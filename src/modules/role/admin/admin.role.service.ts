import crypto from "crypto";
import { ClientSession, MongoServerError } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuditGuard } from "@core/audit/audit.guard";
import {
  BusinessCodeSequenceRepository,
  formatBusinessCode,
} from "@core/business-code/business-code-sequence.repository";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
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
import { AccountContext } from "@modules/account-context/domain/account-context.types";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import { getCurrentDomainEventCollector } from "@system/event-bridge/domain-event.types";
import { RoleAssignmentRuleRepository } from "@modules/role/domain/role-assignment-rule.repository";
import {
  RoleAssignmentConflictError,
  RoleAssignmentNotFoundError,
  RoleConflictError,
  RoleDependencyError,
  RoleNotFoundError,
  RoleStateError,
  RoleValidationError,
} from "@modules/role/domain/role.errors";
import {
  assertActorCanGrantAssignmentScopeGrants,
  normalizeAssignmentScopeGrants,
} from "@modules/role/domain/role-assignment-scope-grants";
import {
  buildRoleAssignmentScopeFingerprint,
  normalizeRoleAssignmentScopeGrants,
} from "@modules/role/domain/role-assignment-scope";
import {
  createRoleCreatedEvent,
  createRoleActivatedEvent,
  createRoleArchivedEvent,
  createRoleAssignedToUserEvent,
  createRoleAssignmentRulesUpdatedEvent,
  createRoleDeactivatedEvent,
  createRolePermissionsUpdatedEvent,
  createRoleRevokedFromUserEvent,
  createRoleUpdatedEvent,
} from "@modules/role/domain/role.events";
import { RoleRepository } from "@modules/role/domain/role.repository";
import { ROLE_CODE_POLICY } from "@modules/role/domain/role-code-policy";
import {
  getRoleTemplate,
  isRoleTemplateCode,
  RoleTemplateCode,
} from "@modules/role/domain/role-template.catalog";
import { RoleUserReadonlyAccess } from "@modules/role/domain/role-user-readonly-access";
import { UserAdminCapabilityRepository } from "@modules/user/domain/user.admin-capability.repository";
import {
  ROLE_ASSIGNMENT_RULE_STATES,
  ROLE_DELEGATION_BANDS,
  ROLE_MAX_DELEGATABLE_BANDS,
  RoleDelegationBand,
  RoleMaxDelegatableBand,
  RoleAssignmentRuleRecord,
  RoleAssignmentRuleState,
  RoleAssignmentRuleView,
  RoleAssignmentView,
  RoleMutationView,
  RoleRecord,
  RoleState,
  UserRoleAssignmentRecord,
} from "@modules/role/domain/role.types";
import { UserRoleAssignmentRepository } from "@modules/role/domain/user-role-assignment.repository";
import {
  ActivateRoleCommand,
  ArchiveRoleCommand,
  AssignRoleToUserCommand,
  CreateRoleFromTemplateCommand,
  CreateRoleCommand,
  DeactivateRoleCommand,
  RevokeRoleFromUserCommand,
  RoleAssignmentMutationResult,
  RoleAssignmentRuleInput,
  RoleMutationResult,
  SetRoleAssignmentRulesCommand,
  SetRolePermissionsCommand,
  UpdateRoleCommand,
} from "@modules/role/shared/role.contracts";

const MUTABLE_ROLE_STATES: readonly RoleState[] = [
  "DRAFT",
  "ACTIVE",
  "INACTIVE",
];
const CANONICAL_PERMISSION_CODES = new Set<string>(Object.values(Permission));

const GOVERNANCE_RECOVERY_PERMISSION_CODES: readonly string[] = [
  Permission.USER_CREATE,
  Permission.USER_ACTIVATE,
  Permission.USER_DISABLE,
  Permission.USER_ARCHIVE,
  Permission.USER_AUTH_LINKAGE_SET,
  Permission.USER_PROVISION_ACCOUNT,
  Permission.USER_AUTH_LINKAGE_UNLINK,
  Permission.USER_PASSWORD_SETUP_SEND,
  Permission.USER_ACTOR_KIND_UPDATE,
  Permission.ROLE_CREATE,
  Permission.ROLE_UPDATE,
  Permission.ROLE_ACTIVATE,
  Permission.ROLE_DEACTIVATE,
  Permission.ROLE_ARCHIVE,
  Permission.ROLE_PERMISSION_ASSIGN,
  Permission.ROLE_ASSIGN_TO_USER,
  Permission.ROLE_REVOKE_FROM_USER,
];

type RoleFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "dependency_error"
  | "invariant"
  | "unknown";

