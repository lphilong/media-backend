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
import {
  BusinessCodeSequenceRepository,
  formatBusinessCode,
} from "@core/business-code/business-code-sequence.repository";
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
import {
  PlatformAccountInvalidOwnerReferenceError,
  PlatformAccountConflictError,
  PlatformAccountInvalidPlatformIdentityError,
  PlatformAccountNotFoundError,
  PlatformAccountStateError,
  PlatformAccountValidationError,
} from "@modules/platform-account/domain/platform-account.errors";
import { PLATFORM_ACCOUNT_CODE_POLICY } from "@modules/platform-account/domain/platform-account-code-policy";
import {
  PlatformAccountOrgUnitReadonlyAccess,
  PlatformAccountReferencedOrgUnit,
} from "@modules/platform-account/domain/platform-account-org-unit-readonly-access";
import { PlatformAccountEventAssignmentReadonlyAccess } from "@modules/platform-account/domain/platform-account-event-assignment-readonly-access";
import {
  PlatformAccountRepository,
  UpdatePlatformAccountCoreInput,
} from "@modules/platform-account/domain/platform-account.repository";
import {
  PlatformAccountReferencedTalent,
  PlatformAccountTalentReadonlyAccess,
} from "@modules/platform-account/domain/platform-account-talent-readonly-access";
import {
  PlatformAccountReferencedTalentGroup,
  PlatformAccountTalentGroupReadonlyAccess,
} from "@modules/platform-account/domain/platform-account-talent-group-readonly-access";
import {
  PLATFORM_ACCOUNT_OPERATIONAL_STATUSES,
  PLATFORM_ACCOUNT_OWNER_KINDS,
  PLATFORM_ACCOUNT_PLATFORMS,
  PLATFORM_ACCOUNT_SURFACE_TYPES,
  PlatformAccountMutationView,
  PlatformAccountOperationalStatus,
  PlatformAccountOwnerKind,
  PlatformAccountPlatform,
  PlatformAccountRecord,
  PlatformAccountSurfaceType,
} from "@modules/platform-account/domain/platform-account.types";
import {
  ActivatePlatformAccountCommand,
  ArchivePlatformAccountCommand,
  CreatePlatformAccountCommand,
  DeactivatePlatformAccountCommand,
  PlatformAccountMutationResult,
  TransferPlatformAccountOwnershipCommand,
  UpdatePlatformAccountCapabilitiesCommand,
  UpdatePlatformAccountCoreCommand,
} from "@modules/platform-account/shared/platform-account.contracts";

type PlatformAccountFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "invalid_owner_reference"
  | "invalid_platform_identity"
  | "invariant"
  | "unknown";

type OwnerEligibilityRequirement =
  | "ACTIVE_ONLY"
  | "NON_ARCHIVED_ONLY";

interface OwnerReferenceShape {
  readonly ownerKind: PlatformAccountOwnerKind;
  readonly ownerOrgUnitId: string | null;
  readonly ownerTalentId: string | null;
  readonly ownerTalentGroupId: string | null;
  readonly ownerReferenceId: string;
}

interface NormalizedNullableValue {
  readonly value: string | null;
  readonly normalized: string | null;
}

interface NormalizedCreateCommand
  extends OwnerReferenceShape {
  readonly accountCode: string | undefined;
  readonly platform: PlatformAccountPlatform;
  readonly platformSurfaceType: PlatformAccountSurfaceType;
  readonly displayName: string;
  readonly normalizedDisplayName: string;
  readonly handle: string | null;
  readonly normalizedHandle: string | null;
  readonly externalPlatformId: string | null;
  readonly profileUrl: string | null;
  readonly normalizedProfileUrl: string | null;
  readonly livestreamEnabled: boolean;
  readonly contentPublishingEnabled: boolean;
  readonly monetizationEnabled: boolean;
  readonly description: string | null;
  readonly externalRef: string | null;
}

