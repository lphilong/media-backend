import {
  getRoleBundle,
} from "@modules/role/domain/role-bundle.catalog";
import {
  buildRoleAssignmentScopeFingerprint,
  normalizeRoleAssignmentScopeGrants,
  RoleAssignmentScopeGrant,
} from "@modules/role/domain/role-assignment-scope";
import { isRoleAssignmentCurrentlyEffective } from "@modules/role/domain/role-assignment-lifecycle";
import {
  getRoleTemplate,
  isLegacyRoleTemplateCode,
  LEGACY_ROLE_TEMPLATE_COMPATIBILITY,
} from "@modules/role/domain/role-template.catalog";
import type { ActorScopeGrants } from "@core/actor/actor";
import type {
  AccountContextReadinessRecord,
  BundleConsistencyRecord,
  CoarseKpiScopeRecord,
  LegacyRoleRecord,
  RoleDriftPlannerRecord,
  ScopeFingerprintRecord,
  StaleKpiRecord,
  TalentIdentityReadinessRecord,
} from "./risk-001-planners";
import {
  ReadOnlyDocument,
  ReadOnlyFilter,
  ReadOnlyMongoGateway,
  ReadOnlyProjection,
  Risk001SanitizedError,
} from "./read-only-mongo.gateway";

export const RISK001_DEFAULT_PAGE_SIZE = 200;
export const RISK001_DEFAULT_SAFETY_CEILING = 10_000;

export interface QueryCountEvidence {
  readonly collection: string;
  readonly countKind: "EXACT" | "BOUNDED" | "ESTIMATED" | "BLOCKED_BY_SAFETY_CEILING";
  readonly inspectedCount: number;
  readonly matchedCount: number;
  readonly pageSize: number;
  readonly safetyCeiling: number;
  readonly projectionFields: readonly string[];
}

export interface LoaderResult<T> {
  readonly records: readonly T[];
  readonly evidence: readonly QueryCountEvidence[];
  readonly exceptions: readonly string[];
}

export interface Risk001LoaderOptions {
  readonly observedAt: number;
  readonly pageSize?: number;
  readonly safetyCeiling?: number;
}

export interface Risk001PlannerInputLoadResult {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly evidence: readonly QueryCountEvidence[];
  readonly exceptions: readonly string[];
  readonly affectedAccountCount: number;
}

interface RoleDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly code: string;
  readonly state: string;
  readonly permissions?: readonly string[];
  readonly templateCode?: string;
  readonly templateVersion?: string;
}

interface RoleAssignmentDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly userId: string;
  readonly state: "ACTIVE" | "REVOKED";
  readonly effectiveAt?: number | null;
  readonly expiresAt?: number | null;
  readonly revokedAt?: number | null;
  readonly scopeGrants?: ActorScopeGrants;
  readonly structuredScopeGrants?: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint?: string;
  readonly origin?: "DIRECT" | "BUNDLE" | "LEGACY";
  readonly bundleOrigin?: {
    readonly bundleAssignmentId: string;
    readonly bundleCode: string;
    readonly bundleVersion: string;
  } | null;
}

interface BundleAssignmentDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly targetUserId: string;
  readonly bundleCode: string;
  readonly bundleVersion: string;
  readonly status: "ACTIVE" | "REVOKED" | "EXPIRED";
  readonly effectiveAt?: number | null;
  readonly expiresAt?: number | null;
  readonly childRoleAssignmentIds?: readonly string[];
  readonly sourceTrace?: Readonly<Record<string, unknown>>;
}

interface UserDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly accountStatus: string;
  readonly actorKind: string;
  readonly accountContexts?: readonly string[];
}

interface EmploymentProfileDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly linkedUserId?: string | null;
  readonly employmentStatus: string;
}

interface TalentDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly talentOrigin: "INTERNAL" | "EXTERNAL";
  readonly operationalStatus: string;
  readonly linkedEmploymentProfileId?: string | null;
}

interface TalentGroupMemberDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: string;
}