export class RoleAdminService {
  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly userRoleAssignmentRepository: UserRoleAssignmentRepository,
    private readonly roleAssignmentRuleRepository: RoleAssignmentRuleRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly userReadonlyAccess: RoleUserReadonlyAccess,
    private readonly adminCapabilityRepository: UserAdminCapabilityRepository,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly actorSnapshotCacheInvalidator: ActorSnapshotCacheInvalidator,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createRole(
    actor: Actor,
    command: CreateRoleCommand,
  ): Promise<RoleMutationResult> {
    const mutationType = "role.create";
    return this.runLoggedMutation(
      actor,
      mutationType,
      {
        roleCode: readOptionalLogString(command.code),
      },
      async (mutationTargetDescriptor) => {
        const permission = this.assertPermission(actor, Permission.ROLE_CREATE);

        const requestedCode = normalizeOptionalRoleCode(command.code);
        const name = normalizeRequiredText(command.name, "name");
        const description = normalizeNullableText(
          command.description,
          "description",
        );
        const initialPermissions = normalizePermissionCodeList(
          command.initialPermissions,
          "initialPermissions",
        );
        this.assertActorCanAuthorPermissions(
          actor,
          initialPermissions,
          "initialPermissions",
        );
        const initialDelegationBand = normalizeRoleDelegationBand(
          command.initialDelegationBand,
          "initialDelegationBand",
          "LIMITED",
        );
        const initialMaxDelegatableBand = normalizeRoleMaxDelegatableBand(
          command.initialMaxDelegatableBand,
          "initialMaxDelegatableBand",
          "NONE",
        );
        const templateCode = normalizeOptionalRoleTemplateCode(
          command.templateCode,
          "templateCode",
        );
        const templateVersion = normalizeOptionalText(
          command.templateVersion,
          "templateVersion",
        );
        const templateAppliedAt = normalizeOptionalTimestamp(
          command.templateAppliedAt,
          "templateAppliedAt",
        );

        return this.executeAuthoritativeMutation(
          actor,
          permission,
          mutationType,
          mutationTargetDescriptor,
          async (session) => {
            if (requestedCode !== undefined) {
              const existing = await this.roleRepository.findByCode(
                requestedCode,
                session,
              );

              if (existing) {
                throw new RoleConflictError(
                  `Role code already exists: ${requestedCode}`,
                );
              }
            }

            let created!: RoleRecord;
            let initialAssignmentRules: readonly RoleAssignmentRuleRecord[] = [];
            const maxAttempts = requestedCode === undefined ? 5 : 1;

            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
              const code =
                requestedCode ?? (await this.allocateGeneratedCode(session));
              const now = Date.now();
              const roleId = crypto.randomUUID();
              initialAssignmentRules = normalizeRoleAssignmentRules({
                roleId,
                rules: command.initialAssignmentRules ?? [],
                now,
              });

              const role: RoleRecord = {
                id: roleId,
                code,
                name,
                description,
                state: "DRAFT",
                permissions: initialPermissions,
                delegationBand: initialDelegationBand,
                maxDelegatableBand: initialMaxDelegatableBand,
                ...(templateCode ? { templateCode } : {}),
                ...(templateVersion ? { templateVersion } : {}),
                ...(templateAppliedAt !== undefined
                  ? { templateAppliedAt }
                  : {}),
                createdAt: now,
                updatedAt: now,
                activatedAt: null,
                archivedAt: null,
              };

              try {
                created = await this.roleRepository.insert(role, session);
                break;
              } catch (error) {
                if (!isDuplicateKeyError(error)) {
                  throw error;
                }

                if (requestedCode !== undefined) {
                  throw new RoleConflictError(
                    `Role code already exists: ${requestedCode}`,
                  );
                }

                if (attempt >= maxAttempts) {
                  throw new RoleConflictError(
                    "Generated role code conflict detected on create",
                  );
                }
              }
            }

            const createdRules =
              await this.roleAssignmentRuleRepository.replaceForRole(
                {
                  roleId: created.id,
                  rules: initialAssignmentRules,
                },
                session,
              );

            await this.recordRoleAudit({
              actor,
              permission,
              roleId: created.id,
              mutationType,
              metadata: {
                roleCode: created.code,
                roleName: created.name,
                initialState: created.state,
              },
              session,
            });

            getCurrentDomainEventCollector().emit(
              createRoleCreatedEvent({
                roleId: created.id,
                aggregateVersion: created.updatedAt,
                occurredAt: created.updatedAt,
              }),
            );

            return toRoleMutationView(created, createdRules);
          },
        );
      },
      (result) => ({
        roleId: result.id,
        roleCode: result.code,
        permissionCount: result.permissions.length,
        delegationBand: result.delegationBand,
        maxDelegatableBand: result.maxDelegatableBand,
        assignmentRuleCount: result.assignmentRules.length,
      }),
    );
  }

  private async allocateGeneratedCode(
    session: ClientSession,
  ): Promise<string> {
    const maxExisting =
      await this.roleRepository.findMaxGeneratedCodeSequence(
        ROLE_CODE_POLICY,
        session,
      );

    await this.codeSequenceRepository.ensureAtLeast(
      ROLE_CODE_POLICY.moduleKey,
      ROLE_CODE_POLICY.bucket,
      maxExisting,
      session,
    );

    const sequence = await this.codeSequenceRepository.allocateNext(
      ROLE_CODE_POLICY.moduleKey,
      ROLE_CODE_POLICY.bucket,
      session,
    );

    return formatBusinessCode(ROLE_CODE_POLICY, sequence);
  }

  async createRoleFromTemplate(
    actor: Actor,
    command: CreateRoleFromTemplateCommand,
  ): Promise<RoleMutationResult> {
    const template = getRoleTemplate(
      normalizeRequiredText(command.templateCode, "templateCode"),
    );

    if (!template) {
      throw new RoleValidationError(
        `Unknown role template code: ${command.templateCode}`,
      );
    }

    return this.createRole(actor, {
      code: command.code,
      name: command.name,
      description: command.description,
      initialPermissions: template.permissions,
      templateCode: template.code,
      templateVersion: template.version,
      templateAppliedAt: Date.now(),
    });
  }

  async updateRole(
    actor: Actor,
    command: UpdateRoleCommand,
  ): Promise<RoleMutationResult> {
    const mutationType = "role.update";
    return this.runLoggedMutation(
      actor,
      mutationType,
      {
        roleId: readOptionalLogString(command.roleId),
      },
      async (mutationTargetDescriptor) => {
        const permission = this.assertPermission(actor, Permission.ROLE_UPDATE);

        const roleId = normalizeRequiredText(command.roleId, "roleId");

        const hasName = command.name !== undefined;
        const hasDescription = command.description !== undefined;
        const hasDelegationBand = command.delegationBand !== undefined;
        const hasMaxDelegatableBand = command.maxDelegatableBand !== undefined;

        if (
          !hasName &&
          !hasDescription &&
          !hasDelegationBand &&
          !hasMaxDelegatableBand
        ) {
          throw new RoleValidationError(
            "At least one field must be provided for update",
          );
        }

        const name = hasName
          ? normalizeRequiredText(command.name, "name")
          : undefined;

        const description = hasDescription
          ? normalizeNullableText(command.description, "description")
          : undefined;
        const delegationBand = hasDelegationBand
          ? normalizeRoleDelegationBand(
              command.delegationBand,
              "delegationBand",
            )
          : undefined;
        const maxDelegatableBand = hasMaxDelegatableBand
          ? normalizeRoleMaxDelegatableBand(
              command.maxDelegatableBand,
              "maxDelegatableBand",
            )
          : undefined;

        return this.executeAuthoritativeMutation(
          actor,
          permission,
          mutationType,
          mutationTargetDescriptor,
          async (session) => {
            const role = await this.requireRole(roleId, session);

            assertRoleStateAllowed(
              role.state,
              MUTABLE_ROLE_STATES,
              "update role metadata",
            );

            const changedFields: string[] = [];

            if (name !== undefined && name !== role.name) {
              changedFields.push("name");
            }

            if (description !== undefined && description !== role.description) {
              changedFields.push("description");
            }

            if (
              delegationBand !== undefined &&
              delegationBand !== role.delegationBand
            ) {
              changedFields.push("delegationBand");
            }

            if (
              maxDelegatableBand !== undefined &&
              maxDelegatableBand !== role.maxDelegatableBand
            ) {
              changedFields.push("maxDelegatableBand");
            }

            if (changedFields.length === 0) {
              throw new RoleValidationError(
                "At least one changed field is required",
              );
            }

            const now = Date.now();
            const updated = await this.roleRepository.updateMetadata(
              {
                roleId,
                name,
                description,
                delegationBand,
                maxDelegatableBand,
                updatedAt: now,
              },
              session,
            );

            if (!updated) {
              throw new RoleConflictError(`Failed to update role: ${roleId}`);
            }

            const rules = await this.roleAssignmentRuleRepository.listByRoleId(
              roleId,
              session,
            );

            await this.recordRoleAudit({
              actor,
              permission,
              roleId,
              mutationType,
              metadata: {
                changedFields,
              },
              session,
            });

            if (
              maxDelegatableBand !== undefined &&
              maxDelegatableBand !== role.maxDelegatableBand
            ) {
              await this.assertGovernanceRecoveryContinuity(
                "update role delegation ceiling",
                session,
              );
            }

            getCurrentDomainEventCollector().emit(
              createRoleUpdatedEvent({
                roleId: updated.id,
                aggregateVersion: updated.updatedAt,
                occurredAt: updated.updatedAt,
              }),
            );

            return toRoleMutationView(updated, rules);
          },
        );
      },
      (result) => ({
        roleId: result.id,
        roleCode: result.code,
      }),
    );
  }

  async activateRole(
    actor: Actor,
    command: ActivateRoleCommand,
  ): Promise<RoleMutationResult> {
    const mutationType = "role.activate";
    return this.runLoggedMutation(
      actor,
      mutationType,
      {
        roleId: readOptionalLogString(command.roleId),
      },
      async (mutationTargetDescriptor) => {
        const permission = this.assertPermission(
          actor,
          Permission.ROLE_ACTIVATE,
        );

        const roleId = normalizeRequiredText(command.roleId, "roleId");

        return this.executeAuthoritativeMutation(
          actor,
          permission,
          mutationType,
          mutationTargetDescriptor,
          async (session, controls) => {
            const role = await this.requireRole(roleId, session);

            if (role.state !== "DRAFT" && role.state !== "INACTIVE") {
              throw new RoleStateError(
                `Role ${roleId} cannot transition from ${role.state} to ACTIVE`,
              );
            }

            const trackedPermissions = toSortedUniquePermissionCodes(
              role.permissions,
            );
            const permissionCoverageBefore = await this.readPermissionCoverage(
              trackedPermissions,
              session,
            );

            const updated = await this.roleRepository.transitionState(
              {
                roleId,
                fromStates: [role.state],
                toState: "ACTIVE",
                changedAt: Date.now(),
              },
              session,
            );

            if (!updated) {
              throw new RoleConflictError(
                `Role state transition conflict for ${roleId}`,
              );
            }

            await this.assertGovernanceRecoveryContinuity(
              "activate role",
              session,
            );

            const rules = await this.roleAssignmentRuleRepository.listByRoleId(
              roleId,
              session,
            );

            await this.recordRoleAudit({
              actor,
              permission,
              roleId,
              mutationType,
              metadata: {
                previousState: role.state,
                nextState: updated.state,
              },
              session,
            });

            getCurrentDomainEventCollector().emit(
              createRoleActivatedEvent({
                roleId,
                aggregateVersion: updated.updatedAt,
                occurredAt: updated.updatedAt,
              }),
            );

            await this.markAuthSecurityTruthChangedOnCoverageDelta({
              controls,
              trackedPermissions,
              permissionCoverageBefore,
              session,
            });

            return toRoleMutationView(updated, rules);
          },
        );
      },
      (result) => ({
        roleId: result.id,
        roleCode: result.code,
        nextState: result.state,
      }),
    );
  }

  async deactivateRole(
    actor: Actor,
    command: DeactivateRoleCommand,
  ): Promise<RoleMutationResult> {
    const mutationType = "role.deactivate";
    return this.runLoggedMutation(
      actor,
      mutationType,
      {
        roleId: readOptionalLogString(command.roleId),
      },
      async (mutationTargetDescriptor) => {
        const permission = this.assertPermission(
          actor,
          Permission.ROLE_DEACTIVATE,
        );

        const roleId = normalizeRequiredText(command.roleId, "roleId");
        const reason = normalizeNullableText(command.reason, "reason");

        return this.executeAuthoritativeMutation(
          actor,
          permission,
          mutationType,
          mutationTargetDescriptor,
          async (session) => {
            const role = await this.requireRole(roleId, session);

            if (role.state !== "ACTIVE") {
              throw new RoleStateError(
                `Role ${roleId} cannot transition from ${role.state} to INACTIVE`,
              );
            }

            await this.assertNoActiveAssignmentsForTransition(
              roleId,
              "INACTIVE",
              session,
            );

            const updated = await this.roleRepository.transitionState(
              {
                roleId,
                fromStates: ["ACTIVE"],
                toState: "INACTIVE",
                changedAt: Date.now(),
              },
              session,
            );

            if (!updated) {
              throw new RoleConflictError(
                `Role state transition conflict for ${roleId}`,
              );
            }

            await this.assertGovernanceRecoveryContinuity(
              "deactivate role",
              session,
            );

            const rules = await this.roleAssignmentRuleRepository.listByRoleId(
              roleId,
              session,
            );

            await this.recordRoleAudit({
              actor,
              permission,
              roleId,
              mutationType,
              metadata: {
                previousState: role.state,
                nextState: updated.state,
                reason,
              },
              session,
            });

            getCurrentDomainEventCollector().emit(
              createRoleDeactivatedEvent({
                roleId,
                aggregateVersion: updated.updatedAt,
                occurredAt: updated.updatedAt,
              }),
            );

            return toRoleMutationView(updated, rules);
          },
        );
      },
      (result) => ({
        roleId: result.id,
        roleCode: result.code,
        nextState: result.state,
      }),
    );
  }

  async archiveRole(
    actor: Actor,
    command: ArchiveRoleCommand,
  ): Promise<RoleMutationResult> {
    const mutationType = "role.archive";
    return this.runLoggedMutation(
      actor,
      mutationType,
      {
        roleId: readOptionalLogString(command.roleId),
      },
      async (mutationTargetDescriptor) => {
        const permission = this.assertPermission(
          actor,
          Permission.ROLE_ARCHIVE,
        );

        const roleId = normalizeRequiredText(command.roleId, "roleId");
        const reason = normalizeNullableText(command.reason, "reason");

        return this.executeAuthoritativeMutation(
          actor,
          permission,
          mutationType,
          mutationTargetDescriptor,
          async (session) => {
            const role = await this.requireRole(roleId, session);

            if (role.state !== "DRAFT" && role.state !== "INACTIVE") {
              throw new RoleStateError(
                `Role ${roleId} cannot transition from ${role.state} to ARCHIVED`,
              );
            }

            await this.assertNoActiveAssignmentsForTransition(
              roleId,
              "ARCHIVED",
              session,
            );

            const updated = await this.roleRepository.transitionState(
              {
                roleId,
                fromStates: [role.state],
                toState: "ARCHIVED",
                changedAt: Date.now(),
              },
              session,
            );

            if (!updated) {
              throw new RoleConflictError(
                `Role state transition conflict for ${roleId}`,
              );
            }

            await this.assertGovernanceRecoveryContinuity(
              "archive role",
              session,
            );

            const rules = await this.roleAssignmentRuleRepository.listByRoleId(
              roleId,
              session,
            );

            await this.recordRoleAudit({
              actor,
              permission,
              roleId,
              mutationType,
              metadata: {
                previousState: role.state,
                nextState: updated.state,
                reason,
              },
              session,
            });

            getCurrentDomainEventCollector().emit(
              createRoleArchivedEvent({
                roleId,
                aggregateVersion: updated.updatedAt,
                occurredAt: updated.updatedAt,
              }),
            );

            return toRoleMutationView(updated, rules);
          },
        );
      },
      (result) => ({
        roleId: result.id,
        roleCode: result.code,
        nextState: result.state,
      }),
    );
  }

  async setRolePermissions(
    actor: Actor,
    command: SetRolePermissionsCommand,
  ): Promise<RoleMutationResult> {
    const mutationType = "role.set-permissions";
    return this.runLoggedMutation(
      actor,
      mutationType,
      {
        roleId: readOptionalLogString(command.roleId),
      },
      async (mutationTargetDescriptor) => {
        const permission = this.assertPermission(
          actor,
          Permission.ROLE_PERMISSION_ASSIGN,
        );

        const roleId = normalizeRequiredText(command.roleId, "roleId");

        const permissions = normalizePermissionCodeList(
          command.permissions,
          "permissions",
        );
        this.assertActorCanAuthorPermissions(actor, permissions, "permissions");

        return this.executeAuthoritativeMutation(
          actor,
          permission,
          mutationType,
          mutationTargetDescriptor,
          async (session, controls) => {
            const role = await this.requireRole(roleId, session);

            assertRoleStateAllowed(
              role.state,
              MUTABLE_ROLE_STATES,
              "set role permissions",
            );

            if (areStringSetsEquivalent(role.permissions, permissions)) {
              throw new RoleValidationError(
                "At least one changed field is required",
              );
            }

            const trackedPermissions = mergePermissionCodeSets(
              role.permissions,
              permissions,
            );
            const permissionCoverageBefore = await this.readPermissionCoverage(
              trackedPermissions,
              session,
            );

            const updated = await this.roleRepository.replacePermissions(
              {
                roleId,
                permissions,
                updatedAt: Date.now(),
              },
              session,
            );

            if (!updated) {
              throw new RoleConflictError(
                `Failed to update permissions for role ${roleId}`,
              );
            }

            await this.assertGovernanceRecoveryContinuity(
              "set role permissions",
              session,
            );

            const rules = await this.roleAssignmentRuleRepository.listByRoleId(
              roleId,
              session,
            );

            await this.recordRoleAudit({
              actor,
              permission,
              roleId,
              mutationType,
              metadata: {
                permissionCount: permissions.length,
                permissionCodesSummary: permissions,
              },
              session,
            });

            getCurrentDomainEventCollector().emit(
              createRolePermissionsUpdatedEvent({
                roleId,
                permissions,
                aggregateVersion: updated.updatedAt,
                occurredAt: updated.updatedAt,
              }),
            );

            await this.markAuthSecurityTruthChangedOnCoverageDelta({
              controls,
              trackedPermissions,
              permissionCoverageBefore,
              session,
            });

            return toRoleMutationView(updated, rules);
          },
          {
            invalidateActorSnapshots: true,
          },
        );
      },
      (result) => ({
        roleId: result.id,
        roleCode: result.code,
        permissionCount: result.permissions.length,
      }),
    );
  }

  async setRoleAssignmentRules(
    actor: Actor,
    command: SetRoleAssignmentRulesCommand,
  ): Promise<RoleMutationResult> {
    const mutationType = "role.set-assignment-rules";
    return this.runLoggedMutation(
      actor,
      mutationType,
      {
        roleId: readOptionalLogString(command.roleId),
      },
      async (mutationTargetDescriptor) => {
        const permission = this.assertPermission(
          actor,
          Permission.ROLE_ASSIGNMENT_RULE_SET,
        );

        const roleId = normalizeRequiredText(command.roleId, "roleId");

        return this.executeAuthoritativeMutation(
          actor,
          permission,
          mutationType,
          mutationTargetDescriptor,
          async (session) => {
            const role = await this.requireRole(roleId, session);

            assertRoleStateAllowed(
              role.state,
              MUTABLE_ROLE_STATES,
              "set role assignment rules",
            );

            const now = Date.now();
            const normalizedRules = normalizeRoleAssignmentRules({
              roleId,
              rules: command.rules,
              now,
            });
            const currentRules =
              await this.roleAssignmentRuleRepository.listByRoleId(
                roleId,
                session,
              );

            if (
              areRoleAssignmentRulesSemanticallyEqual(
                currentRules,
                normalizedRules,
              )
            ) {
              throw new RoleValidationError(
                "At least one changed field is required",
              );
            }

            const rules =
              await this.roleAssignmentRuleRepository.replaceForRole(
                {
                  roleId,
                  rules: normalizedRules,
                },
                session,
              );

            const refreshedRole = await this.roleRepository.updateMetadata(
              {
                roleId,
                updatedAt: now,
              },
              session,
            );

            if (!refreshedRole) {
              throw new RoleConflictError(`Failed to update role: ${roleId}`);
            }

            await this.recordRoleAudit({
              actor,
              permission,
              roleId,
              mutationType,
              metadata: {
                ruleCount: rules.length,
              },
              session,
            });

            getCurrentDomainEventCollector().emit(
              createRoleAssignmentRulesUpdatedEvent({
                roleId,
                ruleIds: rules.map((rule) => rule.id),
                aggregateVersion: refreshedRole.updatedAt,
                occurredAt: refreshedRole.updatedAt,
              }),
            );

            return toRoleMutationView(refreshedRole, rules);
          },
        );
      },
      (result) => ({
        roleId: result.id,
        roleCode: result.code,
        assignmentRuleCount: result.assignmentRules.length,
      }),
    );
  }

  async assignRoleToUser(
    actor: Actor,
    command: AssignRoleToUserCommand,
  ): Promise<RoleAssignmentMutationResult> {
    const mutationType = "role.assign-to-user";
    return this.runLoggedMutation(
      actor,
      mutationType,
      {
        roleId: readOptionalLogString(command.roleId),
        userId: readOptionalLogString(command.userId),
      },
      async (mutationTargetDescriptor) => {
        const permission = this.assertPermission(
          actor,
          Permission.ROLE_ASSIGN_TO_USER,
        );

        const roleId = normalizeRequiredText(command.roleId, "roleId");
        const userId = normalizeRequiredText(command.userId, "userId");
        const reason = normalizeNullableText(command.reason, "reason");
        const scopeGrants = normalizeAssignmentScopeGrants(command.scopeGrants);
        assertActorCanGrantAssignmentScopeGrants(actor, scopeGrants);
        const structuredScopeGrants = normalizeRoleAssignmentScopeGrants(
          command.structuredScopeGrants,
        );
        const scopeFingerprint =
          buildRoleAssignmentScopeFingerprint(structuredScopeGrants);
        const effectiveAt = normalizeOptionalAssignmentTimestamp(
          command.effectiveAt,
          "effectiveAt",
        );
        const expiresAt = normalizeOptionalAssignmentTimestamp(
          command.expiresAt,
          "expiresAt",
        );
        const reviewAt = normalizeOptionalAssignmentTimestamp(
          command.reviewAt,
          "reviewAt",
        );
        assertAssignmentDates(effectiveAt, expiresAt, reviewAt);
        assertGlobalScopeReason(structuredScopeGrants, reason);

        return this.executeAuthoritativeMutation(
          actor,
          permission,
          mutationType,
          mutationTargetDescriptor,
          async (session, controls) => {
            await this.assertActorActiveForDelegation(actor, session);

            const role = await this.requireRole(roleId, session);

            if (role.state !== "ACTIVE") {
              throw new RoleStateError(
                `Role ${roleId} must be ACTIVE to assign to user`,
              );
            }

            if (userId === actor.id) {
              throw new RoleDependencyError(
                "Cannot assign role to the current actor",
              );
            }

            this.assertRoleDelegationBandAssignable(role);

            await this.assertActorCanDelegateRoleBand(
              actor.id,
              role.delegationBand,
              role.id,
              session,
            );

            const targetUser =
              await this.userReadonlyAccess.getAssignableById(
                userId,
                session,
              );

            if (!targetUser) {
              throw new RoleDependencyError(
                `Assignment target user is not assignable: ${userId}`,
              );
            }

            assertRoleAccountContextCompatible(
              role,
              targetUser.accountContexts,
            );

            const existingActiveAssignment =
              structuredScopeGrants &&
              this.userRoleAssignmentRepository
                .findActiveByRoleUserAndScopeFingerprint
                ? await this.userRoleAssignmentRepository.findActiveByRoleUserAndScopeFingerprint(
                    roleId,
                    userId,
                    scopeFingerprint,
                    session,
                  )
                : await this.userRoleAssignmentRepository.findActiveByRoleAndUser(
                    roleId,
                    userId,
                    session,
                  );

            if (existingActiveAssignment) {
              throw new RoleAssignmentConflictError(
                `Active assignment already exists for role ${roleId}, user ${userId}, and scope ${scopeFingerprint}`,
              );
            }

            const rules = await this.roleAssignmentRuleRepository.listByRoleId(
              roleId,
              session,
            );

            assertAssignmentRulesAllow({
              actor,
              role,
              userId,
              rules,
            });

            const trackedPermissions = toSortedUniquePermissionCodes(
              role.permissions,
            );
            const permissionCoverageBefore = await this.readPermissionCoverage(
              trackedPermissions,
              session,
            );

            const now = Date.now();

            const assignment = {
              assignmentId: crypto.randomUUID(),
              roleId,
              userId,
              ...(scopeGrants ? { scopeGrants } : {}),
              ...(structuredScopeGrants ? { structuredScopeGrants } : {}),
              scopeFingerprint,
              state: "ACTIVE" as const,
              effectiveAt: effectiveAt ?? now,
              expiresAt,
              reviewAt,
              assignedBy: actor.id,
              assignedAt: now,
              revokedAt: null,
              revokedBy: null,
              revokeReason: null,
              origin: command.bundleOrigin ? ("BUNDLE" as const) : ("DIRECT" as const),
              bundleOrigin: command.bundleOrigin ?? null,
              reason,
              createdAt: now,
              updatedAt: now,
            };

            try {
              await this.userRoleAssignmentRepository.insert(
                assignment,
                session,
              );
            } catch (error) {
              if (isDuplicateKeyError(error)) {
                throw new RoleAssignmentConflictError(
                  `Active assignment already exists for role ${roleId}, user ${userId}, and scope ${scopeFingerprint}`,
                );
              }

              throw error;
            }

            const refreshedRole = await this.roleRepository.updateMetadata(
              {
                roleId,
                updatedAt: now,
              },
              session,
            );

            if (!refreshedRole) {
              throw new RoleConflictError(`Failed to update role: ${roleId}`);
            }

            await this.recordRoleAudit({
              actor,
              permission,
              roleId,
              mutationType,
              metadata: {
                userId,
                assignmentId: assignment.assignmentId,
              },
              session,
            });

            getCurrentDomainEventCollector().emit(
              createRoleAssignedToUserEvent({
                roleId,
                assignmentId: assignment.assignmentId,
                userId,
                aggregateVersion: refreshedRole.updatedAt,
                occurredAt: refreshedRole.updatedAt,
              }),
            );

            await this.markAuthSecurityTruthChangedOnCoverageDelta({
              controls,
              trackedPermissions,
              permissionCoverageBefore,
              session,
            });

            return toRoleAssignmentView(assignment, refreshedRole, targetUser.ref);
          },
          {
            invalidateActorSnapshots: true,
          },
        );
      },
      (result) => ({
        roleId: result.roleId,
        assignmentId: result.assignmentId,
        userId: result.userId,
      }),
    );
  }

  async revokeRoleFromUser(
    actor: Actor,
    command: RevokeRoleFromUserCommand,
  ): Promise<RoleAssignmentMutationResult> {
    const mutationType = "role.revoke-from-user";
    return this.runLoggedMutation(
      actor,
      mutationType,
      {
        roleId: readOptionalLogString(command.roleId),
        assignmentId: readOptionalLogString(command.assignmentId),
      },
      async (mutationTargetDescriptor) => {
        const permission = this.assertPermission(
          actor,
          Permission.ROLE_REVOKE_FROM_USER,
        );

        const roleId = normalizeRequiredText(command.roleId, "roleId");
        const assignmentId = normalizeRequiredText(
          command.assignmentId,
          "assignmentId",
        );
        const reason = normalizeNullableText(command.reason, "reason");

        return this.executeAuthoritativeMutation(
          actor,
          permission,
          mutationType,
          mutationTargetDescriptor,
          async (session, controls) => {
            await this.assertActorActiveForDelegation(actor, session);

            const role = await this.requireRole(roleId, session);

            if (role.state !== "ACTIVE") {
              throw new RoleStateError(
                `Role ${roleId} must be ACTIVE to revoke from user`,
              );
            }

            this.assertRoleDelegationBandAssignable(role);

            await this.assertActorCanDelegateRoleBand(
              actor.id,
              role.delegationBand,
              role.id,
              session,
            );

            const assignment = await this.userRoleAssignmentRepository.findById(
              assignmentId,
              session,
            );

            if (!assignment || assignment.roleId !== roleId) {
              throw new RoleAssignmentNotFoundError(assignmentId);
            }

            if (assignment.state !== "ACTIVE") {
              throw new RoleStateError(
                `Role assignment ${assignmentId} cannot transition from ${assignment.state} to REVOKED`,
              );
            }

            const targetExists = await this.userReadonlyAccess.isAssignableById(
              assignment.userId,
              session,
            );

            if (!targetExists) {
              throw new RoleDependencyError(
                `Revocation target user is not assignable: ${assignment.userId}`,
              );
            }

            const rules = await this.roleAssignmentRuleRepository.listByRoleId(
              roleId,
              session,
            );

            assertAssignmentRulesAllow({
              actor,
              role,
              userId: assignment.userId,
              rules,
            });

            const trackedPermissions = toSortedUniquePermissionCodes(
              role.permissions,
            );
            const permissionCoverageBefore = await this.readPermissionCoverage(
              trackedPermissions,
              session,
            );

            const revokedAt = Date.now();
            const revoked = await this.userRoleAssignmentRepository.revokeById(
              assignmentId,
              reason,
              revokedAt,
              session,
              actor.id,
            );

            if (!revoked) {
              throw new RoleConflictError(
                `Role assignment transition conflict: ${assignmentId}`,
              );
            }

            await this.assertGovernanceRecoveryContinuity(
              "revoke role from user",
              session,
            );

            const refreshedRole = await this.roleRepository.updateMetadata(
              {
                roleId,
                updatedAt: revokedAt,
              },
              session,
            );

            if (!refreshedRole) {
              throw new RoleConflictError(`Failed to update role: ${roleId}`);
            }

            await this.recordRoleAudit({
              actor,
              permission,
              roleId,
              mutationType,
              metadata: {
                userId: revoked.userId,
                assignmentId,
                reason,
              },
              session,
            });

            getCurrentDomainEventCollector().emit(
              createRoleRevokedFromUserEvent({
                roleId,
                assignmentId,
                userId: revoked.userId,
                aggregateVersion: refreshedRole.updatedAt,
                occurredAt: refreshedRole.updatedAt,
              }),
            );

            await this.markAuthSecurityTruthChangedOnCoverageDelta({
              controls,
              trackedPermissions,
              permissionCoverageBefore,
              session,
            });

            return toRoleAssignmentView(revoked, refreshedRole);
          },
          {
            invalidateActorSnapshots: true,
          },
        );
      },
      (result) => ({
        roleId: result.roleId,
        assignmentId: result.assignmentId,
        userId: result.userId,
      }),
    );
  }

  private async runLoggedMutation<T>(
    actor: Actor,
    operation: AuthoritativeAdminMutationIdentity,
    startMetadata: Readonly<Record<string, unknown>>,
    execute: (mutationTargetDescriptor: string) => Promise<T>,
    onSuccess: (result: T) => Readonly<Record<string, unknown>>,
  ): Promise<T> {
    const mutationTargetDescriptor =
      buildMutationTargetDescriptor(startMetadata);

    this.logMutationEvent(actor, operation, "mutation.start", startMetadata);

    try {
      const result = await execute(mutationTargetDescriptor);

      this.logMutationEvent(actor, operation, "mutation.success", {
        ...startMetadata,
        ...onSuccess(result),
      });

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
          classification: classifyRoleMutationFailure(error),
          errorCode: extractErrorCode(error),
          errorMessage: truncateLogMessage(error),
        },
      });

      throw error;
    }
  }

  private async executeAuthoritativeMutation<T>(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    mutationTargetDescriptor: string,
    mutate: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
    options?: {
      readonly invalidateActorSnapshots?: boolean;
    },
  ): Promise<T> {
    const traceId = getTraceIdOrThrow();

    const result = await this.mutationBridge.execute(
      {
        actor,
        traceId,
        requiredPermission: permission,
        mutationIdentity: operation,
        mutationTargetDescriptor,
      },
      mutate,
    );

    if (options?.invalidateActorSnapshots) {
      await this.actorSnapshotCacheInvalidator.invalidateAll({
        traceId,
        actorId: actor.id,
        context: actor.context,
        operation,
      });
    }

    return result;
  }

  private async readPermissionCoverage(
    permissionCodes: readonly string[],
    session: ClientSession,
  ): Promise<Readonly<Record<string, readonly string[]>>> {
    const trackedPermissions = toSortedUniquePermissionCodes(permissionCodes);

    if (trackedPermissions.length === 0) {
      return {};
    }

    return this.adminCapabilityRepository.listActiveUserIdsByPermission(
      trackedPermissions,
      session,
    );
  }

  private async markAuthSecurityTruthChangedOnCoverageDelta(params: {
    readonly controls: AuthoritativeMutationControls;
    readonly trackedPermissions: readonly string[];
    readonly permissionCoverageBefore: Readonly<
      Record<string, readonly string[]>
    >;
    readonly session: ClientSession;
  }): Promise<void> {
    const trackedPermissions = toSortedUniquePermissionCodes(
      params.trackedPermissions,
    );

    if (trackedPermissions.length === 0) {
      return;
    }

    const permissionCoverageAfter =
      await this.adminCapabilityRepository.listActiveUserIdsByPermission(
        trackedPermissions,
        params.session,
      );

    if (
      hasPermissionCoverageDelta({
        trackedPermissions,
        before: params.permissionCoverageBefore,
        after: permissionCoverageAfter,
      })
    ) {
      params.controls.markAuthSecurityTruthChanged();
    }
  }

  private async assertActorActiveForDelegation(
    actor: Actor,
    session: ClientSession,
  ): Promise<void> {
    if (!actor.isActive) {
      throw new RoleDependencyError(
        `Delegation actor is not ACTIVE: ${actor.id}`,
      );
    }

    const isActive = await this.userReadonlyAccess.isAssignableById(
      actor.id,
      session,
    );

    if (!isActive) {
      throw new RoleDependencyError(
        `Delegation actor is not ACTIVE: ${actor.id}`,
      );
    }
  }

  private assertRoleDelegationBandAssignable(role: RoleRecord): void {
    if (role.delegationBand !== "FOUNDATION") {
      return;
    }

    throw new RoleDependencyError(
      `Role ${role.id} in delegation band FOUNDATION cannot be delegated on admin path`,
    );
  }

  private async assertActorCanDelegateRoleBand(
    actorId: string,
    targetBand: RoleDelegationBand,
    roleId: string,
    session: ClientSession,
  ): Promise<void> {
    const ceilings =
      await this.adminCapabilityRepository.listActiveDelegationCeilingsByUserId(
        actorId,
        session,
      );

    if (
      ceilings.some((ceiling) =>
        isDelegationCeilingSufficient(ceiling, targetBand),
      )
    ) {
      return;
    }

    throw new RoleDependencyError(
      `Delegation denied: actor ${actorId} lacks active role delegation ceiling for role ${roleId} band ${targetBand}`,
    );
  }

  private async assertGovernanceRecoveryContinuity(
    operation: string,
    session: ClientSession,
  ): Promise<void> {
    const recoverableUserIds =
      await this.adminCapabilityRepository.listActiveUserIdsWithGovernanceRecoverySurface(
        GOVERNANCE_RECOVERY_PERMISSION_CODES,
        "PRIVILEGED",
        session,
      );

    if (recoverableUserIds.length > 0) {
      return;
    }

    throw new RoleDependencyError(
      `Cannot ${operation}: no ACTIVE user retains full governance recovery surface`,
    );
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

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    const permission = PermissionResolver.resolve(permissionCode);

    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private async recordRoleAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly roleId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.roleId,
      {
        mutationType: params.mutationType,
        targetId: params.roleId,
        targetType: "role",
        actorId: params.actor.id,
        ...params.metadata,
      },
      params.session,
    );
  }

  private assertActorCanAuthorPermissions(
    actor: Actor,
    requestedPermissions: readonly string[],
    field: string,
  ): void {
    const actorPermissions = new Set(actor.permissions);

    for (const code of requestedPermissions) {
      if (actorPermissions.has(code)) {
        continue;
      }

      throw new RoleValidationError(
        `${field} contains unauthorized permission code: ${code}`,
      );
    }
  }

  private async requireRole(
    roleId: string,
    session: ClientSession,
  ): Promise<RoleRecord> {
    const role = await this.roleRepository.findById(roleId, session);

    if (!role) {
      throw new RoleNotFoundError(roleId);
    }

    return role;
  }

  private async assertNoActiveAssignmentsForTransition(
    roleId: string,
    nextState: "INACTIVE" | "ARCHIVED",
    session: ClientSession,
  ): Promise<void> {
    const hasActiveAssignments =
      await this.userRoleAssignmentRepository.hasActiveAssignmentsForRole(
        roleId,
        session,
      );

    if (!hasActiveAssignments) {
      return;
    }

    throw new RoleDependencyError(
      `Role ${roleId} has active assignments and cannot transition to ${nextState}`,
    );
  }
}

