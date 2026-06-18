import { RoleAssignmentScopeGrant } from "./role-assignment-scope";
import { isRoleAssignmentCurrentlyEffective } from "./role-assignment-lifecycle";
import { UserRoleAssignmentRecord } from "./role.types";

export type StructuredScopeAuthorityMode =
  | "STRUCTURED_SCOPE_REQUIRED"
  | "LEGACY_PERMISSION_ONLY_COMPATIBILITY";

export interface StructuredScopeAuthorityRole {
  readonly id: string;
  readonly state: "ACTIVE" | string;
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
}

export interface StructuredScopeAuthorityCheck {
  readonly userId: string;
  readonly permission: string;
  readonly scope: RoleAssignmentScopeGrant;
  readonly mode?: StructuredScopeAuthorityMode;
  readonly now?: number;
}

export class StructuredScopeAuthorityService {
  constructor(
    private readonly reader: StructuredScopeAuthorityReader,
    private readonly clock: () => number = Date.now,
  ) {}

  async hasAuthority(input: StructuredScopeAuthorityCheck): Promise<boolean> {
    const userId = normalizeRequiredText(input.userId);
    const permission = normalizeRequiredText(input.permission);
    if (!userId || !permission) {
      return false;
    }
    const mode = input.mode ?? "STRUCTURED_SCOPE_REQUIRED";
    const now = input.now ?? this.clock();
    const records = await this.reader.listByUserId(userId);

    return records.some(({ assignment, role }) => {
      if (!isRoleAssignmentCurrentlyEffective(assignment, now)) {
        return false;
      }

      if (!role || role.state !== "ACTIVE") {
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
  }
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
