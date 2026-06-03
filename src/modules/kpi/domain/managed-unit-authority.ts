import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { PermissionGuard } from "@core/permission/permission.guard";
import { KpiSubjectReadonlyAccess } from "./kpi-subject-readonly-access";
import { OrgUnitManagerAssignmentRepository } from "./org-unit-manager-assignment.repository";
import { TalentGroupManagerAssignmentRepository } from "./talent-group-manager-assignment.repository";
import { OrgUnitManagerAssignment, OrgUnitManagerRole } from "./kpi.types";

export const MANAGED_UNIT_KINDS = ["TALENT_GROUP", "ORG_UNIT"] as const;

export type ManagedUnitKind = (typeof MANAGED_UNIT_KINDS)[number];

export interface ManagedOrgUnitScope {
  readonly orgUnitId: string;
  readonly role: OrgUnitManagerRole;
  readonly includeDescendants: boolean;
  readonly actionMask: readonly string[];
}

export interface ManagedUnitScope {
  readonly talentGroupIds: readonly string[];
  readonly orgUnitIds: readonly string[];
  readonly orgUnitScopes: readonly ManagedOrgUnitScope[];
}

export interface ManagedUnitAuthority {
  readonly actorEmploymentProfileId: string | null;
  readonly scope: ManagedUnitScope;
}

export interface ManagedUnitAuthorityDependencies {
  readonly subjectReadonlyAccess: Pick<
    KpiSubjectReadonlyAccess,
    "findActiveEmploymentProfileByLinkedUserId"
  >;
  readonly managerAssignmentRepository: Pick<
    TalentGroupManagerAssignmentRepository,
    "listActiveAssignmentsByManagerEmploymentProfile"
  >;
  readonly orgUnitManagerAssignmentRepository?: Pick<
    OrgUnitManagerAssignmentRepository,
    "listActiveByManagerEmploymentProfileId"
  >;
}

export interface ResolveManagedUnitAuthorityOptions {
  readonly asOf?: number;
  readonly session?: ClientSession;
}

export function requiresManagedUnitAuthority(actor: Actor): boolean {
  if (PermissionGuard.hasKpiScopeGrant(actor, "global")) {
    return false;
  }

  return PermissionGuard.hasKpiScopeGrant(actor, "managedGroup");
}

export async function resolveManagedUnitAuthority(
  actor: Actor,
  dependencies: ManagedUnitAuthorityDependencies | undefined,
  options: ResolveManagedUnitAuthorityOptions = {},
): Promise<ManagedUnitAuthority | null> {
  if (!requiresManagedUnitAuthority(actor)) {
    return null;
  }

  if (!dependencies) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Managed unit authority dependencies are not configured",
    );
  }

  const employmentProfile =
    await dependencies.subjectReadonlyAccess.findActiveEmploymentProfileByLinkedUserId(
      actor.id,
      options.session,
    );

  if (!employmentProfile) {
    return createManagedUnitAuthority(null, [], []);
  }

  const talentGroupAssignments =
    await dependencies.managerAssignmentRepository.listActiveAssignmentsByManagerEmploymentProfile(
      employmentProfile.employmentProfileId,
      options.asOf ?? Date.now(),
      options.session,
    );
  const orgUnitAssignments =
    (await dependencies.orgUnitManagerAssignmentRepository?.listActiveByManagerEmploymentProfileId(
      employmentProfile.employmentProfileId,
      options.asOf ?? Date.now(),
      options.session,
    )) ?? [];

  return createManagedUnitAuthority(
    employmentProfile.employmentProfileId,
    talentGroupAssignments.map((assignment) => assignment.groupId),
    orgUnitAssignments,
  );
}

export function managedUnitScopeIncludes(
  scope: ManagedUnitScope,
  kind: ManagedUnitKind,
  unitId: string,
): boolean {
  return kind === "TALENT_GROUP"
    ? scope.talentGroupIds.includes(unitId)
    : scope.orgUnitIds.includes(unitId);
}

function createManagedUnitAuthority(
  actorEmploymentProfileId: string | null,
  talentGroupIds: readonly string[],
  orgUnitAssignments: readonly OrgUnitManagerAssignment[],
): ManagedUnitAuthority {
  const orgUnitScopes = uniqueOrgUnitScopes(orgUnitAssignments);
  return {
    actorEmploymentProfileId,
    scope: {
      talentGroupIds: uniqueNonEmpty(talentGroupIds),
      orgUnitIds: uniqueNonEmpty(orgUnitScopes.map((scope) => scope.orgUnitId)),
      orgUnitScopes,
    },
  };
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return [
    ...new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  ];
}

function uniqueOrgUnitScopes(
  assignments: readonly OrgUnitManagerAssignment[],
): readonly ManagedOrgUnitScope[] {
  const scopes = new Map<string, ManagedOrgUnitScope>();
  for (const assignment of assignments) {
    const orgUnitId = assignment.orgUnitId.trim();
    if (!orgUnitId) {
      continue;
    }
    const key = [
      orgUnitId,
      assignment.role,
      assignment.includeDescendants ? "desc" : "direct",
      [...assignment.actionMask].sort().join(","),
    ].join(":");
    if (!scopes.has(key)) {
      scopes.set(key, {
        orgUnitId,
        role: assignment.role,
        includeDescendants: assignment.includeDescendants,
        actionMask: uniqueNonEmpty(assignment.actionMask),
      });
    }
  }
  return [...scopes.values()];
}
