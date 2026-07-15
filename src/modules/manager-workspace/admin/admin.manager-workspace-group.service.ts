import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import {
  EmploymentProfileDetailView,
  EmploymentProfileListItemView,
  EmploymentStatus,
} from "@modules/employment-profile/domain/employment-profile.types";
import { EmploymentProfileReadRepository } from "@modules/employment-profile/read/employment-profile.read-repository";
import { KpiSubjectReadonlyAccess } from "@modules/kpi/domain/kpi-subject-readonly-access";
import { OrgUnitReadRepository } from "@modules/org-unit/read/org-unit.read-repository";
import {
  ResponsibilityManagedScope,
  ResponsibilityManagedScopeReader,
} from "@modules/responsibility/domain/responsibility-managed-scope";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { TalentGroupRepository } from "@modules/talent-group/domain/talent-group.repository";
import { TalentGroupMemberRecord } from "@modules/talent-group/domain/talent-group.types";
import { TalentGroupReadRepository } from "@modules/talent-group/read/talent-group.read-repository";
import { TalentRepository } from "@modules/talent/domain/talent.repository";
import {
  TalentListItemView,
  TalentOperationalStatus,
} from "@modules/talent/domain/talent.types";
import { TalentReadRepository } from "@modules/talent/read/talent.read-repository";
import {
  ManagerWorkspaceScopeNotFoundError,
  ManagerWorkspaceValidationError,
} from "../manager-workspace.errors";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 120;

export type ManagedScopeType = "ORG_UNIT" | "TALENT_GROUP";

export interface ManagedGroupView {
  readonly scopeType: ManagedScopeType;
  readonly scopeId: string;
  readonly code: string;
  readonly displayName: string;
  readonly operationalStatus: string;
  readonly responsibility: {
    readonly role: string | null;
    readonly includeDescendants: boolean;
    readonly isPrimary: boolean;
  } | null;
  readonly readiness: {
    readonly memberReadAvailable: boolean;
    readonly reasonCodes: readonly string[];
  };
  readonly navigation: {
    readonly groupRef: string;
    readonly membersRef: string;
  };
}

export interface ManagedGroupListView {
  readonly items: readonly ManagedGroupView[];
  readonly nextCursor?: string;
  readonly readiness: {
    readonly hasAssignedScope: boolean;
    readonly reasonCodes: readonly string[];
  };
}

export interface ManagedMemberView {
  readonly personKind: "INTERNAL" | "EXTERNAL_ONLY";
  readonly operationalMemberId: string | null;
  readonly displayName: string;
  readonly employeeCode: string | null;
  readonly operationalStatus: string;
  readonly trace: {
    readonly talentId: string | null;
    readonly talentCode: string | null;
    readonly membershipId: string | null;
    readonly membershipStatus: string | null;
    readonly joinedAt: number | null;
    readonly leftAt: number | null;
  };
  readonly eligibility: {
    readonly kpi: boolean;
    readonly schedule: boolean;
    readonly actualEntry: boolean;
    readonly mutation: boolean;
  };
  readonly readinessReasonCodes: readonly string[];
  readonly navigation: {
    readonly memberRef: string | null;
  };
}

export interface ManagedMemberListView {
  readonly items: readonly ManagedMemberView[];
  readonly nextCursor?: string;
}

export interface ManagerGroupListQuery {
  readonly search?: string;
  readonly scopeType?: string;
  readonly limit?: string;
  readonly cursor?: string;
}

export interface ManagerMemberListQuery {
  readonly search?: string;
  readonly operationalStatus?: string;
  readonly personKind?: string;
  readonly kpiEligibility?: string;
  readonly scheduleEligibility?: string;
  readonly limit?: string;
  readonly cursor?: string;
}