interface KpiPlanDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly status?: string;
  readonly lifecycleStatus?: string;
  readonly actualPolicySnapshot?: unknown;
  readonly finalResult?: unknown;
  readonly createdByActorId?: string | null;
  readonly updatedByActorId?: string | null;
  readonly publishedByActorId?: string | null;
  readonly finalizedByActorId?: string | null;
}

interface KpiMetricDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly kpiPlanId: string;
  readonly allocationMode?: string;
  readonly allocationScale?: number;
  readonly actualCaptureMode?: string;
  readonly actualReviewMode?: string;
  readonly actualEvidenceMode?: string;
  readonly actualPolicyVersion?: string;
}

interface KpiAllocationDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly kpiPlanId: string;
  readonly subjectId?: string;
  readonly memberEmploymentProfileId?: string | null;
  readonly memberTalentId?: string | null;
  readonly lifecycleStatus?: string;
  readonly sourcePlanVersion?: number;
  readonly allocationVersion?: number;
  readonly membershipSnapshotVersion?: string | null;
  readonly eligibleMemberSnapshot?: unknown;
  readonly idempotencyKey?: string | null;
  readonly idempotencyFingerprint?: string | null;
  readonly correlationId?: string | null;
  readonly createdByActorId?: string | null;
  readonly updatedByActorId?: string | null;
}

interface KpiActualDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly memberEmploymentProfileId?: string | null;
  readonly memberTalentId?: string | null;
  readonly lifecycleStatus?: string;
  readonly entryVersion?: number;
  readonly policyVersion?: string;
  readonly sourceFingerprint?: string | null;
  readonly acceptedInputVersions?: readonly string[];
  readonly derivationVersion?: string | null;
  readonly latestCorrectionId?: string | null;
  readonly createdByActorId?: string | null;
  readonly updatedByActorId?: string | null;
}

interface KpiCorrectionDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly actualEntryId: string;
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly previousEntryVersion?: number;
  readonly replacementEntryVersion?: number;
  readonly idempotencyKey?: string;
  readonly payloadFingerprint?: string;
  readonly correctedByActorId?: string;
}

interface KpiOperationDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly kpiPlanId: string;
  readonly actorId?: string;
  readonly operation?: string;
  readonly idempotencyKey?: string;
  readonly payloadFingerprint?: string;
  readonly completedAt?: number | null;
}

interface KpiExcuseDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly createdByActorId?: string;
  readonly updatedByActorId?: string;
}

const ROLE_PROJECTION = projection(
  "_id",
  "code",
  "state",
  "permissions",
  "templateCode",
  "templateVersion",
);
const ASSIGNMENT_PROJECTION = projection(
  "_id",
  "roleId",
  "userId",
  "state",
  "effectiveAt",
  "expiresAt",
  "revokedAt",
  "scopeGrants",
  "structuredScopeGrants",
  "scopeFingerprint",
  "origin",
  "bundleOrigin",
);
const BUNDLE_PROJECTION = projection(
  "_id",
  "targetUserId",
  "bundleCode",
  "bundleVersion",
  "status",
  "effectiveAt",
  "expiresAt",
  "childRoleAssignmentIds",
  "sourceTrace",
);

export async function loadRoleDriftPlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<RoleDriftPlannerRecord>> {
  const roles = await scanCollection<RoleDocument>(gateway, "roles", {}, ROLE_PROJECTION, options);
  const assignments = await scanCollection<RoleAssignmentDocument>(
    gateway,
    "role_assignments",
    {},
    ASSIGNMENT_PROJECTION,
    options,
  );
  const activeByRole = activeAccountsByRole(assignments.records, options.observedAt);
  const records = roles.records.map((role) => ({
    id: role._id,
    code: role.code,
    templateCode: role.templateCode,
    templateVersion: role.templateVersion,
    permissions: sortedStrings(role.permissions),
    activeAccountCount: activeByRole.get(role._id)?.size ?? 0,
    template: getRoleTemplate(role.templateCode ?? role.code),
  }));
  return result(records, roles, assignments);
}

