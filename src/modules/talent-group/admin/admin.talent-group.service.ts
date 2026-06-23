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
  TalentGroupConflictError,
  TalentGroupInvalidMembershipStateError,
  TalentGroupInvalidTalentReferenceError,
  TalentGroupMemberNotFoundError,
  TalentGroupNotFoundError,
  TalentGroupPermissionScopeError,
  TalentGroupStateError,
  TalentGroupValidationError,
} from "@modules/talent-group/domain/talent-group.errors";
import { TALENT_GROUP_CODE_POLICY } from "@modules/talent-group/domain/talent-group-code-policy";
import { TalentGroupEventAssignmentReadonlyAccess } from "@modules/talent-group/domain/talent-group-event-assignment-readonly-access";
import { TalentGroupWorkScheduleReadonlyAccess } from "@modules/talent-group/domain/talent-group-work-schedule-readonly-access";
import {
  TalentGroupRepository,
  UpdateTalentGroupCoreInput,
} from "@modules/talent-group/domain/talent-group.repository";
import {
  TalentGroupMemberMutationView,
  TalentGroupMemberRecord,
  TalentGroupMutationView,
  TalentGroupRecord,
} from "@modules/talent-group/domain/talent-group.types";
import {
  ActivateTalentGroupCommand,
  AddTalentGroupMemberCommand,
  ArchiveTalentGroupCommand,
  CreateTalentGroupCommand,
  DeactivateTalentGroupCommand,
  DeactivateTalentGroupMemberCommand,
  ReactivateTalentGroupMemberCommand,
  RemoveTalentGroupMemberCommand,
  TalentGroupMutationResult,
  UpdateTalentGroupCoreCommand,
  UpdateTalentGroupMemberLineupCommand,
} from "@modules/talent-group/shared/talent-group.contracts";
import {
  TalentGroupReferencedTalent,
  TalentGroupTalentReadonlyAccess,
} from "@modules/talent/domain/talent-group-talent-readonly-access";
import { TalentGroupPlatformAccountReadonlyAccess } from "@modules/talent-group/domain/talent-group-platform-account-readonly-access";
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";

type TalentGroupFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "member_not_found"
  | "state_error"
  | "invalid_talent_reference"
  | "invalid_membership_state"
  | "invariant"
  | "unknown";