function buildMutationTargetDescriptor(
  metadata: Readonly<Record<string, unknown>>,
): string {
  const encoded = JSON.stringify(metadata);

  if (typeof encoded === "string" && encoded.length > 2) {
    return encoded;
  }

  return "target:unspecified";
}

function toRoleMutationView(
  role: RoleRecord,
  rules: readonly RoleAssignmentRuleRecord[],
): RoleMutationView {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    state: role.state,
    permissions: [...role.permissions],
    delegationBand: role.delegationBand,
    maxDelegatableBand: role.maxDelegatableBand,
    assignmentRules: rules.map((rule) => toRuleView(rule)),
    templateCode: role.templateCode,
    templateVersion: role.templateVersion,
    templateAppliedAt: role.templateAppliedAt,
    updatedAt: role.updatedAt,
    activatedAt: role.activatedAt,
    archivedAt: role.archivedAt,
  };
}

function toRuleView(rule: RoleAssignmentRuleRecord): RoleAssignmentRuleView {
  return {
    id: rule.id,
    code: rule.code,
    description: rule.description,
    state: rule.state,
    conditions: rule.conditions,
  };
}

function toRoleAssignmentView(
  assignment: UserRoleAssignmentRecord,
  role: RoleRecord,
  userRef?: RoleAssignmentView["userRef"],
): RoleAssignmentView {
  return {
    assignmentId: assignment.assignmentId,
    roleId: assignment.roleId,
    userId: assignment.userId,
    roleRef: {
      id: role.id,
      code: role.code,
      name: role.name,
    },
    userRef: userRef ?? null,
    ...(assignment.scopeGrants ? { scopeGrants: assignment.scopeGrants } : {}),
    ...(assignment.structuredScopeGrants
      ? { structuredScopeGrants: assignment.structuredScopeGrants }
      : {}),
    scopeFingerprint:
      assignment.scopeFingerprint ??
      buildRoleAssignmentScopeFingerprint(undefined),
    state: assignment.state,
    effectiveAt: assignment.effectiveAt,
    expiresAt: assignment.expiresAt ?? null,
    reviewAt: assignment.reviewAt ?? null,
    assignedBy: assignment.assignedBy ?? null,
    assignedAt: assignment.assignedAt ?? assignment.createdAt,
    revokedAt: assignment.revokedAt,
    revokedBy: assignment.revokedBy ?? null,
    revokeReason: assignment.revokeReason ?? null,
    origin: assignment.origin ?? "LEGACY",
    bundleOrigin: assignment.bundleOrigin ?? null,
    reason: assignment.reason,
  };
}