export class ManagerWorkspaceGroupAdminService {
  constructor(
    private readonly employmentProfileRepository: Pick<
      EmploymentProfileRepository,
      "findNonArchivedByLinkedUserId" | "findById"
    >,
    private readonly employmentProfileReadRepository: Pick<
      EmploymentProfileReadRepository,
      "listEmploymentProfiles" | "getEmploymentProfileDetail"
    >,
    private readonly orgUnitReadRepository: Pick<
      OrgUnitReadRepository,
      "getOrgUnitDetail"
    >,
    private readonly talentGroupRepository: Pick<
      TalentGroupRepository,
      "findMemberById"
    >,
    private readonly talentGroupReadRepository: Pick<
      TalentGroupReadRepository,
      "getTalentGroupDetail"
    >,
    private readonly talentRepository: Pick<TalentRepository, "findById">,
    private readonly talentReadRepository: Pick<
      TalentReadRepository,
      "listTalents"
    >,
    private readonly subjectReadonlyAccess: Pick<
      KpiSubjectReadonlyAccess,
      "findActiveGroupMember" | "findActiveGroupMemberByEmploymentProfile"
    >,
    private readonly managedScopeReader: ResponsibilityManagedScopeReader,
    private readonly structuredAuthority: StructuredScopeAuthorityService,
    private readonly clock: () => number = Date.now,
  ) {}

  async listGroups(
    actor: Actor,
    query: ManagerGroupListQuery,
  ): Promise<ManagedGroupListView> {
    const scope = await this.resolveAuthorizedScope(
      actor,
      Permission.MANAGER_GROUP_READ,
    );
    const limit = parseLimit(query.limit);
    const search = normalizeSearch(query.search);
    const scopeType = parseOptionalScopeType(query.scopeType);
    const groups = await this.loadGroups(scope, actor);
    const filtered = groups
      .filter((group) => !scopeType || group.scopeType === scopeType)
      .filter((group) =>
        !search
          ? true
          : `${group.code} ${group.displayName}`
              .toLocaleLowerCase("vi")
              .includes(search),
      )
      .sort(compareGroups);
    const start = parseGroupCursor(query.cursor, filtered);
    const items = filtered.slice(start, start + limit);
    const next = filtered[start + limit];
    return {
      items,
      ...(next ? { nextCursor: encodeCursor(groupKey(next)) } : {}),
      readiness: {
        hasAssignedScope: groups.length > 0,
        reasonCodes:
          groups.length > 0 ? [] : ["NO_MANAGER_RESPONSIBILITY_ASSIGNED"],
      },
    };
  }

  async getGroup(
    actor: Actor,
    scopeTypeInput: string,
    scopeIdInput: string,
  ): Promise<ManagedGroupView> {
    const scopeType = parseScopeType(scopeTypeInput);
    const scopeId = requireId(scopeIdInput, "scopeId");
    const scope = await this.resolveAuthorizedScope(
      actor,
      Permission.MANAGER_GROUP_READ,
    );
    await this.assertExactScope(actor, scope, scopeType, scopeId, [
      Permission.MANAGER_GROUP_READ,
    ]);
    const group = await this.loadGroup(scope, actor, scopeType, scopeId);
    if (!group) {
      throw new ManagerWorkspaceScopeNotFoundError();
    }
    return group;
  }