export class PlatformAccountAdminService {
  constructor(
    private readonly repository: PlatformAccountRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly orgUnitReadonlyAccess: PlatformAccountOrgUnitReadonlyAccess,
    private readonly talentReadonlyAccess: PlatformAccountTalentReadonlyAccess,
    private readonly talentGroupReadonlyAccess: PlatformAccountTalentGroupReadonlyAccess,
    private readonly eventAssignmentReadonlyAccess: PlatformAccountEventAssignmentReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createPlatformAccount(
    actor: Actor,
    command: CreatePlatformAccountCommand,
  ): Promise<PlatformAccountMutationResult> {
    const operation = "platform-account.create";
    const permission = this.assertPermission(
      actor,
      Permission.PLATFORM_ACCOUNT_CREATE,
    );
    const input = normalizeCreateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        accountCode: readOptionalLogString(
          command.accountCode,
        ),
        platform: readOptionalLogString(
          command.platform,
        ),
        ownerKind: readOptionalLogString(
          command.ownerKind,
        ),
        ownerReferenceId: input.ownerReferenceId,
      },
      async (session) => {
        if (input.accountCode !== undefined) {
          const existingCode =
            await this.repository.findByAccountCode(
              input.accountCode,
              session,
            );

          if (existingCode) {
            throw new PlatformAccountConflictError(
              `Platform account code already exists: ${input.accountCode}`,
            );
          }
        }

        await this.assertOwnerEligible(
          input,
          "ACTIVE_ONLY",
          session,
        );
        await this.assertNoLiveIdentityConflicts(
          {
            platform: input.platform,
            normalizedHandle:
              input.normalizedHandle,
            externalPlatformId:
              input.externalPlatformId,
            normalizedProfileUrl:
              input.normalizedProfileUrl,
          },
          session,
        );

        let created!: PlatformAccountRecord;
        const maxAttempts =
          input.accountCode === undefined ? 5 : 1;

        for (
          let attempt = 1;
          attempt <= maxAttempts;
          attempt += 1
        ) {
          const accountCode =
            input.accountCode ??
            (await this.allocateGeneratedCode(session));
          const now = Date.now();
          const record: PlatformAccountRecord = {
            id: crypto.randomUUID(),
            accountCode,
            platform: input.platform,
            platformSurfaceType:
              input.platformSurfaceType,
            displayName: input.displayName,
            normalizedDisplayName:
              input.normalizedDisplayName,
            handle: input.handle,
            normalizedHandle:
              input.normalizedHandle,
            externalPlatformId:
              input.externalPlatformId,
            profileUrl: input.profileUrl,
            normalizedProfileUrl:
              input.normalizedProfileUrl,
            ownerKind: input.ownerKind,
            ownerOrgUnitId:
              input.ownerOrgUnitId,
            ownerTalentId: input.ownerTalentId,
            ownerTalentGroupId:
              input.ownerTalentGroupId,
            operationalStatus: "ACTIVE",
            livestreamEnabled:
              input.livestreamEnabled,
            contentPublishingEnabled:
              input.contentPublishingEnabled,
            monetizationEnabled:
              input.monetizationEnabled,
            description: input.description,
            externalRef: input.externalRef,
            createdAt: now,
            updatedAt: now,
          };

          try {
            created = await this.repository.insert(
              record,
              session,
            );
            break;
          } catch (error) {
            if (!isDuplicateKeyError(error)) {
              throw error;
            }

            if (input.accountCode !== undefined) {
              throw new PlatformAccountConflictError(
                "Platform account identity conflict detected on create",
              );
            }

            if (attempt >= maxAttempts) {
              throw new PlatformAccountConflictError(
                "Generated platform account code conflict detected on create",
              );
            }
          }
        }

        await this.recordAudit({
          actor,
          permission,
          platformAccountId: created.id,
          mutationType: operation,
          metadata: {
            accountCode: created.accountCode,
            platform: created.platform,
            ownerKind: created.ownerKind,
            ownerReferenceId:
              input.ownerReferenceId,
          },
          session,
        });

        return toPlatformAccountMutationView(
          created,
        );
      },
      (result) => ({
        platformAccountId: result.id,
        accountCode: result.accountCode,
        operationalStatus:
          result.operationalStatus,
      }),
    );
  }

  async updatePlatformAccountCore(
    actor: Actor,
    command: UpdatePlatformAccountCoreCommand,
  ): Promise<PlatformAccountMutationResult> {
    const operation = "platform-account.update-core";
    const permission = this.assertPermission(
      actor,
      Permission.PLATFORM_ACCOUNT_UPDATE,
    );
    const platformAccountId = normalizeRequiredText(
      command.platformAccountId,
      "platformAccountId",
    );

    const hasDisplayName =
      command.displayName !== undefined;
    const hasHandle =
      command.handle !== undefined;
    const hasExternalPlatformId =
      command.externalPlatformId !== undefined;
    const hasProfileUrl =
      command.profileUrl !== undefined;
    const hasDescription =
      command.description !== undefined;
    const hasExternalRef =
      command.externalRef !== undefined;

    if (
      !hasDisplayName &&
      !hasHandle &&
      !hasExternalPlatformId &&
      !hasProfileUrl &&
      !hasDescription &&
      !hasExternalRef
    ) {
      throw new PlatformAccountValidationError(
        "At least one field must be provided for update",
      );
    }

    const displayName = hasDisplayName
      ? normalizeDisplayText(
          command.displayName,
          "displayName",
        )
      : undefined;
    const handleIdentity = hasHandle
      ? normalizeHandleIdentity(
          command.handle,
          "handle",
        )
      : undefined;
    const externalPlatformId = hasExternalPlatformId
      ? normalizeNullableOpaquePatchText(
          command.externalPlatformId,
          "externalPlatformId",
        )
      : undefined;
    const profileUrlIdentity = hasProfileUrl
      ? normalizeProfileUrlIdentity(
          command.profileUrl,
          "profileUrl",
          true,
        )
      : undefined;
    const description = hasDescription
      ? normalizeNullablePatchText(
          command.description,
          "description",
        )
      : undefined;
    const externalRef = hasExternalRef
      ? normalizeNullablePatchText(
          command.externalRef,
          "externalRef",
        )
      : undefined;

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        platformAccountId:
          readOptionalLogString(
            command.platformAccountId,
          ),
      },
      async (session) => {
        const current =
          await this.requirePlatformAccount(
            platformAccountId,
            session,
          );

        if (
          current.operationalStatus === "ARCHIVED"
        ) {
          throw new PlatformAccountStateError(
            `Archived platform account cannot be updated: ${platformAccountId}`,
          );
        }

        await this.assertRecordInvariantForTargetStatus(
          current,
          current.operationalStatus,
          session,
        );

        const patch =
          buildPlatformAccountCorePatch({
            current,
            platformAccountId,
            displayName,
            handle: handleIdentity?.value,
            normalizedHandle:
              handleIdentity?.normalized,
            externalPlatformId,
            profileUrl:
              profileUrlIdentity?.value,
            normalizedProfileUrl:
              profileUrlIdentity?.normalized,
            description,
            externalRef,
          });
        const changedFields =
          summarizeChangedCoreFields(patch);

        if (changedFields.length === 0) {
          throw new PlatformAccountValidationError(
            "At least one changed field is required",
          );
        }

        assertLocatorPresence({
          handle:
            patch.handle !== undefined
              ? patch.handle
              : current.handle,
          externalPlatformId:
            patch.externalPlatformId !== undefined
              ? patch.externalPlatformId
              : current.externalPlatformId,
          profileUrl:
            patch.profileUrl !== undefined
              ? patch.profileUrl
              : current.profileUrl,
        });

        await this.assertNoLiveIdentityConflicts(
          {
            platform: current.platform,
            normalizedHandle:
              patch.normalizedHandle,
            externalPlatformId:
              patch.externalPlatformId,
            normalizedProfileUrl:
              patch.normalizedProfileUrl,
            excludePlatformAccountId:
              current.id,
          },
          session,
        );

        let updated: PlatformAccountRecord | null;

        try {
          updated = await this.repository.updateCore(
            patch,
            session,
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new PlatformAccountConflictError(
              "Platform account identity conflict detected on update",
            );
          }

          throw error;
        }

        if (!updated) {
          throw new PlatformAccountConflictError(
            `Failed to update platform account: ${platformAccountId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          platformAccountId,
          mutationType: operation,
          metadata: {
            changedFields,
          },
          session,
        });

        return toPlatformAccountMutationView(
          updated,
        );
      },
      (result) => ({
        platformAccountId: result.id,
        operationalStatus:
          result.operationalStatus,
      }),
    );
  }

  async transferPlatformAccountOwnership(
    actor: Actor,
    command: TransferPlatformAccountOwnershipCommand,
  ): Promise<PlatformAccountMutationResult> {
    const operation =
      "platform-account.transfer-ownership";
    const permission = this.assertPermission(
      actor,
      Permission.PLATFORM_ACCOUNT_MANAGE_OWNERSHIP,
    );
    const platformAccountId = normalizeRequiredText(
      command.platformAccountId,
      "platformAccountId",
    );
    const ownerReference =
      normalizeOwnerReferenceInput({
        ownerKind: command.ownerKind,
        ownerOrgUnitId:
          command.ownerOrgUnitId,
        ownerTalentId: command.ownerTalentId,
        ownerTalentGroupId:
          command.ownerTalentGroupId,
      });

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        platformAccountId:
          readOptionalLogString(
            command.platformAccountId,
          ),
        ownerKind: readOptionalLogString(
          command.ownerKind,
        ),
        ownerReferenceId:
          ownerReference.ownerReferenceId,
      },
      async (session, controls) => {
        const current =
          await this.requirePlatformAccount(
            platformAccountId,
            session,
          );

        if (
          current.operationalStatus === "ARCHIVED"
        ) {
          throw new PlatformAccountStateError(
            `Archived platform account cannot transfer ownership: ${platformAccountId}`,
          );
        }

        assertLocatorPresence(current);

        await this.assertOwnerEligible(
          ownerReference,
          "ACTIVE_ONLY",
          session,
        );

        if (
          hasExactOwnerShape(current) &&
          current.ownerKind === ownerReference.ownerKind &&
          readCurrentOwnerReferenceId(current) ===
            ownerReference.ownerReferenceId
        ) {
          controls.markExplicitNoOpSuccess();
          return toPlatformAccountMutationView(
            current,
          );
        }

        const updated =
          await this.repository.transferOwnership(
            {
              platformAccountId,
              ownerKind: ownerReference.ownerKind,
              ownerOrgUnitId:
                ownerReference.ownerOrgUnitId,
              ownerTalentId:
                ownerReference.ownerTalentId,
              ownerTalentGroupId:
                ownerReference.ownerTalentGroupId,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new PlatformAccountConflictError(
            `Failed to transfer platform account ownership: ${platformAccountId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          platformAccountId,
          mutationType: operation,
          metadata: {
            previousOwnerKind: current.ownerKind,
            previousOwnerReferenceId:
              readCurrentOwnerReferenceId(current),
            newOwnerKind:
              ownerReference.ownerKind,
            newOwnerReferenceId:
              ownerReference.ownerReferenceId,
          },
          session,
        });

        return toPlatformAccountMutationView(
          updated,
        );
      },
      (result) => ({
        platformAccountId: result.id,
        ownerKind: result.ownerKind,
      }),
    );
  }

  async activatePlatformAccount(
    actor: Actor,
    command: ActivatePlatformAccountCommand,
  ): Promise<PlatformAccountMutationResult> {
    const operation = "platform-account.activate";
    const permission = this.assertPermission(
      actor,
      Permission.PLATFORM_ACCOUNT_MANAGE_LIFECYCLE,
    );
    const platformAccountId = normalizeRequiredText(
      command.platformAccountId,
      "platformAccountId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        platformAccountId:
          readOptionalLogString(
            command.platformAccountId,
          ),
      },
      async (session) => {
        const current =
          await this.requirePlatformAccount(
            platformAccountId,
            session,
          );

        if (
          current.operationalStatus !== "INACTIVE"
        ) {
          throw new PlatformAccountStateError(
            `Platform account ${platformAccountId} cannot transition from ${current.operationalStatus} to ACTIVE`,
          );
        }

        await this.assertRecordInvariantForTargetStatus(
          current,
          "ACTIVE",
          session,
        );

        const updated =
          await this.repository.transitionOperationalStatus(
            {
              platformAccountId,
              fromStatuses: ["INACTIVE"],
              toStatus: "ACTIVE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new PlatformAccountConflictError(
            `Platform account state transition conflict for ${platformAccountId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          platformAccountId,
          mutationType: operation,
          metadata: {
            previousOperationalStatus:
              current.operationalStatus,
            nextOperationalStatus:
              updated.operationalStatus,
          },
          session,
        });

        return toPlatformAccountMutationView(
          updated,
        );
      },
      (result) => ({
        platformAccountId: result.id,
        operationalStatus:
          result.operationalStatus,
      }),
    );
  }

  async deactivatePlatformAccount(
    actor: Actor,
    command: DeactivatePlatformAccountCommand,
  ): Promise<PlatformAccountMutationResult> {
    const operation = "platform-account.deactivate";
    const permission = this.assertPermission(
      actor,
      Permission.PLATFORM_ACCOUNT_MANAGE_LIFECYCLE,
    );
    const platformAccountId = normalizeRequiredText(
      command.platformAccountId,
      "platformAccountId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        platformAccountId:
          readOptionalLogString(
            command.platformAccountId,
          ),
      },
      async (session) => {
        const current =
          await this.requirePlatformAccount(
            platformAccountId,
            session,
          );

        if (
          current.operationalStatus !== "ACTIVE"
        ) {
          throw new PlatformAccountStateError(
            `Platform account ${platformAccountId} cannot transition from ${current.operationalStatus} to INACTIVE`,
          );
        }

        await this.assertRecordInvariantForTargetStatus(
          current,
          "INACTIVE",
          session,
        );
        await this.assertNoLiveEventAllocationForLifecycleMutation(
          platformAccountId,
          "deactivate",
          Date.now(),
          session,
        );

        const updated =
          await this.repository.transitionOperationalStatus(
            {
              platformAccountId,
              fromStatuses: ["ACTIVE"],
              toStatus: "INACTIVE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new PlatformAccountConflictError(
            `Platform account state transition conflict for ${platformAccountId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          platformAccountId,
          mutationType: operation,
          metadata: {
            previousOperationalStatus:
              current.operationalStatus,
            nextOperationalStatus:
              updated.operationalStatus,
          },
          session,
        });

        return toPlatformAccountMutationView(
          updated,
        );
      },
      (result) => ({
        platformAccountId: result.id,
        operationalStatus:
          result.operationalStatus,
      }),
    );
  }

  async archivePlatformAccount(
    actor: Actor,
    command: ArchivePlatformAccountCommand,
  ): Promise<PlatformAccountMutationResult> {
    const operation = "platform-account.archive";
    const permission = this.assertPermission(
      actor,
      Permission.PLATFORM_ACCOUNT_MANAGE_LIFECYCLE,
    );
    const platformAccountId = normalizeRequiredText(
      command.platformAccountId,
      "platformAccountId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        platformAccountId:
          readOptionalLogString(
            command.platformAccountId,
          ),
      },
      async (session) => {
        const current =
          await this.requirePlatformAccount(
            platformAccountId,
            session,
          );

        if (
          current.operationalStatus !== "INACTIVE"
        ) {
          throw new PlatformAccountStateError(
            `Platform account ${platformAccountId} cannot transition from ${current.operationalStatus} to ARCHIVED`,
          );
        }

        await this.assertNoLiveEventAllocationForLifecycleMutation(
          platformAccountId,
          "archive",
          Date.now(),
          session,
        );

        const updated =
          await this.repository.transitionOperationalStatus(
            {
              platformAccountId,
              fromStatuses: ["INACTIVE"],
              toStatus: "ARCHIVED",
              livestreamEnabled: false,
              contentPublishingEnabled: false,
              monetizationEnabled: false,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new PlatformAccountConflictError(
            `Platform account state transition conflict for ${platformAccountId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          platformAccountId,
          mutationType: operation,
          metadata: {
            previousOperationalStatus:
              current.operationalStatus,
            nextOperationalStatus:
              updated.operationalStatus,
            previousLivestreamEnabled:
              current.livestreamEnabled,
            previousContentPublishingEnabled:
              current.contentPublishingEnabled,
            previousMonetizationEnabled:
              current.monetizationEnabled,
            newLivestreamEnabled:
              updated.livestreamEnabled,
            newContentPublishingEnabled:
              updated.contentPublishingEnabled,
            newMonetizationEnabled:
              updated.monetizationEnabled,
          },
          session,
        });

        return toPlatformAccountMutationView(
          updated,
        );
      },
      (result) => ({
        platformAccountId: result.id,
        operationalStatus:
          result.operationalStatus,
      }),
    );
  }

  async updatePlatformAccountCapabilities(
    actor: Actor,
    command: UpdatePlatformAccountCapabilitiesCommand,
  ): Promise<PlatformAccountMutationResult> {
    const operation =
      "platform-account.update-capabilities";
    const permission = this.assertPermission(
      actor,
      Permission.PLATFORM_ACCOUNT_MANAGE_CAPABILITIES,
    );
    const platformAccountId = normalizeRequiredText(
      command.platformAccountId,
      "platformAccountId",
    );
    const livestreamEnabled = normalizeBoolean(
      command.livestreamEnabled,
      "livestreamEnabled",
    );
    const contentPublishingEnabled =
      normalizeBoolean(
        command.contentPublishingEnabled,
        "contentPublishingEnabled",
      );
    const monetizationEnabled = normalizeBoolean(
      command.monetizationEnabled,
      "monetizationEnabled",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        platformAccountId:
          readOptionalLogString(
            command.platformAccountId,
          ),
      },
      async (session, controls) => {
        const current =
          await this.requirePlatformAccount(
            platformAccountId,
            session,
          );

        if (
          current.operationalStatus === "ARCHIVED"
        ) {
          throw new PlatformAccountStateError(
            `Archived platform account cannot update capabilities: ${platformAccountId}`,
          );
        }

        await this.assertRecordInvariantForTargetStatus(
          current,
          current.operationalStatus,
          session,
        );

        if (
          livestreamEnabled === false &&
          contentPublishingEnabled === false
        ) {
          await this.assertNoLiveEventAllocationForCapabilityDownshift(
            platformAccountId,
            Date.now(),
            session,
          );
        }

        if (
          current.livestreamEnabled ===
            livestreamEnabled &&
          current.contentPublishingEnabled ===
            contentPublishingEnabled &&
          current.monetizationEnabled ===
            monetizationEnabled
        ) {
          controls.markExplicitNoOpSuccess();
          return toPlatformAccountMutationView(
            current,
          );
        }

        const updated =
          await this.repository.updateCapabilities(
            {
              platformAccountId,
              livestreamEnabled,
              contentPublishingEnabled,
              monetizationEnabled,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new PlatformAccountConflictError(
            `Failed to update platform account capabilities: ${platformAccountId}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          platformAccountId,
          mutationType: operation,
          metadata: {
            previousLivestreamEnabled:
              current.livestreamEnabled,
            newLivestreamEnabled:
              updated.livestreamEnabled,
            previousContentPublishingEnabled:
              current.contentPublishingEnabled,
            newContentPublishingEnabled:
              updated.contentPublishingEnabled,
            previousMonetizationEnabled:
              current.monetizationEnabled,
            newMonetizationEnabled:
              updated.monetizationEnabled,
          },
          session,
        });

        return toPlatformAccountMutationView(
          updated,
        );
      },
      (result) => ({
        platformAccountId: result.id,
        livestreamEnabled:
          result.livestreamEnabled,
        contentPublishingEnabled:
          result.contentPublishingEnabled,
        monetizationEnabled:
          result.monetizationEnabled,
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

  private async requirePlatformAccount(
    platformAccountId: string,
    session: ClientSession,
  ): Promise<PlatformAccountRecord> {
    const platformAccount =
      await this.repository.findById(
        platformAccountId,
        session,
      );

    if (!platformAccount) {
      throw new PlatformAccountNotFoundError(
        platformAccountId,
      );
    }

    return platformAccount;
  }

  private async allocateGeneratedCode(
    session: ClientSession,
  ): Promise<string> {
    const maxExisting =
      await this.repository.findMaxGeneratedCodeSequence(
        PLATFORM_ACCOUNT_CODE_POLICY,
        session,
      );
    await this.codeSequenceRepository.ensureAtLeast(
      PLATFORM_ACCOUNT_CODE_POLICY.moduleKey,
      PLATFORM_ACCOUNT_CODE_POLICY.bucket,
      maxExisting,
      session,
    );
    const next =
      await this.codeSequenceRepository.allocateNext(
        PLATFORM_ACCOUNT_CODE_POLICY.moduleKey,
        PLATFORM_ACCOUNT_CODE_POLICY.bucket,
        session,
      );

    return formatBusinessCode(
      PLATFORM_ACCOUNT_CODE_POLICY,
      next,
    );
  }

  private async assertNoLiveIdentityConflicts(
    params: {
      readonly platform: PlatformAccountPlatform;
      readonly normalizedHandle?: string | null;
      readonly externalPlatformId?: string | null;
      readonly normalizedProfileUrl?: string | null;
      readonly excludePlatformAccountId?: string;
    },
    session: ClientSession,
  ): Promise<void> {
    if (
      params.normalizedHandle !== undefined &&
      params.normalizedHandle !== null
    ) {
      const existing =
        await this.repository.findLiveByPlatformAndNormalizedHandle(
          {
            platform: params.platform,
            normalizedHandle:
              params.normalizedHandle,
            excludePlatformAccountId:
              params.excludePlatformAccountId,
          },
          session,
        );

      if (existing) {
        throw new PlatformAccountConflictError(
          "A non-archived platform account already uses the same platform and handle",
        );
      }
    }

    if (
      params.externalPlatformId !== undefined &&
      params.externalPlatformId !== null
    ) {
      const existing =
        await this.repository.findLiveByPlatformAndExternalPlatformId(
          {
            platform: params.platform,
            externalPlatformId:
              params.externalPlatformId,
            excludePlatformAccountId:
              params.excludePlatformAccountId,
          },
          session,
        );

      if (existing) {
        throw new PlatformAccountConflictError(
          "A non-archived platform account already uses the same platform and externalPlatformId",
        );
      }
    }

    if (
      params.normalizedProfileUrl !== undefined &&
      params.normalizedProfileUrl !== null
    ) {
      const existing =
        await this.repository.findLiveByPlatformAndNormalizedProfileUrl(
          {
            platform: params.platform,
            normalizedProfileUrl:
              params.normalizedProfileUrl,
            excludePlatformAccountId:
              params.excludePlatformAccountId,
          },
          session,
        );

      if (existing) {
        throw new PlatformAccountConflictError(
          "A non-archived platform account already uses the same platform and profileUrl",
        );
      }
    }
  }

  private async assertRecordInvariantForTargetStatus(
    record: PlatformAccountRecord,
    targetStatus: PlatformAccountOperationalStatus,
    session: ClientSession,
  ): Promise<void> {
    if (!hasExactOwnerShape(record)) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        `Platform account owner reference shape is invalid: ${record.id}`,
      );
    }

    if (targetStatus === "ARCHIVED") {
      return;
    }

    assertLocatorPresence(record);
    await this.assertOwnerEligible(
      {
        ownerKind: record.ownerKind,
        ownerOrgUnitId: record.ownerOrgUnitId,
        ownerTalentId: record.ownerTalentId,
        ownerTalentGroupId:
          record.ownerTalentGroupId,
        ownerReferenceId:
          readCurrentOwnerReferenceId(record) ?? "",
      },
      targetStatus === "ACTIVE"
        ? "ACTIVE_ONLY"
        : "NON_ARCHIVED_ONLY",
      session,
    );
  }

  private async assertNoLiveEventAllocationForLifecycleMutation(
    platformAccountId: string,
    operation: "deactivate" | "archive",
    evaluationTime: number,
    session: ClientSession,
  ): Promise<void> {
    const hasLiveEventAllocation =
      await this.eventAssignmentReadonlyAccess.hasLiveEventAllocationForPlatformAccount(
        platformAccountId,
        evaluationTime,
        session,
      );

    if (!hasLiveEventAllocation) {
      return;
    }

    throw new PlatformAccountStateError(
      `Platform account ${platformAccountId} cannot ${operation} while live event allocations exist`,
    );
  }

  private async assertNoLiveEventAllocationForCapabilityDownshift(
    platformAccountId: string,
    evaluationTime: number,
    session: ClientSession,
  ): Promise<void> {
    const hasLiveEventAllocation =
      await this.eventAssignmentReadonlyAccess.hasLiveEventAllocationForPlatformAccount(
        platformAccountId,
        evaluationTime,
        session,
      );

    if (!hasLiveEventAllocation) {
      return;
    }

    throw new PlatformAccountStateError(
      `Platform account ${platformAccountId} cannot disable both livestream and content publishing while live event allocations exist`,
    );
  }

  private async assertOwnerEligible(
    ownerReference: OwnerReferenceShape,
    requirement: OwnerEligibilityRequirement,
    session: ClientSession,
  ): Promise<void> {
    switch (ownerReference.ownerKind) {
      case "ORG_UNIT": {
        const orgUnit =
          await this.requireOrgUnitReference(
            ownerReference.ownerReferenceId,
            session,
          );
        assertOrgUnitEligible(
          orgUnit,
          ownerReference.ownerReferenceId,
          requirement,
        );
        return;
      }

      case "TALENT": {
        const talent =
          await this.requireTalentReference(
            ownerReference.ownerReferenceId,
            session,
          );
        assertTalentEligible(
          talent,
          ownerReference.ownerReferenceId,
          requirement,
        );
        return;
      }

      case "TALENT_GROUP": {
        const talentGroup =
          await this.requireTalentGroupReference(
            ownerReference.ownerReferenceId,
            session,
          );
        assertTalentGroupEligible(
          talentGroup,
          ownerReference.ownerReferenceId,
          requirement,
        );
      }
    }
  }

  private async requireOrgUnitReference(
    orgUnitId: string,
    session: ClientSession,
  ): Promise<PlatformAccountReferencedOrgUnit> {
    const orgUnit =
      await this.orgUnitReadonlyAccess.findById(
        orgUnitId,
        session,
      );

    if (!orgUnit) {
      throw new PlatformAccountInvalidOwnerReferenceError(
        `Org unit owner does not exist: ${orgUnitId}`,
      );
    }

    return orgUnit;
  }

  private async requireTalentReference(
    talentId: string,
    session: ClientSession,
  ): Promise<PlatformAccountReferencedTalent> {
    const talent =
      await this.talentReadonlyAccess.findById(
        talentId,
        session,
      );

    if (!talent) {
      throw new PlatformAccountInvalidOwnerReferenceError(
        `Talent owner does not exist: ${talentId}`,
      );
    }

    return talent;
  }

  private async requireTalentGroupReference(
    groupId: string,
    session: ClientSession,
  ): Promise<PlatformAccountReferencedTalentGroup> {
    const talentGroup =
      await this.talentGroupReadonlyAccess.findById(
        groupId,
        session,
      );

    if (!talentGroup) {
      throw new PlatformAccountInvalidOwnerReferenceError(
        `Talent group owner does not exist: ${groupId}`,
      );
    }

    return talentGroup;
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly platformAccountId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.platformAccountId,
      {
        mutationType: params.mutationType,
        targetId: params.platformAccountId,
        targetType: "platform-account",
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
            classifyPlatformAccountMutationFailure(
              error,
            ),
          errorCode: extractErrorCode(error),
          errorMessage:
            truncateLogMessage(error),
        },
      });

      throw error;
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
}