function assertRoleStateAllowed(
  state: RoleState,
  allowedStates: readonly RoleState[],
  actionLabel: string,
): void {
  if (allowedStates.includes(state)) {
    return;
  }

  throw new RoleStateError(
    `Role in state ${state} cannot execute operation: ${actionLabel}`,
  );
}

function assertRoleAccountContextCompatible(
  role: RoleRecord,
  accountContexts: readonly AccountContext[],
): void {
  const governingCode = role.templateCode ?? role.code;
  const template = getRoleTemplate(governingCode);
  const requiredAccountContext = template?.recommendedAccountContext;

  if (!requiredAccountContext) {
    return;
  }

  if (!accountContexts.includes(requiredAccountContext)) {
    throw new RoleValidationError(
      `${governingCode} requires ${requiredAccountContext} account context.`,
    );
  }
}

function normalizeRoleCode(value: unknown): string {
  const raw = normalizeRequiredText(value, "code");
  return raw.trim().toUpperCase();
}

function normalizeOptionalRoleCode(value: unknown): string | undefined {
  const raw = normalizeOptionalText(value, "code");
  return raw === undefined ? undefined : normalizeRoleCode(raw);
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new RoleValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new RoleValidationError(`${field} is required`);
  }

  return normalized;
}

function normalizeNullableText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new RoleValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalText(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new RoleValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalRoleTemplateCode(
  value: unknown,
  field: string,
): RoleTemplateCode | undefined {
  const normalized = normalizeOptionalText(value, field);
  if (normalized === undefined) {
    return undefined;
  }

  const code = normalized.toUpperCase();
  if (isRoleTemplateCode(code)) {
    return code;
  }

  throw new RoleValidationError(
    `${field} contains unknown role template code: ${normalized}`,
  );
}

function normalizeOptionalTimestamp(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new RoleValidationError(`${field} must be a non-negative integer`);
  }

  return value;
}

