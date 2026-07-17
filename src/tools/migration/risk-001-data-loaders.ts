import {
  getRoleBundle,
} from "@modules/role/domain/role-bundle.catalog";
import {
  evaluateKpiPersistedRecord,
  type KpiPersistedEvaluation,
} from "@modules/kpi/domain/kpi-persisted-contract";
import {
  buildRoleAssignmentScopeFingerprint,
  normalizeRoleAssignmentScopeGrants,
  RoleAssignmentScopeGrant,
} from "@modules/role/domain/role-assignment-scope";
import { isRoleAssignmentCurrentlyEffective } from "@modules/role/domain/role-assignment-lifecycle";
import { TALENT_GROUP_MEMBER_STATUSES } from "@modules/talent-group/domain/talent-group.types";
import {
  getRoleTemplate,
  isLegacyRoleTemplateCode,
  LEGACY_ROLE_TEMPLATE_COMPATIBILITY,
  ROLE_TEMPLATE_CATALOG,
} from "@modules/role/domain/role-template.catalog";
import type { ActorScopeGrants } from "@core/actor/actor";
import type {
  AccountContextReadinessRecord,
  BundleConsistencyRecord,
  CoarseKpiScopeRecord,
  LegacyRoleRecord,
  LegacyDependencyDimension,
  RoleDriftPlannerRecord,
  ScopeFingerprintRecord,
  StaleKpiRecord,
  TalentIdentityReadinessRecord,
} from "./risk-001-planners";
import type {
  ReadOnlyDocument,
  ReadOnlyFilter,
  ReadOnlyMongoGateway,
  ReadOnlyProjection,
} from "./read-only-mongo.gateway";
import { Risk001SanitizedError } from "./risk-001-sanitized-error";
import {
  createRisk001ReadCommitment,
  createRisk001ReadQueryIdentity,
  verifyRisk001ReadCommitment,
} from "./risk-001-read-commitment";
import {
  type Risk001AssessmentAreaId,
  type Risk001LoaderOutcome,
  type Risk001ReadCompletionState,
} from "./risk-001-completed-run-contract";
export type {
  Risk001AssessmentAreaId,
  Risk001LoaderOutcome,
  Risk001ReadCompletionState,
} from "./risk-001-completed-run-contract";

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
  readonly filterFingerprint: string;
  readonly projectionFingerprint: string;
  readonly queryIdentityFingerprint: string;
  readonly sourceStateFingerprint: string;
  readonly firstIdentity: string | null;
  readonly lastIdentity: string | null;
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
  readonly loaderOutcomes: readonly Risk001LoaderOutcome[];
  readonly readState: Risk001ReadCompletionState;
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
  readonly joinedAt?: number | null;
  readonly leftAt?: number | null;
}

interface TalentGroupDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly status: string;
}

interface ResponsibilityAssignmentDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly responsibleEmploymentProfileId: string;
  readonly status: string;
  readonly effectiveAt?: number | null;
  readonly expiresAt?: number | null;
  readonly revokedAt?: number | null;
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
  readonly planCode?: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly currencyCode?: string;
  readonly periodMonth?: string;
  readonly periodStartAt?: number;
  readonly periodEndAt?: number;
  readonly timezone?: string;
  readonly publishedAt?: number | null;
  readonly finalizedAt?: number | null;
  readonly archivedAt?: number | null;
  readonly archivedByActorId?: string | null;
  readonly createdAt?: number;
  readonly updatedAt?: number;
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
  readonly metricCode?: string;
  readonly targetValue?: number;
  readonly targetValueExact?: string;
  readonly groupRemainderExact?: string;
  readonly unit?: string;
  readonly rollupMethod?: string;
  readonly actualSource?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
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
  readonly subjectType?: string;
  readonly groupId?: string | null;
  readonly membershipId?: string | null;
  readonly allocationStatus?: string;
  readonly allocationMode?: string;
  readonly supersedesAllocationId?: string | null;
  readonly correctsAllocationId?: string | null;
  readonly allocationStartDate?: string;
  readonly allocationEndDate?: string | null;
  readonly targetMetrics?: readonly unknown[];
  readonly snapshotMemberDisplayName?: string | null;
  readonly note?: string | null;
  readonly approvalNote?: string | null;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly submittedAt?: number | null;
  readonly submittedByActorId?: string | null;
  readonly approvedAt?: number | null;
  readonly approvedByActorId?: string | null;
  readonly rejectedAt?: number | null;
  readonly rejectedByActorId?: string | null;
  readonly rejectionReason?: string | null;
  readonly publishedAt?: number | null;
  readonly publishedByActorId?: string | null;
  readonly closedAt?: number | null;
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
  readonly metricCode?: string;
  readonly actualDate?: string;
  readonly actualValue?: number;
  readonly effectiveValue?: number;
  readonly acceptedValue?: number | null;
  readonly acceptedVersion?: number | null;
  readonly editCount?: number;
  readonly correctionCount?: number;
  readonly captureMode?: string;
  readonly aggregationMethod?: string;
  readonly reviewMode?: string;
  readonly evidenceMode?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly lastEditedAt?: number | null;
  readonly lastEditedByActorId?: string | null;
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
  readonly memberEmploymentProfileId?: string | null;
  readonly memberTalentId?: string | null;
  readonly metricCode?: string;
  readonly actualDate?: string;
  readonly previousValue?: number;
  readonly correctedValue?: number;
  readonly replacementLifecycleStatus?: string;
  readonly requiresReview?: boolean;
  readonly reason?: string;
  readonly correctedAt?: number;
  readonly createdAt?: number;
}

interface KpiOperationDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly kpiPlanId: string;
  readonly actorId?: string;
  readonly operation?: string;
  readonly idempotencyKey?: string;
  readonly payloadFingerprint?: string;
  readonly completedAt?: number | null;
  readonly result?: unknown | null;
  readonly createdAt?: number;
}

interface KpiExcuseDocument extends ReadOnlyDocument {
  readonly _id: string;
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly createdByActorId?: string;
  readonly updatedByActorId?: string;
  readonly metricCode?: string;
  readonly actualDate?: string;
  readonly status?: string;
  readonly reasonCode?: string;
  readonly reasonText?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly deletedAt?: number | null;
  readonly deletedByActorId?: string | null;
}

interface CapturedScan {
  readonly key: string;
  readonly collection: string;
  readonly filter: ReadOnlyFilter;
  readonly projection: ReadOnlyProjection;
  readonly options: Risk001LoaderOptions;
  readonly result: LoaderResult<ReadOnlyDocument>;
}

interface ReadSetCapture {
  readonly scans: Map<string, Promise<CapturedScan>>;
}

interface InternalLoaderOptions extends Risk001LoaderOptions {
  readonly capture?: ReadSetCapture;
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
  const records: RoleDriftPlannerRecord[] = [];
  const persistedByCanonicalCode = new Map<string, RoleDocument[]>();
  for (const role of roles.records) {
    const code = typeof role.code === "string" ? role.code : "";
    const templateCode = typeof role.templateCode === "string" ? role.templateCode : undefined;
    const codeTemplate = code ? getRoleTemplate(code) : null;
    const declaredTemplate = templateCode ? getRoleTemplate(templateCode) : null;
    const template = declaredTemplate ?? codeTemplate;
    const reconciliationIssues = uniqueSorted([
      ...(!code ? ["INVALID_PERSISTED_ROLE_CODE"] : []),
      ...(templateCode && !declaredTemplate ? ["UNKNOWN_DECLARED_TEMPLATE_CODE"] : []),
      ...(codeTemplate && declaredTemplate && codeTemplate.code !== declaredTemplate.code ? ["CONFLICTING_ROLE_CODE_AND_TEMPLATE_CODE"] : []),
    ]);
    if (template) {
      const items = persistedByCanonicalCode.get(template.code) ?? [];
      items.push(role);
      persistedByCanonicalCode.set(template.code, items);
    }
    records.push({
      id: role._id, code, ...(templateCode ? { templateCode } : {}), templateVersion: role.templateVersion,
      permissions: sortedStrings(role.permissions), activeAccountCount: activeByRole.get(role._id)?.size ?? 0,
      template, sourceKind: "PERSISTED", persistedState: role.state ?? null, reconciliationIssues,
    });
  }
  const duplicateCanonicalCodes = new Set<string>();
  for (const template of ROLE_TEMPLATE_CATALOG.filter((item) => item.status === "READY")) {
    const persisted = persistedByCanonicalCode.get(template.code) ?? [];
    if (persisted.length === 0) {
      records.push({ id: `catalog:${template.code}`, code: template.code, templateCode: template.code,
        templateVersion: template.version, permissions: [], activeAccountCount: 0, template,
        sourceKind: "CATALOG_ONLY", persistedState: null, reconciliationIssues: ["CANONICAL_ROLE_MISSING_FROM_PERSISTENCE"] });
    } else if (persisted.length > 1) duplicateCanonicalCodes.add(template.code);
  }
  const reconciled = records.map((record) => duplicateCanonicalCodes.has(record.template?.code ?? "")
    ? { ...record, reconciliationIssues: uniqueSorted([...(record.reconciliationIssues ?? []), "DUPLICATE_PERSISTED_CANONICAL_IDENTITY"]) }
    : record).sort((left, right) => left.id.localeCompare(right.id));
  return result(reconciled, roles, assignments);
}