  async listMembers(
    actor: Actor,
    scopeTypeInput: string,
    scopeIdInput: string,
    query: ManagerMemberListQuery,
  ): Promise<ManagedMemberListView> {
    const scopeType = parseScopeType(scopeTypeInput);
    const scopeId = requireId(scopeIdInput, "scopeId");
    const scope = await this.resolveAuthorizedScope(
      actor,
      Permission.MANAGER_MEMBER_READ,
    );
    await this.assertExactScope(actor, scope, scopeType, scopeId, [
      Permission.MANAGER_GROUP_READ,
      Permission.MANAGER_MEMBER_READ,
    ]);
    await this.assertPersistedGroup(scopeType, scopeId);
    const limit = parseLimit(query.limit);
    const search = normalizeSearch(query.search);

    if (scopeType === "ORG_UNIT") {
      const status = parseOptionalEmploymentStatus(query.operationalStatus);
      const result =
        await this.employmentProfileReadRepository.listEmploymentProfiles({
          orgUnitId: scopeId,
          ...(status ? { employmentStatus: status } : {}),
          ...(search ? { search } : {}),
          limit,
          ...(query.cursor ? { cursor: query.cursor } : {}),
          sortField: "employeeCode",
          sortDirection: "ASC",
        });
      return {
        items: applyMemberReadinessFilters(
          result.items.map(toOrgUnitMemberView),
          query,
        ),
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
    }

    const operationalStatus = parseOptionalTalentStatus(
      query.operationalStatus,
    );
    const result = await this.talentReadRepository.listTalents({
      activeMemberOfGroupIds: [scopeId],
      ...(operationalStatus ? { operationalStatus } : {}),
      ...(search ? { search } : {}),
      limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      sortField: "talentCode",
      sortDirection: "ASC",
    });
    const items = await Promise.all(
      result.items.map((talent) =>
        this.toTalentGroupMemberView(scopeId, talent),
      ),
    );
    return {
      items: applyMemberReadinessFilters(items, query),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    };
  }

  async getMember(
    actor: Actor,
    scopeTypeInput: string,
    scopeIdInput: string,
    memberIdInput: string,
  ): Promise<ManagedMemberView> {
    const scopeType = parseScopeType(scopeTypeInput);
    const scopeId = requireId(scopeIdInput, "scopeId");
    const memberId = requireId(memberIdInput, "memberId");
    const scope = await this.resolveAuthorizedScope(
      actor,
      Permission.MANAGER_MEMBER_READ,
    );
    await this.assertExactScope(actor, scope, scopeType, scopeId, [
      Permission.MANAGER_GROUP_READ,
      Permission.MANAGER_MEMBER_READ,
    ]);
    await this.assertPersistedGroup(scopeType, scopeId);

    if (scopeType === "ORG_UNIT") {
      const profile =
        await this.employmentProfileReadRepository.getEmploymentProfileDetail(
          memberId,
        );
      if (!profile || profile.orgUnitId !== scopeId) {
        throw new ManagerWorkspaceScopeNotFoundError();
      }
      return toOrgUnitMemberDetailView(profile);
    }

    const membership =
      await this.subjectReadonlyAccess.findActiveGroupMemberByEmploymentProfile(
        scopeId,
        memberId,
      );
    if (!membership) {
      throw new ManagerWorkspaceScopeNotFoundError();
    }
    const [profile, talent, membershipRecord] = await Promise.all([
      this.employmentProfileRepository.findById(memberId),
      this.talentRepository.findById(membership.talentId),
      this.talentGroupRepository.findMemberById(membership.membershipId),
    ]);
    if (!profile || !talent || !membershipRecord) {
      throw new ManagerWorkspaceScopeNotFoundError();
    }
    return toInternalTalentGroupMemberView(profile, talent, membershipRecord);
  }

  private async resolveAuthorizedScope(
    actor: Actor,
    permission: Permission,
  ): Promise<ResponsibilityManagedScope> {
    if (!actor.isActive || !actor.accountContexts.includes("MANAGER_CONSOLE")) {
      throw new SystemInvariantError(
        "PERMISSION_DENIED",
        "Active MANAGER_CONSOLE account context is required",
      );
    }
    if (!actor.permissions.includes(permission)) {
      throw new SystemInvariantError(
        "PERMISSION_DENIED",
        `Missing permission ${permission}`,
      );
    }
    const profile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );
    if (
      !profile ||
      !["ACTIVE", "ON_LEAVE"].includes(profile.employmentStatus)
    ) {
      throw new SystemInvariantError(
        "PERMISSION_DENIED",
        "Active or on-leave linked EmploymentProfile is required",
      );
    }
    return this.managedScopeReader.resolveManagedScopeByResponsibleEmploymentProfile(
      {
        responsibleEmploymentProfileId: profile.id,
        asOf: this.clock(),
      },
    );
  }

  private async assertExactScope(
    actor: Actor,
    scope: ResponsibilityManagedScope,
    scopeType: ManagedScopeType,
    scopeId: string,
    permissions: readonly Permission[],
  ): Promise<void> {
    const responsible =
      scopeType === "ORG_UNIT"
        ? scope.orgUnitScopes.some(
            (item) => item.orgUnitId === scopeId && !item.includeDescendants,
          )
        : scope.talentGroupIds.includes(scopeId);
    if (!responsible) {
      throw new ManagerWorkspaceScopeNotFoundError();
    }
    for (const permission of permissions) {
      if (!actor.permissions.includes(permission)) {
        throw new SystemInvariantError(
          "PERMISSION_DENIED",
          `Missing permission ${permission}`,
        );
      }
      const authorized = await this.structuredAuthority.hasAuthority({
        userId: actor.id,
        permission,
        scope:
          scopeType === "ORG_UNIT"
            ? { scopeType: "managedOrgUnit", targetId: scopeId }
            : { scopeType: "managedTalentGroup", targetId: scopeId },
      });
      if (!authorized) {
        throw new ManagerWorkspaceScopeNotFoundError();
      }
    }
  }

