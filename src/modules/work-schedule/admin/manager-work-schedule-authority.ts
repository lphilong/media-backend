import { Actor } from "@core/actor/actor";
import { PermissionContract } from "@core/permission/permission.contract";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { ResponsibilityManagedScopeReader } from "@modules/responsibility/domain/responsibility-managed-scope";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { ClientSession } from "mongodb";
import { WorkSchedulePermissionScopeError } from "../domain/work-schedule.errors";

export interface ManagerWorkScheduleTargetAuthority {
  readonly orgUnitIds: ReadonlySet<string>;
  readonly talentGroupIds: ReadonlySet<string>;
}

export function assertManagerWorkSchedulePermission(
  actor: Actor,
  permissionCode: Permission,
): PermissionContract {
  if (!actor.accountContexts.includes("MANAGER_CONSOLE")) {
    throw new WorkSchedulePermissionScopeError(
      "Manager WorkSchedule requires MANAGER_CONSOLE account context",
    );
  }
  const permission = PermissionResolver.resolve(permissionCode);
  PermissionGuard.assert(actor, permission);
  return permission;
}

export async function resolveManagerWorkScheduleTargetAuthority(input: {
  readonly actor: Actor;
  readonly managerEmploymentProfileId: string;
  readonly permission: Permission;
  readonly managedScopeReader: ResponsibilityManagedScopeReader;
  readonly structuredAuthority: StructuredScopeAuthorityService;
  readonly asOf: number;
  readonly session?: ClientSession;
}): Promise<ManagerWorkScheduleTargetAuthority> {
  const [managedScope, grants] = await Promise.all([
    input.managedScopeReader.resolveManagedScopeByResponsibleEmploymentProfile(
      {
        responsibleEmploymentProfileId: input.managerEmploymentProfileId,
        asOf: input.asOf,
      },
      input.session,
    ),
    input.structuredAuthority.listAuthorizedScopeGrants({
      userId: input.actor.id,
      permission: input.permission,
    }),
  ]);
  const grantedOrgUnitIds = new Set(
    grants.flatMap((grant) =>
      grant.scopeType === "managedOrgUnit" ? [grant.targetId] : [],
    ),
  );
  const grantedTalentGroupIds = new Set(
    grants.flatMap((grant) =>
      grant.scopeType === "managedTalentGroup" ? [grant.targetId] : [],
    ),
  );

  return {
    orgUnitIds: new Set(
      managedScope.orgUnitScopes
        .map((scope) => scope.orgUnitId)
        .filter((id) => grantedOrgUnitIds.has(id)),
    ),
    talentGroupIds: new Set(
      managedScope.talentGroupIds.filter((id) => grantedTalentGroupIds.has(id)),
    ),
  };
}

export function assertManagerWorkScheduleTarget(
  authority: ManagerWorkScheduleTargetAuthority,
  targetType: "ORG_UNIT" | "TALENT_GROUP",
  targetId: string,
): void {
  if (!hasManagerWorkScheduleTarget(authority, targetType, targetId)) {
    throw new WorkSchedulePermissionScopeError(
      "Matching exact Manager responsibility and structured WorkSchedule scope are required",
    );
  }
}

export function hasManagerWorkScheduleTarget(
  authority: ManagerWorkScheduleTargetAuthority,
  targetType: "ORG_UNIT" | "TALENT_GROUP",
  targetId: string,
): boolean {
  return targetType === "ORG_UNIT"
    ? authority.orgUnitIds.has(targetId)
    : authority.talentGroupIds.has(targetId);
}

export function hasManagerWorkScheduleTargets(
  authority: ManagerWorkScheduleTargetAuthority,
): boolean {
  return authority.orgUnitIds.size > 0 || authority.talentGroupIds.size > 0;
}
