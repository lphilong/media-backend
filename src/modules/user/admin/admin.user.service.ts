import crypto from "crypto";
import {
  ClientSession,
  MongoServerError,
} from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import { SystemInvariantError } from "@core/error/system-error";
import { BaseAppError } from "@core/errors/base.error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "@core/permission/permission.contract";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import {
  createStructuredLogger,
  StructuredLogger,
} from "@infra/logger.adapter";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import {
  Auth0ManagementPort,
  Auth0ManagementUser,
} from "@modules/user/domain/auth0-management.port";
import {
  createUserActivatedEvent,
  createUserArchivedEvent,
  createUserAuthLinkedEvent,
  createUserCreatedEvent,
  createUserDisabledEvent,
  createUserUpdatedEvent,
} from "@modules/user/domain/user.events";
import {
  UpdateUserProfileInput,
  UserMutationRepository,
} from "@modules/user/domain/user.repository";
import { UserAdminCapabilityRepository } from "@modules/user/domain/user.admin-capability.repository";
import {
  ActivateUserCommand,
  ArchiveUserCommand,
  CreateUserCommand,
  DisableUserCommand,
  ProvisionUserCommand,
  SendPasswordSetupCommand,
  SetAuthLinkageCommand,
  UnlinkAuthLinkageCommand,
  UpdateUserCommand,
  PasswordSetupDeliveryMode,
  UserMutationResult,
} from "@modules/user/shared/user.contracts";
import {
  UserConflictError,
  UserDependencyError,
  UserNotFoundError,
  UserStateError,
  UserValidationError,
} from "@modules/user/domain/user.errors";
import {
  UserAccountStatus,
  UserRecord,
} from "@modules/user/domain/user.types";
import { getCurrentDomainEventCollector } from "@system/event-bridge/domain-event.types";

const GOVERNANCE_RECOVERY_PERMISSION_CODES: readonly string[] =
  [
  Permission.USER_CREATE,
  Permission.USER_ACTIVATE,
  Permission.USER_DISABLE,
  Permission.USER_ARCHIVE,
  Permission.USER_AUTH_LINKAGE_SET,
  Permission.USER_PROVISION_ACCOUNT,
  Permission.USER_AUTH_LINKAGE_UNLINK,
  Permission.USER_PASSWORD_SETUP_SEND,
  Permission.ROLE_CREATE,
  Permission.ROLE_UPDATE,
  Permission.ROLE_ACTIVATE,
  Permission.ROLE_DEACTIVATE,
  Permission.ROLE_ARCHIVE,
  Permission.ROLE_PERMISSION_ASSIGN,
  Permission.ROLE_ASSIGN_TO_USER,
  Permission.ROLE_REVOKE_FROM_USER,
];

const GOVERNANCE_RECOVERY_MIN_DELEGATION_BAND =
  "PRIVILEGED" as const;

const LEGACY_STORAGE_ACTOR_KIND = "STAFF" as const;

const ALLOWED_LIFECYCLE_TRANSITIONS: Readonly<
  Record<UserAccountStatus, readonly UserAccountStatus[]>
> = {
  PENDING: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["DISABLED"],
  DISABLED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
};

type UserFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "dependency_error"
  | "invariant"
  | "unknown";

interface PasswordSetupDeliveryResult {
  readonly deliveryMode: PasswordSetupDeliveryMode;
  readonly emailSent: boolean;
  readonly ticketCreated: boolean;
}

export class UserLifecycleService {
  constructor(
    private readonly repository: UserMutationRepository,
    private readonly adminCapabilityRepository: UserAdminCapabilityRepository,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly actorSnapshotCacheInvalidator: ActorSnapshotCacheInvalidator,
    private readonly auth0Management: Auth0ManagementPort,
    private readonly provisioningOptions: {
      readonly databaseConnection: string;
      readonly passwordResetClientId?: string;
      readonly passwordSetupDeliveryMode: PasswordSetupDeliveryMode;
      readonly passwordSetupResultUrl?: string;
    },
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createUser(
    actor: Actor,
    command: CreateUserCommand,
  ): Promise<UserMutationResult> {
    const mutationType = "user.create";
    const permission = this.assertPermission(
      actor,
      Permission.USER_CREATE,
    );
    const input = normalizeCreateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      mutationType,
      {},
      async (session) => {
        await this.assertEmailIsAvailable(
          input.email,
          undefined,
          session,
        );

        let created: UserRecord;

        try {
          const now = Date.now();
          const userId = crypto.randomUUID();

          created = await this.repository.insert(
            {
              id: userId,
              accountStatus: "PENDING",
              actorKind: LEGACY_STORAGE_ACTOR_KIND,
              authLinkage: {
                provider: "auth0",
                subject: createUnlinkedSubject(userId),
                status: "UNLINKED",
              },
              profile: {
                displayName: input.displayName,
                email: input.email,
                phone: input.phone,
              },
              contextAccess: {
                contexts: ["ADMIN"],
              },
              preferences: {
                locale: input.locale,
                timezone: input.timezone,
              },
              createdAt: now,
              updatedAt: now,
              activatedAt: null,
              disabledAt: null,
              archivedAt: null,
            },
            session,
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new UserConflictError(
              "Email or auth linkage already exists",
            );
          }

          throw error;
        }

        await this.recordUserAudit({
          actor,
          permission,
          userId: created.id,
          mutationType,
          metadata: {},
          session,
        });

        getCurrentDomainEventCollector().emit(
          createUserCreatedEvent({
            userId: created.id,
            aggregateVersion: created.updatedAt,
            occurredAt: created.updatedAt,
          }),
        );

        return { user: created };
      },
      (result) => ({
        userId: result.user.id,
        accountStatus: result.user.accountStatus,
      }),
    );
  }