export async function loadLegacyRolePlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<LegacyRoleRecord>> {
  const roles = await scanCollection<RoleDocument>(gateway, "roles", {}, ROLE_PROJECTION, options);
  const assignments = await scanCollection<RoleAssignmentDocument>(gateway, "role_assignments", {}, ASSIGNMENT_PROJECTION, options);
  const bundles = await scanCollection<BundleAssignmentDocument>(gateway, "bundle_assignments", {}, BUNDLE_PROJECTION, options);
  const users = await scanCollection<UserDocument>(gateway, "users", {}, projection("_id", "accountStatus", "actorKind", "accountContexts"), options);
  const userById = new Map(users.records.map((user) => [user._id, user]));
  const effective = assignments.records.filter((item) => isRoleAssignmentCurrentlyEffective(item, options.observedAt));
  const records = roles.records
    .filter((role) => isLegacyRoleTemplateCode(role.code))
    .map((role) => {
      const roleAssignments = effective.filter((item) => item.roleId === role._id);
      const mapping = LEGACY_ROLE_TEMPLATE_COMPATIBILITY.find((item) => item.legacyCode === role.code);
      const bundleParentCount = bundles.records.filter((parent) =>
        getRoleBundle(parent.bundleCode, parent.bundleVersion)?.childRoles.includes(role.code as never),
      ).length;
      const bundleChildCount = roleAssignments.filter((item) => item.origin === "BUNDLE" || item.bundleOrigin).length;
      const accountContextDependencyCount = new Set(
        roleAssignments
          .map((item) => userById.get(item.userId))
          .filter((user) => (user?.accountContexts?.length ?? 0) > 0)
          .map((user) => user?._id as string),
      ).size;
      return {
        id: role._id,
        code: role.code,
        activeAssignmentCount: roleAssignments.length,
        bundleParentCount,
        bundleChildCount,
        accountContextDependencyCount,
        effectivePermissions: sortedStrings(role.permissions),
        replacementRoleCodes: sortedStrings(mapping?.replacementRoleCodes),
      };
    });
  return result(records, roles, assignments, bundles, users);
}

export async function loadBundleConsistencyPlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<BundleConsistencyRecord>> {
  const bundles = await scanCollection<BundleAssignmentDocument>(gateway, "bundle_assignments", {}, BUNDLE_PROJECTION, options);
  const assignments = await scanCollection<RoleAssignmentDocument>(gateway, "role_assignments", {}, ASSIGNMENT_PROJECTION, options);
  const byId = new Map(assignments.records.map((item) => [item._id, item]));
  const records = bundles.records.map((parent) => {
    const expectedChildIds = sortedStrings(parent.childRoleAssignmentIds);
    const expectedChildren = expectedChildIds.map((id) => byId.get(id));
    const activeChildIds = expectedChildren
      .filter((child): child is RoleAssignmentDocument => Boolean(child && isRoleAssignmentCurrentlyEffective(child, options.observedAt)))
      .map((child) => child._id)
      .sort();
    const revokedChildIds = expectedChildren
      .filter((child): child is RoleAssignmentDocument => Boolean(child && child.state === "REVOKED"))
      .map((child) => child._id)
      .sort();
    const provenanceComplete = Boolean(
      parent.sourceTrace &&
        getRoleBundle(parent.bundleCode, parent.bundleVersion) &&
        expectedChildren.every(
          (child) =>
            child?.bundleOrigin?.bundleAssignmentId === parent._id &&
            child.bundleOrigin.bundleCode === parent.bundleCode &&
            child.bundleOrigin.bundleVersion === parent.bundleVersion,
        ),
    );
    return {
      parentId: parent._id,
      status: parent.status,
      expectedChildIds,
      activeChildIds,
      revokedChildIds,
      provenanceComplete,
    };
  });
  return result(records, bundles, assignments);
}