function normalizeRoleDelegationBand(
  value: unknown,
  field: string,
  fallback?: RoleDelegationBand,
): RoleDelegationBand {
  if (value === undefined || value === null) {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new RoleValidationError(
      `${field} must be one of LIMITED, PRIVILEGED, FOUNDATION`,
    );
  }

  if (typeof value !== "string") {
    throw new RoleValidationError(
      `${field} must be one of LIMITED, PRIVILEGED, FOUNDATION`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (ROLE_DELEGATION_BANDS.includes(normalized as RoleDelegationBand)) {
    return normalized as RoleDelegationBand;
  }

  throw new RoleValidationError(
    `${field} must be one of LIMITED, PRIVILEGED, FOUNDATION`,
  );
}

function normalizeRoleMaxDelegatableBand(
  value: unknown,
  field: string,
  fallback?: RoleMaxDelegatableBand,
): RoleMaxDelegatableBand {
  if (value === undefined || value === null) {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new RoleValidationError(
      `${field} must be one of NONE, LIMITED, PRIVILEGED`,
    );
  }

  if (typeof value !== "string") {
    throw new RoleValidationError(
      `${field} must be one of NONE, LIMITED, PRIVILEGED`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    ROLE_MAX_DELEGATABLE_BANDS.includes(normalized as RoleMaxDelegatableBand)
  ) {
    return normalized as RoleMaxDelegatableBand;
  }

  throw new RoleValidationError(
    `${field} must be one of NONE, LIMITED, PRIVILEGED`,
  );
}

function normalizePermissionCodeList(
  value: unknown,
  field: string,
): readonly string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new RoleValidationError(`${field} must be an array of strings`);
  }

  const unique = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new RoleValidationError(`${field} must be an array of strings`);
    }

    const normalized = entry.trim();

    if (!normalized) {
      throw new RoleValidationError(
        `${field} must not contain empty permission codes`,
      );
    }

    if (!CANONICAL_PERMISSION_CODES.has(normalized)) {
      throw new RoleValidationError(
        `${field} contains unknown permission code: ${normalized}`,
      );
    }

    unique.add(normalized);
  }

  return [...unique.values()];
}