  private async loadGroups(
    scope: ResponsibilityManagedScope,
    actor: Actor,
  ): Promise<readonly ManagedGroupView[]> {
    const candidates = [
      ...scope.orgUnitScopes
        .filter((item) => !item.includeDescendants)
        .map((item) => ({
          scopeType: "ORG_UNIT" as const,
          scopeId: item.orgUnitId,
        })),
      ...scope.talentGroupIds.map((scopeId) => ({
        scopeType: "TALENT_GROUP" as const,
        scopeId,
      })),
    ];
    const loaded = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          await this.assertExactScope(
            actor,
            scope,
            candidate.scopeType,
            candidate.scopeId,
            [Permission.MANAGER_GROUP_READ],
          );
          return this.loadGroup(
            scope,
            actor,
            candidate.scopeType,
            candidate.scopeId,
          );
        } catch (error) {
          if (error instanceof ManagerWorkspaceScopeNotFoundError) {
            return null;
          }
          throw error;
        }
      }),
    );
    return loaded.filter((item): item is ManagedGroupView => item !== null);
  }

  private async loadGroup(
    scope: ResponsibilityManagedScope,
    actor: Actor,
    scopeType: ManagedScopeType,
    scopeId: string,
  ): Promise<ManagedGroupView | null> {
    const memberReadAvailable =
      actor.permissions.includes(Permission.MANAGER_MEMBER_READ) &&
      (await this.structuredAuthority.hasAuthority({
        userId: actor.id,
        permission: Permission.MANAGER_MEMBER_READ,
        scope:
          scopeType === "ORG_UNIT"
            ? { scopeType: "managedOrgUnit", targetId: scopeId }
            : { scopeType: "managedTalentGroup", targetId: scopeId },
      }));
    if (scopeType === "ORG_UNIT") {
      const record = await this.orgUnitReadRepository.getOrgUnitDetail(scopeId);
      if (!record || record.status === "ARCHIVED") {
        return null;
      }
      const responsibility =
        scope.orgUnitScopes.find(
          (item) => item.orgUnitId === scopeId && !item.includeDescendants,
        ) ?? null;
      return {
        scopeType,
        scopeId,
        code: record.code,
        displayName: record.name,
        operationalStatus: record.status,
        responsibility: responsibility
          ? {
              role: responsibility.role,
              includeDescendants: responsibility.includeDescendants,
              isPrimary: responsibility.isPrimary,
            }
          : null,
        readiness: {
          memberReadAvailable,
          reasonCodes: memberReadAvailable
            ? []
            : ["MANAGER_MEMBER_READ_REQUIRED"],
        },
        navigation: navigationFor(scopeType, scopeId),
      };
    }
    const record =
      await this.talentGroupReadRepository.getTalentGroupDetail(scopeId);
    if (!record || record.status === "ARCHIVED") {
      return null;
    }
    return {
      scopeType,
      scopeId,
      code: record.groupCode,
      displayName: record.name,
      operationalStatus: record.status,
      responsibility: null,
      readiness: {
        memberReadAvailable,
        reasonCodes: memberReadAvailable
          ? []
          : ["MANAGER_MEMBER_READ_REQUIRED"],
      },
      navigation: navigationFor(scopeType, scopeId),
    };
  }

  private async assertPersistedGroup(
    scopeType: ManagedScopeType,
    scopeId: string,
  ): Promise<void> {
    const record =
      scopeType === "ORG_UNIT"
        ? await this.orgUnitReadRepository.getOrgUnitDetail(scopeId)
        : await this.talentGroupReadRepository.getTalentGroupDetail(scopeId);
    if (!record || record.status === "ARCHIVED") {
      throw new ManagerWorkspaceScopeNotFoundError();
    }
  }

  private async toTalentGroupMemberView(
    groupId: string,
    talent: TalentListItemView,
  ): Promise<ManagedMemberView> {
    const membership = await this.findMembership(groupId, talent.id);
    if (!membership) {
      throw new ManagerWorkspaceScopeNotFoundError();
    }
    const profile = talent.linkedEmploymentProfileId
      ? await this.employmentProfileRepository.findById(
          talent.linkedEmploymentProfileId,
        )
      : null;
    if (!profile) {
      return toExternalTalentGroupMemberView(talent, membership);
    }
    return toInternalTalentGroupMemberView(profile, talent, membership);
  }

  private async findMembership(
    groupId: string,
    talentId: string,
  ): Promise<TalentGroupMemberRecord | null> {
    const active = await this.subjectReadonlyAccess.findActiveGroupMember(
      groupId,
      talentId,
    );
    return active
      ? this.talentGroupRepository.findMemberById(active.membershipId)
      : null;
  }
}