export async function loadScopeFingerprintPlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<ScopeFingerprintRecord>> {
  const assignments = await scanCollection<RoleAssignmentDocument>(gateway, "role_assignments", {}, ASSIGNMENT_PROJECTION, options);
  const exceptions: string[] = [];
  const records: ScopeFingerprintRecord[] = [];
  for (const assignment of assignments.records) {
    if (!assignment.structuredScopeGrants || assignment.structuredScopeGrants.length === 0) continue;
    let grants: readonly RoleAssignmentScopeGrant[] = [];
    let subjectsExist = false;
    try {
      grants = normalizeRoleAssignmentScopeGrants(assignment.structuredScopeGrants) ?? [];
      subjectsExist = await allScopeSubjectsExist(gateway, grants);
    } catch {
      exceptions.push(`SCOPE_GRANT_INVALID:${assignment._id.length > 0 ? "SANITIZED" : "UNKNOWN"}`);
    }
    records.push({
      assignmentId: assignment._id,
      grants,
      ...(assignment.scopeFingerprint ? { storedFingerprint: assignment.scopeFingerprint } : {}),
      subjectsExist,
    });
  }
  return {
    records: Object.freeze(records.sort((a, b) => a.assignmentId.localeCompare(b.assignmentId))),
    evidence: assignments.evidence,
    exceptions: Object.freeze(exceptions.sort()),
  };
}

export async function loadAccountContextPlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<AccountContextReadinessRecord>> {
  const roles = await scanCollection<RoleDocument>(gateway, "roles", {}, ROLE_PROJECTION, options);
  const assignments = await scanCollection<RoleAssignmentDocument>(gateway, "role_assignments", {}, ASSIGNMENT_PROJECTION, options);
  const users = await scanCollection<UserDocument>(gateway, "users", {}, projection("_id", "accountStatus", "actorKind", "accountContexts"), options);
  const profiles = await scanCollection<EmploymentProfileDocument>(gateway, "employment_profiles", {}, projection("_id", "linkedUserId", "employmentStatus"), options);
  const roleById = new Map(roles.records.map((role) => [role._id, role]));
  const activeByUser = new Map<string, RoleAssignmentDocument[]>();
  for (const assignment of assignments.records.filter((item) => isRoleAssignmentCurrentlyEffective(item, options.observedAt))) {
    const list = activeByUser.get(assignment.userId) ?? [];
    list.push(assignment);
    activeByUser.set(assignment.userId, list);
  }
  const records = users.records
    .filter((user) => activeByUser.has(user._id))
    .map((user) => {
      const activeRoles = (activeByUser.get(user._id) ?? [])
        .map((assignment) => roleById.get(assignment.roleId))
        .filter((role): role is RoleDocument => Boolean(role));
      const activeRoleCodes = sortedStrings(activeRoles.map((role) => role.code));
      const recommendedContexts = sortedStrings(
        activeRoles.flatMap((role) => {
          const context = getRoleTemplate(
            role.templateCode ?? role.code,
          )?.recommendedAccountContext;
          return context ? [context] : [];
        }),
      );
      const currentContexts = sortedStrings(user.accountContexts);
      const hasOperationalProfile = profiles.records.some(
        (profile) =>
          profile.linkedUserId === user._id &&
          profile.employmentStatus !== "ARCHIVED" &&
          profile.employmentStatus !== "TERMINATED",
      );
      const eligibilityProven =
        user.accountStatus === "ACTIVE" &&
        recommendedContexts.every((context) => currentContexts.includes(context)) &&
        (recommendedContexts.every((context) => context === "ADMIN_CONSOLE") || hasOperationalProfile);
      return {
        userId: user._id,
        activeRoleCodes,
        currentContexts,
        recommendedContexts,
        eligibilityProven,
      };
    });
  return result(records, roles, assignments, users, profiles);
}

