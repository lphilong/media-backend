import crypto from "crypto";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "@core/permission/permission.contract";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import {
  TalentGroupConflictError,
  TalentGroupInvalidTalentReferenceError,
  TalentGroupNotFoundError,
  TalentGroupPermissionScopeError,
  TalentGroupStateError,
  TalentGroupValidationError,
} from "@modules/talent-group/domain/talent-group.errors";
import { TalentGroupRepository } from "@modules/talent-group/domain/talent-group.repository";
import { TalentGroupRecord } from "@modules/talent-group/domain/talent-group.types";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import {
  TalentGroupManagerAssignment,
  TalentGroupManagerAssignmentView,
} from "@modules/kpi/domain/kpi.types";
import {
  CreateTalentGroupManagerAssignmentCommand,
  ListTalentGroupManagerAssignmentsQuery,
  ListTalentGroupManagerAssignmentsResult,
  RevokeTalentGroupManagerAssignmentCommand,
} from "@modules/talent-group/shared/talent-group.contracts";
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";

const MANAGER_ASSIGNMENT_ROLE = "MANAGER";
const MANAGER_ASSIGNMENT_OPERATION: AuthoritativeAdminMutationIdentity =
  "talent-group.assign-manager";
const MANAGER_REVOCATION_OPERATION: AuthoritativeAdminMutationIdentity =
  "talent-group.revoke-manager";

export class TalentGroupManagerAssignmentAdminService {
  constructor(
    private readonly talentGroupRepository: TalentGroupRepository,
    private readonly managerAssignmentRepository: TalentGroupManagerAssignmentRepository,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
    private readonly clock: () => number = Date.now,
  ) {}

  async listManagerAssignments(
    actor: Actor,
    query: ListTalentGroupManagerAssignmentsQuery,
  ): Promise<ListTalentGroupManagerAssignmentsResult> {
    this.assertPermission(actor, Permission.TALENT_GROUP_READ);
    const groupId = normalizeRequiredText(query.groupId, "groupId");
    const group = await this.requireGroup(groupId);
    await this.requireManagedTalentGroupAuthority(
      actor,
      Permission.TALENT_GROUP_READ,
      group.id,
    );
    const assignments =
      await this.managerAssignmentRepository.listActiveAssignmentsByGroup(
        groupId,
        this.clock(),
      );

    return {
      items: await this.toViews(group, assignments),
    };
  }

  async createManagerAssignment(
    actor: Actor,
    command: CreateTalentGroupManagerAssignmentCommand,
  ): Promise<TalentGroupManagerAssignmentView> {
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_UPDATE,
    );
    const groupId = normalizeRequiredText(command.groupId, "groupId");
    const managerEmploymentProfileId = normalizeRequiredText(
      command.managerEmploymentProfileId,
      "managerEmploymentProfileId",
    );
    const reason = normalizeNullableReason(command.reason);