export class TalentGroupAdminService {
  constructor(
    private readonly repository: TalentGroupRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly talentReadonlyAccess: TalentGroupTalentReadonlyAccess,
    private readonly platformAccountReadonlyAccess: TalentGroupPlatformAccountReadonlyAccess,
    private readonly workScheduleReadonlyAccess: TalentGroupWorkScheduleReadonlyAccess,
    private readonly eventAssignmentReadonlyAccess: TalentGroupEventAssignmentReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createTalentGroup(
    actor: Actor,
    command: CreateTalentGroupCommand,
  ): Promise<TalentGroupMutationResult> {
    const operation = "talent-group.create";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_CREATE,
    );
    const input = normalizeCreateCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        groupCode: readOptionalLogString(
          command.groupCode,
        ),
      },
      async (session) => {
        if (input.groupCode !== undefined) {
          const existingCode =
            await this.repository.findGroupByCode(
              input.groupCode,
              session,
            );

          if (existingCode) {
            throw new TalentGroupConflictError(
              `Talent group code already exists: ${input.groupCode}`,
            );
          }
        }

        const existingName =
          await this.repository.findLiveGroupByNormalizedName(
            {
              normalizedName:
                input.normalizedName,
            },
            session,
          );

        if (existingName) {
          throw new TalentGroupConflictError(
            "A live talent group already uses the same normalized name",
          );
        }

        let created!: TalentGroupRecord;
        const maxAttempts =
          input.groupCode === undefined ? 5 : 1;

        for (
          let attempt = 1;
          attempt <= maxAttempts;
          attempt += 1
        ) {
          const groupCode =
            input.groupCode ??
            (await this.allocateGeneratedCode(session));
          const now = Date.now();
          const group: TalentGroupRecord = {
            id: crypto.randomUUID(),
            groupCode,
            name: input.name,
            normalizedName: input.normalizedName,
            shortName: input.shortName,
            normalizedShortName:
              input.normalizedShortName,
            description: input.description,
            externalRef: input.externalRef,
            status: "ACTIVE",
            displayOrder: input.displayOrder,
            createdAt: now,
            updatedAt: now,
          };

          try {
            created = await this.repository.insertGroup(
              group,
              session,
            );
            break;
          } catch (error) {
            if (!isDuplicateKeyError(error)) {
              throw error;
            }

            if (input.groupCode !== undefined) {
              throw new TalentGroupConflictError(
                "Talent group code or live normalized name already exists",
              );
            }

            if (attempt >= maxAttempts) {
              throw new TalentGroupConflictError(
                "Generated talent group code conflict detected on create",
              );
            }
          }
        }

        await this.recordGroupAudit({
          actor,
          permission,
          groupId: created.id,
          mutationType: operation,
          metadata: {
            groupCode: created.groupCode,
            status: created.status,
          },
          session,
        });

        return toTalentGroupMutationView(created);
      },
      (result) => ({
        groupId: result.id,
        status: result.status,
      }),
    );
  }

  async updateTalentGroupCore(
    actor: Actor,
    command: UpdateTalentGroupCoreCommand,
  ): Promise<TalentGroupMutationResult> {
    const operation = "talent-group.update-core";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_UPDATE,
    );
    const groupId = normalizeRequiredText(
      command.groupId,
      "groupId",
    );

    const hasName = command.name !== undefined;
    const hasShortName =
      command.shortName !== undefined;
    const hasDescription =
      command.description !== undefined;
    const hasDisplayOrder =
      command.displayOrder !== undefined;
    const hasExternalRef =
      command.externalRef !== undefined;

    if (
      !hasName &&
      !hasShortName &&
      !hasDescription &&
      !hasDisplayOrder &&
      !hasExternalRef
    ) {
      throw new TalentGroupValidationError(
        "At least one field must be provided for update",
      );
    }

    const name = hasName
      ? normalizeDisplayText(command.name, "name")
      : undefined;
    const shortName = hasShortName
      ? normalizeNullablePatchText(
          command.shortName,
          "shortName",
        )
      : undefined;
    const description = hasDescription
      ? normalizeNullablePatchText(
          command.description,
          "description",
        )
      : undefined;
    const displayOrder = hasDisplayOrder
      ? normalizeInteger(
          command.displayOrder,
          "displayOrder",
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
        groupId: readOptionalLogString(
          command.groupId,
        ),
      },
      async (session) => {
        const current = await this.requireGroup(
          groupId,
          session,
        );
        await this.requireManagedTalentGroupAuthority(
          actor,
          Permission.TALENT_GROUP_UPDATE,
          current.id,
        );

        if (current.status === "ARCHIVED") {
          throw new TalentGroupStateError(
            `Archived talent group cannot be updated: ${groupId}`,
          );
        }

        const patch = buildTalentGroupCorePatch({
          current,
          groupId,
          name,
          shortName,
          description,
          displayOrder,
          externalRef,
        });

        if (
          patch.normalizedName !== undefined
        ) {
          const existingName =
            await this.repository.findLiveGroupByNormalizedName(
              {
                normalizedName:
                  patch.normalizedName,
                excludeGroupId: current.id,
              },
              session,
            );

          if (existingName) {
            throw new TalentGroupConflictError(
              "A live talent group already uses the same normalized name",
            );
          }
        }

        let updated: TalentGroupRecord | null;

        try {
          updated =
            await this.repository.updateGroupCore(
              patch,
              session,
            );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new TalentGroupConflictError(
              "Talent group name conflict detected on update",
            );
          }

          throw error;
        }

        if (!updated) {
          throw new TalentGroupConflictError(
            `Talent group update conflict for ${groupId}`,
          );
        }

        await this.recordGroupAudit({
          actor,
          permission,
          groupId,
          mutationType: operation,
          metadata: {
            changedFields: summarizeChangedGroupFields(
              current,
              updated,
            ),
          },
          session,
        });

        return toTalentGroupMutationView(updated);
      },
      (result) => ({
        groupId: result.id,
        status: result.status,
      }),
    );
  }

  async activateTalentGroup(
    actor: Actor,
    command: ActivateTalentGroupCommand,
  ): Promise<TalentGroupMutationResult> {
    const operation = "talent-group.activate";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_MANAGE_LIFECYCLE,
    );
    const groupId = normalizeRequiredText(
      command.groupId,
      "groupId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        groupId: readOptionalLogString(
          command.groupId,
        ),
      },
      async (session) => {
        const current = await this.requireGroup(
          groupId,
          session,
        );
        await this.requireManagedTalentGroupAuthority(
          actor,
          Permission.TALENT_GROUP_MANAGE_LIFECYCLE,
          current.id,
        );

        if (current.status !== "INACTIVE") {
          throw new TalentGroupStateError(
            `Talent group ${groupId} cannot transition from ${current.status} to ACTIVE`,
          );
        }

        const updated =
          await this.repository.transitionGroupStatus(
            {
              groupId,
              fromStatuses: ["INACTIVE"],
              toStatus: "ACTIVE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentGroupConflictError(
            `Talent group state transition conflict for ${groupId}`,
          );
        }

        await this.recordGroupAudit({
          actor,
          permission,
          groupId,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
          },
          session,
        });

        return toTalentGroupMutationView(updated);
      },
      (result) => ({
        groupId: result.id,
        status: result.status,
      }),
    );
  }

  async deactivateTalentGroup(
    actor: Actor,
    command: DeactivateTalentGroupCommand,
  ): Promise<TalentGroupMutationResult> {
    const operation = "talent-group.deactivate";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_MANAGE_LIFECYCLE,
    );
    const groupId = normalizeRequiredText(
      command.groupId,
      "groupId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        groupId: readOptionalLogString(
          command.groupId,
        ),
      },
      async (session) => {
        const current = await this.requireGroup(
          groupId,
          session,
        );
        await this.requireManagedTalentGroupAuthority(
          actor,
          Permission.TALENT_GROUP_MANAGE_LIFECYCLE,
          current.id,
        );

        if (current.status !== "ACTIVE") {
          throw new TalentGroupStateError(
            `Talent group ${groupId} cannot transition from ${current.status} to INACTIVE`,
          );
        }

        const hasActiveMembers =
          await this.repository.hasActiveMembers(
            groupId,
            session,
          );

        if (hasActiveMembers) {
          throw new TalentGroupStateError(
            `Talent group ${groupId} cannot deactivate while ACTIVE memberships exist`,
          );
        }

        await this.assertNoActiveOwnedPlatformAccounts(
          groupId,
          session,
        );
        const evaluationTime = Date.now();
        await this.assertNoLiveScheduledWorkShifts(
          groupId,
          "deactivate",
          evaluationTime,
          session,
        );
        await this.assertNoLiveEventBindings(
          groupId,
          "deactivate",
          evaluationTime,
          session,
        );

        const updated =
          await this.repository.transitionGroupStatus(
            {
              groupId,
              fromStatuses: ["ACTIVE"],
              toStatus: "INACTIVE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentGroupConflictError(
            `Talent group state transition conflict for ${groupId}`,
          );
        }

        await this.recordGroupAudit({
          actor,
          permission,
          groupId,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
          },
          session,
        });

        return toTalentGroupMutationView(updated);
      },
      (result) => ({
        groupId: result.id,
        status: result.status,
      }),
    );
  }

  async archiveTalentGroup(
    actor: Actor,
    command: ArchiveTalentGroupCommand,
  ): Promise<TalentGroupMutationResult> {
    const operation = "talent-group.archive";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_MANAGE_LIFECYCLE,
    );
    const groupId = normalizeRequiredText(
      command.groupId,
      "groupId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        groupId: readOptionalLogString(
          command.groupId,
        ),
      },
      async (session) => {
        const current = await this.requireGroup(
          groupId,
          session,
        );
        await this.requireManagedTalentGroupAuthority(
          actor,
          Permission.TALENT_GROUP_MANAGE_LIFECYCLE,
          current.id,
        );

        if (current.status !== "INACTIVE") {
          throw new TalentGroupStateError(
            `Talent group ${groupId} cannot transition from ${current.status} to ARCHIVED`,
          );
        }

        const hasNonRemovedMembers =
          await this.repository.hasNonRemovedMembers(
            groupId,
            session,
          );

        if (hasNonRemovedMembers) {
          throw new TalentGroupStateError(
            `Talent group ${groupId} cannot archive while non-removed memberships exist`,
          );
        }

        await this.assertNoNonArchivedOwnedPlatformAccounts(
          groupId,
          session,
        );
        const evaluationTime = Date.now();
        await this.assertNoLiveScheduledWorkShifts(
          groupId,
          "archive",
          evaluationTime,
          session,
        );
        await this.assertNoLiveEventBindings(
          groupId,
          "archive",
          evaluationTime,
          session,
        );

        const updated =
          await this.repository.transitionGroupStatus(
            {
              groupId,
              fromStatuses: ["INACTIVE"],
              toStatus: "ARCHIVED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentGroupConflictError(
            `Talent group state transition conflict for ${groupId}`,
          );
        }

        await this.recordGroupAudit({
          actor,
          permission,
          groupId,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
          },
          session,
        });

        return toTalentGroupMutationView(updated);
      },
      (result) => ({
        groupId: result.id,
        status: result.status,
      }),
    );
  }

  async addTalentGroupMember(
    actor: Actor,
    command: AddTalentGroupMemberCommand,
  ): Promise<TalentGroupMutationResult> {
    const operation = "talent-group.add-member";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
    );
    const groupId = normalizeRequiredText(
      command.groupId,
      "groupId",
    );
    const talentId = normalizeRequiredText(
      command.talentId,
      "talentId",
    );
    const lineupOrder = normalizeStrictInteger(
      command.lineupOrder,
      "lineupOrder",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        groupId: readOptionalLogString(
          command.groupId,
        ),
        talentId: readOptionalLogString(
          command.talentId,
        ),
        lineupOrder,
      },
      async (session) => {
        const group = await this.requireGroup(
          groupId,
          session,
        );
        await this.requireManagedTalentGroupAuthority(
          actor,
          Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
          group.id,
        );
        assertActiveGroup(group, groupId);

        await this.assertTalentEligibleForActiveMembership(
          talentId,
          session,
        );

        const existingMember =
          await this.repository.findLiveMemberByGroupAndTalent(
            {
              groupId,
              talentId,
            },
            session,
          );

        if (existingMember) {
          throw new TalentGroupConflictError(
            "Talent already has a non-removed membership in this group",
          );
        }

        const existingLineup =
          await this.repository.findLiveMemberByGroupAndLineup(
            {
              groupId,
              lineupOrder,
            },
            session,
          );

        if (existingLineup) {
          throw new TalentGroupConflictError(
            "lineupOrder must be unique among non-removed memberships in the group",
          );
        }

        const now = Date.now();
        const member: TalentGroupMemberRecord = {
          id: crypto.randomUUID(),
          groupId,
          talentId,
          membershipStatus: "ACTIVE",
          lineupOrder,
          joinedAt: now,
          leftAt: null,
          createdAt: now,
          updatedAt: now,
        };

        let created: TalentGroupMemberRecord;

        try {
          created = await this.repository.insertMember(
            member,
            session,
          );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new TalentGroupConflictError(
              "Non-removed talent membership or lineup order already exists in the group",
            );
          }

          throw error;
        }

        await this.recordMemberAudit({
          actor,
          permission,
          membershipId: created.id,
          mutationType: operation,
          metadata: {
            groupId: created.groupId,
            talentId: created.talentId,
            lineupOrder: created.lineupOrder,
            membershipStatus:
              created.membershipStatus,
          },
          session,
        });

        return toTalentGroupMemberMutationView(
          created,
        );
      },
      (result) =>
        isGroupMutationView(result)
          ? {
              groupId: result.id,
              status: result.status,
            }
          : {
              membershipId: result.id,
              groupId: result.groupId,
              membershipStatus:
                result.membershipStatus,
            },
    );
  }

  async updateTalentGroupMemberLineup(
    actor: Actor,
    command: UpdateTalentGroupMemberLineupCommand,
  ): Promise<TalentGroupMutationResult> {
    const operation =
      "talent-group.update-member-lineup";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
    );
    const membershipId = normalizeRequiredText(
      command.membershipId,
      "membershipId",
    );
    const newLineupOrder = normalizeStrictInteger(
      command.newLineupOrder,
      "newLineupOrder",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        membershipId: readOptionalLogString(
          command.membershipId,
        ),
        newLineupOrder,
      },
      async (session, controls) => {
        const current = await this.requireMember(
          membershipId,
          session,
        );

        if (
          current.membershipStatus === "REMOVED"
        ) {
          throw new TalentGroupInvalidMembershipStateError(
            `Removed talent group member cannot change lineup: ${membershipId}`,
          );
        }

        const group = await this.requireGroup(
          current.groupId,
          session,
        );
        await this.requireManagedTalentGroupAuthority(
          actor,
          Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
          group.id,
        );

        if (group.status === "ARCHIVED") {
          throw new TalentGroupStateError(
            `Archived talent group cannot change member lineup: ${group.id}`,
          );
        }

        if (current.lineupOrder === newLineupOrder) {
          controls.markExplicitNoOpSuccess();
          return toTalentGroupMemberMutationView(
            current,
          );
        }

        const existingLineup =
          await this.repository.findLiveMemberByGroupAndLineup(
            {
              groupId: current.groupId,
              lineupOrder: newLineupOrder,
              excludeMembershipId: current.id,
            },
            session,
          );

        if (existingLineup) {
          throw new TalentGroupConflictError(
            "lineupOrder must be unique among non-removed memberships in the group",
          );
        }

        let updated: TalentGroupMemberRecord | null;

        try {
          updated =
            await this.repository.updateMemberLineup(
              {
                membershipId,
                lineupOrder: newLineupOrder,
                updatedAt: Date.now(),
              },
              session,
            );
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new TalentGroupConflictError(
              "lineupOrder must be unique among non-removed memberships in the group",
            );
          }

          throw error;
        }

        if (!updated) {
          throw new TalentGroupConflictError(
            `Talent group member lineup conflict for ${membershipId}`,
          );
        }

        await this.recordMemberAudit({
          actor,
          permission,
          membershipId,
          mutationType: operation,
          metadata: {
            groupId: updated.groupId,
            talentId: updated.talentId,
            previousLineupOrder:
              current.lineupOrder,
            nextLineupOrder:
              updated.lineupOrder,
          },
          session,
        });

        return toTalentGroupMemberMutationView(
          updated,
        );
      },
      (result) =>
        isGroupMutationView(result)
          ? {
              groupId: result.id,
            }
          : {
              membershipId: result.id,
              groupId: result.groupId,
              lineupOrder: result.lineupOrder,
            },
    );
  }

  async deactivateTalentGroupMember(
    actor: Actor,
    command: DeactivateTalentGroupMemberCommand,
  ): Promise<TalentGroupMutationResult> {
    const operation =
      "talent-group.deactivate-member";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
    );
    const membershipId = normalizeRequiredText(
      command.membershipId,
      "membershipId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        membershipId: readOptionalLogString(
          command.membershipId,
        ),
      },
      async (session) => {
        const current = await this.requireMember(
          membershipId,
          session,
        );
        const group = await this.requireGroup(
          current.groupId,
          session,
        );
        await this.requireManagedTalentGroupAuthority(
          actor,
          Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
          group.id,
        );

        if (
          current.membershipStatus !== "ACTIVE"
        ) {
          throw new TalentGroupInvalidMembershipStateError(
            `Talent group member ${membershipId} cannot transition from ${current.membershipStatus} to INACTIVE`,
          );
        }

        const updated =
          await this.repository.transitionMemberStatus(
            {
              membershipId,
              fromStatuses: ["ACTIVE"],
              toStatus: "INACTIVE",
              updatedAt: Date.now(),
              leftAt: null,
            },
            session,
          );

        if (!updated) {
          throw new TalentGroupConflictError(
            `Talent group member state transition conflict for ${membershipId}`,
          );
        }

        await this.recordMemberAudit({
          actor,
          permission,
          membershipId,
          mutationType: operation,
          metadata: {
            groupId: updated.groupId,
            talentId: updated.talentId,
            previousMembershipStatus:
              current.membershipStatus,
            nextMembershipStatus:
              updated.membershipStatus,
          },
          session,
        });

        return toTalentGroupMemberMutationView(
          updated,
        );
      },
      (result) =>
        isGroupMutationView(result)
          ? {
              groupId: result.id,
            }
          : {
              membershipId: result.id,
              groupId: result.groupId,
              membershipStatus:
                result.membershipStatus,
            },
    );
  }

  async reactivateTalentGroupMember(
    actor: Actor,
    command: ReactivateTalentGroupMemberCommand,
  ): Promise<TalentGroupMutationResult> {
    const operation =
      "talent-group.reactivate-member";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
    );
    const membershipId = normalizeRequiredText(
      command.membershipId,
      "membershipId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        membershipId: readOptionalLogString(
          command.membershipId,
        ),
      },
      async (session) => {
        const current = await this.requireMember(
          membershipId,
          session,
        );

        if (
          current.membershipStatus !== "INACTIVE"
        ) {
          throw new TalentGroupInvalidMembershipStateError(
            `Talent group member ${membershipId} cannot transition from ${current.membershipStatus} to ACTIVE`,
          );
        }

        const group = await this.requireGroup(
          current.groupId,
          session,
        );
        await this.requireManagedTalentGroupAuthority(
          actor,
          Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
          group.id,
        );
        assertActiveGroup(group, group.id);

        await this.assertTalentEligibleForActiveMembership(
          current.talentId,
          session,
        );

        const updated =
          await this.repository.transitionMemberStatus(
            {
              membershipId,
              fromStatuses: ["INACTIVE"],
              toStatus: "ACTIVE",
              updatedAt: Date.now(),
              leftAt: null,
            },
            session,
          );

        if (!updated) {
          throw new TalentGroupConflictError(
            `Talent group member state transition conflict for ${membershipId}`,
          );
        }

        await this.recordMemberAudit({
          actor,
          permission,
          membershipId,
          mutationType: operation,
          metadata: {
            groupId: updated.groupId,
            talentId: updated.talentId,
            previousMembershipStatus:
              current.membershipStatus,
            nextMembershipStatus:
              updated.membershipStatus,
          },
          session,
        });

        return toTalentGroupMemberMutationView(
          updated,
        );
      },
      (result) =>
        isGroupMutationView(result)
          ? {
              groupId: result.id,
            }
          : {
              membershipId: result.id,
              groupId: result.groupId,
              membershipStatus:
                result.membershipStatus,
            },
    );
  }

  async removeTalentGroupMember(
    actor: Actor,
    command: RemoveTalentGroupMemberCommand,
  ): Promise<TalentGroupMutationResult> {
    const operation = "talent-group.remove-member";
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
    );
    const membershipId = normalizeRequiredText(
      command.membershipId,
      "membershipId",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        membershipId: readOptionalLogString(
          command.membershipId,
        ),
      },
      async (session) => {
        const current = await this.requireMember(
          membershipId,
          session,
        );
        const group = await this.requireGroup(
          current.groupId,
          session,
        );
        await this.requireManagedTalentGroupAuthority(
          actor,
          Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
          group.id,
        );

        if (
          current.membershipStatus === "REMOVED"
        ) {
          throw new TalentGroupInvalidMembershipStateError(
            `Talent group member ${membershipId} is already REMOVED`,
          );
        }

        const updated =
          await this.repository.transitionMemberStatus(
            {
              membershipId,
              fromStatuses: [
                current.membershipStatus,
              ],
              toStatus: "REMOVED",
              updatedAt: Date.now(),
              leftAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new TalentGroupConflictError(
            `Talent group member state transition conflict for ${membershipId}`,
          );
        }

        await this.recordMemberAudit({
          actor,
          permission,
          membershipId,
          mutationType: operation,
          metadata: {
            groupId: updated.groupId,
            talentId: updated.talentId,
            previousMembershipStatus:
              current.membershipStatus,
            nextMembershipStatus:
              updated.membershipStatus,
            leftAt: updated.leftAt,
          },
          session,
        });

        return toTalentGroupMemberMutationView(
          updated,
        );
      },
      (result) =>
        isGroupMutationView(result)
          ? {
              groupId: result.id,
            }
          : {
              membershipId: result.id,
              groupId: result.groupId,
              membershipStatus:
                result.membershipStatus,
            },
    );
  }

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    const permission = PermissionResolver.resolve(
      permissionCode,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private async requireGroup(
    groupId: string,
    session: ClientSession,
  ): Promise<TalentGroupRecord> {
    const group = await this.repository.findGroupById(
      groupId,
      session,
    );

    if (!group) {
      throw new TalentGroupNotFoundError(groupId);
    }

    return group;
  }

  private async requireManagedTalentGroupAuthority(
    actor: Actor,
    permission: Permission,
    groupId: string,
  ): Promise<void> {
    await requireAdminObjectScopeAuthority({
      actor,
      permission,
      scope: { scopeType: "managedTalentGroup", targetId: groupId },
      authority: this.structuredAuthority,
      error: new TalentGroupPermissionScopeError(
        `Talent group operation requires managedTalentGroup scope: ${groupId}`,
      ),
    });
  }

  private async allocateGeneratedCode(
    session: ClientSession,
  ): Promise<string> {
    const maxExisting =
      await this.repository.findMaxGeneratedCodeSequence(
        TALENT_GROUP_CODE_POLICY,
        session,
      );
    await this.codeSequenceRepository.ensureAtLeast(
      TALENT_GROUP_CODE_POLICY.moduleKey,
      TALENT_GROUP_CODE_POLICY.bucket,
      maxExisting,
      session,
    );
    const next =
      await this.codeSequenceRepository.allocateNext(
        TALENT_GROUP_CODE_POLICY.moduleKey,
        TALENT_GROUP_CODE_POLICY.bucket,
        session,
      );

    return formatBusinessCode(
      TALENT_GROUP_CODE_POLICY,
      next,
    );
  }

  private async requireMember(
    membershipId: string,
    session: ClientSession,
  ): Promise<TalentGroupMemberRecord> {
    const member =
      await this.repository.findMemberById(
        membershipId,
        session,
      );

    if (!member) {
      throw new TalentGroupMemberNotFoundError(
        membershipId,
      );
    }

    return member;
  }

  private async assertTalentEligibleForActiveMembership(
    talentId: string,
    session: ClientSession,
  ): Promise<TalentGroupReferencedTalent> {
    const talent = await this.requireTalentReference(
      talentId,
      session,
    );

    if (talent.operationalStatus === "ARCHIVED") {
      throw new TalentGroupInvalidTalentReferenceError(
        `Talent group membership may reference only a non-archived Talent: ${talentId}`,
      );
    }

    if (talent.operationalStatus !== "ACTIVE") {
      throw new TalentGroupInvalidTalentReferenceError(
        `Active talent group membership requires Talent ACTIVE: ${talentId}`,
      );
    }

    return talent;
  }

  private async requireTalentReference(
    talentId: string,
    session: ClientSession,
  ): Promise<TalentGroupReferencedTalent> {
    const talent =
      await this.talentReadonlyAccess.findById(
        talentId,
        session,
      );

    if (!talent) {
      throw new TalentGroupInvalidTalentReferenceError(
        `Talent does not exist: ${talentId}`,
      );
    }

    return talent;
  }

  private async assertNoActiveOwnedPlatformAccounts(
    groupId: string,
    session: ClientSession,
  ): Promise<void> {
    const hasActiveOwnedPlatformAccounts =
      await this.platformAccountReadonlyAccess.hasActiveOwnedPlatformAccountsForTalentGroup(
        groupId,
        session,
      );

    if (hasActiveOwnedPlatformAccounts) {
      throw new TalentGroupStateError(
        `Talent group ${groupId} cannot transition while ACTIVE platform accounts remain owned`,
      );
    }
  }

  private async assertNoNonArchivedOwnedPlatformAccounts(
    groupId: string,
    session: ClientSession,
  ): Promise<void> {
    const hasNonArchivedOwnedPlatformAccounts =
      await this.platformAccountReadonlyAccess.hasNonArchivedOwnedPlatformAccountsForTalentGroup(
        groupId,
        session,
      );

    if (hasNonArchivedOwnedPlatformAccounts) {
      throw new TalentGroupStateError(
        `Talent group ${groupId} cannot transition while non-archived platform accounts remain owned`,
      );
    }
  }

  private async assertNoLiveScheduledWorkShifts(
    groupId: string,
    operation: "deactivate" | "archive",
    evaluationTime: number,
    session: ClientSession,
  ): Promise<void> {
    const hasLiveScheduledWorkShift =
      await this.workScheduleReadonlyAccess.hasLiveScheduledShiftForTalentGroup(
        groupId,
        evaluationTime,
        session,
      );

    if (!hasLiveScheduledWorkShift) {
      return;
    }

    throw new TalentGroupStateError(
      `Talent group ${groupId} cannot ${operation} while live scheduled work shifts exist`,
    );
  }

  private async assertNoLiveEventBindings(
    groupId: string,
    operation: "deactivate" | "archive",
    evaluationTime: number,
    session: ClientSession,
  ): Promise<void> {
    const hasLiveEventBinding =
      await this.eventAssignmentReadonlyAccess.hasLiveEventBindingForTalentGroup(
        groupId,
        evaluationTime,
        session,
      );

    if (!hasLiveEventBinding) {
      return;
    }

    throw new TalentGroupStateError(
      `Talent group ${groupId} cannot ${operation} while live event bindings exist`,
    );
  }

  private async recordGroupAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly groupId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.groupId,
      {
        mutationType: params.mutationType,
        targetId: params.groupId,
        targetType: "talent-group",
        actorId: params.actor.id,
        ...params.metadata,
      },
      params.session,
    );
  }

  private async recordMemberAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly membershipId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.membershipId,
      {
        mutationType: params.mutationType,
        targetId: params.membershipId,
        targetType: "talent-group-member",
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
            classifyTalentGroupMutationFailure(
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

interface NormalizedCreateCommand {
  readonly groupCode: string | undefined;
  readonly name: string;
  readonly normalizedName: string;
  readonly shortName: string | null;
  readonly normalizedShortName: string | null;
  readonly description: string | null;
  readonly displayOrder: number;
  readonly externalRef: string | null;
}

function normalizeCreateCommand(
  command: CreateTalentGroupCommand,
): NormalizedCreateCommand {
  const name = normalizeDisplayText(
    command.name,
    "name",
  );
  const shortName = normalizeNullableText(
    command.shortName,
    "shortName",
  );

  return {
    groupCode: normalizeOptionalCreateCode(
      command.groupCode,
      "groupCode",
    ),
    name,
    normalizedName: normalizeNameForSearch(name),
    shortName,
    normalizedShortName:
      shortName === null
        ? null
        : normalizeNameForSearch(shortName),
    description: normalizeNullableText(
      command.description,
      "description",
    ),
    displayOrder: normalizeInteger(
      command.displayOrder,
      "displayOrder",
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
    throw new TalentGroupValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function buildTalentGroupCorePatch(params: {
  readonly current: TalentGroupRecord;
  readonly groupId: string;
  readonly name?: string;
  readonly shortName?: string | null;
  readonly description?: string | null;
  readonly displayOrder?: number;
  readonly externalRef?: string | null;
}): UpdateTalentGroupCoreInput {
  const patch: {
    groupId: string;
    updatedAt: number;
    name?: string;
    normalizedName?: string;
    shortName?: string | null;
    normalizedShortName?: string | null;
    description?: string | null;
    externalRef?: string | null;
    displayOrder?: number;
  } = {
    groupId: params.groupId,
    updatedAt: Date.now(),
  };

  if (
    params.name !== undefined &&
    params.name !== params.current.name
  ) {
    patch.name = params.name;
    patch.normalizedName =
      normalizeNameForSearch(params.name);
  }

  if (
    params.shortName !== undefined &&
    params.shortName !== params.current.shortName
  ) {
    patch.shortName = params.shortName;
    patch.normalizedShortName =
      params.shortName === null
        ? null
        : normalizeNameForSearch(
            params.shortName,
          );
  }

  if (
    params.description !== undefined &&
    params.description !== params.current.description
  ) {
    patch.description = params.description;
  }

  if (
    params.externalRef !== undefined &&
    params.externalRef !== params.current.externalRef
  ) {
    patch.externalRef = params.externalRef;
  }

  if (
    params.displayOrder !== undefined &&
    params.displayOrder !== params.current.displayOrder
  ) {
    patch.displayOrder = params.displayOrder;
  }

  return patch;
}

function summarizeChangedGroupFields(
  previous: TalentGroupRecord,
  next: TalentGroupRecord,
): readonly string[] {
  const changed: string[] = [];

  if (previous.name !== next.name) {
    changed.push("name");
  }

  if (previous.shortName !== next.shortName) {
    changed.push("shortName");
  }

  if (previous.description !== next.description) {
    changed.push("description");
  }

  if (previous.externalRef !== next.externalRef) {
    changed.push("externalRef");
  }

  if (
    previous.displayOrder !== next.displayOrder
  ) {
    changed.push("displayOrder");
  }

  return changed;
}

function toTalentGroupMutationView(
  group: TalentGroupRecord,
): TalentGroupMutationView {
  return {
    id: group.id,
    groupCode: group.groupCode,
    name: group.name,
    shortName: group.shortName,
    description: group.description,
    externalRef: group.externalRef,
    status: group.status,
    displayOrder: group.displayOrder,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

function toTalentGroupMemberMutationView(
  member: TalentGroupMemberRecord,
): TalentGroupMemberMutationView {
  return {
    id: member.id,
    groupId: member.groupId,
    talentId: member.talentId,
    membershipStatus:
      member.membershipStatus,
    lineupOrder: member.lineupOrder,
    joinedAt: member.joinedAt,
    leftAt: member.leftAt,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

function isGroupMutationView(
  result: TalentGroupMutationResult,
): result is TalentGroupMutationView {
  return (
    typeof result === "object" &&
    result !== null &&
    "groupCode" in result
  );
}

function assertActiveGroup(
  group: TalentGroupRecord,
  groupId: string,
): void {
  if (group.status !== "ACTIVE") {
    throw new TalentGroupStateError(
      `Active talent group membership requires ACTIVE group: ${groupId}`,
    );
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

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TalentGroupValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function normalizeDisplayText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");

  if (!normalized) {
    throw new TalentGroupValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function normalizeNullableText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");

  if (normalized.length === 0) {
    throw new TalentGroupValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function normalizeNullablePatchText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined) {
    throw new TalentGroupValidationError(
      `${field} must be provided`,
    );
  }

  return normalizeNullableText(value, field);
}

function normalizeInteger(
  value: unknown,
  field: string,
): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TalentGroupValidationError(
        `${field} must be an integer`,
      );
    }

    return value;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      `${field} must be an integer`,
    );
  }

  const normalized = value.trim();

  if (!/^-?\d+$/u.test(normalized)) {
    throw new TalentGroupValidationError(
      `${field} must be an integer`,
    );
  }

  return Number.parseInt(normalized, 10);
}

function normalizeStrictInteger(
  value: unknown,
  field: string,
): number {
  if (typeof value !== "number") {
    throw new TalentGroupValidationError(
      `${field} must be an integer`,
    );
  }

  if (!Number.isInteger(value)) {
    throw new TalentGroupValidationError(
      `${field} must be an integer`,
    );
  }

  return value;
}

function normalizeNameForSearch(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function isDuplicateKeyError(
  error: unknown,
): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000
  );
}

function classifyTalentGroupMutationFailure(
  error: unknown,
): TalentGroupFailureClassification {
  if (error instanceof TalentGroupValidationError) {
    return "validation";
  }

  if (error instanceof TalentGroupConflictError) {
    return "conflict";
  }

  if (error instanceof TalentGroupNotFoundError) {
    return "not_found";
  }

  if (
    error instanceof TalentGroupMemberNotFoundError
  ) {
    return "member_not_found";
  }

  if (error instanceof TalentGroupStateError) {
    return "state_error";
  }

  if (
    error instanceof
    TalentGroupInvalidTalentReferenceError
  ) {
    return "invalid_talent_reference";
  }

  if (
    error instanceof
    TalentGroupInvalidMembershipStateError
  ) {
    return "invalid_membership_state";
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

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new TalentGroupPermissionScopeError(
        "Structured TalentGroup authority is unavailable",
      );
    },
  });
}