export async function loadTalentIdentityPlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<TalentIdentityReadinessRecord>> {
  const talents = await scanCollection<TalentDocument>(gateway, "talents", {}, projection("_id", "talentOrigin", "operationalStatus", "linkedEmploymentProfileId"), options);
  const profiles = await scanCollection<EmploymentProfileDocument>(gateway, "employment_profiles", {}, projection("_id", "linkedUserId", "employmentStatus"), options);
  const memberships = await scanCollection<TalentGroupMemberDocument>(gateway, "talent_group_members", {}, projection("_id", "groupId", "talentId", "membershipStatus"), options);
  const profileById = new Map(profiles.records.map((profile) => [profile._id, profile]));
  const talentCountByProfile = new Map<string, number>();
  for (const talent of talents.records) {
    if (talent.linkedEmploymentProfileId) {
      talentCountByProfile.set(talent.linkedEmploymentProfileId, (talentCountByProfile.get(talent.linkedEmploymentProfileId) ?? 0) + 1);
    }
  }
  const records = talents.records.map((talent) => {
    const profile = talent.linkedEmploymentProfileId ? profileById.get(talent.linkedEmploymentProfileId) : undefined;
    const activeMembershipCount = memberships.records.filter(
      (membership) => membership.talentId === talent._id && membership.membershipStatus === "ACTIVE",
    ).length;
    const externalOnly = talent.talentOrigin === "EXTERNAL" && !talent.linkedEmploymentProfileId;
    const evidenceUnambiguous = Boolean(
      profile &&
        profile.employmentStatus !== "ARCHIVED" &&
        talentCountByProfile.get(profile._id) === 1,
    );
    return {
      talentId: talent._id,
      ...(talent.linkedEmploymentProfileId ? { employmentProfileId: talent.linkedEmploymentProfileId } : {}),
      activeMembershipCount,
      externalOnly,
      evidenceUnambiguous,
    };
  });
  return result(records, talents, profiles, memberships);
}

export async function loadCoarseKpiScopePlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<CoarseKpiScopeRecord>> {
  const assignments = await scanCollection<RoleAssignmentDocument>(gateway, "role_assignments", {}, ASSIGNMENT_PROJECTION, options);
  const records = assignments.records
    .filter((assignment) => (assignment.scopeGrants?.kpi?.length ?? 0) > 0)
    .map((assignment) => ({
      assignmentId: assignment._id,
      coarseScopes: sortedStrings(assignment.scopeGrants?.kpi),
      structuredGrantCount: assignment.structuredScopeGrants?.length ?? 0,
      // The current ActorScopeGrants KPI compatibility reader is still a production caller.
      productionCallerCount: 1,
    }));
  return result(records, assignments);
}