    return this.executeMutation(
      actor,
      permission,
      MANAGER_ASSIGNMENT_OPERATION,
      `talent-group-manager-assignment:create:${groupId}:${managerEmploymentProfileId}`,
      async (session) => {
        const group = await this.requireGroup(groupId, session);
        await this.requireManagedTalentGroupAuthority(
          actor,
          Permission.TALENT_GROUP_UPDATE,
          group.id,
        );
        if (group.status !== "ACTIVE") {
          throw new TalentGroupStateError(
            `Talent group manager assignment requires ACTIVE group: ${groupId}`,
          );
        }

        const candidate =
          await this.managerAssignmentRepository.findManagerEmploymentProfileCandidate(
            managerEmploymentProfileId,
            session,
          );
        if (!candidate) {
          throw new TalentGroupInvalidTalentReferenceError(
            `Manager employment profile does not exist: ${managerEmploymentProfileId}`,
          );
        }
        if (candidate.employmentStatus !== "ACTIVE") {
          throw new TalentGroupInvalidTalentReferenceError(
            `Manager employment profile must be ACTIVE: ${managerEmploymentProfileId}`,
          );
        }

        const now = this.clock();
        const activeAssignments =
          await this.managerAssignmentRepository.listActiveAssignmentsByGroup(
            groupId,
            now,
            session,
          );
        if (
          activeAssignments.some(
            (assignment) =>
              assignment.managerEmploymentProfileId ===
              managerEmploymentProfileId,
          )
        ) {
          throw new TalentGroupConflictError(
            `Active talent group manager assignment already exists for ${groupId} and ${managerEmploymentProfileId}`,
          );
        }

        const assignment: TalentGroupManagerAssignment = {
          id: crypto.randomUUID(),
          groupId,
          managerEmploymentProfileId,
          role: MANAGER_ASSIGNMENT_ROLE,
          effectiveFrom: now,
          effectiveTo: null,
          status: "ACTIVE",
          isPrimary: activeAssignments.length === 0,
          createdAt: now,
          createdByActorId: actor.id,
          updatedAt: now,
          updatedByActorId: actor.id,
        };

        const created = await this.managerAssignmentRepository.insertAssignment(
          assignment,
          session,
        );

        await this.audit.record(
          actor,
          permission,
          created.id,
          {
            mutationType: MANAGER_ASSIGNMENT_OPERATION,
            targetId: created.id,
            targetType: "talent-group-manager-assignment",
            groupId,
            managerEmploymentProfileId,
            managerHasLinkedAdminUser:
              candidate.linkedUserActorKind === "ADMIN" &&
              candidate.linkedUserAccountStatus === "ACTIVE",
            ...(reason ? { reason } : {}),
          },
          session,
        );

        return this.toView(group, created);
      },
    );
  }

  async revokeManagerAssignment(
    actor: Actor,
    command: RevokeTalentGroupManagerAssignmentCommand,
  ): Promise<TalentGroupManagerAssignmentView> {
    const permission = this.assertPermission(
      actor,
      Permission.TALENT_GROUP_UPDATE,
    );
    const groupId = normalizeRequiredText(command.groupId, "groupId");
    const assignmentId = normalizeRequiredText(
      command.assignmentId,
      "assignmentId",
    );
    const reason = normalizeNullableReason(command.reason);

    return this.executeMutation(
      actor,
      permission,
      MANAGER_REVOCATION_OPERATION,
      `talent-group-manager-assignment:revoke:${groupId}:${assignmentId}`,
      async (session) => {
        const group = await this.requireGroup(groupId, session);
        await this.requireManagedTalentGroupAuthority(
          actor,
          Permission.TALENT_GROUP_UPDATE,
          group.id,
        );
        const current =
          await this.managerAssignmentRepository.findAssignmentById(
            assignmentId,
            session,
          );
        if (!current || current.groupId !== groupId) {
          throw new TalentGroupNotFoundError(assignmentId);
        }
        if (current.status !== "ACTIVE") {
          throw new TalentGroupStateError(
            `Talent group manager assignment is not ACTIVE: ${assignmentId}`,
          );
        }

        const now = this.clock();
        const revoked = await this.managerAssignmentRepository.revokeAssignment(
          {
            assignmentId,
            effectiveTo: now,
            updatedAt: now,
            updatedByActorId: actor.id,
          },
          session,
        );
        if (!revoked) {
          throw new TalentGroupConflictError(
            `Talent group manager assignment revoke conflict: ${assignmentId}`,
          );
        }

        await this.audit.record(
          actor,
          permission,
          revoked.id,
          {
            mutationType: MANAGER_REVOCATION_OPERATION,
            targetId: revoked.id,
            targetType: "talent-group-manager-assignment",
            groupId,
            managerEmploymentProfileId: revoked.managerEmploymentProfileId,
            previousStatus: current.status,
            nextStatus: revoked.status,
            ...(reason ? { reason } : {}),
          },
          session,
        );

        return this.toView(group, revoked);
      },
    );
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

  private async requireGroup(
    groupId: string,
    session?: ClientSession,
  ): Promise<TalentGroupRecord> {
    const group = await this.talentGroupRepository.findGroupById(
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
        `Talent group manager assignment requires managedTalentGroup scope: ${groupId}`,
      ),
    });
  }

  private async toViews(
    group: TalentGroupRecord,
    assignments: readonly TalentGroupManagerAssignment[],
  ): Promise<readonly TalentGroupManagerAssignmentView[]> {
    const views: TalentGroupManagerAssignmentView[] = [];
    for (const assignment of assignments) {
      views.push(await this.toView(group, assignment));
    }
    return views;
  }

  private async toView(
    group: TalentGroupRecord,
    assignment: TalentGroupManagerAssignment,
  ): Promise<TalentGroupManagerAssignmentView> {
    const manager =
      await this.managerAssignmentRepository.findManagerEmploymentProfileCandidate(
        assignment.managerEmploymentProfileId,
      );

    return {
      ...assignment,
      groupRef: {
        id: group.id,
        code: group.groupCode,
        name: group.name,
        status: group.status,
      },
      managerRef: {
        id: assignment.managerEmploymentProfileId,
        code: manager?.employeeCode,
        displayName: manager?.displayName,
        name: manager?.legalName,
        status: manager?.employmentStatus,
      },
      managerHasLinkedAdminUser:
        manager?.linkedUserActorKind === "ADMIN" &&
        manager?.linkedUserAccountStatus === "ACTIVE",
    };
  }

  private async executeMutation<T>(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    targetDescriptor: string,
    fn: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
  ): Promise<T> {
    return this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: operation,
        mutationTargetDescriptor: targetDescriptor,
      },
      fn,
    );
  }
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TalentGroupValidationError(`${field} is required`);
  }
  return value.trim();
}

function normalizeNullableReason(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TalentGroupValidationError("reason must be a string");
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
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