  async updateUser(
    actor: Actor,
    command: UpdateUserCommand,
  ): Promise<UserMutationResult> {
    const mutationType = "user.update";
    const permission = this.assertPermission(
      actor,
      Permission.USER_EDIT,
    );

    const userId = normalizeRequiredText(
      command.userId,
      "userId",
    );
    const updates =
      normalizeUpdateFieldsFromCommand(command);

    return this.executeMutation(
      actor,
      permission,
      mutationType,
      {
        userId: readOptionalLogString(command.userId),
      },
      async (session) => {
        const current = await this.requireUser(
          userId,
          session,
        );

        if (current.accountStatus === "ARCHIVED") {
          throw new UserStateError(
            `User in state ARCHIVED cannot execute operation: updateUser`,
          );
        }

        const profilePatch = toProfilePatch({
          current,
          updates,
          userId,
        });

        const changedFields = Object.keys(
          profilePatch,
        ).filter((field) => field !== "updatedAt");

        if (changedFields.length === 0) {
          throw new UserValidationError(
            "At least one changed field is required",
          );
        }

        await this.assertEmailIsAvailable(
          profilePatch.email,
          userId,
          session,
        );

        let updated: UserRecord | null;

        try {
          updated = await this.repository.updateProfile(
            profilePatch,
            session,
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new UserConflictError(
              "User email already exists",
            );
          }

          throw error;
        }

        if (!updated) {
          throw new UserConflictError(
            `Failed to update user: ${userId}`,
          );
        }

        await this.recordUserAudit({
          actor,
          permission,
          userId,
          mutationType,
          metadata: {
            changedFields,
          },
          session,
        });

        getCurrentDomainEventCollector().emit(
          createUserUpdatedEvent({
            userId,
            changedFields,
            aggregateVersion: updated.updatedAt,
            occurredAt: updated.updatedAt,
          }),
        );

        return { user: updated };
      },
      (result) => ({
        userId: result.user.id,
        accountStatus: result.user.accountStatus,
      }),
    );
  }