export async function loadStaleKpiPlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<StaleKpiRecord>> {
  const plans = await scanCollection<KpiPlanDocument>(gateway, "kpi_plans", {}, projection("_id", "subjectType", "subjectId", "status", "lifecycleStatus", "actualPolicySnapshot", "finalResult", "createdByActorId", "updatedByActorId", "publishedByActorId", "finalizedByActorId"), options);
  const metrics = await scanCollection<KpiMetricDocument>(gateway, "kpi_target_metrics", {}, projection("_id", "kpiPlanId", "allocationMode", "allocationScale", "actualCaptureMode", "actualReviewMode", "actualEvidenceMode", "actualPolicyVersion"), options);
  const allocations = await scanCollection<KpiAllocationDocument>(gateway, "kpi_allocations", {}, projection("_id", "kpiPlanId", "subjectId", "memberEmploymentProfileId", "memberTalentId", "lifecycleStatus", "sourcePlanVersion", "allocationVersion", "membershipSnapshotVersion", "eligibleMemberSnapshot", "idempotencyKey", "idempotencyFingerprint", "correlationId", "createdByActorId", "updatedByActorId"), options);
  const actuals = await scanCollection<KpiActualDocument>(gateway, "kpi_actual_entries", {}, projection("_id", "kpiPlanId", "allocationId", "memberEmploymentProfileId", "memberTalentId", "lifecycleStatus", "entryVersion", "policyVersion", "sourceFingerprint", "acceptedInputVersions", "derivationVersion", "latestCorrectionId", "createdByActorId", "updatedByActorId"), options);
  const corrections = await scanCollection<KpiCorrectionDocument>(gateway, "kpi_actual_corrections", {}, projection("_id", "actualEntryId", "kpiPlanId", "allocationId", "previousEntryVersion", "replacementEntryVersion", "idempotencyKey", "payloadFingerprint", "correctedByActorId"), options);
  const operations = await scanCollection<KpiOperationDocument>(gateway, "kpi_allocation_operations", {}, projection("_id", "kpiPlanId", "actorId", "operation", "idempotencyKey", "payloadFingerprint", "completedAt"), options);
  const excuses = await scanCollection<KpiExcuseDocument>(gateway, "kpi_actual_slot_excuses", {}, projection("_id", "kpiPlanId", "allocationId", "createdByActorId", "updatedByActorId"), options);

  const records: StaleKpiRecord[] = [];
  for (const plan of plans.records) {
    const refs = uniqueSorted([
      ...(metrics.records.some((item) => item.kpiPlanId === plan._id) ? ["KPI_TARGET_METRIC"] : []),
      ...(allocations.records.some((item) => item.kpiPlanId === plan._id) ? ["KPI_ALLOCATION"] : []),
      ...(actuals.records.some((item) => item.kpiPlanId === plan._id) ? ["KPI_ACTUAL"] : []),
      ...(corrections.records.some((item) => item.kpiPlanId === plan._id) ? ["KPI_CORRECTION"] : []),
      ...(operations.records.some((item) => item.kpiPlanId === plan._id) ? ["KPI_OPERATION"] : []),
      ...(excuses.records.some((item) => item.kpiPlanId === plan._id) ? ["KPI_EXCUSE"] : []),
      ...(plan.finalResult ? ["KPI_FINAL_RESULT_SNAPSHOT"] : []),
    ]);
    records.push(staleRecord(plan._id, "PLAN", Boolean(plan.lifecycleStatus && plan.actualPolicySnapshot), refs, Boolean(plan.subjectType && plan.subjectId && plan.createdByActorId && plan.updatedByActorId)));
  }
  for (const metric of metrics.records) {
    const refs = plans.records.some((plan) => plan._id === metric.kpiPlanId) ? ["KPI_PLAN"] : [];
    records.push(staleRecord(metric._id, "METRIC", Boolean(metric.allocationMode && metric.actualCaptureMode && metric.actualReviewMode && metric.actualEvidenceMode && metric.actualPolicyVersion), refs, refs.length === 1));
  }
  for (const allocation of allocations.records) {
    const refs = uniqueSorted([
      ...(plans.records.some((plan) => plan._id === allocation.kpiPlanId) ? ["KPI_PLAN"] : []),
      ...(actuals.records.some((actual) => actual.allocationId === allocation._id) ? ["KPI_ACTUAL"] : []),
      ...(corrections.records.some((correction) => correction.allocationId === allocation._id) ? ["KPI_CORRECTION"] : []),
      ...(excuses.records.some((excuse) => excuse.allocationId === allocation._id) ? ["KPI_EXCUSE"] : []),
    ]);
    records.push(staleRecord(allocation._id, "ALLOCATION", Boolean(allocation.lifecycleStatus && allocation.sourcePlanVersion && allocation.allocationVersion && allocation.idempotencyKey && allocation.idempotencyFingerprint && allocation.correlationId), refs, Boolean(allocation.kpiPlanId && allocation.createdByActorId && allocation.updatedByActorId)));
  }
  for (const actual of actuals.records) {
    const refs = uniqueSorted([
      ...(plans.records.some((plan) => plan._id === actual.kpiPlanId) ? ["KPI_PLAN"] : []),
      ...(allocations.records.some((allocation) => allocation._id === actual.allocationId) ? ["KPI_ALLOCATION"] : []),
      ...(corrections.records.some((correction) => correction.actualEntryId === actual._id) ? ["KPI_CORRECTION"] : []),
    ]);
    records.push(staleRecord(actual._id, "ACTUAL", Boolean(actual.lifecycleStatus && actual.entryVersion && actual.policyVersion && (actual.sourceFingerprint || actual.acceptedInputVersions?.length || actual.derivationVersion)), refs, Boolean(actual.kpiPlanId && actual.allocationId && actual.createdByActorId && actual.updatedByActorId)));
  }
  records.sort((left, right) => [left.kind, left.id].join("|").localeCompare([right.kind, right.id].join("|")));
  return result(records, plans, metrics, allocations, actuals, corrections, operations, excuses);
}

