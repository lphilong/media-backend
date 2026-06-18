import { RoleValidationError } from "./role.errors";

export const ROLE_ASSIGNMENT_SCOPE_TYPES = [
  "self",
  "global",
  "managedTalentGroup",
  "managedOrgUnit",
  "assignedPlatformAccount",
  "financeGlobal",
  "financePeriod",
  "contractPortfolio",
  "assignedEvent",
  "assignedStudioResource",
  "payrollPeriod",
  "attendancePeriodOrg",
] as const;

export type RoleAssignmentScopeType =
  (typeof ROLE_ASSIGNMENT_SCOPE_TYPES)[number];

export interface RoleAssignmentScopeGrant {
  readonly scopeType: RoleAssignmentScopeType;
  readonly targetId?: string;
  readonly targetKey?: string;
  readonly periodKey?: string;
}

const SCOPE_TYPE_SET = new Set<string>(ROLE_ASSIGNMENT_SCOPE_TYPES);
const TARGET_ID_SCOPES = new Set<RoleAssignmentScopeType>([
  "managedTalentGroup",
  "managedOrgUnit",
  "assignedPlatformAccount",
  "assignedEvent",
  "assignedStudioResource",
]);
const PERIOD_SCOPES = new Set<RoleAssignmentScopeType>([
  "financePeriod",
  "payrollPeriod",
]);

export function normalizeRoleAssignmentScopeGrants(
  value: unknown,
  field = "structuredScopeGrants",
): readonly RoleAssignmentScopeGrant[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new RoleValidationError(`${field} must be an array`);
  }

  const normalized = value.map((grant, index) =>
    normalizeScopeGrant(grant, `${field}[${index}]`),
  );
  const byFingerprint = new Map(
    normalized.map((grant) => [scopeGrantKey(grant), grant]),
  );
  const deduplicated = [...byFingerprint.values()].sort((left, right) =>
    scopeGrantKey(left).localeCompare(scopeGrantKey(right)),
  );

  return deduplicated.length > 0 ? Object.freeze(deduplicated) : undefined;
}

export function buildRoleAssignmentScopeFingerprint(
  grants: readonly RoleAssignmentScopeGrant[] | undefined,
): string {
  if (!grants || grants.length === 0) {
    return "scope:v1:legacy";
  }

  return `scope:v1:${grants.map(scopeGrantKey).sort().join(";")}`;
}

function normalizeScopeGrant(
  value: unknown,
  field: string,
): RoleAssignmentScopeGrant {
  if (!isStrictPlainObject(value)) {
    throw new RoleValidationError(`${field} must be a plain object`);
  }

  const unknownFields = Object.keys(value).filter(
    (key) =>
      key !== "scopeType" &&
      key !== "targetId" &&
      key !== "targetKey" &&
      key !== "periodKey",
  );
  if (unknownFields.length > 0) {
    unknownFields.sort();
    throw new RoleValidationError(
      `${field} contains unsupported field(s): ${unknownFields.join(", ")}`,
    );
  }

  const scopeType = normalizeScopeType(value.scopeType, `${field}.scopeType`);
  const targetId = normalizeOptionalKey(value.targetId, `${field}.targetId`);
  const targetKey = normalizeOptionalKey(value.targetKey, `${field}.targetKey`);
  const periodKey = normalizeOptionalPeriodKey(
    value.periodKey,
    `${field}.periodKey`,
  );

  if (scopeType === "self" || scopeType === "global" || scopeType === "financeGlobal") {
    assertNoTargets(scopeType, targetId, targetKey, periodKey, field);
    return Object.freeze({ scopeType });
  }

  if (TARGET_ID_SCOPES.has(scopeType)) {
    if (!targetId) {
      throw new RoleValidationError(
        `${field}.targetId is required for ${scopeType}`,
      );
    }
    assertAbsent(targetKey, `${field}.targetKey`, scopeType);
    assertAbsent(periodKey, `${field}.periodKey`, scopeType);
    return Object.freeze({ scopeType, targetId });
  }

  if (PERIOD_SCOPES.has(scopeType)) {
    if (!periodKey) {
      throw new RoleValidationError(
        `${field}.periodKey is required for ${scopeType}`,
      );
    }
    assertAbsent(targetId, `${field}.targetId`, scopeType);
    assertAbsent(targetKey, `${field}.targetKey`, scopeType);
    return Object.freeze({ scopeType, periodKey });
  }

  if (scopeType === "contractPortfolio") {
    if (!targetKey) {
      throw new RoleValidationError(
        `${field}.targetKey is required for contractPortfolio`,
      );
    }
    assertAbsent(targetId, `${field}.targetId`, scopeType);
    assertAbsent(periodKey, `${field}.periodKey`, scopeType);
    return Object.freeze({ scopeType, targetKey });
  }

  if (!targetId || !periodKey) {
    throw new RoleValidationError(
      `${field}.targetId and ${field}.periodKey are required for attendancePeriodOrg`,
    );
  }
  assertAbsent(targetKey, `${field}.targetKey`, scopeType);
  return Object.freeze({ scopeType, targetId, periodKey });
}

function normalizeScopeType(
  value: unknown,
  field: string,
): RoleAssignmentScopeType {
  if (typeof value !== "string" || !SCOPE_TYPE_SET.has(value.trim())) {
    throw new RoleValidationError(
      `${field} must be one of ${ROLE_ASSIGNMENT_SCOPE_TYPES.join(", ")}`,
    );
  }
  return value.trim() as RoleAssignmentScopeType;
}

function normalizeOptionalKey(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new RoleValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeOptionalPeriodKey(
  value: unknown,
  field: string,
): string | undefined {
  const normalized = normalizeOptionalKey(value, field);
  if (normalized && !/^\d{4}-(0[1-9]|1[0-2])$/u.test(normalized)) {
    throw new RoleValidationError(`${field} must use YYYY-MM`);
  }
  return normalized;
}

function assertNoTargets(
  scopeType: RoleAssignmentScopeType,
  targetId: string | undefined,
  targetKey: string | undefined,
  periodKey: string | undefined,
  field: string,
): void {
  if (targetId || targetKey || periodKey) {
    throw new RoleValidationError(
      `${field} must not include a target for ${scopeType}`,
    );
  }
}

function assertAbsent(
  value: string | undefined,
  field: string,
  scopeType: RoleAssignmentScopeType,
): void {
  if (value !== undefined) {
    throw new RoleValidationError(`${field} is not supported for ${scopeType}`);
  }
}

function scopeGrantKey(grant: RoleAssignmentScopeGrant): string {
  return [
    encodeURIComponent(grant.scopeType),
    grant.targetId ? `targetId=${encodeURIComponent(grant.targetId)}` : "",
    grant.targetKey ? `targetKey=${encodeURIComponent(grant.targetKey)}` : "",
    grant.periodKey ? `periodKey=${encodeURIComponent(grant.periodKey)}` : "",
  ]
    .filter(Boolean)
    .join("|");
}

function isStrictPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}