function normalizeCreateCommand(
  command: CreatePlatformAccountCommand,
): NormalizedCreateCommand {
  const displayName = normalizeDisplayText(
    command.displayName,
    "displayName",
  );
  const handleIdentity = normalizeHandleIdentity(
    command.handle,
    "handle",
  );
  const profileUrlIdentity =
    normalizeProfileUrlIdentity(
      command.profileUrl,
      "profileUrl",
      false,
    );
  const ownerReference =
    normalizeOwnerReferenceInput({
      ownerKind: command.ownerKind,
      ownerOrgUnitId: command.ownerOrgUnitId,
      ownerTalentId: command.ownerTalentId,
      ownerTalentGroupId:
        command.ownerTalentGroupId,
    });

  assertLocatorPresence({
    handle: handleIdentity.value,
    externalPlatformId:
      normalizeNullableOpaqueText(
        command.externalPlatformId,
        "externalPlatformId",
      ),
    profileUrl: profileUrlIdentity.value,
  });

  return {
    accountCode: normalizeOptionalCreateCode(
      command.accountCode,
      "accountCode",
    ),
    platform: normalizePlatform(command.platform),
    platformSurfaceType:
      normalizePlatformSurfaceType(
        command.platformSurfaceType,
      ),
    displayName,
    normalizedDisplayName:
      normalizeDisplayNameForSearch(
        displayName,
      ),
    handle: handleIdentity.value,
    normalizedHandle:
      handleIdentity.normalized,
    externalPlatformId:
      normalizeNullableOpaqueText(
        command.externalPlatformId,
        "externalPlatformId",
      ),
    profileUrl: profileUrlIdentity.value,
    normalizedProfileUrl:
      profileUrlIdentity.normalized,
    ...ownerReference,
    livestreamEnabled: normalizeBoolean(
      command.livestreamEnabled,
      "livestreamEnabled",
    ),
    contentPublishingEnabled: normalizeBoolean(
      command.contentPublishingEnabled,
      "contentPublishingEnabled",
    ),
    monetizationEnabled: normalizeBoolean(
      command.monetizationEnabled,
      "monetizationEnabled",
    ),
    description: normalizeNullableText(
      command.description,
      "description",
    ),
    externalRef: normalizeNullableText(
      command.externalRef,
      "externalRef",
    ),
  };
}