function toOrgUnitMemberView(
  profile: EmploymentProfileListItemView,
): ManagedMemberView {
  return internalMemberView({
    operationalMemberId: profile.id,
    displayName: profile.displayName,
    employeeCode: profile.employeeCode,
    operationalStatus: profile.employmentStatus,
  });
}

function toOrgUnitMemberDetailView(
  profile: EmploymentProfileDetailView,
): ManagedMemberView {
  return internalMemberView({
    operationalMemberId: profile.id,
    displayName: profile.displayName,
    employeeCode: profile.employeeCode,
    operationalStatus: profile.employmentStatus,
  });
}

function toInternalTalentGroupMemberView(
  profile: {
    readonly id: string;
    readonly displayName: string;
    readonly employeeCode: string;
    readonly employmentStatus: string;
  },
  talent: {
    readonly id: string;
    readonly talentCode: string;
  },
  membership: TalentGroupMemberRecord,
): ManagedMemberView {
  return internalMemberView({
    operationalMemberId: profile.id,
    displayName: profile.displayName,
    employeeCode: profile.employeeCode,
    operationalStatus: profile.employmentStatus,
    talentId: talent.id,
    talentCode: talent.talentCode,
    membership,
  });
}

function internalMemberView(input: {
  readonly operationalMemberId: string;
  readonly displayName: string;
  readonly employeeCode: string;
  readonly operationalStatus: string;
  readonly talentId?: string;
  readonly talentCode?: string;
  readonly membership?: TalentGroupMemberRecord;
}): ManagedMemberView {
  const operationallyEligible = ["ACTIVE", "ON_LEAVE"].includes(
    input.operationalStatus,
  );
  return {
    personKind: "INTERNAL",
    operationalMemberId: input.operationalMemberId,
    displayName: input.displayName,
    employeeCode: input.employeeCode,
    operationalStatus: input.operationalStatus,
    trace: {
      talentId: input.talentId ?? null,
      talentCode: input.talentCode ?? null,
      membershipId: input.membership?.id ?? null,
      membershipStatus: input.membership?.membershipStatus ?? null,
      joinedAt: input.membership?.joinedAt ?? null,
      leftAt: input.membership?.leftAt ?? null,
    },
    eligibility: {
      kpi: false,
      schedule: false,
      actualEntry: false,
      mutation: false,
    },
    readinessReasonCodes: operationallyEligible
      ? ["KPI_SOURCE_NOT_RESOLVED", "SCHEDULE_SOURCE_NOT_RESOLVED"]
      : [
          "EMPLOYMENT_PROFILE_NOT_ACTIVE_OR_ON_LEAVE",
          "KPI_SOURCE_NOT_RESOLVED",
          "SCHEDULE_SOURCE_NOT_RESOLVED",
        ],
    navigation: {
      memberRef: input.operationalMemberId,
    },
  };
}

function applyMemberReadinessFilters(
  items: readonly ManagedMemberView[],
  query: ManagerMemberListQuery,
): readonly ManagedMemberView[] {
  const personKind = parseOptionalPersonKind(query.personKind);
  const kpiEligibility = parseOptionalEligibility(
    query.kpiEligibility,
    "kpiEligibility",
  );
  const scheduleEligibility = parseOptionalEligibility(
    query.scheduleEligibility,
    "scheduleEligibility",
  );
  return items.filter(
    (item) =>
      (!personKind || item.personKind === personKind) &&
      (kpiEligibility === null || item.eligibility.kpi === kpiEligibility) &&
      (scheduleEligibility === null ||
        item.eligibility.schedule === scheduleEligibility),
  );
}

