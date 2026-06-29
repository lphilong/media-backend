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
  TalentGroupNotFoundError,
  TalentGroupPermissionScopeError,
  TalentGroupValidationError,
} from "@modules/talent-group/domain/talent-group.errors";
import { TalentGroupRepository } from "@modules/talent-group/domain/talent-group.repository";
import { TalentGroupRecord } from "@modules/talent-group/domain/talent-group.types";
import { TalentGroupManagerAssignmentView } from "@modules/kpi/domain/kpi.types";
import {
  CreateTalentGroupManagerAssignmentCommand,
  ListTalentGroupManagerAssignmentsQuery,
  ListTalentGroupManagerAssignmentsResult,
  RevokeTalentGroupManagerAssignmentCommand,
} from "@modules/talent-group/shared/talent-group.contracts";
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { ResponsibilityAdminService } from "@modules/responsibility/admin/admin.responsibility.service";
import { ResponsibilityAssignmentView } from "@modules/responsibility/domain/responsibility.types";

const MANAGER_ASSIGNMENT_OPERATION: AuthoritativeAdminMutationIdentity =
  "talent-group.assign-manager";

export class TalentGroupManagerAssignmentAdminService {
  private readonly responsibilityService: ResponsibilityAdminService | undefined;

  constructor(
    private readonly talentGroupRepository: TalentGroupRepository,
    _legacyManagerAssignmentRepository: unknown,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
    responsibilityServiceOrClock?: ResponsibilityAdminService | (() => number),
    _clock: () => number = Date.now,
  ) {
    this.responsibilityService =
      typeof responsibilityServiceOrClock === "function"
        ? undefined
        : responsibilityServiceOrClock;
  }

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
    const assignments = await this.requireResponsibilityService().getSummaryForSubject(
      actor,
      "TALENT_GROUP",
      groupId,
    );
    return {
      items: assignments.items
        .filter((item) => item.responsibilityType === "TALENT_GROUP_MANAGER")
        .map(toTalentGroupManagerAssignmentView),
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

    const group = await this.requireGroup(groupId);
    await this.requireManagedTalentGroupAuthority(
      actor,
      Permission.TALENT_GROUP_UPDATE,
      group.id,
    );

    return this.executeMutation(
      actor,
      permission,
      MANAGER_ASSIGNMENT_OPERATION,
      `talent-group-manager-assignment:create:${groupId}:${managerEmploymentProfileId}`,
      async (session) => {
        const created =
          await this.requireResponsibilityService().createTalentGroupManagerAssignment(
            actor,
            {
              groupId,
              managerEmploymentProfileId,
              reason,
            },
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
            ...(reason ? { reason } : {}),
          },
          session,
        );

        return toTalentGroupManagerAssignmentView(created);
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

    const group = await this.requireGroup(groupId);
    await this.requireManagedTalentGroupAuthority(
      actor,
      Permission.TALENT_GROUP_UPDATE,
      group.id,
    );
    const current = await this.requireResponsibilityService().getAssignment(
      actor,
      assignmentId,
    );
    if (
      current.subjectType !== "TALENT_GROUP" ||
      current.subjectId !== groupId ||
      current.responsibilityType !== "TALENT_GROUP_MANAGER"
    ) {
      throw new TalentGroupNotFoundError(assignmentId);
    }

    return toTalentGroupManagerAssignmentView(
      await this.requireResponsibilityService().revokeAssignment(actor, {
        assignmentId,
        reason,
      }),
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

  private requireResponsibilityService(): ResponsibilityAdminService {
    if (!this.responsibilityService) {
      throw new TalentGroupValidationError(
        "TalentGroup manager assignments must use central responsibility assignments",
      );
    }
    return this.responsibilityService;
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

function toTalentGroupManagerAssignmentView(
  assignment: ResponsibilityAssignmentView,
): TalentGroupManagerAssignmentView {
  return {
    id: assignment.id,
    groupId: assignment.subjectId,
    managerEmploymentProfileId: assignment.responsibleEmploymentProfileId,
    role: "MANAGER",
    effectiveFrom: assignment.effectiveAt,
    effectiveTo: assignment.expiresAt,
    status: assignment.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
    isPrimary: assignment.isPrimary,
    createdAt: assignment.createdAt,
    createdByActorId: assignment.createdBy,
    updatedAt: assignment.updatedAt,
    updatedByActorId: assignment.updatedBy,
    groupRef: assignment.subjectRef ?? {
      id: assignment.subjectId,
    },
    managerRef: assignment.responsibleEmploymentProfileRef ?? {
      id: assignment.responsibleEmploymentProfileId,
    },
    managerHasLinkedAdminUser: false,
  };
}