function normalizeOptionalCreateCode(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function buildPlatformAccountCorePatch(params: {
  readonly current: PlatformAccountRecord;
  readonly platformAccountId: string;
  readonly displayName?: string;
  readonly handle?: string | null;
  readonly normalizedHandle?: string | null;
  readonly externalPlatformId?: string | null;
  readonly profileUrl?: string | null;
  readonly normalizedProfileUrl?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}): UpdatePlatformAccountCoreInput {
  const patch: {
    platformAccountId: string;
    updatedAt: number;
    displayName?: string;
    normalizedDisplayName?: string;
    handle?: string | null;
    normalizedHandle?: string | null;
    externalPlatformId?: string | null;
    profileUrl?: string | null;
    normalizedProfileUrl?: string | null;
    description?: string | null;
    externalRef?: string | null;
  } = {
    platformAccountId: params.platformAccountId,
    updatedAt: Date.now(),
  };

  if (
    params.displayName !== undefined &&
    params.displayName !==
      params.current.displayName
  ) {
    patch.displayName = params.displayName;
    patch.normalizedDisplayName =
      normalizeDisplayNameForSearch(
        params.displayName,
      );
  }

  if (
    params.handle !== undefined &&
    params.handle !== params.current.handle
  ) {
    patch.handle = params.handle;
    patch.normalizedHandle =
      params.normalizedHandle ?? null;
  }

  if (
    params.externalPlatformId !== undefined &&
    params.externalPlatformId !==
      params.current.externalPlatformId
  ) {
    patch.externalPlatformId =
      params.externalPlatformId;
  }

  if (
    params.profileUrl !== undefined &&
    params.profileUrl !==
      params.current.profileUrl
  ) {
    patch.profileUrl = params.profileUrl;
    patch.normalizedProfileUrl =
      params.normalizedProfileUrl ?? null;
  }

  if (
    params.description !== undefined &&
    params.description !==
      params.current.description
  ) {
    patch.description = params.description;
  }

  if (
    params.externalRef !== undefined &&
    params.externalRef !==
      params.current.externalRef
  ) {
    patch.externalRef = params.externalRef;
  }

  return patch;
}

function summarizeChangedCoreFields(
  patch: UpdatePlatformAccountCoreInput,
): readonly string[] {
  const changed: string[] = [];

  if (patch.displayName !== undefined) {
    changed.push("displayName");
  }

  if (patch.handle !== undefined) {
    changed.push("handle");
  }

  if (patch.externalPlatformId !== undefined) {
    changed.push("externalPlatformId");
  }

  if (patch.profileUrl !== undefined) {
    changed.push("profileUrl");
  }

  if (patch.description !== undefined) {
    changed.push("description");
  }

  if (patch.externalRef !== undefined) {
    changed.push("externalRef");
  }

  return changed;
}

function toPlatformAccountMutationView(
  platformAccount: PlatformAccountRecord,
): PlatformAccountMutationView {
  return {
    id: platformAccount.id,
    accountCode: platformAccount.accountCode,
    platform: platformAccount.platform,
    platformSurfaceType:
      platformAccount.platformSurfaceType,
    displayName: platformAccount.displayName,
    handle: platformAccount.handle,
    externalPlatformId:
      platformAccount.externalPlatformId,
    profileUrl: platformAccount.profileUrl,
    ownerKind: platformAccount.ownerKind,
    ownerOrgUnitId:
      platformAccount.ownerOrgUnitId,
    ownerTalentId:
      platformAccount.ownerTalentId,
    ownerTalentGroupId:
      platformAccount.ownerTalentGroupId,
    operationalStatus:
      platformAccount.operationalStatus,
    livestreamEnabled:
      platformAccount.livestreamEnabled,
    contentPublishingEnabled:
      platformAccount.contentPublishingEnabled,
    monetizationEnabled:
      platformAccount.monetizationEnabled,
    description: platformAccount.description,
    externalRef: platformAccount.externalRef,
    createdAt: platformAccount.createdAt,
    updatedAt: platformAccount.updatedAt,
  };
}

function hasExactOwnerShape(
  record: Pick<
    PlatformAccountRecord,
    | "ownerKind"
    | "ownerOrgUnitId"
    | "ownerTalentId"
    | "ownerTalentGroupId"
  >,
): boolean {
  const providedOwnerReferences = [
    record.ownerOrgUnitId !== null,
    record.ownerTalentId !== null,
    record.ownerTalentGroupId !== null,
  ].filter(Boolean).length;

  if (providedOwnerReferences !== 1) {
    return false;
  }

  switch (record.ownerKind) {
    case "ORG_UNIT":
      return (
        record.ownerOrgUnitId !== null &&
        record.ownerTalentId === null &&
        record.ownerTalentGroupId === null
      );

    case "TALENT":
      return (
        record.ownerOrgUnitId === null &&
        record.ownerTalentId !== null &&
        record.ownerTalentGroupId === null
      );

    case "TALENT_GROUP":
      return (
        record.ownerOrgUnitId === null &&
        record.ownerTalentId === null &&
        record.ownerTalentGroupId !== null
      );
  }
}

function readCurrentOwnerReferenceId(
  record: Pick<
    PlatformAccountRecord,
    | "ownerKind"
    | "ownerOrgUnitId"
    | "ownerTalentId"
    | "ownerTalentGroupId"
  >,
): string | null {
  switch (record.ownerKind) {
    case "ORG_UNIT":
      return record.ownerOrgUnitId;

    case "TALENT":
      return record.ownerTalentId;

    case "TALENT_GROUP":
      return record.ownerTalentGroupId;
  }
}

function normalizeOwnerReferenceInput(params: {
  readonly ownerKind: unknown;
  readonly ownerOrgUnitId: unknown;
  readonly ownerTalentId: unknown;
  readonly ownerTalentGroupId: unknown;
}): OwnerReferenceShape {
  const ownerKind = normalizeOwnerKind(
    params.ownerKind,
  );
  const ownerOrgUnitId = normalizeOptionalNullableId(
    params.ownerOrgUnitId,
    "ownerOrgUnitId",
  );
  const ownerTalentId = normalizeOptionalNullableId(
    params.ownerTalentId,
    "ownerTalentId",
  );
  const ownerTalentGroupId =
    normalizeOptionalNullableId(
      params.ownerTalentGroupId,
      "ownerTalentGroupId",
    );

  const providedOwnerReferences = [
    {
      ownerKind: "ORG_UNIT" as const,
      id: ownerOrgUnitId,
    },
    {
      ownerKind: "TALENT" as const,
      id: ownerTalentId,
    },
    {
      ownerKind: "TALENT_GROUP" as const,
      id: ownerTalentGroupId,
    },
  ].filter((entry) => entry.id !== null);

  if (providedOwnerReferences.length !== 1) {
    throw new PlatformAccountInvalidOwnerReferenceError(
      "Exactly one owner reference must be provided",
    );
  }

  const providedOwnerReference =
    providedOwnerReferences[0];

  if (
    providedOwnerReference.ownerKind !== ownerKind ||
    providedOwnerReference.id === null
  ) {
    throw new PlatformAccountInvalidOwnerReferenceError(
      "ownerKind must match the single provided owner reference",
    );
  }

  return {
    ownerKind,
    ownerOrgUnitId,
    ownerTalentId,
    ownerTalentGroupId,
    ownerReferenceId: providedOwnerReference.id,
  };
}

function assertOrgUnitEligible(
  orgUnit: PlatformAccountReferencedOrgUnit,
  ownerReferenceId: string,
  requirement: OwnerEligibilityRequirement,
): void {
  if (
    requirement === "ACTIVE_ONLY" &&
    orgUnit.status !== "ACTIVE"
  ) {
    throw new PlatformAccountInvalidOwnerReferenceError(
      `Org unit owner must be ACTIVE: ${ownerReferenceId}`,
    );
  }

  if (
    requirement === "NON_ARCHIVED_ONLY" &&
    orgUnit.status === "ARCHIVED"
  ) {
    throw new PlatformAccountInvalidOwnerReferenceError(
      `Org unit owner must be non-archived: ${ownerReferenceId}`,
    );
  }
}

function assertTalentEligible(
  talent: PlatformAccountReferencedTalent,
  ownerReferenceId: string,
  requirement: OwnerEligibilityRequirement,
): void {
  if (
    requirement === "ACTIVE_ONLY" &&
    talent.operationalStatus !== "ACTIVE"
  ) {
    throw new PlatformAccountInvalidOwnerReferenceError(
      `Talent owner must be ACTIVE: ${ownerReferenceId}`,
    );
  }

  if (
    requirement === "NON_ARCHIVED_ONLY" &&
    talent.operationalStatus === "ARCHIVED"
  ) {
    throw new PlatformAccountInvalidOwnerReferenceError(
      `Talent owner must be non-archived: ${ownerReferenceId}`,
    );
  }
}

function assertTalentGroupEligible(
  talentGroup: PlatformAccountReferencedTalentGroup,
  ownerReferenceId: string,
  requirement: OwnerEligibilityRequirement,
): void {
  if (
    requirement === "ACTIVE_ONLY" &&
    talentGroup.status !== "ACTIVE"
  ) {
    throw new PlatformAccountInvalidOwnerReferenceError(
      `Talent group owner must be ACTIVE: ${ownerReferenceId}`,
    );
  }

  if (
    requirement === "NON_ARCHIVED_ONLY" &&
    talentGroup.status === "ARCHIVED"
  ) {
    throw new PlatformAccountInvalidOwnerReferenceError(
      `Talent group owner must be non-archived: ${ownerReferenceId}`,
    );
  }
}

function assertLocatorPresence(params: {
  readonly handle: string | null;
  readonly externalPlatformId: string | null;
  readonly profileUrl: string | null;
}): void {
  const hasValidHandle =
    params.handle !== null &&
    normalizeHandleForSearch(params.handle).length > 0;
  const hasValidExternalPlatformId =
    params.externalPlatformId !== null &&
    params.externalPlatformId.trim().length > 0;
  const hasValidProfileUrl =
    params.profileUrl !== null &&
    isAbsoluteProfileUrl(params.profileUrl);

  if (
    hasValidHandle ||
    hasValidExternalPlatformId ||
    hasValidProfileUrl
  ) {
    return;
  }

  throw new PlatformAccountInvalidPlatformIdentityError(
    "At least one valid locator field must be present: handle, externalPlatformId, or profileUrl",
  );
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new PlatformAccountValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function normalizeDisplayText(
  value: unknown,
  field: string,
): string {
  return normalizeRequiredText(value, field)
    .normalize("NFKC")
    .replace(/\s+/gu, " ");
}

function normalizeNullableText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");

  if (normalized.length === 0) {
    throw new PlatformAccountValidationError(
      `${field} must not be empty when provided`,
    );
  }

  return normalized;
}

function normalizeNullablePatchText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined) {
    throw new PlatformAccountValidationError(
      `${field} must be provided`,
    );
  }

  return normalizeNullableText(value, field);
}