function parseOptionalPersonKind(
  value: string | undefined,
): ManagedMemberView["personKind"] | null {
  if (value === undefined || value.trim() === "") return null;
  if (value === "INTERNAL" || value === "EXTERNAL_ONLY") return value;
  throw new ManagerWorkspaceValidationError("Invalid personKind");
}

function parseOptionalEligibility(
  value: string | undefined,
  field: string,
): boolean | null {
  if (value === undefined || value.trim() === "") return null;
  if (value === "ELIGIBLE") return true;
  if (value === "INELIGIBLE") return false;
  throw new ManagerWorkspaceValidationError(`Invalid ${field}`);
}

function toExternalTalentGroupMemberView(
  talent: TalentListItemView,
  membership: TalentGroupMemberRecord,
): ManagedMemberView {
  return {
    personKind: "EXTERNAL_ONLY",
    operationalMemberId: null,
    displayName: talent.displayName,
    employeeCode: null,
    operationalStatus: talent.operationalStatus,
    trace: {
      talentId: talent.id,
      talentCode: talent.talentCode,
      membershipId: membership.id,
      membershipStatus: membership.membershipStatus,
      joinedAt: membership.joinedAt,
      leftAt: membership.leftAt,
    },
    eligibility: {
      kpi: false,
      schedule: false,
      actualEntry: false,
      mutation: false,
    },
    readinessReasonCodes: ["ACTIVE_EMPLOYMENT_PROFILE_LINK_REQUIRED"],
    navigation: { memberRef: null },
  };
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!/^\d+$/u.test(value)) {
    throw new ManagerWorkspaceValidationError("limit must be an integer");
  }
  const limit = Number(value);
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new ManagerWorkspaceValidationError(
      `limit must be between 1 and ${MAX_LIMIT}`,
    );
  }
  return limit;
}

function normalizeSearch(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/gu, " ");
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > MAX_SEARCH_LENGTH) {
    throw new ManagerWorkspaceValidationError(
      `search must not exceed ${MAX_SEARCH_LENGTH} characters`,
    );
  }
  return normalized.toLocaleLowerCase("vi");
}

function parseScopeType(value: string): ManagedScopeType {
  if (value === "ORG_UNIT" || value === "TALENT_GROUP") {
    return value;
  }
  throw new ManagerWorkspaceValidationError(
    "scopeType must be ORG_UNIT or TALENT_GROUP",
  );
}

function parseOptionalScopeType(
  value: string | undefined,
): ManagedScopeType | undefined {
  return value === undefined ? undefined : parseScopeType(value);
}

function parseOptionalEmploymentStatus(
  value: string | undefined,
): EmploymentStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    ["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED", "ARCHIVED"].includes(
      value,
    )
  ) {
    return value as EmploymentStatus;
  }
  throw new ManagerWorkspaceValidationError("Invalid operationalStatus");
}

function parseOptionalTalentStatus(
  value: string | undefined,
): TalentOperationalStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (["ACTIVE", "SUSPENDED", "INACTIVE", "ARCHIVED"].includes(value)) {
    return value as TalentOperationalStatus;
  }
  throw new ManagerWorkspaceValidationError("Invalid operationalStatus");
}

function requireId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ManagerWorkspaceValidationError(`${field} is required`);
  }
  return normalized;
}

function groupKey(group: ManagedGroupView): string {
  return `${group.scopeType}:${group.scopeId}`;
}

function compareGroups(
  left: ManagedGroupView,
  right: ManagedGroupView,
): number {
  return groupKey(left).localeCompare(groupKey(right));
}

function encodeCursor(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function parseGroupCursor(
  cursor: string | undefined,
  groups: readonly ManagedGroupView[],
): number {
  if (!cursor) {
    return 0;
  }
  let key: string;
  try {
    key = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new ManagerWorkspaceValidationError("cursor is invalid");
  }
  const index = groups.findIndex((group) => groupKey(group) === key);
  if (index < 0) {
    throw new ManagerWorkspaceValidationError("cursor is invalid");
  }
  return index;
}

function navigationFor(
  scopeType: ManagedScopeType,
  scopeId: string,
): ManagedGroupView["navigation"] {
  return {
    groupRef: `${scopeType}:${scopeId}`,
    membersRef: `${scopeType}:${scopeId}:members`,
  };
}