export async function loadLegacyRolePlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<LegacyRoleRecord>> {
  const roles = await scanCollection<RoleDocument>(gateway, "roles", {}, ROLE_PROJECTION, options);
  const assignments = await scanCollection<RoleAssignmentDocument>(gateway, "role_assignments", {}, ASSIGNMENT_PROJECTION, options);
  const bundles = await scanCollection<BundleAssignmentDocument>(gateway, "bundle_assignments", {}, BUNDLE_PROJECTION, options);
  const users = await scanCollection<UserDocument>(gateway, "users", {}, projection("_id", "accountStatus", "actorKind", "accountContexts"), options);
  const profiles = await scanCollection<EmploymentProfileDocument>(gateway, "employment_profiles", {}, projection("_id", "linkedUserId", "employmentStatus"), options);
  const responsibilities = await scanCollection<ResponsibilityAssignmentDocument>(gateway, "responsibility_assignments", {}, projection("_id", "responsibleEmploymentProfileId", "status", "effectiveAt", "expiresAt", "revokedAt"), options);
  const userById = new Map(users.records.map((user) => [user._id, user]));
  const effective = assignments.records.filter((item) => isRoleAssignmentCurrentlyEffective(item, options.observedAt));
  const records = roles.records
    .filter((role) => isLegacyRoleTemplateCode(role.code))
    .map((role) => {
      const roleAssignments = effective.filter((item) => item.roleId === role._id);
      const mapping = LEGACY_ROLE_TEMPLATE_COMPATIBILITY.find((item) => item.legacyCode === role.code);
      const liveParents = bundles.records.filter((parent) => isBundleParentCurrentlyEffective(parent, options.observedAt));
      const provenBundleChildren = roleAssignments.filter((item) => {
        const origin = item.bundleOrigin;
        if (role.state !== "ACTIVE" || !origin || !isRoleAssignmentCurrentlyEffective(item, options.observedAt)) return false;
        const parent = liveParents.find((candidate) => candidate._id === origin.bundleAssignmentId);
        return Boolean(
          parent &&
          parent.targetUserId === item.userId &&
          parent.bundleCode === origin.bundleCode &&
          parent.bundleVersion === origin.bundleVersion &&
          (parent.childRoleAssignmentIds ?? []).includes(item._id),
        );
      });
      const bundleParentCount = new Set(provenBundleChildren.map((item) => item.bundleOrigin?.bundleAssignmentId)).size;
      const bundleChildCount = provenBundleChildren.length;
      const accountContextDependencyCount = new Set(
        roleAssignments
          .map((item) => userById.get(item.userId))
          .filter((user) => (user?.accountContexts?.length ?? 0) > 0)
          .map((user) => user?._id as string),
      ).size;
      const assignedUserIds = new Set(roleAssignments.map((item) => item.userId));
      const responsibleProfileIds = new Set(profiles.records.filter((profile) => profile.linkedUserId && assignedUserIds.has(profile.linkedUserId)).map((profile) => profile._id));
      const activeResponsibilities = responsibilities.records.filter((item) =>
        item.status === "ACTIVE" && responsibleProfileIds.has(item.responsibleEmploymentProfileId) &&
        (item.effectiveAt ?? Number.NEGATIVE_INFINITY) <= options.observedAt &&
        (item.expiresAt == null || item.expiresAt > options.observedAt) && item.revokedAt == null,
      );
      const replacementRoles = (mapping?.replacementRoleCodes ?? []).map((replacementCode) =>
        roles.records.filter((candidate) => candidate.code === replacementCode),
      );
      const resolvedReplacementRoles = replacementRoles.flat();
      const replacementAmbiguous = replacementRoles.some((matches) => matches.length !== 1);
      const replacementInactive = resolvedReplacementRoles.some((candidate) => candidate.state !== "ACTIVE");
      const replacementPermissions = sortedStrings(resolvedReplacementRoles.flatMap((candidate) => candidate.permissions ?? []));
      const effectiveAccessEquivalent = replacementRoles.length > 0 && !replacementAmbiguous && !replacementInactive &&
        sameStringSet(role.permissions ?? [], replacementPermissions);
      const scopeMigrationBlocked = roleAssignments.some((assignment) => !assignment.structuredScopeGrants || assignment.structuredScopeGrants.length === 0);
      const coarseKpiDependencyCount = roleAssignments.filter((assignment) => (assignment.scopeGrants?.kpi?.length ?? 0) > 0).length;
      const dimensions: readonly LegacyDependencyDimension[] = Object.freeze([
        legacyDimension("active-role-assignments", "ACTIVE_ROLE_ASSIGNMENTS", roleAssignments.map((item) => item._id)),
        legacyDimension("responsibility-references", "RESPONSIBILITY_REFERENCES", activeResponsibilities.map((item) => item._id)),
        legacyDimension("bundle-references", "BUNDLE_PARENT_OR_CHILD_REFERENCES", [...provenBundleChildren.map((item) => item._id), ...liveParents.filter((parent) => parent.childRoleAssignmentIds?.some((id) => roleAssignments.some((assignment) => assignment._id === id))).map((item) => item._id)]),
        legacyDimension("policy-authority", "ACTIVE_AUTHORITY_DEPENDENCIES", roleAssignments.map((item) => item._id)),
        { id: "compatibility", reasonCode: mapping ? "CATALOG_COMPATIBILITY_MAPPING_PRESENT" : "COMPATIBILITY_MAPPING_UNRESOLVED", status: mapping ? "CLEAR" : "UNRESOLVED", evidenceIds: mapping ? [mapping.legacyCode] : [] },
        legacyDimension("coarse-kpi", "COARSE_KPI_SCOPE_DEPENDENCIES", roleAssignments.filter((item) => (item.scopeGrants?.kpi?.length ?? 0) > 0).map((item) => item._id)),
        { id: "structured-scope-migration", reasonCode: scopeMigrationBlocked ? "STRUCTURED_SCOPE_MIGRATION_INCOMPLETE" : "STRUCTURED_SCOPE_MIGRATION_CLEAR", status: scopeMigrationBlocked ? "BLOCKED" : "CLEAR", evidenceIds: scopeMigrationBlocked ? roleAssignments.filter((item) => !item.structuredScopeGrants || item.structuredScopeGrants.length === 0).map((item) => item._id) : [] },
        { id: "effective-access-equivalence", reasonCode: effectiveAccessEquivalent ? "EFFECTIVE_ACCESS_EQUIVALENCE_PROVEN" : "EFFECTIVE_ACCESS_EQUIVALENCE_UNPROVEN", status: effectiveAccessEquivalent ? "CLEAR" : "UNRESOLVED", evidenceIds: resolvedReplacementRoles.map((item) => item._id) },
        { id: "persisted-replacement-resolution", reasonCode: replacementAmbiguous ? "PERSISTED_REPLACEMENT_AMBIGUOUS" : replacementInactive ? "PERSISTED_REPLACEMENT_INACTIVE" : resolvedReplacementRoles.length === 0 ? "PERSISTED_REPLACEMENT_MISSING" : "PERSISTED_REPLACEMENT_RESOLVED", status: replacementAmbiguous || replacementInactive ? "BLOCKED" : resolvedReplacementRoles.length === 0 ? "UNRESOLVED" : "CLEAR", evidenceIds: resolvedReplacementRoles.map((item) => item._id) },
        { id: "ownership", reasonCode: assignedUserIds.size > 0 && responsibleProfileIds.size === 0 ? "OWNERSHIP_UNRESOLVED" : "OWNERSHIP_RESOLVED", status: assignedUserIds.size > 0 && responsibleProfileIds.size === 0 ? "UNRESOLVED" : "CLEAR", evidenceIds: [...assignedUserIds].sort() },
      ]);
      return {
        id: role._id,
        code: role.code,
        activeAssignmentCount: roleAssignments.length,
        bundleParentCount,
        bundleChildCount,
        accountContextDependencyCount,
        effectivePermissions: sortedStrings(role.permissions),
        replacementRoleCodes: sortedStrings(mapping?.replacementRoleCodes),
        dependencyDimensions: dimensions,
      };
    });
  return result(records, roles, assignments, bundles, users, profiles, responsibilities);
}

export async function loadBundleConsistencyPlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<BundleConsistencyRecord>> {
  const bundles = await scanCollection<BundleAssignmentDocument>(gateway, "bundle_assignments", {}, BUNDLE_PROJECTION, options);
  const assignments = await scanCollection<RoleAssignmentDocument>(gateway, "role_assignments", {}, ASSIGNMENT_PROJECTION, options);
  const roles = await scanCollection<RoleDocument>(gateway, "roles", {}, ROLE_PROJECTION, options);
  const byId = new Map(assignments.records.map((item) => [item._id, item]));
  const roleById = new Map(roles.records.map((item) => [item._id, item]));
  const records = bundles.records.map((parent) => {
    const persistedChildIds = Object.freeze([...(parent.childRoleAssignmentIds ?? [])]);
    const listedChildren = persistedChildIds.map((id) => byId.get(id));
    const originChildren = assignments.records.filter(
      (item) => item.bundleOrigin?.bundleAssignmentId === parent._id,
    );
    const reconciledChildren = uniqueDocuments([
      ...listedChildren.filter((item): item is RoleAssignmentDocument => Boolean(item)),
      ...originChildren,
    ]);
    const validCurrentChildren = reconciledChildren.filter((child) => {
      const role = roleById.get(child.roleId);
      return child.userId === parent.targetUserId &&
        bundleOriginMatches(child, parent) &&
        isRoleAssignmentCurrentlyEffective(child, options.observedAt) &&
        role?.state === "ACTIVE";
    });
    const activeChildIds = validCurrentChildren
      .map((child) => child._id)
      .sort();
    const revokedChildIds = reconciledChildren
      .filter((child): child is RoleAssignmentDocument => Boolean(child && child.state === "REVOKED"))
      .map((child) => child._id)
      .sort();
    const currentCatalog = getRoleBundle(parent.bundleCode);
    const exactCatalog = getRoleBundle(parent.bundleCode, parent.bundleVersion);
    const expectedRoleCodes = sortedStrings(exactCatalog?.childRoles);
    const childRoleCodes = reconciledChildren.map((child) => roleById.get(child.roleId)?.code ?? null);
    const activeRoleCodes = validCurrentChildren
      .map((child) => roleById.get(child.roleId)?.code)
      .filter((code): code is string => Boolean(code));
    const classifications: BundleConsistencyRecord["classifications"][number][] = [];
    if (!isBundleParentCurrentlyEffective(parent, options.observedAt)) classifications.push("PARENT_INACTIVE_OR_EXPIRED");
    if (reconciledChildren.some((child) => child.userId !== parent.targetUserId)) classifications.push("TARGET_USER_MISMATCH");
    if (reconciledChildren.some((child) => roleById.get(child.roleId)?.state !== "ACTIVE")) classifications.push("ROLE_MISSING_OR_INACTIVE");
    if (currentCatalog && !exactCatalog) classifications.push("CATALOG_VERSION_MISMATCH");
    if (!currentCatalog) classifications.push("UNKNOWN_OR_MANUAL_REVIEW");
    if (expectedRoleCodes.some((code) => !activeRoleCodes.includes(code))) classifications.push("MISSING_EXPECTED_CHILD");
    if (activeRoleCodes.some((code) => !expectedRoleCodes.includes(code))) classifications.push("EXTRA_CHILD");
    if (hasDuplicate(childRoleCodes.filter((code): code is string => code !== null)) || hasDuplicate(persistedChildIds)) classifications.push("DUPLICATE_CHILD_ROLE");
    if (reconciledChildren.some((child) => !isRoleAssignmentCurrentlyEffective(child, options.observedAt))) classifications.push("REVOKED_OR_INEFFECTIVE_CHILD");
    if (reconciledChildren.some((child) => !bundleOriginMatches(child, parent))) classifications.push("ORIGIN_MISMATCH");
    if (originChildren.some((child) => !persistedChildIds.includes(child._id))) classifications.push("ORPHAN_CHILD_LINK");
    if (listedChildren.some((child) => !child) || childRoleCodes.some((code) => code === null) || !parent.sourceTrace) classifications.push("UNKNOWN_OR_MANUAL_REVIEW");
    const exactRoleMultiset = multisetEquals(activeRoleCodes, expectedRoleCodes);
    if (
      classifications.length === 0 && exactCatalog && exactRoleMultiset &&
      persistedChildIds.length > 0 && persistedChildIds.length === reconciledChildren.length
    ) classifications.push("MATCHED");
    if (classifications.length === 0) classifications.push("UNKNOWN_OR_MANUAL_REVIEW");
    return {
      parentId: parent._id,
      status: parent.status,
      bundleCode: parent.bundleCode,
      persistedCatalogVersion: parent.bundleVersion,
      canonicalCatalogVersion: currentCatalog?.version ?? null,
      expectedRoleCodes,
      persistedChildIds,
      childRoleCodes: Object.freeze(childRoleCodes),
      relatedRoleIds: Object.freeze(uniqueSorted(reconciledChildren.map((child) => child.roleId))),
      activeChildIds,
      revokedChildIds,
      classifications: Object.freeze(uniqueSorted(classifications)),
      provenanceComplete: Boolean(parent.sourceTrace && exactCatalog && reconciledChildren.length > 0 && reconciledChildren.every((child) =>
        child.userId === parent.targetUserId && bundleOriginMatches(child, parent) && roleById.get(child.roleId)?.state === "ACTIVE",
      )),
    };
  });
  return result(records, bundles, assignments, roles);
}