function normalizeNullableOpaqueText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim();

  if (normalized.length === 0) {
    throw new PlatformAccountInvalidPlatformIdentityError(
      `${field} must not be empty when provided`,
    );
  }

  return normalized;
}

function normalizeNullableOpaquePatchText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined) {
    throw new PlatformAccountValidationError(
      `${field} must be provided`,
    );
  }

  return normalizeNullableOpaqueText(value, field);
}

function normalizeOptionalNullableId(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new PlatformAccountValidationError(
      `${field} must not be empty when provided`,
    );
  }

  return normalized;
}

function normalizeBoolean(
  value: unknown,
  field: string,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new PlatformAccountValidationError(
    `${field} must be a boolean`,
  );
}

function normalizePlatform(
  value: unknown,
): PlatformAccountPlatform {
  if (
    typeof value === "string" &&
    PLATFORM_ACCOUNT_PLATFORMS.includes(
      value as PlatformAccountPlatform,
    )
  ) {
    return value as PlatformAccountPlatform;
  }

  throw new PlatformAccountValidationError(
    `platform must be one of ${PLATFORM_ACCOUNT_PLATFORMS.join(", ")}`,
  );
}

function normalizePlatformSurfaceType(
  value: unknown,
): PlatformAccountSurfaceType {
  if (
    typeof value === "string" &&
    PLATFORM_ACCOUNT_SURFACE_TYPES.includes(
      value as PlatformAccountSurfaceType,
    )
  ) {
    return value as PlatformAccountSurfaceType;
  }

  throw new PlatformAccountValidationError(
    `platformSurfaceType must be one of ${PLATFORM_ACCOUNT_SURFACE_TYPES.join(", ")}`,
  );
}