export async function loadAllRisk001PlannerInputs(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<Risk001PlannerInputLoadResult> {
  const roleDrift = await loadRoleDriftPlannerRecords(gateway, options);
  const legacy = await loadLegacyRolePlannerRecords(gateway, options);
  const bundles = await loadBundleConsistencyPlannerRecords(gateway, options);
  const fingerprints = await loadScopeFingerprintPlannerRecords(gateway, options);
  const contexts = await loadAccountContextPlannerRecords(gateway, options);
  const talents = await loadTalentIdentityPlannerRecords(gateway, options);
  const coarse = await loadCoarseKpiScopePlannerRecords(gateway, options);
  const staleKpi = await loadStaleKpiPlannerRecords(gateway, options);
  const inputs = Object.freeze({
    RISK001_ROLE_DRIFT: roleDrift.records,
    RISK001_LEGACY_ROLE_RETIREMENT: legacy.records,
    RISK001_BUNDLE_CONSISTENCY: bundles.records,
    RISK001_SCOPE_FINGERPRINT: fingerprints.records,
    RISK001_ACCOUNT_CONTEXT_READINESS: contexts.records,
    RISK001_TALENT_IDENTITY_READINESS: talents.records,
    RISK001_COARSE_KPI_SCOPE: coarse.records,
    RISK001_STALE_KPI_DATA: staleKpi.records,
  });
  const affectedAccountCount = new Set(
    contexts.records.filter((record) => record.activeRoleCodes.length > 0).map((record) => record.userId),
  ).size;
  return {
    inputs,
    evidence: Object.freeze(dedupeEvidence([roleDrift, legacy, bundles, fingerprints, contexts, talents, coarse, staleKpi])),
    exceptions: Object.freeze(uniqueSorted([roleDrift, legacy, bundles, fingerprints, contexts, talents, coarse, staleKpi].flatMap((item) => item.exceptions))),
    affectedAccountCount,
  };
}

export async function scanCollection<T extends ReadOnlyDocument>(
  gateway: ReadOnlyMongoGateway,
  collection: string,
  filter: ReadOnlyFilter,
  requestedProjection: ReadOnlyProjection,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<T>> {
  const pageSize = options.pageSize ?? RISK001_DEFAULT_PAGE_SIZE;
  const safetyCeiling = options.safetyCeiling ?? RISK001_DEFAULT_SAFETY_CEILING;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new Risk001SanitizedError("VALIDATION_FAILED", "Invalid page size");
  }
  if (!Number.isInteger(safetyCeiling) || safetyCeiling < pageSize) {
    throw new Risk001SanitizedError("VALIDATION_FAILED", "Invalid safety ceiling");
  }
  const exactCount = await gateway.countDocuments(collection, filter);
  if (exactCount > safetyCeiling) {
    throw new Risk001SanitizedError(
      "MANUAL_SCOPE_ESCALATION_REQUIRED",
      `MANUAL_SCOPE_ESCALATION_REQUIRED:${collection}:count_exceeds_safety_ceiling`,
    );
  }
  const rows: T[] = [];
  let lastId: string | undefined;
  while (rows.length < exactCount) {
    const pageFilter: ReadOnlyFilter = lastId
      ? Object.keys(filter).length > 0
        ? { $and: [filter, { _id: { $gt: lastId } }] }
        : { _id: { $gt: lastId } }
      : filter;
    const page = await gateway.find<T>(collection, pageFilter, {
      projection: requestedProjection,
      sort: { _id: 1 },
      limit: Math.min(pageSize, safetyCeiling - rows.length),
    });
    if (page.length === 0) break;
    for (const row of page) {
      const id = readStringId(row);
      if (lastId && id <= lastId) {
        throw new Risk001SanitizedError("READ_FAILED", `Non-deterministic pagination in ${collection}`);
      }
      rows.push(row);
      lastId = id;
    }
  }
  if (rows.length !== exactCount) {
    throw new Risk001SanitizedError("READ_FAILED", `Count changed during bounded scan of ${collection}`);
  }
  return {
    records: Object.freeze(rows),
    evidence: Object.freeze([{
      collection,
      countKind: "EXACT",
      inspectedCount: rows.length,
      matchedCount: exactCount,
      pageSize,
      safetyCeiling,
      projectionFields: Object.freeze(Object.keys(requestedProjection).sort()),
    }]),
    exceptions: Object.freeze([]),
  };
}

function staleRecord(
  id: string,
  kind: StaleKpiRecord["kind"],
  reconstructible: boolean,
  downstreamReferences: readonly string[],
  historicalTruthKnown: boolean,
): StaleKpiRecord {
  return {
    id,
    kind,
    reconstructible,
    dependencyCount: downstreamReferences.length,
    historicalTruthKnown,
    downstreamReferences: uniqueSorted(downstreamReferences),
  };
}

async function allScopeSubjectsExist(
  gateway: ReadOnlyMongoGateway,
  grants: readonly RoleAssignmentScopeGrant[],
): Promise<boolean> {
  for (const grant of grants) {
    const collection = scopeSubjectCollection(grant);
    if (!collection) continue;
    if (!grant.targetId) return false;
    const subject = await gateway.findOne<ReadOnlyDocument>(collection, { _id: grant.targetId }, { _id: 1 });
    if (!subject) return false;
  }
  return grants.length > 0;
}

function scopeSubjectCollection(grant: RoleAssignmentScopeGrant): string | null {
  switch (grant.scopeType) {
    case "managedTalentGroup": return "talent_groups";
    case "managedOrgUnit":
    case "attendancePeriodOrg": return "org_units";
    case "assignedPlatformAccount": return "platform_accounts";
    case "assignedEvent": return "events";
    case "assignedStudioResource": return "studio_resources";
    default: return null;
  }
}

function activeAccountsByRole(
  assignments: readonly RoleAssignmentDocument[],
  now: number,
): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    if (!isRoleAssignmentCurrentlyEffective(assignment, now)) continue;
    const users = result.get(assignment.roleId) ?? new Set<string>();
    users.add(assignment.userId);
    result.set(assignment.roleId, users);
  }
  return result;
}