export async function loadScopeFingerprintPlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<ScopeFingerprintRecord>> {
  const assignments = await scanCollection<RoleAssignmentDocument>(gateway, "role_assignments", {}, ASSIGNMENT_PROJECTION, options);
  const exceptions: string[] = [];
  const records: ScopeFingerprintRecord[] = [];
  for (const assignment of assignments.records) {
    let grants: readonly RoleAssignmentScopeGrant[] = [];
    let subjectsExist = false;
    let sourceClassification: ScopeFingerprintRecord["sourceClassification"];
    const reasonCodes: string[] = [];
    const assignmentValidityReasons = invalidAssignmentSourceReasons(assignment);
    const effective = isRoleAssignmentCurrentlyEffective(assignment, options.observedAt);
    if (assignmentValidityReasons.length > 0) {
      sourceClassification = "INVALID_ASSIGNMENT_SOURCE";
      reasonCodes.push(...assignmentValidityReasons);
    } else if (!effective) {
      sourceClassification = "INACTIVE_OR_INEFFECTIVE_ASSIGNMENT";
      reasonCodes.push("ASSIGNMENT_NOT_CURRENTLY_EFFECTIVE");
    } else if (!assignment.structuredScopeGrants || assignment.structuredScopeGrants.length === 0) {
      sourceClassification = assignment.scopeGrants && Object.keys(assignment.scopeGrants).some((key) => (assignment.scopeGrants?.[key as keyof ActorScopeGrants]?.length ?? 0) > 0)
        ? "COARSE_SCOPE_ONLY" : "NO_STRUCTURED_GRANT";
      reasonCodes.push(sourceClassification);
    } else {
      const rawGrantCount = assignment.structuredScopeGrants.length;
      try {
        grants = normalizeRoleAssignmentScopeGrants(assignment.structuredScopeGrants) ?? [];
        if (grants.length !== rawGrantCount) {
          sourceClassification = "DUPLICATE_SEMANTIC_GRANT";
          reasonCodes.push("DUPLICATE_SEMANTIC_GRANT");
        } else {
          subjectsExist = await allScopeSubjectsExist(gateway, grants, options);
          if (!subjectsExist) {
            sourceClassification = "OBJECT_IDENTITY_MISMATCH";
            reasonCodes.push("SCOPE_SUBJECT_NOT_FOUND");
          } else {
            const expected = buildRoleAssignmentScopeFingerprint(grants);
            sourceClassification = assignment.scopeFingerprint === expected ? "EXACT_STRUCTURED_MATCH" : "FINGERPRINT_MISMATCH";
            reasonCodes.push(sourceClassification);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        sourceClassification = message.includes("must be one of") ? "UNSUPPORTED_SCOPE_TYPE" : "MALFORMED_STRUCTURED_GRANT";
        reasonCodes.push(sourceClassification);
        exceptions.push(`SCOPE_GRANT_INVALID:${assignment._id.length > 0 ? "SANITIZED" : "UNKNOWN"}`);
      }
    }
    records.push({
      assignmentId: assignment._id,
      roleId: assignment.roleId,
      grants,
      ...(assignment.scopeFingerprint ? { storedFingerprint: assignment.scopeFingerprint } : {}),
      subjectsExist,
      sourceClassification: sourceClassification ?? "INVALID_SOURCE_MANUAL_REVIEW",
      assignmentState: assignment.state,
      reasonCodes: Object.freeze(uniqueSorted(reasonCodes)),
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
      const activeAssignments = activeByUser.get(user._id) ?? [];
      const activeRoles = activeAssignments
        .map((assignment) => roleById.get(assignment.roleId))
        .filter((role): role is RoleDocument => role?.state === "ACTIVE");
      const activeRoleCodes = sortedStrings(activeRoles.map((role) => role.code));
      const activeRoleIds = sortedStrings(activeRoles.map((role) => role._id));
      const recommendedContexts = sortedStrings(
        activeRoles.flatMap((role) => {
          const context = getRoleTemplate(
            role.templateCode ?? role.code,
          )?.recommendedAccountContext;
          return context ? [context] : [];
        }),
      );
      const currentContexts = sortedStrings(user.accountContexts);
      const linkedProfiles = profiles.records.filter((profile) => profile.linkedUserId === user._id);
      const operationalProfileStatuses = sortedStrings(linkedProfiles.filter((profile) => isPeopleReadinessEmploymentStatusOperational(profile.employmentStatus)).map((profile) => profile.employmentStatus));
      const ineligibleProfileStatuses = sortedStrings(linkedProfiles.filter((profile) => !isPeopleReadinessEmploymentStatusOperational(profile.employmentStatus)).map((profile) => profile.employmentStatus));
      const templates = activeRoles.map((role) => getRoleTemplate(role.templateCode ?? role.code));
      const policyOwnerKnown = activeAssignments.length > 0 &&
        activeRoles.length === activeAssignments.length &&
        templates.every((template) => Boolean(template?.recommendedAccountContext));
      const identityUnambiguous = linkedProfiles.length === 1 && operationalProfileStatuses.length === 1 && ineligibleProfileStatuses.length === 0;
      const contextsSatisfied = recommendedContexts.length > 0 && recommendedContexts.every((context) => currentContexts.includes(context));
      const ambiguityReasons = uniqueSorted([
        ...(linkedProfiles.length === 0 ? ["NO_PROFILE_FOUND"] : []),
        ...(linkedProfiles.length > 1 ? ["AMBIGUOUS_PROFILE_LINKAGE"] : []),
        ...(linkedProfiles.length === 1 && operationalProfileStatuses.length !== 1 ? ["PROFILE_NOT_ELIGIBLE"] : []),
        ...(!policyOwnerKnown ? ["POLICY_OWNER_UNKNOWN"] : []),
        ...(recommendedContexts.length === 0 ? ["REQUIRED_CONTEXT_SET_UNKNOWN"] : []),
        ...(!contextsSatisfied ? ["REQUIRED_CONTEXTS_NOT_SATISFIED"] : []),
      ]);
      const eligibilityProven =
        user.accountStatus === "ACTIVE" &&
        policyOwnerKnown && identityUnambiguous && contextsSatisfied && ambiguityReasons.length === 0;
      return {
        userId: user._id,
        activeRoleIds,
        activeRoleCodes,
        currentContexts,
        recommendedContexts,
        operationalProfileStatuses,
        ineligibleProfileStatuses,
        linkedProfileCount: linkedProfiles.length,
        policyOwnerKnown,
        ambiguityReasons: Object.freeze(ambiguityReasons),
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
  const memberships = await scanCollection<TalentGroupMemberDocument>(gateway, "talent_group_members", {}, projection("_id", "groupId", "talentId", "membershipStatus", "joinedAt", "leftAt"), options);
  const groups = await scanCollection<TalentGroupDocument>(gateway, "talent_groups", {}, projection("_id", "status"), options);
  const profileById = new Map(profiles.records.map((profile) => [profile._id, profile]));
  const groupById = new Map(groups.records.map((group) => [group._id, group]));
  const talentCountByProfile = new Map<string, number>();
  for (const talent of talents.records) {
    if (talent.linkedEmploymentProfileId) {
      talentCountByProfile.set(talent.linkedEmploymentProfileId, (talentCountByProfile.get(talent.linkedEmploymentProfileId) ?? 0) + 1);
    }
  }
  const knownMembershipStatuses = new Set<string>(TALENT_GROUP_MEMBER_STATUSES);
  const membershipsByTalentId = new Map<string, TalentGroupMemberDocument[]>();
  const unresolvedMemberships: TalentGroupMemberDocument[] = [];
  for (const membership of memberships.records) {
    if (isNonBlankString(membership.talentId)) {
      const bucket = membershipsByTalentId.get(membership.talentId) ?? [];
      bucket.push(membership);
      membershipsByTalentId.set(membership.talentId, bucket);
    } else {
      unresolvedMemberships.push(membership);
    }
  }
  const records: TalentIdentityReadinessRecord[] = talents.records.map((talent) => {
    const profile = talent.linkedEmploymentProfileId ? profileById.get(talent.linkedEmploymentProfileId) : undefined;
    const talentMemberships = membershipsByTalentId.get(talent._id) ?? [];
    const malformedMemberships = talentMemberships.filter((membership) => !isValidTalentMembership(membership, knownMembershipStatuses));
    const validMemberships = talentMemberships.filter((membership) => isValidTalentMembership(membership, knownMembershipStatuses));
    const duplicateMembershipCount = duplicateSemanticMembershipCount(validMemberships);
    const activeMemberships = validMemberships.filter((membership) => membership.membershipStatus === "ACTIVE" && isTalentMembershipCurrentlyEffective(membership, options.observedAt));
    const activeMembershipCount = activeMemberships.length;
    const externalOnly = talent.talentOrigin === "EXTERNAL" && !talent.linkedEmploymentProfileId;
    const duplicatedLink = Boolean(profile && (talentCountByProfile.get(profile._id) ?? 0) > 1);
    const profileOperational = Boolean(profile && isPeopleReadinessEmploymentStatusOperational(profile.employmentStatus));
    const operationalMembershipCount = talent.talentOrigin === "INTERNAL" && talent.operationalStatus === "ACTIVE" && profileOperational && !duplicatedLink
      ? activeMemberships.filter((membership) => groupById.get(membership.groupId)?.status === "ACTIVE").length
      : 0;
    const invalidActiveGroup = activeMemberships.some((membership) => groupById.get(membership.groupId)?.status !== "ACTIVE");
    const activeValidMemberships = activeMemberships.filter((membership) => groupById.get(membership.groupId)?.status === "ACTIVE");
    let readinessClassification: TalentIdentityReadinessRecord["readinessClassification"];
    if (talent.talentOrigin === "EXTERNAL" && talent.linkedEmploymentProfileId) readinessClassification = "FORBIDDEN_EXTERNAL_PROFILE_LINK";
    else if (externalOnly) readinessClassification = "EXTERNAL_ONLY_TALENT";
    else if (talent.operationalStatus !== "ACTIVE") readinessClassification = "INACTIVE_TALENT";
    else if (!talent.linkedEmploymentProfileId || !profile) readinessClassification = "MISSING_EMPLOYMENT_PROFILE";
    else if (duplicatedLink) readinessClassification = "AMBIGUOUS_MULTIPLE_LINKS";
    else if (!profileOperational) readinessClassification = "INELIGIBLE_EMPLOYMENT_PROFILE";
    else if (malformedMemberships.length > 0 || duplicateMembershipCount > 0) readinessClassification = "MALFORMED_RELEVANT_MEMBERSHIP";
    else if (invalidActiveGroup) readinessClassification = "INACTIVE_OR_INVALID_GROUP";
    else if (validMemberships.some((membership) => membership.membershipStatus !== "ACTIVE" || !isTalentMembershipCurrentlyEffective(membership, options.observedAt)) && activeMembershipCount === 0) readinessClassification = "STALE_MEMBERSHIP";
    else if (activeValidMemberships.length === 0) readinessClassification = "NO_ACTIVE_VALID_GROUP_MEMBERSHIP";
    else if (activeValidMemberships.length > 1) readinessClassification = "AMBIGUOUS_MULTIPLE_ACTIVE_VALID_GROUP_MEMBERSHIPS";
    else readinessClassification = "VALID_OPERATIONAL_IDENTITY";
    const evidenceUnambiguous = readinessClassification === "VALID_OPERATIONAL_IDENTITY";
    return {
      talentId: talent._id,
      ...(talent.linkedEmploymentProfileId ? { employmentProfileId: talent.linkedEmploymentProfileId } : {}),
      ...(profile?.linkedUserId ? { linkedUserId: profile.linkedUserId } : {}),
      activeMembershipCount,
      operationalMembershipCount,
      malformedMembershipCount: malformedMemberships.length,
      unresolvedMembershipCount: malformedMemberships.length + duplicateMembershipCount,
      duplicateMembershipCount,
      membershipReasonCodes: Object.freeze(uniqueSorted([
        ...(malformedMemberships.length > 0 ? ["MALFORMED_RELEVANT_MEMBERSHIP"] : []),
        ...(duplicateMembershipCount > 0 ? ["DUPLICATE_SEMANTIC_MEMBERSHIP"] : []),
      ])),
      externalOnly,
      evidenceUnambiguous,
      readinessClassification,
      talentOperationalStatus: talent.operationalStatus,
      employmentProfileStatus: profile?.employmentStatus ?? null,
    };
  });
  for (const membership of unresolvedMemberships) {
    records.push({
      talentId: `UNRESOLVED_MEMBERSHIP:${membership._id}`,
      activeMembershipCount: 0,
      operationalMembershipCount: 0,
      malformedMembershipCount: 1,
      unresolvedMembershipCount: 1,
      duplicateMembershipCount: 0,
      membershipReasonCodes: Object.freeze(["MEMBERSHIP_TALENT_ID_MISSING_OR_INVALID"]),
      externalOnly: false,
      evidenceUnambiguous: false,
      readinessClassification: "UNRESOLVED_MEMBERSHIP_SUBJECT",
      talentOperationalStatus: "UNKNOWN",
      employmentProfileStatus: null,
    });
  }
  return result(records.sort((left, right) => left.talentId.localeCompare(right.talentId)), talents, profiles, memberships, groups);
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
      compatibilityOwner: KPI_COARSE_SCOPE_COMPATIBILITY_INVENTORY.sourceOwner,
      compatibilityContract: KPI_COARSE_SCOPE_COMPATIBILITY_INVENTORY.contract,
      compatibilityVersion: KPI_COARSE_SCOPE_COMPATIBILITY_INVENTORY.version,
      consumerIds: Object.freeze(KPI_COARSE_SCOPE_COMPATIBILITY_INVENTORY.consumers.map((consumer) => consumer.id).sort()),
      productionCallerCount: KPI_COARSE_SCOPE_COMPATIBILITY_INVENTORY.consumers.length,
      retirementBlocker: KPI_COARSE_SCOPE_COMPATIBILITY_INVENTORY.retirementCondition,
    }));
  return result(records, assignments);
}

export async function loadStaleKpiPlannerRecords(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<StaleKpiRecord>> {
  const plans = await scanCollection<KpiPlanDocument>(gateway, "kpi_plans", {}, projection("_id", "planCode", "title", "description", "externalRef", "subjectType", "subjectId", "status", "lifecycleStatus", "currencyCode", "periodMonth", "periodStartAt", "periodEndAt", "timezone", "actualPolicySnapshot", "publishedAt", "publishedByActorId", "finalizedAt", "finalizedByActorId", "finalResult", "archivedAt", "archivedByActorId", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId"), options);
  const metrics = await scanCollection<KpiMetricDocument>(gateway, "kpi_target_metrics", {}, projection("_id", "kpiPlanId", "metricCode", "targetValue", "targetValueExact", "allocationMode", "allocationScale", "groupRemainderExact", "unit", "rollupMethod", "actualSource", "actualCaptureMode", "actualReviewMode", "actualEvidenceMode", "actualPolicyVersion", "createdAt", "updatedAt"), options);
  const allocations = await scanCollection<KpiAllocationDocument>(gateway, "kpi_allocations", {}, projection("_id", "kpiPlanId", "subjectType", "subjectId", "groupId", "memberEmploymentProfileId", "memberTalentId", "membershipId", "allocationStatus", "lifecycleStatus", "allocationMode", "sourcePlanVersion", "allocationVersion", "membershipSnapshotVersion", "eligibleMemberSnapshot", "idempotencyKey", "idempotencyFingerprint", "correlationId", "supersedesAllocationId", "correctsAllocationId", "allocationStartDate", "allocationEndDate", "targetMetrics", "snapshotMemberDisplayName", "note", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId", "submittedAt", "submittedByActorId", "approvedAt", "approvedByActorId", "approvalNote", "rejectedAt", "rejectedByActorId", "rejectionReason", "publishedAt", "publishedByActorId", "closedAt"), options);
  const actuals = await scanCollection<KpiActualDocument>(gateway, "kpi_actual_entries", {}, projection("_id", "kpiPlanId", "allocationId", "memberEmploymentProfileId", "memberTalentId", "metricCode", "actualDate", "actualValue", "effectiveValue", "acceptedValue", "acceptedVersion", "editCount", "correctionCount", "latestCorrectionId", "lifecycleStatus", "entryVersion", "captureMode", "aggregationMethod", "reviewMode", "evidenceMode", "policyVersion", "sourceFingerprint", "acceptedInputVersions", "derivationVersion", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId", "lastEditedAt", "lastEditedByActorId"), options);
  const corrections = await scanCollection<KpiCorrectionDocument>(gateway, "kpi_actual_corrections", {}, projection("_id", "actualEntryId", "kpiPlanId", "allocationId", "memberEmploymentProfileId", "memberTalentId", "metricCode", "actualDate", "previousValue", "correctedValue", "previousEntryVersion", "replacementEntryVersion", "replacementLifecycleStatus", "requiresReview", "idempotencyKey", "payloadFingerprint", "reason", "correctedByActorId", "correctedAt", "createdAt"), options);
  const operations = await scanCollection<KpiOperationDocument>(gateway, "kpi_allocation_operations", {}, projection("_id", "kpiPlanId", "actorId", "operation", "idempotencyKey", "payloadFingerprint", "result", "createdAt", "completedAt"), options);
  const excuses = await scanCollection<KpiExcuseDocument>(gateway, "kpi_actual_slot_excuses", {}, projection("_id", "kpiPlanId", "allocationId", "metricCode", "actualDate", "status", "reasonCode", "reasonText", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId", "deletedAt", "deletedByActorId"), options);

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
    records.push(classifyKpiRecord(plan, "PLAN", refs, evaluateKpiPlan(plan), talentPlanSubjectIds(plan)));
  }
  for (const metric of metrics.records) {
    const refs = plans.records.some((plan) => plan._id === metric.kpiPlanId) ? ["KPI_PLAN"] : [];
    const plan = plans.records.find((item) => item._id === metric.kpiPlanId);
    records.push(classifyKpiRecord(metric, "METRIC", refs, evaluateKpiMetric(metric, plan), talentPlanSubjectIds(plan)));
  }
  for (const allocation of allocations.records) {
    const refs = uniqueSorted([
      ...(plans.records.some((plan) => plan._id === allocation.kpiPlanId) ? ["KPI_PLAN"] : []),
      ...(actuals.records.some((actual) => actual.allocationId === allocation._id) ? ["KPI_ACTUAL"] : []),
      ...(corrections.records.some((correction) => correction.allocationId === allocation._id) ? ["KPI_CORRECTION"] : []),
      ...(excuses.records.some((excuse) => excuse.allocationId === allocation._id) ? ["KPI_EXCUSE"] : []),
      ...(allocation.supersedesAllocationId ? ["KPI_ALLOCATION_PREDECESSOR"] : []),
      ...(allocation.correctsAllocationId ? ["KPI_ALLOCATION_CORRECTED"] : []),
      ...(allocations.records.some((candidate) => candidate.supersedesAllocationId === allocation._id || candidate.correctsAllocationId === allocation._id) ? ["KPI_ALLOCATION_SUCCESSOR"] : []),
    ]);
    records.push(classifyKpiRecord(allocation, "ALLOCATION", refs, evaluateKpiAllocation(
      allocation,
      plans.records.find((plan) => plan._id === allocation.kpiPlanId),
      allocations.records,
    ), relatedTalentIds(allocation.memberTalentId)));
  }
  for (const actual of actuals.records) {
    const refs = uniqueSorted([
      ...(plans.records.some((plan) => plan._id === actual.kpiPlanId) ? ["KPI_PLAN"] : []),
      ...(allocations.records.some((allocation) => allocation._id === actual.allocationId) ? ["KPI_ALLOCATION"] : []),
      ...(corrections.records.some((correction) => correction.actualEntryId === actual._id) ? ["KPI_CORRECTION"] : []),
      ...(actual.latestCorrectionId ? ["KPI_LATEST_CORRECTION"] : []),
    ]);
    records.push(classifyKpiRecord(actual, "ACTUAL", refs, evaluateKpiActual(
      actual,
      plans.records.find((plan) => plan._id === actual.kpiPlanId),
      allocations.records.find((allocation) => allocation._id === actual.allocationId),
      metrics.records.find((metric) => metric.kpiPlanId === actual.kpiPlanId && metric.metricCode === actual.metricCode),
      corrections.records,
    ), relatedTalentIds(actual.memberTalentId)));
  }
  for (const correction of corrections.records) {
    const refs = uniqueSorted(["KPI_PLAN", "KPI_ALLOCATION", "KPI_ACTUAL"].filter((kind) => kind === "KPI_PLAN" ? plans.records.some((item) => item._id === correction.kpiPlanId) : kind === "KPI_ALLOCATION" ? allocations.records.some((item) => item._id === correction.allocationId) : actuals.records.some((item) => item._id === correction.actualEntryId)));
    records.push(classifyKpiRecord(correction, "CORRECTION", refs, evaluateKpiCorrection(
      correction,
      plans.records.find((item) => item._id === correction.kpiPlanId),
      allocations.records.find((item) => item._id === correction.allocationId),
      actuals.records.find((item) => item._id === correction.actualEntryId),
    ), relatedTalentIds(correction.memberTalentId)));
  }
  for (const operation of operations.records) {
    const parent = plans.records.find((item) => item._id === operation.kpiPlanId);
    records.push(classifyKpiRecord(operation, "ALLOCATION_OPERATION", parent ? ["KPI_PLAN"] : [], evaluateKpiOperation(operation, parent), talentPlanSubjectIds(parent)));
  }
  for (const excuse of excuses.records) {
    const refs = uniqueSorted([...(plans.records.some((item) => item._id === excuse.kpiPlanId) ? ["KPI_PLAN"] : []), ...(allocations.records.some((item) => item._id === excuse.allocationId) ? ["KPI_ALLOCATION"] : [])]);
    const allocation = allocations.records.find((item) => item._id === excuse.allocationId);
    records.push(classifyKpiRecord(excuse, "SLOT_EXCUSE", refs, evaluateKpiExcuse(
      excuse,
      plans.records.find((item) => item._id === excuse.kpiPlanId),
      allocation,
      metrics.records.find((item) => item.kpiPlanId === excuse.kpiPlanId && item.metricCode === excuse.metricCode),
    ), relatedTalentIds(allocation?.memberTalentId)));
  }
  records.sort((left, right) => [left.kind, left.id].join("|").localeCompare([right.kind, right.id].join("|")));
  return result(records, plans, metrics, allocations, actuals, corrections, operations, excuses);
}

export async function loadAllRisk001PlannerInputs(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
): Promise<Risk001PlannerInputLoadResult> {
  const capture: ReadSetCapture = { scans: new Map() };
  const capturedOptions: InternalLoaderOptions = { ...options, capture };
  const roleDrift = await loadRoleDriftPlannerRecords(gateway, capturedOptions);
  const legacy = await loadLegacyRolePlannerRecords(gateway, capturedOptions);
  const bundles = await loadBundleConsistencyPlannerRecords(gateway, capturedOptions);
  const fingerprints = await loadScopeFingerprintPlannerRecords(gateway, capturedOptions);
  const contexts = await loadAccountContextPlannerRecords(gateway, capturedOptions);
  const talents = await loadTalentIdentityPlannerRecords(gateway, capturedOptions);
  const coarse = await loadCoarseKpiScopePlannerRecords(gateway, capturedOptions);
  const staleKpi = await loadStaleKpiPlannerRecords(gateway, capturedOptions);
  await verifyCapturedReadSet(gateway, capturedOptions, capture);
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
    loaderOutcomes: Object.freeze([
      loaderOutcome("RISK001_ROLE_DRIFT", roleDrift),
      loaderOutcome("RISK001_LEGACY_ROLE_RETIREMENT", legacy),
      loaderOutcome("RISK001_BUNDLE_CONSISTENCY", bundles),
      loaderOutcome("RISK001_SCOPE_FINGERPRINT", fingerprints),
      loaderOutcome("RISK001_ACCOUNT_CONTEXT_READINESS", contexts),
      loaderOutcome("RISK001_TALENT_IDENTITY_READINESS", talents),
      loaderOutcome("RISK001_COARSE_KPI_SCOPE", coarse),
      loaderOutcome("RISK001_STALE_KPI_DATA", staleKpi),
    ]),
    readState: Object.freeze({
      capturedReadVerification: "PASSED",
      paginationConsistency: "PASSED",
    }),
  };
}

export async function scanCollection<T extends ReadOnlyDocument>(
  gateway: ReadOnlyMongoGateway,
  collection: string,
  filter: ReadOnlyFilter,
  requestedProjection: ReadOnlyProjection,
  options: Risk001LoaderOptions,
): Promise<LoaderResult<T>> {
  const capture = (options as InternalLoaderOptions).capture;
  const key = scanKey(collection, filter, requestedProjection, options);
  if (capture) {
    let pending = capture.scans.get(key);
    if (!pending) {
      pending = scanCollectionOnce<T>(gateway, collection, filter, requestedProjection, options).then((scan) => ({
        key,
        collection,
        filter,
        projection: requestedProjection,
        options: Object.freeze({
          observedAt: options.observedAt,
          pageSize: options.pageSize ?? RISK001_DEFAULT_PAGE_SIZE,
          safetyCeiling: options.safetyCeiling ?? RISK001_DEFAULT_SAFETY_CEILING,
        }),
        result: scan as LoaderResult<ReadOnlyDocument>,
      }));
      capture.scans.set(key, pending);
    }
    return (await pending).result as LoaderResult<T>;
  }
  const captured = await scanCollectionOnce<T>(gateway, collection, filter, requestedProjection, options);
  const verified = await scanCollectionOnce<T>(gateway, collection, filter, requestedProjection, options);
  assertSameSourceState(captured, verified, collection);
  return captured;
}

async function scanCollectionOnce<T extends ReadOnlyDocument>(
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
  let queryIdentity;
  try {
    queryIdentity = createRisk001ReadQueryIdentity(collection, filter, requestedProjection, pageSize, safetyCeiling);
  } catch {
    throw new Risk001SanitizedError("VALIDATION_FAILED", "Invalid collection identity");
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
  while (rows.length <= exactCount) {
    const pageFilter: ReadOnlyFilter = lastId
      ? Object.keys(filter).length > 0
        ? { $and: [filter, { _id: { $gt: lastId } }] }
        : { _id: { $gt: lastId } }
      : filter;
    const page = await gateway.find<T>(collection, pageFilter, {
      projection: requestedProjection,
      sort: { _id: 1 },
      limit: Math.min(pageSize, safetyCeiling + 1 - rows.length),
    });
    if (page.length === 0) break;
    for (const row of page) {
      const id = readStringId(row);
      if (lastId && id <= lastId) {
        throw new Risk001SanitizedError("READ_FAILED", `Non-deterministic pagination in ${collection}`);
      }
      rows.push(row);
      if (rows.length > safetyCeiling) {
        throw new Risk001SanitizedError("MANUAL_SCOPE_ESCALATION_REQUIRED", `MANUAL_SCOPE_ESCALATION_REQUIRED:${collection}:count_exceeds_safety_ceiling`);
      }
      lastId = id;
    }
  }
  const finalCount = await gateway.countDocuments(collection, filter);
  if (rows.length !== exactCount || finalCount !== exactCount) {
    throw sourceStateChanged(collection);
  }
  const commitment = createRisk001ReadCommitment({
    collection,
    filter,
    projection: requestedProjection,
    pageSize,
    safetyCeiling,
    rows,
    inspectedCount: rows.length,
    matchedCount: exactCount,
  });
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
      filterFingerprint: commitment.filterFingerprint,
      projectionFingerprint: commitment.projectionFingerprint,
      queryIdentityFingerprint: commitment.queryIdentityFingerprint,
      sourceStateFingerprint: commitment.sourceStateFingerprint,
      firstIdentity: commitment.firstIdentity,
      lastIdentity: commitment.lastIdentity,
    }]),
    exceptions: Object.freeze([]),
  };
}

async function allScopeSubjectsExist(
  gateway: ReadOnlyMongoGateway,
  grants: readonly RoleAssignmentScopeGrant[],
  options: Risk001LoaderOptions,
): Promise<boolean> {
  for (const grant of grants) {
    const collection = scopeSubjectCollection(grant);
    if (!collection) continue;
    if (!grant.targetId) return false;
    const subjects = await scanCollection<ReadOnlyDocument>(gateway, collection, { _id: grant.targetId }, { _id: 1 }, { ...options, pageSize: 1 });
    if (subjects.records.length !== 1) return false;
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

function isBundleParentCurrentlyEffective(parent: BundleAssignmentDocument, now: number): boolean {
  return parent.status === "ACTIVE" &&
    (parent.effectiveAt == null || parent.effectiveAt <= now) &&
    (parent.expiresAt == null || parent.expiresAt > now);
}

function bundleOriginMatches(child: RoleAssignmentDocument, parent: BundleAssignmentDocument): boolean {
  return child.bundleOrigin?.bundleAssignmentId === parent._id &&
    child.bundleOrigin.bundleCode === parent.bundleCode &&
    child.bundleOrigin.bundleVersion === parent.bundleVersion;
}

function uniqueDocuments<T extends { readonly _id: string }>(values: readonly T[]): readonly T[] {
  const byId = new Map<string, T>();
  for (const value of values) byId.set(value._id, value);
  return Object.freeze([...byId.values()].sort((left, right) => left._id.localeCompare(right._id)));
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function multisetEquals(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

interface KpiCompletenessEvaluation {
  readonly missingMaterialFields: readonly string[];
  readonly materialIssues: readonly string[];
  readonly materialSummary: Readonly<Record<string, unknown>>;
  readonly parentsExist: boolean;
  readonly recommendedClassification: StaleKpiRecord["sourceClassification"];
}

function classifyKpiRecord(
  document: ReadOnlyDocument & { readonly _id: string },
  kind: StaleKpiRecord["kind"],
  references: readonly string[],
  evaluation: KpiCompletenessEvaluation,
  relatedTalentIds: readonly string[] = [],
): StaleKpiRecord {
  const missingMaterialFields = uniqueSorted(evaluation.missingMaterialFields);
  const materialIssues = uniqueSorted(evaluation.materialIssues);
  const downstreamReferences = uniqueSorted(references);
  const complete = missingMaterialFields.length === 0 && materialIssues.length === 0;
  const sourceClassification = complete && evaluation.parentsExist
    ? "CURRENT_CANONICAL"
    : downstreamReferences.length > 0
      ? "PRESERVE_DUE_TO_DEPENDENCY"
      : evaluation.recommendedClassification;
  return Object.freeze({
    id: document._id,
    kind,
    relatedTalentIds: Object.freeze([...relatedTalentIds]),
    sourceClassification,
    dependencyCount: downstreamReferences.length,
    historicalTruthKnown: complete && evaluation.parentsExist,
    downstreamReferences: Object.freeze(downstreamReferences),
    missingMaterialFields: Object.freeze([...missingMaterialFields].sort()),
    materialIssues: Object.freeze([...materialIssues].sort()),
    materialSummary: Object.freeze({ ...evaluation.materialSummary }),
    boundedExternalDependencyEvidence: "NO_REVENUE_OR_COMMISSION_KPI_ID_REFERENCE_IN_CURRENT_SOURCE",
  });
}

function relatedTalentIds(...values: readonly (string | null | undefined)[]): readonly string[] {
  return Object.freeze(uniqueSorted(values.filter((value): value is string => isNonBlankString(value))));
}

function talentPlanSubjectIds(plan: KpiPlanDocument | undefined): readonly string[] {
  return plan?.subjectType === "TALENT" ? relatedTalentIds(plan.subjectId) : Object.freeze([]);
}

/* Replaced by the domain-owned RISK001 KPI persisted-contract evaluator.
function evaluateKpiPlan(plan: KpiPlanDocument): KpiCompletenessEvaluation {
  const source = asRecord(plan);
  const missing = missingPresent(source, [
    "planCode", "subjectType", "subjectId", "status", "lifecycleStatus", "currencyCode",
    "periodMonth", "periodStartAt", "periodEndAt", "timezone", "actualPolicySnapshot",
    "createdAt", "createdByActorId", "updatedAt", "updatedByActorId",
  ]);
  const issues: string[] = [];
  const conditional: string[] = [];
  if (plan.status === "PUBLISHED") {
    conditional.push("publishedAt", "publishedByActorId", "actualPolicySnapshot");
    if (plan.lifecycleStatus !== "RELEASED_FOR_ALLOCATION" && plan.lifecycleStatus !== "ACTIVE") issues.push("PLAN_STATUS_LIFECYCLE_MISMATCH");
  } else if (plan.status === "FINALIZED") {
    conditional.push("publishedAt", "publishedByActorId", "actualPolicySnapshot", "finalizedAt", "finalizedByActorId", "finalResult");
    if (plan.lifecycleStatus !== "FINALIZED") issues.push("PLAN_STATUS_LIFECYCLE_MISMATCH");
  } else if (plan.status === "ARCHIVED") {
    conditional.push("archivedAt", "archivedByActorId");
    if (plan.lifecycleStatus !== "ARCHIVED") issues.push("PLAN_STATUS_LIFECYCLE_MISMATCH");
  } else if (plan.status === "DRAFT" && plan.lifecycleStatus !== "DRAFT") {
    issues.push("PLAN_STATUS_LIFECYCLE_MISMATCH");
  }
  missing.push(...missingNonNull(source, conditional));
  if (plan.actualPolicySnapshot != null) {
    const snapshot = asRecord(plan.actualPolicySnapshot);
    missing.push(...missingPresent(snapshot, ["timezone", "entryOpenLocalTime", "entryLockLocalTime", "maxDirectEditsPerEntry", "correctionAllowedUntil", "policyVersion", "policySource", "snapshottedAt"], "actualPolicySnapshot."));
  }
  return evaluation(missing, issues, {
    status: plan.status ?? null,
    lifecycleStatus: plan.lifecycleStatus ?? null,
    policySnapshotPresent: plan.actualPolicySnapshot != null,
    publicationLineageComplete: nonNull(source, ["publishedAt", "publishedByActorId"]),
    finalizationLineageComplete: nonNull(source, ["finalizedAt", "finalizedByActorId", "finalResult"]),
    archiveLineageComplete: nonNull(source, ["archivedAt", "archivedByActorId"]),
    optionalFieldsPresent: presentFieldNames(source, ["title", "description", "externalRef"]),
  }, true);
}

function evaluateKpiMetric(metric: KpiMetricDocument, plan: KpiPlanDocument | undefined): KpiCompletenessEvaluation {
  const source = asRecord(metric);
  const missing = missingNonNull(source, [
    "kpiPlanId", "metricCode", "targetValue", "targetValueExact", "allocationMode", "allocationScale",
    "groupRemainderExact", "unit", "rollupMethod", "actualSource", "actualCaptureMode",
    "actualReviewMode", "actualEvidenceMode", "actualPolicyVersion", "createdAt", "updatedAt",
  ]);
  const issues: string[] = [];
  const policySnapshot = plan?.actualPolicySnapshot == null ? undefined : asRecord(plan.actualPolicySnapshot);
  if (policySnapshot?.policyVersion !== undefined && metric.actualPolicyVersion !== policySnapshot.policyVersion) issues.push("PLAN_POLICY_VERSION_LINK_MISMATCH");
  return evaluation(missing, issues, {
    planLinked: Boolean(plan),
    policyModesComplete: nonNull(source, ["actualCaptureMode", "actualReviewMode", "actualEvidenceMode", "actualPolicyVersion"]),
    allocationPolicyComplete: nonNull(source, ["allocationMode", "allocationScale", "groupRemainderExact"]),
    policyVersion: metric.actualPolicyVersion ?? null,
  }, Boolean(plan));
}

function evaluateKpiAllocation(
  allocation: KpiAllocationDocument,
  plan: KpiPlanDocument | undefined,
  allAllocations: readonly KpiAllocationDocument[],
): KpiCompletenessEvaluation {
  const source = asRecord(allocation);
  const missing = missingPresent(source, [
    "kpiPlanId", "subjectType", "subjectId", "groupId", "memberEmploymentProfileId", "memberTalentId",
    "membershipId", "allocationStatus", "lifecycleStatus", "allocationMode", "sourcePlanVersion",
    "allocationVersion", "membershipSnapshotVersion", "eligibleMemberSnapshot", "idempotencyKey",
    "idempotencyFingerprint", "correlationId", "supersedesAllocationId", "correctsAllocationId",
    "allocationStartDate", "allocationEndDate", "targetMetrics", "snapshotMemberDisplayName", "createdAt",
    "createdByActorId", "updatedAt", "updatedByActorId",
  ]);
  missing.push(...missingNonNull(source, ["kpiPlanId", "subjectType", "subjectId", "allocationStatus", "lifecycleStatus", "allocationMode", "sourcePlanVersion", "allocationVersion", "membershipSnapshotVersion", "eligibleMemberSnapshot", "idempotencyKey", "idempotencyFingerprint", "correlationId", "allocationStartDate", "targetMetrics", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId"]));
  const issues: string[] = [];
  const lifecycle = allocation.lifecycleStatus ?? allocation.allocationStatus;
  const submitStates = new Set(["SUBMITTED", "CHANGES_REQUESTED", "APPROVED", "PUBLISHED"]);
  if (submitStates.has(lifecycle ?? "")) missing.push(...missingNonNull(source, ["submittedAt", "submittedByActorId"]));
  if (lifecycle === "APPROVED" || lifecycle === "PUBLISHED") missing.push(...missingNonNull(source, ["approvedAt", "approvedByActorId"]));
  if (lifecycle === "CHANGES_REQUESTED" || allocation.allocationStatus === "REJECTED") missing.push(...missingNonNull(source, ["rejectedAt", "rejectedByActorId", "rejectionReason"]));
  if (lifecycle === "PUBLISHED" || allocation.allocationStatus === "PUBLISHED") missing.push(...missingNonNull(source, ["publishedAt", "publishedByActorId"]));
  if (lifecycle === "SUPERSEDED" || allocation.allocationStatus === "CLOSED") missing.push(...missingNonNull(source, ["closedAt"]));
  const predecessorIds = [allocation.supersedesAllocationId, allocation.correctsAllocationId].filter((id): id is string => Boolean(id));
  if (predecessorIds.some((id) => !allAllocations.some((candidate) => candidate._id === id))) issues.push("BROKEN_ALLOCATION_PREDECESSOR_LINK");
  if (lifecycle === "CORRECTED") {
    missing.push(...missingNonNull(source, ["supersedesAllocationId", "correctsAllocationId", "note"]));
  }
  if (lifecycle === "SUPERSEDED" && !allAllocations.some((candidate) => candidate.supersedesAllocationId === allocation._id || candidate.correctsAllocationId === allocation._id)) issues.push("MISSING_ALLOCATION_SUCCESSOR_LINK");
  return evaluation(missing, issues, {
    allocationStatus: allocation.allocationStatus ?? null,
    lifecycleStatus: allocation.lifecycleStatus ?? null,
    sourcePlanVersion: allocation.sourcePlanVersion ?? null,
    allocationVersion: allocation.allocationVersion ?? null,
    membershipSnapshotPresent: allocation.membershipSnapshotVersion != null && allocation.eligibleMemberSnapshot != null,
    submitLineageComplete: nonNull(source, ["submittedAt", "submittedByActorId"]),
    approvalLineageComplete: nonNull(source, ["approvedAt", "approvedByActorId"]),
    rejectionLineageComplete: nonNull(source, ["rejectedAt", "rejectedByActorId", "rejectionReason"]),
    publicationLineageComplete: nonNull(source, ["publishedAt", "publishedByActorId"]),
    correctionLinkageComplete: predecessorIds.length === 0 || issues.length === 0,
    optionalFieldsPresent: presentFieldNames(source, ["note", "approvalNote"]),
  }, Boolean(plan));
}

function evaluateKpiActual(
  actual: KpiActualDocument,
  plan: KpiPlanDocument | undefined,
  allocation: KpiAllocationDocument | undefined,
  metric: KpiMetricDocument | undefined,
  corrections: readonly KpiCorrectionDocument[],
): KpiCompletenessEvaluation {
  const source = asRecord(actual);
  const missing = missingPresent(source, [
    "kpiPlanId", "allocationId", "memberEmploymentProfileId", "memberTalentId", "metricCode", "actualDate",
    "actualValue", "effectiveValue", "editCount", "correctionCount",
    "latestCorrectionId", "lifecycleStatus", "entryVersion", "captureMode", "aggregationMethod", "reviewMode",
    "evidenceMode", "policyVersion", "sourceFingerprint", "acceptedInputVersions", "derivationVersion", "createdAt",
    "createdByActorId", "updatedAt", "updatedByActorId", "lastEditedAt", "lastEditedByActorId",
  ]);
  missing.push(...missingNonNull(source, ["kpiPlanId", "allocationId", "metricCode", "actualDate", "actualValue", "effectiveValue", "editCount", "correctionCount", "lifecycleStatus", "entryVersion", "captureMode", "aggregationMethod", "reviewMode", "evidenceMode", "policyVersion", "acceptedInputVersions", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId"]));
  const issues: string[] = [];
  if (["ACCEPTED", "CORRECTED", "LOCKED"].includes(actual.lifecycleStatus ?? "")) missing.push(...missingNonNull(source, ["acceptedValue", "acceptedVersion"]));
  if ((actual.editCount ?? 0) > 0) missing.push(...missingNonNull(source, ["lastEditedAt", "lastEditedByActorId"]));
  if (actual.captureMode === "IMPORTED_SOURCE" || actual.captureMode === "DERIVED") missing.push(...missingNonNull(source, ["sourceFingerprint"]));
  if (actual.captureMode === "DERIVED") {
    missing.push(...missingNonNull(source, ["derivationVersion"]));
    if (!Array.isArray(actual.acceptedInputVersions) || actual.acceptedInputVersions.length === 0) issues.push("DERIVED_ACCEPTED_INPUT_LINEAGE_EMPTY");
  }
  if ((actual.correctionCount ?? 0) > 0) missing.push(...missingNonNull(source, ["latestCorrectionId"]));
  if (actual.latestCorrectionId && !corrections.some((candidate) => candidate._id === actual.latestCorrectionId && candidate.actualEntryId === actual._id)) issues.push("BROKEN_LATEST_CORRECTION_LINK");
  if (metric) {
    if (actual.captureMode !== metric.actualCaptureMode || actual.aggregationMethod !== metric.rollupMethod || actual.reviewMode !== metric.actualReviewMode || actual.evidenceMode !== metric.actualEvidenceMode || actual.policyVersion !== metric.actualPolicyVersion) issues.push("ACTUAL_POLICY_SNAPSHOT_MISMATCH");
  }
  return evaluation(missing, issues, {
    lifecycleStatus: actual.lifecycleStatus ?? null,
    entryVersion: actual.entryVersion ?? null,
    acceptedVersion: actual.acceptedVersion ?? null,
    captureMode: actual.captureMode ?? null,
    policyVersion: actual.policyVersion ?? null,
    acceptedLineageComplete: nonNull(source, ["acceptedValue", "acceptedVersion"]),
    sourceLineageRepresented: hasOwn(source, "sourceFingerprint"),
    acceptedInputLineageRepresented: hasOwn(source, "acceptedInputVersions"),
    derivationLineageRepresented: hasOwn(source, "derivationVersion"),
    lastEditorLineageComplete: (actual.editCount ?? 0) === 0 || nonNull(source, ["lastEditedAt", "lastEditedByActorId"]),
    correctionLinkageComplete: !actual.latestCorrectionId || !issues.includes("BROKEN_LATEST_CORRECTION_LINK"),
    policyDependencyComplete: Boolean(metric),
  }, Boolean(plan && allocation && metric));
}

function evaluateKpiCorrection(
  correction: KpiCorrectionDocument,
  plan: KpiPlanDocument | undefined,
  allocation: KpiAllocationDocument | undefined,
  actual: KpiActualDocument | undefined,
): KpiCompletenessEvaluation {
  const source = asRecord(correction);
  const missing = missingNonNull(source, [
    "actualEntryId", "kpiPlanId", "allocationId", "metricCode", "actualDate", "previousValue", "correctedValue",
    "previousEntryVersion", "replacementEntryVersion", "replacementLifecycleStatus", "requiresReview",
    "idempotencyKey", "payloadFingerprint", "reason", "correctedByActorId", "correctedAt", "createdAt",
  ]);
  const issues: string[] = [];
  if (actual && (actual.kpiPlanId !== correction.kpiPlanId || actual.allocationId !== correction.allocationId)) issues.push("CORRECTION_PARENT_LINEAGE_MISMATCH");
  if (correction.requiresReview === true && correction.replacementLifecycleStatus !== "UNDER_REVIEW") issues.push("CORRECTION_REVIEW_LINEAGE_MISMATCH");
  if (correction.requiresReview === false && correction.replacementLifecycleStatus !== "CORRECTED") issues.push("CORRECTION_REVIEW_LINEAGE_MISMATCH");
  return evaluation(missing, issues, {
    replacementLifecycleStatus: correction.replacementLifecycleStatus ?? null,
    requiresReview: correction.requiresReview ?? null,
    versionLineageComplete: nonNull(source, ["previousEntryVersion", "replacementEntryVersion"]),
    actorReasonLineageComplete: nonNull(source, ["correctedByActorId", "reason", "correctedAt"]),
    idempotencyLineageComplete: nonNull(source, ["idempotencyKey", "payloadFingerprint"]),
    parentDependencyComplete: Boolean(plan && allocation && actual),
  }, Boolean(plan && allocation && actual));
}

function evaluateKpiOperation(operation: KpiOperationDocument, plan: KpiPlanDocument | undefined): KpiCompletenessEvaluation {
  const source = asRecord(operation);
  const missing = missingPresent(source, ["kpiPlanId", "actorId", "operation", "idempotencyKey", "payloadFingerprint", "result", "createdAt", "completedAt"]);
  missing.push(...missingNonNull(source, ["kpiPlanId", "actorId", "operation", "idempotencyKey", "payloadFingerprint", "createdAt"]));
  const issues: string[] = [];
  const resultPresent = operation.result != null;
  const completed = operation.completedAt != null;
  if (resultPresent !== completed) issues.push("OPERATION_RESULT_LIFECYCLE_MISMATCH");
  return evaluation(missing, issues, {
    operation: operation.operation ?? null,
    operationStatus: completed ? "COMPLETED" : "PENDING",
    resultPresent,
    actorPresent: operation.actorId != null,
    idempotencyLineageComplete: nonNull(source, ["idempotencyKey", "payloadFingerprint"]),
    parentDependencyComplete: Boolean(plan),
  }, Boolean(plan));
}

function evaluateKpiExcuse(
  excuse: KpiExcuseDocument,
  plan: KpiPlanDocument | undefined,
  allocation: KpiAllocationDocument | undefined,
  metric: KpiMetricDocument | undefined,
): KpiCompletenessEvaluation {
  const source = asRecord(excuse);
  const missing = missingPresent(source, ["kpiPlanId", "allocationId", "metricCode", "actualDate", "status", "reasonCode", "reasonText", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId"]);
  missing.push(...missingNonNull(source, ["kpiPlanId", "allocationId", "metricCode", "actualDate", "status", "reasonCode", "reasonText", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId"]));
  if (excuse.deletedAt != null) missing.push(...missingNonNull(source, ["deletedByActorId"]));
  const issues: string[] = [];
  if (excuse.status !== "EXCUSED" && excuse.status !== "NOT_REQUIRED") issues.push("EXCUSE_STATUS_UNSUPPORTED");
  return evaluation(missing, issues, {
    status: excuse.status ?? null,
    deletionState: excuse.deletedAt == null ? "ACTIVE" : "DELETED",
    deletionLineageComplete: excuse.deletedAt == null || excuse.deletedByActorId != null,
    actorReasonLineageComplete: nonNull(source, ["createdByActorId", "reasonCode", "reasonText"]),
    slotDependencyComplete: Boolean(plan && allocation && metric),
  }, Boolean(plan && allocation && metric));
}

function evaluation(
  missingMaterialFields: readonly string[],
  materialIssues: readonly string[],
  materialSummary: Readonly<Record<string, unknown>>,
  parentsExist: boolean,
): KpiCompletenessEvaluation {
  return { missingMaterialFields, materialIssues, materialSummary, parentsExist };
}

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function hasOwn(source: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined;
}

function missingPresent(source: Record<string, unknown>, fields: readonly string[], prefix = ""): string[] {
  return fields.filter((field) => !hasOwn(source, field)).map((field) => `${prefix}${field}`);
}

function missingNonNull(source: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields.filter((field) => !hasOwn(source, field) || source[field] === null);
}

function nonNull(source: Record<string, unknown>, fields: readonly string[]): boolean {
  return missingNonNull(source, fields).length === 0;
}

function presentFieldNames(source: Record<string, unknown>, fields: readonly string[]): readonly string[] {
  return Object.freeze(fields.filter((field) => hasOwn(source, field)).sort());
}
*/

function evaluateKpiPlan(plan: KpiPlanDocument): KpiCompletenessEvaluation {
  return toCompleteness(evaluateKpiPersistedRecord("PLAN", plan, { parentReferencesValid: true }));
}

function evaluateKpiMetric(metric: KpiMetricDocument, plan: KpiPlanDocument | undefined): KpiCompletenessEvaluation {
  return toCompleteness(evaluateKpiPersistedRecord("METRIC", metric, {
    parentReferencesValid: Boolean(plan),
    dependencyEvidence: plan ? ["KPI_PLAN"] : [],
    planPolicyVersion: typeof (plan?.actualPolicySnapshot as { policyVersion?: unknown } | null)?.policyVersion === "string"
      ? (plan?.actualPolicySnapshot as { policyVersion: string }).policyVersion : null,
  }));
}

function evaluateKpiAllocation(allocation: KpiAllocationDocument, plan: KpiPlanDocument | undefined, allAllocations: readonly KpiAllocationDocument[]): KpiCompletenessEvaluation {
  const predecessorIds = [allocation.supersedesAllocationId, allocation.correctsAllocationId].filter((id): id is string => Boolean(id));
  return toCompleteness(evaluateKpiPersistedRecord("ALLOCATION", allocation, {
    parentReferencesValid: Boolean(plan) && predecessorIds.every((id) => allAllocations.some((candidate) => candidate._id === id)),
    dependencyEvidence: plan ? ["KPI_PLAN"] : [],
    predecessorExists: predecessorIds.length === 0 || predecessorIds.every((id) => allAllocations.some((candidate) => candidate._id === id)),
    successorExists: allocation.lifecycleStatus !== "SUPERSEDED" || allAllocations.some((candidate) => candidate.supersedesAllocationId === allocation._id || candidate.correctsAllocationId === allocation._id),
  }));
}

function evaluateKpiActual(actual: KpiActualDocument, plan: KpiPlanDocument | undefined, allocation: KpiAllocationDocument | undefined, metric: KpiMetricDocument | undefined, corrections: readonly KpiCorrectionDocument[]): KpiCompletenessEvaluation {
  return toCompleteness(evaluateKpiPersistedRecord("ACTUAL", actual, {
    parentReferencesValid: Boolean(plan && allocation && metric),
    dependencyEvidence: [plan && "KPI_PLAN", allocation && "KPI_ALLOCATION", metric && "KPI_TARGET_METRIC"].filter((value): value is string => Boolean(value)),
    latestCorrectionExists: !actual.latestCorrectionId || corrections.some((candidate) => candidate._id === actual.latestCorrectionId && candidate.actualEntryId === actual._id),
    metricPolicy: metric ? { captureMode: metric.actualCaptureMode, aggregationMethod: metric.rollupMethod, reviewMode: metric.actualReviewMode, evidenceMode: metric.actualEvidenceMode, policyVersion: metric.actualPolicyVersion } : null,
  }));
}

function evaluateKpiCorrection(correction: KpiCorrectionDocument, plan: KpiPlanDocument | undefined, allocation: KpiAllocationDocument | undefined, actual: KpiActualDocument | undefined): KpiCompletenessEvaluation {
  return toCompleteness(evaluateKpiPersistedRecord("CORRECTION", correction, {
    parentReferencesValid: Boolean(plan && allocation && actual) && actual?.kpiPlanId === correction.kpiPlanId && actual?.allocationId === correction.allocationId,
    dependencyEvidence: [plan && "KPI_PLAN", allocation && "KPI_ALLOCATION", actual && "KPI_ACTUAL"].filter((value): value is string => Boolean(value)),
  }));
}

function evaluateKpiOperation(operation: KpiOperationDocument, plan: KpiPlanDocument | undefined): KpiCompletenessEvaluation {
  return toCompleteness(evaluateKpiPersistedRecord("ALLOCATION_OPERATION", operation, { parentReferencesValid: Boolean(plan), dependencyEvidence: plan ? ["KPI_PLAN"] : [] }));
}

function evaluateKpiExcuse(excuse: KpiExcuseDocument, plan: KpiPlanDocument | undefined, allocation: KpiAllocationDocument | undefined, metric: KpiMetricDocument | undefined): KpiCompletenessEvaluation {
  return toCompleteness(evaluateKpiPersistedRecord("SLOT_EXCUSE", excuse, { parentReferencesValid: Boolean(plan && allocation && metric), dependencyEvidence: [plan && "KPI_PLAN", allocation && "KPI_ALLOCATION", metric && "KPI_TARGET_METRIC"].filter((value): value is string => Boolean(value)) }));
}

function toCompleteness(evaluation: KpiPersistedEvaluation): KpiCompletenessEvaluation {
  return {
    missingMaterialFields: [...evaluation.missingAlwaysRequiredFields, ...evaluation.missingStateRequiredFields],
    materialIssues: [...evaluation.contradictoryFields, ...evaluation.invalidReferences, ...(evaluation.enumValidity ? [] : ["UNSUPPORTED_ENUM"]), ...(evaluation.statusLifecyclePairValidity ? [] : ["STATUS_LIFECYCLE_PAIR_INVALID"]), ...(evaluation.policyVersionCompleteness ? [] : ["POLICY_VERSION_INCOMPLETE"])],
    materialSummary: Object.freeze({ ...evaluation.materialSummary, family: evaluation.family, contractVersion: evaluation.contractVersion, recommendedClassification: evaluation.recommendedClassification, dependencyEvidence: evaluation.dependencyEvidence }),
    parentsExist: evaluation.invalidReferences.length === 0,
    recommendedClassification: evaluation.recommendedClassification,
  };
}

async function verifyCapturedReadSet(
  gateway: ReadOnlyMongoGateway,
  options: Risk001LoaderOptions,
  capture: ReadSetCapture,
): Promise<void> {
  const scans = await Promise.all([...capture.scans.values()]);
  for (const captured of scans.sort((left, right) => left.key.localeCompare(right.key))) {
    const verified = await scanCollectionOnce<ReadOnlyDocument>(
      gateway,
      captured.collection,
      captured.filter,
      captured.projection,
      captured.options,
    );
    assertSameSourceState(captured.result, verified, captured.collection);
  }
}

function assertSameSourceState<T>(captured: LoaderResult<T>, verified: LoaderResult<T>, collection: string): void {
  const first = captured.evidence[0];
  const second = verified.evidence[0];
  if (!first || !second || verifyRisk001ReadCommitment(first, second)) throw sourceStateChanged(collection);
}

function sourceStateChanged(collection: string): Risk001SanitizedError {
  return new Risk001SanitizedError("READ_FAILED", `SOURCE_STATE_CHANGED_DURING_DRY_RUN:${collection}`);
}

function scanKey(
  collection: string,
  filter: ReadOnlyFilter,
  requestedProjection: ReadOnlyProjection,
  options: Risk001LoaderOptions,
): string {
  return createRisk001ReadQueryIdentity(
    collection,
    filter,
    requestedProjection,
    options.pageSize ?? RISK001_DEFAULT_PAGE_SIZE,
    options.safetyCeiling ?? RISK001_DEFAULT_SAFETY_CEILING,
  ).queryIdentityFingerprint;
}

function projection(...fields: readonly string[]): ReadOnlyProjection {
  return Object.freeze(
    Object.fromEntries(fields.map((field) => [field, 1 as const])),
  ) as ReadOnlyProjection;
}

function sortedStrings(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze(uniqueSorted(values ?? []));
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const canonicalLeft = uniqueSorted(left);
  const canonicalRight = uniqueSorted(right);
  return canonicalLeft.length === canonicalRight.length && canonicalLeft.every((value, index) => value === canonicalRight[index]);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidOptionalTimestamp(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "number" && Number.isFinite(value));
}

function invalidAssignmentSourceReasons(assignment: RoleAssignmentDocument): readonly string[] {
  const reasons = [
    ...(!isNonBlankString(assignment._id) ? ["ASSIGNMENT_ID_MISSING_OR_INVALID"] : []),
    ...(!isNonBlankString(assignment.roleId) ? ["ASSIGNMENT_ROLE_ID_MISSING_OR_INVALID"] : []),
    ...(!isNonBlankString(assignment.userId) ? ["ASSIGNMENT_USER_ID_MISSING_OR_INVALID"] : []),
    ...(!["ACTIVE", "REVOKED"].includes(assignment.state) ? ["ASSIGNMENT_STATE_MISSING_OR_INVALID"] : []),
    ...(!isValidOptionalTimestamp(assignment.effectiveAt) ? ["ASSIGNMENT_EFFECTIVE_AT_INVALID"] : []),
    ...(!isValidOptionalTimestamp(assignment.expiresAt) ? ["ASSIGNMENT_EXPIRES_AT_INVALID"] : []),
    ...(!isValidOptionalTimestamp(assignment.revokedAt) ? ["ASSIGNMENT_REVOKED_AT_INVALID"] : []),
    ...(typeof assignment.effectiveAt === "number" && typeof assignment.expiresAt === "number" && assignment.expiresAt <= assignment.effectiveAt
      ? ["ASSIGNMENT_EFFECTIVE_WINDOW_INVALID"] : []),
  ];
  return Object.freeze(uniqueSorted(reasons));
}

function isValidTalentMembership(
  membership: TalentGroupMemberDocument,
  knownMembershipStatuses: ReadonlySet<string>,
): boolean {
  return isNonBlankString(membership._id) &&
    isNonBlankString(membership.groupId) &&
    isNonBlankString(membership.talentId) &&
    isNonBlankString(membership.membershipStatus) &&
    knownMembershipStatuses.has(membership.membershipStatus) &&
    isValidOptionalTimestamp(membership.joinedAt) &&
    isValidOptionalTimestamp(membership.leftAt) &&
    !(typeof membership.joinedAt === "number" && typeof membership.leftAt === "number" && membership.leftAt < membership.joinedAt);
}

function isTalentMembershipCurrentlyEffective(
  membership: TalentGroupMemberDocument,
  observedAt: number,
): boolean {
  return (membership.leftAt === undefined || membership.leftAt === null || membership.leftAt > observedAt) &&
    (membership.joinedAt === undefined || membership.joinedAt === null || membership.joinedAt <= observedAt);
}

function duplicateSemanticMembershipCount(
  memberships: readonly TalentGroupMemberDocument[],
): number {
  const counts = new Map<string, number>();
  for (const membership of memberships) {
    const key = `${membership.talentId}\u0000${membership.groupId}\u0000${membership.membershipStatus}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function legacyDimension(
  id: string,
  reasonCode: string,
  evidenceIds: readonly string[],
): LegacyDependencyDimension {
  const canonicalEvidence = uniqueSorted(evidenceIds);
  return Object.freeze({
    id,
    reasonCode,
    status: canonicalEvidence.length > 0 ? "BLOCKED" : "CLEAR",
    evidenceIds: Object.freeze(canonicalEvidence),
  });
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
    byKey.set(evidence.queryIdentityFingerprint, evidence);
  }
  return [...byKey.values()].sort((a, b) => a.queryIdentityFingerprint.localeCompare(b.queryIdentityFingerprint));
}

function loaderOutcome(
  areaId: Risk001AssessmentAreaId,
  source: LoaderResult<unknown>,
): Risk001LoaderOutcome {
  return Object.freeze({
    areaId,
    status: source.exceptions.length === 0 ? "COMPLETED" : "INCOMPLETE",
    recordCount: source.records.length,
    evidenceCount: source.evidence.length,
    exceptionCount: source.exceptions.length,
    queryIdentityFingerprints: Object.freeze(uniqueSorted(source.evidence.map((item) => item.queryIdentityFingerprint))),
    sourceStateFingerprints: Object.freeze(uniqueSorted(source.evidence.map((item) => item.sourceStateFingerprint))),
  });
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
import { KPI_COARSE_SCOPE_COMPATIBILITY_INVENTORY } from "@core/permission/permission.guard";
import { isPeopleReadinessEmploymentStatusOperational } from "@modules/people-readiness/domain/people-readiness.types";