function normalizeOwnerKind(
  value: unknown,
): PlatformAccountOwnerKind {
  if (
    typeof value === "string" &&
    PLATFORM_ACCOUNT_OWNER_KINDS.includes(
      value as PlatformAccountOwnerKind,
    )
  ) {
    return value as PlatformAccountOwnerKind;
  }

  throw new PlatformAccountValidationError(
    `ownerKind must be one of ${PLATFORM_ACCOUNT_OWNER_KINDS.join(", ")}`,
  );
}

function normalizeHandleIdentity(
  value: unknown,
  field: string,
): NormalizedNullableValue {
  const normalizedValue =
    normalizeNullableOpaqueText(value, field);
  const normalizedHandle =
    normalizedValue === null
      ? null
      : normalizeHandleForSearch(
          normalizedValue,
        );

  if (
    normalizedValue !== null &&
    normalizedHandle !== null &&
    normalizedHandle.length === 0
  ) {
    throw new PlatformAccountInvalidPlatformIdentityError(
      `${field} must not be empty after normalization`,
    );
  }

  return {
    value: normalizedValue,
    normalized: normalizedHandle,
  };
}

function normalizeProfileUrlIdentity(
  value: unknown,
  field: string,
  requireProvided: boolean,
): NormalizedNullableValue {
  if (value === undefined && requireProvided) {
    throw new PlatformAccountValidationError(
      `${field} must be provided`,
    );
  }

  if (value === undefined || value === null) {
    return {
      value: null,
      normalized: null,
    };
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `${field} must be a string`,
    );
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new PlatformAccountInvalidPlatformIdentityError(
      `${field} must not be empty when provided`,
    );
  }

  const canonical =
    canonicalizeAbsoluteProfileUrl(
      trimmed,
      field,
    );

  return {
    value: canonical,
    normalized: canonical,
  };
}