function normalizeRoleAssignmentRules(params: {
  roleId: string;
  rules: readonly RoleAssignmentRuleInput[];
  now: number;
}): readonly RoleAssignmentRuleRecord[] {
  if (!Array.isArray(params.rules)) {
    throw new RoleValidationError("rules must be an array");
  }

  const normalized: RoleAssignmentRuleRecord[] = [];
  const seenCodes = new Set<string>();

  for (const raw of params.rules) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new RoleValidationError("Each rule must be an object");
    }

    const code = normalizeRequiredText(raw.code, "rule.code");
    if (seenCodes.has(code)) {
      throw new RoleValidationError(
        `rules must not contain duplicate rule.code values: ${code}`,
      );
    }
    seenCodes.add(code);

    const description = normalizeNullableText(
      raw.description,
      "rule.description",
    );

    const state = parseRuleState(raw.state);

    normalized.push({
      id:
        typeof raw.id === "string" && raw.id.trim().length > 0
          ? raw.id.trim()
          : crypto.randomUUID(),
      roleId: params.roleId,
      code,
      description,
      state,
      conditions: normalizeRuleConditions(raw.conditions),
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  return normalized;
}

function parseRuleState(value: unknown): RoleAssignmentRuleState {
  if (value === undefined) {
    return "ACTIVE";
  }

  if (typeof value !== "string") {
    throw new RoleValidationError("rule.state must be ACTIVE or INACTIVE");
  }

  const normalized = value.trim().toUpperCase();

  if (
    ROLE_ASSIGNMENT_RULE_STATES.includes(normalized as RoleAssignmentRuleState)
  ) {
    return normalized as RoleAssignmentRuleState;
  }

  throw new RoleValidationError("rule.state must be ACTIVE or INACTIVE");
}

function normalizeRuleConditions(
  value: unknown,
): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeConditionObject(value, "rule.conditions");
}

