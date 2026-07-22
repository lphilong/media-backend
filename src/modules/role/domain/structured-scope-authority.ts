import { RoleAssignmentScopeGrant } from "./role-assignment-scope";
import { isRoleAssignmentCurrentlyEffective } from "./role-assignment-lifecycle";
import { UserRoleAssignmentRecord } from "./role.types";
import {
  BreakGlassActivationRecord,
  isBreakGlassActivationEffective,
} from "./break-glass";
import { buildCurrentRoleAssignmentPolicy } from "./sensitive-access-policy";
import { buildRoleAssignmentScopeFingerprint } from "./role-assignment-scope";

export type StructuredScopeAuthorityMode =
  "STRUCTURED_SCOPE_REQUIRED" | "LEGACY_PERMISSION_ONLY_COMPATIBILITY";

export interface StructuredScopeAuthorityRole {
  readonly id: string;
  readonly state: "ACTIVE" | string;
  readonly code?: string | null;
  readonly templateCode?: string | null;
  readonly permissions: readonly string[];
}

export interface StructuredScopeAuthorityAssignment {
  readonly assignment: UserRoleAssignmentRecord;
  readonly role: StructuredScopeAuthorityRole | null;
}

export interface StructuredScopeAuthorityReader {
  listByUserId(
    userId: string,
  ): Promise<readonly StructuredScopeAuthorityAssignment[]>;
  listBreakGlassByUserId?(
    userId: string,
    now: number,
  ): Promise<readonly BreakGlassActivationRecord[]>;
}

export interface StructuredScopeAuthorityCheck {
  readonly userId: string;
  readonly permission: string;
  readonly scope: RoleAssignmentScopeGrant;
  readonly mode?: StructuredScopeAuthorityMode;
  readonly now?: number;
}

export interface StructuredScopeAuthorityGrantQuery {
  readonly userId: string;
  readonly permission: string;
  readonly now?: number;
}

export interface StructuredScopeAuthoritySnapshot {
  readonly userId: string;
  readonly capturedAt: number;
  hasAuthority(
    permission: string,
    scope: RoleAssignmentScopeGrant,
    mode?: StructuredScopeAuthorityMode,
  ): boolean;
  listAuthorizedScopeGrants(
    permission: string,
  ): readonly RoleAssignmentScopeGrant[];
}

export class StructuredScopeAuthorityService {
  constructor(
    private readonly reader: StructuredScopeAuthorityReader,
    private readonly clock: () => number = Date.now,
  ) {}

  async createSnapshot(
    userIdInput: string,
    now: number = this.clock(),
  ): Promise<StructuredScopeAuthoritySnapshot> {
    const userId = normalizeRequiredText(userIdInput);
    if (!userId) return emptySnapshot(userId, now);
    const [records, activations] = await Promise.all([
      this.reader.listByUserId(userId),
      this.listBreakGlass(userId, now),
    ]);
    const active = records.filter(({ assignment, role }) =>
      roleAssignmentGrantsCurrentAuthority(assignment, role, now),
    );
    const currentActivations = activations.filter((activation) =>
      isBreakGlassActivationEffective(activation, now),
    );
    return Object.freeze({
      userId,
      capturedAt: now,
      hasAuthority(
        permission: string,
        scope: RoleAssignmentScopeGrant,
        mode: StructuredScopeAuthorityMode = "STRUCTURED_SCOPE_REQUIRED",
      ): boolean {
        return (
          active.some(({ assignment, role }) => {
            if (!role?.permissions.includes(permission)) return false;
            return (
              mode === "LEGACY_PERMISSION_ONLY_COMPATIBILITY" ||
              (assignment.structuredScopeGrants ?? []).some((grant) =>
                scopeGrantMatches(grant, scope),
              )
            );
          }) ||
          currentActivations.some(
            (activation) =>
              activation.permissions.includes(permission) &&
              activation.structuredScopeGrants.some((grant) =>
                scopeGrantMatches(grant, scope),
              ),
          )
        );
      },
      listAuthorizedScopeGrants(
        permission: string,
      ): readonly RoleAssignmentScopeGrant[] {
        const grants = active.flatMap(({ assignment, role }) =>
          role?.permissions.includes(permission)
            ? (assignment.structuredScopeGrants ?? [])
            : [],
        );
        const breakGlass = currentActivations.flatMap((activation) =>
          activation.permissions.includes(permission)
            ? activation.structuredScopeGrants
            : [],
        );
        return uniqueGrants([...grants, ...breakGlass]);
      },
    });
  }

  async hasAuthority(input: StructuredScopeAuthorityCheck): Promise<boolean> {
    const userId = normalizeRequiredText(input.userId);
    const permission = normalizeRequiredText(input.permission);
    if (!userId || !permission) {
      return false;
    }
    const mode = input.mode ?? "STRUCTURED_SCOPE_REQUIRED";
    const now = input.now ?? this.clock();
    const records = await this.reader.listByUserId(userId);

    const assignmentAuthority = records.some(({ assignment, role }) => {
      if (!role || role.state !== "ACTIVE") {
        return false;
      }

      const currentPolicy = buildCurrentRoleAssignmentPolicy({
        roleCode: role.code,
        roleTemplateCode: role.templateCode,
        permissions: role.permissions,
        structuredScopeGrants: assignment.structuredScopeGrants,
        effectiveAt: assignment.effectiveAt,
        durableReviewDeadline:
          assignment.lifecycle?.reviewDeadline ?? assignment.reviewAt,
        durableRiskTier: assignment.lifecycle?.riskTier ?? null,
        storedPermissionFingerprint:
          assignment.lifecycle?.permissionFingerprint ?? null,
        assessedAt: now,
        scopeFingerprint:
          assignment.scopeFingerprint ??
          buildRoleAssignmentScopeFingerprint(assignment.structuredScopeGrants),
      });
      if (!isRoleAssignmentCurrentlyEffective(assignment, now, currentPolicy)) {
        return false;
      }

      if (!role.permissions.includes(permission)) {
        return false;
      }

      if (mode === "LEGACY_PERMISSION_ONLY_COMPATIBILITY") {
        return true;
      }

      return (assignment.structuredScopeGrants ?? []).some((grant) =>
        scopeGrantMatches(grant, input.scope),
      );
    });
    if (assignmentAuthority) return true;

    const activations = await this.listBreakGlass(userId, now);
    return activations.some(
      (activation) =>
        isBreakGlassActivationEffective(activation, now) &&
        activation.permissions.includes(permission) &&
        activation.structuredScopeGrants.some((grant) =>
          scopeGrantMatches(grant, input.scope),
        ),
    );
  }