  async activateUser(
    actor: Actor,
    command: ActivateUserCommand,
  ): Promise<UserMutationResult> {
    const mutationType = "user.activate";
    const permission = this.assertPermission(
      actor,
      Permission.USER_ACTIVATE,
    );
    const userId = normalizeRequiredText(
      command.userId,
      "userId",
    );

    return this.executeMutation(
      actor,
      permission,
      mutationType,
      {
        userId: readOptionalLogString(command.userId),
      },
      async (session, controls) => {
        const current = await this.requireUser(
          userId,
          session,
        );

        assertLifecycleTransition(
          current.accountStatus,
          "ACTIVE",
        );

        const updated =
          await this.repository.transitionLifecycle(
            {
              userId,
              fromStates: [current.accountStatus],
              toState: "ACTIVE",
              changedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new UserConflictError(
            `User state transition conflict: ${userId}`,
          );
        }

        await this.recordUserAudit({
          actor,
          permission,
          userId,
          mutationType,
          metadata: {
            previousState: current.accountStatus,
            nextState: "ACTIVE",
          },
          session,
        });

        getCurrentDomainEventCollector().emit(
          createUserActivatedEvent({
            userId,
            aggregateVersion: updated.updatedAt,
            occurredAt: updated.updatedAt,
          }),
        );

        controls.markAuthSecurityTruthChanged();

        return { user: updated };
      },
      (result) => ({
        userId: result.user.id,
        accountStatus: result.user.accountStatus,
      }),
      {
        invalidateActorSnapshots: true,
      },
    );
  }

  async provisionUser(
    actor: Actor,
    command: ProvisionUserCommand,
  ): Promise<UserMutationResult> {
    const mutationType = "user.provision-account";
    const permission = this.assertPermission(
      actor,
      Permission.USER_PROVISION_ACCOUNT,
    );
    const input = normalizeProvisionCommand(command);

    return this.executeMutation(
      actor,
      permission,
      mutationType,
      {
        emailHash: hashForAudit(input.email),
        credentialMode: input.credentialMode,
      },
      async (session) => {
        await this.assertEmailIsAvailable(
          input.email,
          undefined,
          session,
        );

        const existingAuth0User =
          await this.auth0Management.findUserByEmail(
            input.email,
          );
        const auth0User =
          existingAuth0User ??
          (await this.auth0Management.createDatabaseUser({
            email: input.email,
            displayName: input.displayName,
            connection:
              this.provisioningOptions.databaseConnection,
            password: generateTemporaryPassword(),
            verifyEmail: false,
          }));

        const duplicateAuth =
          await this.repository.findByAuthSubject(
            auth0User.id,
            session,
          );

        if (duplicateAuth) {
          throw new UserConflictError(
            "Auth0 user is already linked to an internal user",
          );
        }

        const passwordSetup =
          input.sendInvitation === false
            ? null
            : await this.deliverPasswordSetup({
                auth0UserId: auth0User.id,
                email: input.email,
              });

        let created: UserRecord;

        try {
          const now = Date.now();

          created = await this.repository.insert(
            {
              id: crypto.randomUUID(),
              accountStatus: "PENDING",
              actorKind: LEGACY_STORAGE_ACTOR_KIND,
              authLinkage: {
                provider: "auth0",
                subject: auth0User.id,
                status: "LINKED",
              },
              profile: {
                displayName: input.displayName,
                email: input.email,
                phone: input.phone,
              },
              contextAccess: {
                contexts: ["ADMIN"],
              },
              preferences: {
                locale: input.locale,
                timezone: input.timezone,
              },
              createdAt: now,
              updatedAt: now,
              activatedAt: null,
              disabledAt: null,
              archivedAt: null,
            },
            session,
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new UserConflictError(
              "Email or auth linkage already exists",
            );
          }

          throw error;
        }

        await this.recordUserAudit({
          actor,
          permission,
          userId: created.id,
          mutationType,
          metadata: {
            emailHash: hashForAudit(input.email),
            auth0Subject: redactSubjectForAudit(auth0User.id),
            auth0UserCreated: existingAuth0User === null,
            provider: "auth0",
            deliveryMode:
              this.provisioningOptions
                .passwordSetupDeliveryMode,
            invitationEmailSent:
              passwordSetup?.emailSent === true,
            invitationTicketCreated:
              passwordSetup?.ticketCreated === true,
          },
          session,
        });

        getCurrentDomainEventCollector().emit(
          createUserCreatedEvent({
            userId: created.id,
            aggregateVersion: created.updatedAt,
            occurredAt: created.updatedAt,
          }),
        );

        return {
          user: created,
          provisioning: {
            credentialMode: "INVITE_LINK",
            auth0UserCreated: existingAuth0User === null,
            invitationEmailSent:
              passwordSetup?.emailSent === true,
            invitationTicketCreated:
              passwordSetup?.ticketCreated === true,
            passwordSetupDeliveryMode:
              this.provisioningOptions
                .passwordSetupDeliveryMode,
          },
          passwordSetup: passwordSetup
            ? {
                deliveryMode: passwordSetup.deliveryMode,
                emailSent: passwordSetup.emailSent,
                ticketCreated: passwordSetup.ticketCreated,
              }
            : undefined,
        };
      },
      (result) => ({
        userId: result.user.id,
        accountStatus: result.user.accountStatus,
        invitationTicketCreated:
          result.provisioning?.invitationTicketCreated === true,
        invitationEmailSent:
          result.provisioning?.invitationEmailSent === true,
        deliveryMode:
          result.provisioning?.passwordSetupDeliveryMode,
      }),
    );
  }

  async disableUser(
    actor: Actor,
    command: DisableUserCommand,
  ): Promise<UserMutationResult> {
    const mutationType = "user.disable";
    const permission = this.assertPermission(
      actor,
      Permission.USER_DISABLE,
    );
    const userId = normalizeRequiredText(
      command.userId,
      "userId",
    );

    if (userId === actor.id) {
      throw new UserDependencyError(
        "Cannot disable the current actor",
      );
    }

    return this.executeMutation(
      actor,
      permission,
      mutationType,
      {
        userId: readOptionalLogString(command.userId),
      },
      async (session, controls) => {
        const current = await this.requireUser(
          userId,
          session,
        );

        assertLifecycleTransition(
          current.accountStatus,
          "DISABLED",
        );

        await this.assertNotLastGovernanceRecoveryActor(
          current,
          "disableUser",
          session,
        );

        await this.assertNoActiveRoleAssignments(
          userId,
          "disableUser",
          session,
        );

        const updated =
          await this.repository.transitionLifecycle(
            {
              userId,
              fromStates: [current.accountStatus],
              toState: "DISABLED",
              changedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new UserConflictError(
            `User state transition conflict: ${userId}`,
          );
        }

        await this.recordUserAudit({
          actor,
          permission,
          userId,
          mutationType,
          metadata: {
            previousState: current.accountStatus,
            nextState: "DISABLED",
          },
          session,
        });

        getCurrentDomainEventCollector().emit(
          createUserDisabledEvent({
            userId,
            aggregateVersion: updated.updatedAt,
            occurredAt: updated.updatedAt,
          }),
        );

        controls.markAuthSecurityTruthChanged();

        return { user: updated };
      },
      (result) => ({
        userId: result.user.id,
        accountStatus: result.user.accountStatus,
      }),
      {
        invalidateActorSnapshots: true,
      },
    );
  }

  async archiveUser(
    actor: Actor,
    command: ArchiveUserCommand,
  ): Promise<UserMutationResult> {
    const mutationType = "user.archive";
    const permission = this.assertPermission(
      actor,
      Permission.USER_ARCHIVE,
    );
    const userId = normalizeRequiredText(
      command.userId,
      "userId",
    );

    if (userId === actor.id) {
      throw new UserDependencyError(
        "Cannot archive the current actor",
      );
    }

    return this.executeMutation(
      actor,
      permission,
      mutationType,
      {
        userId: readOptionalLogString(command.userId),
      },
      async (session) => {
        const current = await this.requireUser(
          userId,
          session,
        );

        assertLifecycleTransition(
          current.accountStatus,
          "ARCHIVED",
        );

        await this.assertNotLastGovernanceRecoveryActor(
          current,
          "archiveUser",
          session,
        );

        await this.assertNoActiveRoleAssignments(
          userId,
          "archiveUser",
          session,
        );

        const updated =
          await this.repository.transitionLifecycle(
            {
              userId,
              fromStates: [current.accountStatus],
              toState: "ARCHIVED",
              changedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new UserConflictError(
            `User state transition conflict: ${userId}`,
          );
        }

        await this.recordUserAudit({
          actor,
          permission,
          userId,
          mutationType,
          metadata: {
            previousState: current.accountStatus,
            nextState: "ARCHIVED",
          },
          session,
        });

        getCurrentDomainEventCollector().emit(
          createUserArchivedEvent({
            userId,
            aggregateVersion: updated.updatedAt,
            occurredAt: updated.updatedAt,
          }),
        );

        return { user: updated };
      },
      (result) => ({
        userId: result.user.id,
        accountStatus: result.user.accountStatus,
      }),
      {
        invalidateActorSnapshots: true,
      },
    );
  }

  async setAuthLinkage(
    actor: Actor,
    command: SetAuthLinkageCommand,
  ): Promise<UserMutationResult> {
    const mutationType = "user.auth-linkage.set";
    const permission = this.assertPermission(
      actor,
      Permission.USER_AUTH_LINKAGE_SET,
    );

    const input = normalizeSetAuthLinkageCommand(
      command,
    );

    return this.executeMutation(
      actor,
      permission,
      mutationType,
      {
        userId: readOptionalLogString(command.userId),
        provider: readOptionalLogString(command.provider),
      },
      async (session, controls) => {
        const current = await this.requireUser(
          input.userId,
          session,
        );

        if (current.accountStatus === "ARCHIVED") {
          throw new UserStateError(
            `User in state ARCHIVED cannot execute operation: setAuthLinkage`,
          );
        }

        if (
          current.authLinkage.provider ===
            input.provider &&
          current.authLinkage.subject ===
            input.subject
        ) {
          throw new UserValidationError(
            "At least one changed field is required",
          );
        }

        await this.assertNotLastGovernanceRecoveryActor(
          current,
          "setAuthLinkage",
          session,
        );

        const duplicate =
          await this.repository.findByAuthSubject(
            input.subject,
            session,
          );

        if (duplicate && duplicate.id !== current.id) {
          throw new UserConflictError(
            `Auth subject already linked: ${input.subject}`,
          );
        }

        const auth0User = await this.requireAuth0User(
          input.subject,
        );

        let updated: UserRecord | null = null;

        try {
          updated = await this.repository.setAuthLinkage(
            {
              userId: input.userId,
              provider: input.provider,
              subject: input.subject,
              status: "LINKED",
              updatedAt: Date.now(),
            },
            session,
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new UserConflictError(
              `Auth subject already linked: ${input.subject}`,
            );
          }

          throw error;
        }

        if (!updated) {
          throw new UserConflictError(
            `Failed to set auth linkage for user: ${input.userId}`,
          );
        }

        await this.recordUserAudit({
          actor,
          permission,
          userId: input.userId,
          mutationType,
          metadata: {
            previousAuthLinkage: {
              provider:
                current.authLinkage.provider,
              subject: redactSubjectForAudit(
                current.authLinkage.subject,
              ),
              status: current.authLinkage.status ?? "LINKED",
            },
            nextAuthLinkage: {
              provider: input.provider,
              subject: redactSubjectForAudit(auth0User.id),
              status: "LINKED",
            },
          },
          session,
        });

        getCurrentDomainEventCollector().emit(
          createUserAuthLinkedEvent({
            userId: input.userId,
            provider: input.provider,
            subject: input.subject,
            aggregateVersion: updated.updatedAt,
            occurredAt: updated.updatedAt,
          }),
        );

        const authLinkageChanged =
          current.authLinkage.provider !==
            updated.authLinkage.provider ||
          current.authLinkage.subject !==
            updated.authLinkage.subject;

        if (
          current.accountStatus === "ACTIVE" &&
          authLinkageChanged
        ) {
          controls.markAuthSecurityTruthChanged();
        }

        return { user: updated };
      },
      (result) => ({
        userId: result.user.id,
        accountStatus: result.user.accountStatus,
      }),
      {
        invalidateActorSnapshots: true,
      },
    );
  }

  async unlinkAuthLinkage(
    actor: Actor,
    command: UnlinkAuthLinkageCommand,
  ): Promise<UserMutationResult> {
    const mutationType = "user.auth-linkage.unlink";
    const permission = this.assertPermission(
      actor,
      Permission.USER_AUTH_LINKAGE_UNLINK,
    );
    const userId = normalizeRequiredText(
      command.userId,
      "userId",
    );

    if (userId === actor.id) {
      throw new UserDependencyError(
        "Cannot unlink Auth0 linkage for the current actor",
      );
    }

    return this.executeMutation(
      actor,
      permission,
      mutationType,
      {
        userId: readOptionalLogString(command.userId),
      },
      async (session, controls) => {
        const current = await this.requireUser(
          userId,
          session,
        );

        if (current.accountStatus === "ARCHIVED") {
          throw new UserStateError(
            `User in state ARCHIVED cannot execute operation: unlinkAuthLinkage`,
          );
        }

        if (
          (current.authLinkage.status ?? "LINKED") ===
          "UNLINKED"
        ) {
          throw new UserValidationError(
            "Auth linkage is already unlinked",
          );
        }

        await this.assertNotLastGovernanceRecoveryActor(
          current,
          "unlinkAuthLinkage",
          session,
        );

        const updated =
          await this.repository.setAuthLinkage(
            {
              userId,
              provider: "auth0",
              subject: createUnlinkedSubject(userId),
              status: "UNLINKED",
              accountStatus: "PENDING",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new UserConflictError(
            `Failed to unlink auth linkage for user: ${userId}`,
          );
        }

        await this.recordUserAudit({
          actor,
          permission,
          userId,
          mutationType,
          metadata: {
            previousAuthLinkage: {
              provider:
                current.authLinkage.provider,
              subject: redactSubjectForAudit(
                current.authLinkage.subject,
              ),
              status: current.authLinkage.status ?? "LINKED",
            },
            nextAuthLinkage: {
              provider: "auth0",
              status: "UNLINKED",
            },
            previousState: current.accountStatus,
            nextState: "PENDING",
          },
          session,
        });

        if (current.accountStatus === "ACTIVE") {
          controls.markAuthSecurityTruthChanged();
        }

        return { user: updated };
      },
      (result) => ({
        userId: result.user.id,
        accountStatus: result.user.accountStatus,
        authLinkageStatus:
          result.user.authLinkage.status ?? "LINKED",
      }),
      {
        invalidateActorSnapshots: true,
      },
    );
  }

  async sendPasswordSetup(
    actor: Actor,
    command: SendPasswordSetupCommand,
  ): Promise<UserMutationResult> {
    const mutationType = "user.password-setup.send";
    const permission = this.assertPermission(
      actor,
      Permission.USER_PASSWORD_SETUP_SEND,
    );
    const userId = normalizeRequiredText(
      command.userId,
      "userId",
    );

    return this.executeMutation(
      actor,
      permission,
      mutationType,
      {
        userId: readOptionalLogString(command.userId),
      },
      async (session) => {
        const current = await this.requireUser(
          userId,
          session,
        );

        if (current.accountStatus === "ARCHIVED") {
          throw new UserStateError(
            `User in state ARCHIVED cannot execute operation: sendPasswordSetup`,
          );
        }

        if (
          (current.authLinkage.status ?? "LINKED") !==
          "LINKED"
        ) {
          throw new UserValidationError(
            "User must have linked Auth0 identity",
          );
        }

        const email = current.profile.email;
        if (!email) {
          throw new UserValidationError(
            "User must have an email address",
          );
        }

        const passwordSetup =
          await this.deliverPasswordSetup({
            auth0UserId: current.authLinkage.subject,
            email,
          });

        await this.recordUserAudit({
          actor,
          permission,
          userId,
          mutationType,
          metadata: {
            auth0Subject: redactSubjectForAudit(
              current.authLinkage.subject,
            ),
            provider: "auth0",
            deliveryMode: passwordSetup.deliveryMode,
            emailHash: hashForAudit(email),
            emailSent: passwordSetup.emailSent === true,
            ticketCreated:
              passwordSetup.ticketCreated === true,
          },
          session,
        });

        return {
          user: current,
          passwordSetup: {
            deliveryMode: passwordSetup.deliveryMode,
            emailSent: passwordSetup.emailSent,
            ticketCreated: passwordSetup.ticketCreated,
          },
        };
      },
      (result) => ({
        userId: result.user.id,
        accountStatus: result.user.accountStatus,
        emailSent:
          result.passwordSetup?.emailSent === true,
        ticketCreated:
          result.passwordSetup?.ticketCreated === true,
        deliveryMode: result.passwordSetup?.deliveryMode,
      }),
    );
  }

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    const permission =
      PermissionResolver.resolve(permissionCode);

    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private async recordUserAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly userId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.userId,
      {
        mutationType: params.mutationType,
        targetId: params.userId,
        targetType: "user",
        actorId: params.actor.id,
        ...params.metadata,
      },
      params.session,
    );
  }

  private async executeMutation<T>(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    startMetadata: Readonly<Record<string, unknown>>,
    fn: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
    onSuccess: (result: T) => Readonly<Record<string, unknown>>,
    options?: {
      readonly invalidateActorSnapshots?: boolean;
    },
  ): Promise<T> {
    this.logMutationEvent(
      actor,
      operation,
      "mutation.start",
      startMetadata,
    );

    try {
      const traceId = getTraceIdOrThrow();

      const result = await this.mutationBridge.execute(
        {
          actor,
          traceId,
          requiredPermission: permission,
          mutationIdentity: operation,
          mutationTargetDescriptor:
            buildMutationTargetDescriptor(
              startMetadata,
            ),
        },
        async (session, controls) =>
          fn(session, controls),
      );

      if (options?.invalidateActorSnapshots) {
        await this.actorSnapshotCacheInvalidator.invalidateAll(
          {
            traceId,
            actorId: actor.id,
            context: actor.context,
            operation,
          },
        );
      }

      this.logMutationEvent(
        actor,
        operation,
        "mutation.success",
        {
          ...startMetadata,
          ...onSuccess(result),
        },
      );

      return result;
    } catch (error) {
      const resolvedError =
        error instanceof MongoServerError
          ? new UserDependencyError(
              "User persistence mutation failed",
            )
          : error;

      this.logger.warn({
        traceId: getTraceIdOrThrow(),
        actorId: actor.id,
        context: actor.context,
        operation,
        status: "mutation.failed",
        timestamp: Date.now(),
        metadata: {
          ...startMetadata,
          classification:
            classifyUserMutationFailure(
              resolvedError,
            ),
          errorCode: extractErrorCode(resolvedError),
          errorMessage:
            truncateLogMessage(resolvedError),
        },
      });

      throw resolvedError;
    }
  }

  private logMutationEvent(
    actor: Actor,
    operation: AuthoritativeAdminMutationIdentity,
    status: "mutation.start" | "mutation.success",
    metadata: Readonly<Record<string, unknown>>,
  ): void {
    this.logger.info({
      traceId: getTraceIdOrThrow(),
      actorId: actor.id,
      context: actor.context,
      operation,
      status,
      timestamp: Date.now(),
      metadata,
    });
  }

  private async requireUser(
    userId: string,
    session: ClientSession,
  ): Promise<UserRecord> {
    const user = await this.repository.findById(
      userId,
      session,
    );

    if (!user) {
      throw new UserNotFoundError(userId);
    }

    return user;
  }

  private async assertNotLastGovernanceRecoveryActor(
    target: UserRecord,
    operation:
      | "disableUser"
      | "archiveUser"
      | "setAuthLinkage"
      | "unlinkAuthLinkage",
    session: ClientSession,
  ): Promise<void> {
    if (target.accountStatus !== "ACTIVE") {
      return;
    }

    const recoverableUserIds =
      await this.adminCapabilityRepository.listActiveUserIdsWithGovernanceRecoverySurface(
        GOVERNANCE_RECOVERY_PERMISSION_CODES,
        GOVERNANCE_RECOVERY_MIN_DELEGATION_BAND,
        session,
      );

    if (
      recoverableUserIds.length !== 1 ||
      recoverableUserIds[0] !== target.id
    ) {
      return;
    }

    throw new UserDependencyError(
      `Cannot ${operation}: ${target.id} is the last ACTIVE user with full governance recovery surface`,
    );
  }

  private async assertNoActiveRoleAssignments(
    userId: string,
    operation: "disableUser" | "archiveUser",
    session: ClientSession,
  ): Promise<void> {
    const hasActiveRoleAssignments =
      await this.adminCapabilityRepository.hasActiveRoleAssignments(
        userId,
        session,
      );

    if (!hasActiveRoleAssignments) {
      return;
    }

    throw new UserDependencyError(
      `Cannot ${operation}: ${userId} has ACTIVE role assignments`,
    );
  }

  private async assertEmailIsAvailable(
    email: string | undefined,
    currentUserId: string | undefined,
    session: ClientSession,
  ): Promise<void> {
    if (email === undefined) {
      return;
    }

    const existing = await this.repository.findByEmail(
      email,
      session,
    );

    if (existing && existing.id !== currentUserId) {
      throw new UserConflictError(
        "User email already exists",
      );
    }
  }

  private async deliverPasswordSetup(params: {
    readonly auth0UserId: string;
    readonly email: string;
  }): Promise<PasswordSetupDeliveryResult> {
    const deliveryMode =
      this.provisioningOptions.passwordSetupDeliveryMode;

    if (deliveryMode === "auth0_email") {
      await this.auth0Management.sendPasswordResetEmail({
        email: params.email,
        connection:
          this.provisioningOptions.databaseConnection,
        clientId:
          this.provisioningOptions.passwordResetClientId,
      });

      return {
        deliveryMode,
        emailSent: true,
        ticketCreated: false,
      };
    }

    const ticket =
      await this.auth0Management.createPasswordChangeTicket({
        userId: params.auth0UserId,
        resultUrl:
          this.provisioningOptions.passwordSetupResultUrl,
      });

    return {
      deliveryMode,
      emailSent: false,
      ticketCreated: ticket.ticketCreated,
    };
  }

  private async requireAuth0User(
    subject: string,
  ): Promise<Auth0ManagementUser> {
    const user = await this.auth0Management.getUserById(
      subject,
    );

    if (!user) {
      throw new UserDependencyError(
        "Auth0 user does not exist",
      );
    }

    return user;
  }
}

function buildMutationTargetDescriptor(
  metadata: Readonly<Record<string, unknown>>,
): string {
  const encoded = JSON.stringify(metadata);

  if (
    typeof encoded === "string" &&
    encoded.length > 2
  ) {
    return encoded;
  }

  return "target:unspecified";
}

interface NormalizedCreateCommand {
  readonly displayName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly locale?: string;
  readonly timezone?: string;
}

interface NormalizedProvisionCommand {
  readonly displayName: string;
  readonly email: string;
  readonly phone?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly credentialMode: "INVITE_LINK";
  readonly sendInvitation?: boolean;
}

interface NormalizedSetAuthLinkageCommand {
  readonly userId: string;
  readonly provider: "auth0";
  readonly subject: string;
}

function normalizeCreateCommand(
  command: CreateUserCommand,
): NormalizedCreateCommand {
  assertNoUserAdminAuthorityFields(command, "USER_CREATE");
  assertNoLegacyCreateAuthBinding(command);

  return {
    displayName: normalizeRequiredText(
      command.displayName,
      "displayName",
    ),
    email: normalizeOptionalEmail(
      command.email,
      "email",
    ),
    phone: normalizeOptionalText(
      command.phone,
      "phone",
    ),
    locale: normalizeOptionalText(
      command.locale,
      "locale",
    ),
    timezone: normalizeOptionalText(
      command.timezone,
      "timezone",
    ),
  };
}

function assertNoLegacyCreateAuthBinding(
  command: object,
): void {
  const rejectedFields = ["authSubject", "authLinkage"].filter(
    (field) =>
      Object.prototype.hasOwnProperty.call(command, field),
  );

  if (rejectedFields.length === 0) {
    return;
  }

  throw new UserValidationError(
    `USER_CREATE payload cannot include ${rejectedFields.join(", ")}; use USER_PROVISION or USER_AUTH_LINKAGE_SET`,
  );
}

function normalizeProvisionCommand(
  command: ProvisionUserCommand,
): NormalizedProvisionCommand {
  assertNoUserAdminAuthorityFields(command, "USER_PROVISION");
  const credentialMode =
    command.credentialMode ?? "INVITE_LINK";

  if (credentialMode !== "INVITE_LINK") {
    throw new UserValidationError(
      "credentialMode must be INVITE_LINK",
    );
  }

  if (
    command.sendInvitation !== undefined &&
    typeof command.sendInvitation !== "boolean"
  ) {
    throw new UserValidationError(
      "sendInvitation must be a boolean",
    );
  }

  return {
    displayName: normalizeRequiredText(
      command.displayName,
      "displayName",
    ),
    email: normalizeRequiredEmail(command.email, "email"),
    phone: normalizeOptionalText(
      command.phone,
      "phone",
    ),
    locale: normalizeOptionalText(
      command.locale,
      "locale",
    ),
    timezone: normalizeOptionalText(
      command.timezone,
      "timezone",
    ),
    credentialMode,
    sendInvitation: command.sendInvitation,
  };
}

function normalizeUpdateFieldsFromCommand(
  command: UpdateUserCommand,
): Omit<
  UpdateUserProfileInput,
  "userId" | "updatedAt"
> {
  assertNoUserAdminAuthorityFields(command, "USER_UPDATE");

  return {
    displayName: normalizeOptionalText(
      command.displayName,
      "displayName",
    ),
    email: normalizeOptionalEmail(
      command.email,
      "email",
    ),
    phone: normalizeOptionalText(
      command.phone,
      "phone",
    ),
    locale: normalizeOptionalText(
      command.locale,
      "locale",
    ),
    timezone: normalizeOptionalText(
      command.timezone,
      "timezone",
    ),
  };
}

function normalizeSetAuthLinkageCommand(
  command: SetAuthLinkageCommand,
): NormalizedSetAuthLinkageCommand {
  const provider = normalizeRequiredText(
    command.provider,
    "provider",
  );
  const subject = normalizeRequiredText(
    command.subject,
    "subject",
  );

  if (provider !== "auth0") {
    throw new UserValidationError(
      "authLinkage.provider must be auth0",
    );
  }

  return {
    userId: normalizeRequiredText(
      command.userId,
      "userId",
    ),
    provider: "auth0",
    subject,
  };
}

function normalizeRequiredText(
  input: unknown,
  field: string,
): string {
  if (typeof input !== "string") {
    throw new UserValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = input.trim();

  if (!normalized) {
    throw new UserValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function normalizeOptionalText(
  input: unknown,
  field: string,
): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input !== "string") {
    throw new UserValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = input.trim();

  if (!normalized) {
    throw new UserValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function assertNoUserAdminAuthorityFields(
  command: object,
  operation: "USER_CREATE" | "USER_PROVISION" | "USER_UPDATE",
): void {
  const rejectedFields = [
    "actorKind",
    "accountContext",
    "accountContexts",
    "consoleCode",
    "workspaceAvailability",
    "primaryWorkspace",
    "hasWorkspace",
    "manualEntitlement",
    "manualConsoleEntitlement",
    "consoleEntitlement",
    "entitlements",
    "permissions",
    "roles",
    "roleIds",
    "scope",
    "scopes",
    "scopeGrants",
    "rawPermissions",
    "rules",
  ].filter((field) =>
    Object.prototype.hasOwnProperty.call(command, field),
  );

  if (rejectedFields.length === 0) {
    return;
  }

  throw new UserValidationError(
    `${operation} payload cannot include authority field(s): ${rejectedFields.join(", ")}`,
  );
}

function normalizeRequiredEmail(
  input: unknown,
  field: string,
): string {
  const normalized = normalizeRequiredText(input, field)
    .toLowerCase();

  assertEmailShape(normalized, field);
  return normalized;
}

function normalizeOptionalEmail(
  input: unknown,
  field: string,
): string | undefined {
  const normalized = normalizeOptionalText(input, field);

  if (normalized === undefined) {
    return undefined;
  }

  const email = normalized.toLowerCase();
  assertEmailShape(email, field);
  return email;
}

function assertEmailShape(email: string, field: string): void {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    return;
  }

  throw new UserValidationError(
    `${field} must be a valid email address`,
  );
}

function toProfilePatch(params: {
  current: UserRecord;
  updates: Omit<
    UpdateUserProfileInput,
    "userId" | "updatedAt"
  >;
  userId: string;
}): UpdateUserProfileInput {
  const patch: {
    userId: string;
    updatedAt: number;
    displayName?: string;
    email?: string;
    phone?: string;
    locale?: string;
    timezone?: string;
  } = {
    userId: params.userId,
    updatedAt: Date.now(),
  };

  if (
    params.updates.displayName !== undefined &&
    params.updates.displayName !==
      params.current.profile.displayName
  ) {
    patch.displayName = params.updates.displayName;
  }

  if (
    params.updates.email !== undefined &&
    params.updates.email !== params.current.profile.email
  ) {
    patch.email = params.updates.email;
  }

  if (
    params.updates.phone !== undefined &&
    params.updates.phone !== params.current.profile.phone
  ) {
    patch.phone = params.updates.phone;
  }

  if (
    params.updates.locale !== undefined &&
    params.updates.locale !==
      params.current.preferences.locale
  ) {
    patch.locale = params.updates.locale;
  }

  if (
    params.updates.timezone !== undefined &&
    params.updates.timezone !==
      params.current.preferences.timezone
  ) {
    patch.timezone = params.updates.timezone;
  }

  return patch;
}

function assertLifecycleTransition(
  from: UserAccountStatus,
  to: UserAccountStatus,
): void {
  if (from === to) {
    throw new UserStateError(
      `User cannot transition from ${from} to ${to}`,
    );
  }

  const allowedTargets =
    ALLOWED_LIFECYCLE_TRANSITIONS[from] ?? [];

  if (allowedTargets.includes(to)) {
    return;
  }

  throw new UserStateError(
    `User cannot transition from ${from} to ${to}`,
  );
}

function isDuplicateKeyError(
  error: unknown,
): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000
  );
}

function classifyUserMutationFailure(
  error: unknown,
): UserFailureClassification {
  if (error instanceof UserValidationError) {
    return "validation";
  }

  if (error instanceof UserConflictError) {
    return "conflict";
  }

  if (error instanceof UserNotFoundError) {
    return "not_found";
  }

  if (error instanceof UserStateError) {
    return "state_error";
  }

  if (error instanceof UserDependencyError) {
    return "dependency_error";
  }

  if (error instanceof SystemInvariantError) {
    return "invariant";
  }

  return "unknown";
}

function extractErrorCode(
  error: unknown,
): string | undefined {
  if (error instanceof BaseAppError) {
    return error.code;
  }

  if (error instanceof SystemInvariantError) {
    return error.code;
  }

  return undefined;
}

function truncateLogMessage(
  error: unknown,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : String(error);

  if (raw.length <= 256) {
    return raw;
  }

  return `${raw.slice(0, 253)}...`;
}

function readOptionalLogString(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function hashForAudit(value: string): string {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function generateTemporaryPassword(): string {
  return `T1!${crypto.randomBytes(32).toString("base64url")}aZ9#`;
}

function redactSubjectForAudit(subject: string): string {
  const normalized = subject.trim();

  if (normalized.length <= 8) {
    return "[redacted]";
  }

  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function createUnlinkedSubject(userId: string): string {
  return `unlinked:${userId}:${crypto.randomUUID()}`;
}