function normalizeConditionObject(
  value: unknown,
  path: string,
): Record<string, unknown> {
  assertStrictConditionObject(value, path);
  const source = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(source)) {
    if (entry === undefined) {
      throw new RoleValidationError(`${path}.${key} must not be undefined`);
    }

    normalized[key] = normalizeConditionValue(entry, `${path}.${key}`);
  }

  return normalized;
}

function normalizeConditionValue(value: unknown, path: string): unknown {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;

  if (valueType === "string" || valueType === "boolean") {
    return value;
  }

  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new RoleValidationError(`${path} must be a finite number`);
    }

    return value;
  }

  if (valueType === "undefined") {
    throw new RoleValidationError(`${path} must not be undefined`);
  }

  if (
    valueType === "bigint" ||
    valueType === "symbol" ||
    valueType === "function"
  ) {
    throw new RoleValidationError(`${path} contains unsupported value type`);
  }

  if (Array.isArray(value)) {
    throw new RoleValidationError(`${path} must not contain arrays`);
  }

  return normalizeConditionObject(value, path);
}

function assertStrictConditionObject(value: unknown, path: string): void {
  if (typeof value !== "object" || value === null) {
    throw new RoleValidationError(`${path} must be a strict plain object`);
  }

  if (Array.isArray(value)) {
    throw new RoleValidationError(`${path} must be a strict plain object`);
  }

  if (value instanceof Date || value instanceof Map || value instanceof Set) {
    throw new RoleValidationError(`${path} must be a strict plain object`);
  }

  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    throw new RoleValidationError(`${path} must be a strict plain object`);
  }

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype) {
    throw new RoleValidationError(`${path} must be a strict plain object`);
  }

  if (
    "toJSON" in value &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    throw new RoleValidationError(`${path} must not include toJSON`);
  }
}

function normalizeOptionalAssignmentTimestamp(
  value: unknown,
  field: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const timestamp =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : Number.NaN;
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new RoleValidationError(`${field} must be a timestamp or ISO date`);
  }
  return Math.trunc(timestamp);
}