  async listAuthorizedScopeGrants(
    input: StructuredScopeAuthorityGrantQuery,
  ): Promise<readonly RoleAssignmentScopeGrant[]> {
    const userId = normalizeRequiredText(input.userId);
    const permission = normalizeRequiredText(input.permission);
    if (!userId || !permission) {
      return [];
    }
    const now = input.now ?? this.clock();
    const records = await this.reader.listByUserId(userId);
    const grants = records.flatMap(({ assignment, role }) => {
      const currentPolicy = role
        ? buildCurrentRoleAssignmentPolicy({
            roleCode: role.code,
            roleTemplateCode: role.templateCode,
            permissions: role.permissions,
            structuredScopeGrants: assignment.structuredScopeGrants,
            effectiveAt: assignment.effectiveAt,
            durableReviewDeadline:
              assignment.lifecycle?.reviewDeadline ?? assignment.reviewAt,
            durableRiskTier: assignment.lifecycle?.riskTier ?? null,
            storedPermissionFingerprint:
              assignment.lifecycle?.permissionFingerprint ?? null,
            assessedAt: now,
            scopeFingerprint:
              assignment.scopeFingerprint ??
              buildRoleAssignmentScopeFingerprint(
                assignment.structuredScopeGrants,
              ),
          })
        : undefined;
      if (
        !isRoleAssignmentCurrentlyEffective(assignment, now, currentPolicy) ||
        !role ||
        role.state !== "ACTIVE" ||
        !role.permissions.includes(permission)
      ) {
        return [];
      }
      return assignment.structuredScopeGrants ?? [];
    });
    const breakGlassGrants = (await this.listBreakGlass(userId, now)).flatMap(
      (activation) =>
        isBreakGlassActivationEffective(activation, now) &&
        activation.permissions.includes(permission)
          ? activation.structuredScopeGrants
          : [],
    );
    const unique = new Map(
      [...grants, ...breakGlassGrants].map(
        (grant) => [scopeGrantKey(grant), grant] as const,
      ),
    );
    return [...unique.values()];
  }

  private async listBreakGlass(
    userId: string,
    now: number,
  ): Promise<readonly BreakGlassActivationRecord[]> {
    return this.reader.listBreakGlassByUserId?.(userId, now) ?? [];
  }
}

function roleAssignmentGrantsCurrentAuthority(
  assignment: UserRoleAssignmentRecord,
  role: StructuredScopeAuthorityRole | null,
  now: number,
): boolean {
  if (!role || role.state !== "ACTIVE") return false;
  const currentPolicy = buildCurrentRoleAssignmentPolicy({
    roleCode: role.code,
    roleTemplateCode: role.templateCode,
    permissions: role.permissions,
    structuredScopeGrants: assignment.structuredScopeGrants,
    effectiveAt: assignment.effectiveAt,
    durableReviewDeadline:
      assignment.lifecycle?.reviewDeadline ?? assignment.reviewAt,
    durableRiskTier: assignment.lifecycle?.riskTier ?? null,
    storedPermissionFingerprint:
      assignment.lifecycle?.permissionFingerprint ?? null,
    assessedAt: now,
    scopeFingerprint:
      assignment.scopeFingerprint ??
      buildRoleAssignmentScopeFingerprint(assignment.structuredScopeGrants),
  });
  return isRoleAssignmentCurrentlyEffective(assignment, now, currentPolicy);
}

function uniqueGrants(
  grants: readonly RoleAssignmentScopeGrant[],
): readonly RoleAssignmentScopeGrant[] {
  return [
    ...new Map(grants.map((grant) => [scopeGrantKey(grant), grant])).values(),
  ];
}

function emptySnapshot(
  userId: string,
  now: number,
): StructuredScopeAuthoritySnapshot {
  return Object.freeze({
    userId,
    capturedAt: now,
    hasAuthority: () => false,
    listAuthorizedScopeGrants: () => [],
  });
}

export function scopeGrantMatches(
  actual: RoleAssignmentScopeGrant,
  expected: RoleAssignmentScopeGrant,
): boolean {
  return (
    actual.scopeType === expected.scopeType &&
    normalizeOptionalText(actual.targetId) ===
      normalizeOptionalText(expected.targetId) &&
    normalizeOptionalText(actual.targetKey) ===
      normalizeOptionalText(expected.targetKey) &&
    normalizeOptionalText(actual.periodKey) ===
      normalizeOptionalText(expected.periodKey)
  );
}

function normalizeRequiredText(value: string): string {
  return value.trim();
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function scopeGrantKey(grant: RoleAssignmentScopeGrant): string {
  return [
    grant.scopeType,
    grant.targetId ?? "",
    grant.targetKey ?? "",
    grant.periodKey ?? "",
  ].join("|");
}