function projection(...fields: readonly string[]): ReadOnlyProjection {
  return Object.freeze(
    Object.fromEntries(fields.map((field) => [field, 1 as const])),
  ) as ReadOnlyProjection;
}

function sortedStrings(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze(uniqueSorted(values ?? []));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function result<T>(
  records: readonly T[],
  ...sources: readonly LoaderResult<unknown>[]
): LoaderResult<T> {
  return {
    records: Object.freeze([...records]),
    evidence: Object.freeze(sources.flatMap((source) => source.evidence)),
    exceptions: Object.freeze(uniqueSorted(sources.flatMap((source) => source.exceptions))),
  };
}

function dedupeEvidence(sources: readonly LoaderResult<unknown>[]): QueryCountEvidence[] {
  const byKey = new Map<string, QueryCountEvidence>();
  for (const evidence of sources.flatMap((source) => source.evidence)) {
    const key = [evidence.collection, evidence.projectionFields.join(",")].join("|");
    byKey.set(key, evidence);
  }
  return [...byKey.values()].sort((a, b) => [a.collection, a.projectionFields.join(",")].join("|").localeCompare([b.collection, b.projectionFields.join(",")].join("|")));
}

function readStringId(row: ReadOnlyDocument): string {
  const id = (row as { readonly _id?: unknown })._id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Risk001SanitizedError("READ_FAILED", "Projected record identity must be a non-empty string");
  }
  return id;
}

// Compile-time proof that the accepted canonical fingerprint owner remains linked.
void buildRoleAssignmentScopeFingerprint;