function canonicalizeAbsoluteProfileUrl(
  value: string,
  field: string,
): string {
  const trimmed = value.trim();
  const sourceWithoutFragment =
    stripFragment(trimmed);
  const preservedQuery =
    extractRawQuerySegment(sourceWithoutFragment);
  let parsed: URL;

  try {
    parsed = new URL(sourceWithoutFragment);
  } catch {
    throw new PlatformAccountInvalidPlatformIdentityError(
      `${field} must be an absolute URL`,
    );
  }

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();

  if (isDefaultPort(parsed)) {
    parsed.port = "";
  }

  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = normalizeUrlPathname(
    parsed.pathname,
  );

  return `${parsed.toString()}${preservedQuery}`;
}

function stripFragment(value: string): string {
  const fragmentIndex = value.indexOf("#");
  return fragmentIndex >= 0
    ? value.slice(0, fragmentIndex)
    : value;
}

function extractRawQuerySegment(
  value: string,
): string {
  const queryIndex = value.indexOf("?");
  return queryIndex >= 0
    ? value.slice(queryIndex)
    : "";
}

function normalizeUrlPathname(
  pathname: string,
): string {
  const withoutTrailingSlash = pathname.replace(
    /\/+$/u,
    "",
  );

  return withoutTrailingSlash.length > 0
    ? withoutTrailingSlash
    : "/";
}

function isDefaultPort(url: URL): boolean {
  return (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" &&
      url.port === "443")
  );
}

function normalizeDisplayNameForSearch(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function normalizeHandleForSearch(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^@/u, "");
}

function isAbsoluteProfileUrl(
  value: string,
): boolean {
  try {
    canonicalizeAbsoluteProfileUrl(
      value,
      "profileUrl",
    );
    return true;
  } catch {
    return false;
  }
}

function isDuplicateKeyError(
  error: unknown,
): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000
  );
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

function classifyPlatformAccountMutationFailure(
  error: unknown,
): PlatformAccountFailureClassification {
  if (error instanceof PlatformAccountValidationError) {
    return "validation";
  }

  if (error instanceof PlatformAccountConflictError) {
    return "conflict";
  }

  if (error instanceof PlatformAccountNotFoundError) {
    return "not_found";
  }

  if (error instanceof PlatformAccountStateError) {
    return "state_error";
  }

  if (
    error instanceof
    PlatformAccountInvalidOwnerReferenceError
  ) {
    return "invalid_owner_reference";
  }

  if (
    error instanceof
    PlatformAccountInvalidPlatformIdentityError
  ) {
    return "invalid_platform_identity";
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
