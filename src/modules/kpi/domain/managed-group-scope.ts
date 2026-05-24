import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { PermissionGuard } from "@core/permission/permission.guard";
import { KpiSubjectReadonlyAccess } from "./kpi-subject-readonly-access";
import { TalentGroupManagerAssignmentRepository } from "./talent-group-manager-assignment.repository";

export interface ManagedGroupScopeDependencies {
  readonly subjectReadonlyAccess: Pick<
    KpiSubjectReadonlyAccess,
    "findActiveEmploymentProfileByLinkedUserId"
  >;
  readonly managerAssignmentRepository: Pick<
    TalentGroupManagerAssignmentRepository,
    "listActiveAssignmentsByManagerEmploymentProfile"
  >;
}

export function requiresManagedGroupScope(actor: Actor): boolean {
  if (PermissionGuard.hasKpiScopeGrant(actor, "global")) {
    return false;
  }

  return PermissionGuard.hasKpiScopeGrant(actor, "managedGroup");
}

export async function resolveManagedTalentGroupIds(
  actor: Actor,
  dependencies: ManagedGroupScopeDependencies | undefined,
  asOf = Date.now(),
): Promise<readonly string[] | null> {
  if (!requiresManagedGroupScope(actor)) {
    return null;
  }

  if (!dependencies) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Managed group scope dependencies are not configured",
    );
  }

  const employmentProfile =
    await dependencies.subjectReadonlyAccess.findActiveEmploymentProfileByLinkedUserId(
      actor.id,
    );

  if (!employmentProfile) {
    return [];
  }

  const assignments =
    await dependencies.managerAssignmentRepository.listActiveAssignmentsByManagerEmploymentProfile(
      employmentProfile.employmentProfileId,
      asOf,
    );

  return [...new Set(assignments.map((assignment) => assignment.groupId))];
}

export function assertManagedScopeIncludesGroup(
  managedGroupIds: readonly string[] | null,
  groupId: string,
): void {
  if (managedGroupIds === null || managedGroupIds.includes(groupId)) {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Actor is not an active manager for talent group ${groupId}`,
  );
}
