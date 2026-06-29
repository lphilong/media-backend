import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { KpiSubjectReadonlyAccess } from "./kpi-subject-readonly-access";
import { ResponsibilityManagedScopeReader } from "@modules/responsibility/domain/responsibility-managed-scope";
import {
  ManagedUnitAuthorityDependencies,
  managedUnitScopeIncludes,
  requiresManagedUnitAuthority,
  resolveManagedUnitAuthority,
} from "./managed-unit-authority";

export interface ManagedGroupScopeDependencies {
  readonly subjectReadonlyAccess: Pick<
    KpiSubjectReadonlyAccess,
    "findActiveEmploymentProfileByLinkedUserId"
  >;
  readonly managedScopeReader: ResponsibilityManagedScopeReader;
}

export function requiresManagedGroupScope(actor: Actor): boolean {
  return requiresManagedUnitAuthority(actor);
}

export async function resolveManagedTalentGroupIds(
  actor: Actor,
  dependencies: ManagedGroupScopeDependencies | undefined,
  asOf = Date.now(),
  session?: ClientSession,
): Promise<readonly string[] | null> {
  const authority = await resolveManagedUnitAuthority(
    actor,
    dependencies as ManagedUnitAuthorityDependencies | undefined,
    { asOf, session },
  );
  return authority?.scope.talentGroupIds ?? null;
}

export function assertManagedScopeIncludesGroup(
  managedGroupIds: readonly string[] | null,
  groupId: string,
): void {
  if (
    managedGroupIds === null ||
    managedUnitScopeIncludes(
      { talentGroupIds: managedGroupIds, orgUnitIds: [], orgUnitScopes: [] },
      "TALENT_GROUP",
      groupId,
    )
  ) {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Actor is not an active manager for talent group ${groupId}`,
  );
}