function assertAssignmentDates(
  effectiveAt: number | null,
  expiresAt: number | null,
  reviewAt: number | null,
): void {
  const effective = effectiveAt ?? Date.now();
  if (expiresAt !== null && expiresAt <= effective) {
    throw new RoleValidationError("expiresAt must be after effectiveAt");
  }
  if (reviewAt !== null && reviewAt < effective) {
    throw new RoleValidationError("reviewAt must not be before effectiveAt");
  }
}

function assertGlobalScopeReason(
  grants: ReturnType<typeof normalizeRoleAssignmentScopeGrants>,
  reason: string | null,
): void {
  if (
    grants?.some(
      (grant) =>
        grant.scopeType === "global" || grant.scopeType === "financeGlobal",
    ) &&
    !reason
  ) {
    throw new RoleValidationError(
      "reason is required for global or financeGlobal scope",
    );
  }
}

function toSortedUniquePermissionCodes(
  permissionCodes: readonly string[],
): readonly string[] {
  return [...new Set(permissionCodes)].sort();
}

function mergePermissionCodeSets(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  return toSortedUniquePermissionCodes([...left, ...right]);
}

function isDelegationCeilingSufficient(
  ceiling: RoleMaxDelegatableBand,
  targetBand: RoleDelegationBand,
): boolean {
  if (targetBand === "FOUNDATION") {
    return false;
  }

  const ceilingRank =
    ceiling === "PRIVILEGED" ? 2 : ceiling === "LIMITED" ? 1 : 0;
  const targetRank = targetBand === "PRIVILEGED" ? 2 : 1;

  return ceilingRank >= targetRank;
}

function areStringSetsEquivalent(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSorted = toSortedUniquePermissionCodes(left);
  const rightSorted = toSortedUniquePermissionCodes(right);

  if (leftSorted.length !== rightSorted.length) {
    return false;
  }

  for (let index = 0; index < leftSorted.length; index += 1) {
    if (leftSorted[index] !== rightSorted[index]) {
      return false;
    }
  }

  return true;
}

function areRoleAssignmentRulesSemanticallyEqual(
  left: readonly RoleAssignmentRuleRecord[],
  right: readonly RoleAssignmentRuleRecord[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const leftComparable = left
    .map(toComparableRoleAssignmentRule)
    .sort(compareComparableRoleRules);
  const rightComparable = right
    .map(toComparableRoleAssignmentRule)
    .sort(compareComparableRoleRules);

  for (let index = 0; index < leftComparable.length; index += 1) {
    const leftRule = leftComparable[index];
    const rightRule = rightComparable[index];

    if (!leftRule || !rightRule) {
      return false;
    }

    if (
      leftRule.code !== rightRule.code ||
      leftRule.description !== rightRule.description ||
      leftRule.state !== rightRule.state ||
      leftRule.conditions !== rightRule.conditions
    ) {
      return false;
    }
  }

  return true;
}

function compareComparableRoleRules(
  left: ComparableRoleAssignmentRule,
  right: ComparableRoleAssignmentRule,
): number {
  if (left.code !== right.code) {
    return left.code.localeCompare(right.code);
  }

  if (left.state !== right.state) {
    return left.state.localeCompare(right.state);
  }

  if (left.description !== right.description) {
    return (left.description ?? "").localeCompare(right.description ?? "");
  }

  return left.conditions.localeCompare(right.conditions);
}

interface ComparableRoleAssignmentRule {
  readonly code: string;
  readonly description: string | null;
  readonly state: RoleAssignmentRuleState;
  readonly conditions: string;
}

function toComparableRoleAssignmentRule(
  rule: RoleAssignmentRuleRecord,
): ComparableRoleAssignmentRule {
  return {
    code: rule.code,
    description: rule.description,
    state: rule.state,
    conditions: JSON.stringify(toStableComparableValue(rule.conditions)),
  };
}

function toStableComparableValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toStableComparableValue(entry));
  }

  if (typeof value !== "object") {
    return String(value);
  }

  const source = value as Record<string, unknown>;
  const entries = Object.keys(source)
    .sort()
    .map((key) => [key, toStableComparableValue(source[key])]);

  return Object.fromEntries(entries);
}

function hasPermissionCoverageDelta(params: {
  readonly trackedPermissions: readonly string[];
  readonly before: Readonly<Record<string, readonly string[]>>;
  readonly after: Readonly<Record<string, readonly string[]>>;
}): boolean {
  for (const permissionCode of params.trackedPermissions) {
    const beforeUserIds = params.before[permissionCode] ?? [];
    const afterUserIds = params.after[permissionCode] ?? [];

    if (beforeUserIds.length !== afterUserIds.length) {
      return true;
    }

    for (let index = 0; index < beforeUserIds.length; index += 1) {
      if (beforeUserIds[index] !== afterUserIds[index]) {
        return true;
      }
    }
  }

  return false;
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!(error instanceof MongoServerError)) {
    return false;
  }

  return error.code === 11000;
}

function classifyRoleMutationFailure(
  error: unknown,
): RoleFailureClassification {
  if (error instanceof RoleValidationError) {
    return "validation";
  }

  if (
    error instanceof RoleConflictError ||
    error instanceof RoleAssignmentConflictError
  ) {
    return "conflict";
  }

  if (
    error instanceof RoleNotFoundError ||
    error instanceof RoleAssignmentNotFoundError
  ) {
    return "not_found";
  }

  if (error instanceof RoleStateError) {
    return "state_error";
  }

  if (error instanceof RoleDependencyError) {
    return "dependency_error";
  }

  if (error instanceof SystemInvariantError) {
    return "invariant";
  }

  return "unknown";
}

function extractErrorCode(error: unknown): string | undefined {
  if (error instanceof BaseAppError) {
    return error.code;
  }

  if (error instanceof SystemInvariantError) {
    return error.code;
  }

  return undefined;
}

function truncateLogMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (raw.length <= 256) {
    return raw;
  }

  return `${raw.slice(0, 253)}...`;
}

function readOptionalLogString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function assertAssignmentRulesAllow(params: {
  actor: Actor;
  role: RoleRecord;
  userId: string;
  rules: readonly RoleAssignmentRuleRecord[];
}): void {
  const evaluationContext = {
    role: {
      id: params.role.id,
      code: params.role.code,
      state: params.role.state,
    },
    target: {
      userId: params.userId,
    },
    actor: {
      id: params.actor.id,
      type: params.actor.type,
      context: params.actor.context,
    },
  };

  for (const rule of params.rules) {
    if (rule.state !== "ACTIVE") {
      continue;
    }

    if (rule.conditions === null) {
      continue;
    }

    if (!doesRuleConditionMatchContext(rule.conditions, evaluationContext)) {
      throw new RoleDependencyError(
        `Role assignment denied by rule ${rule.code} for role ${params.role.id} and user ${params.userId}`,
      );
    }
  }
}

function doesRuleConditionMatchContext(
  condition: Record<string, unknown>,
  context: Record<string, unknown>,
): boolean {
  for (const [key, expectedValue] of Object.entries(condition)) {
    if (!(key in context)) {
      return false;
    }

    const actualValue = context[key];

    if (!doesRuleConditionValueMatch(expectedValue, actualValue)) {
      return false;
    }
  }

  return true;
}

function doesRuleConditionValueMatch(
  expectedValue: unknown,
  actualValue: unknown,
): boolean {
  if (expectedValue === null || typeof expectedValue !== "object") {
    return Object.is(expectedValue, actualValue);
  }

  if (
    typeof actualValue !== "object" ||
    actualValue === null ||
    Array.isArray(actualValue)
  ) {
    return false;
  }

  return doesRuleConditionMatchContext(
    expectedValue as Record<string, unknown>,
    actualValue as Record<string, unknown>,
  );
}
