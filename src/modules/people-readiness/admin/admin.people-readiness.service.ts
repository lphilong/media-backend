import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { PeopleReadinessValidationError } from "../domain/people-readiness.errors";
import {
  PEOPLE_READINESS_CATEGORIES,
  PEOPLE_READINESS_ISSUE_CODES,
  PEOPLE_READINESS_SEVERITIES,
  PeopleReadinessCategory,
  PeopleReadinessEmploymentProfile,
  PeopleReadinessEntityType,
  PeopleReadinessIssue,
  PeopleReadinessIssueCode,
  PeopleReadinessManagerAssignment,
  PeopleReadinessOrgUnit,
  PeopleReadinessSafeEntitySummary,
  PeopleReadinessSeverity,
  PeopleReadinessSnapshot,
  PeopleReadinessTalent,
  PeopleReadinessTalentGroup,
  PeopleReadinessTalentGroupMember,
  PeopleReadinessUser,
} from "../domain/people-readiness.types";
import { PeopleReadinessReadRepository } from "../read/people-readiness.read-repository";
import { EmploymentTermsReadinessReadonlyAccess } from "@modules/employment-terms/domain/employment-terms-readiness-readonly-access";
import {
  EmploymentTermsReadinessFacts,
  toHcmBusinessDateTimestamp,
} from "@modules/employment-terms/domain/employment-terms-readiness";
import {
  ListPeopleReadinessIssuesQuery,
  PeopleReadinessAppliedFilters,
  PeopleReadinessIssueListResult,
  PeopleReadinessSummaryResult,
} from "../shared/people-readiness.contracts";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { requireAdminGlobalScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { normalizeAccountContexts } from "@modules/account-context/domain/account-context.types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const OPERATIONALLY_READY_STATUSES = new Set(["ACTIVE", "ON_LEAVE"]);
const COVERAGE_NOTES = Object.freeze([
  "Exact counts cover the supported issue codes generated from full projected repository snapshots.",
  "The B1 read repository uses projected full-collection snapshots; aggregation or indexed summary queries may be needed at larger runtime scale.",
  "EMPLOYMENT_PROFILE_REQUIRES_LOGIN_BUT_MISSING_ACTIVE_USER is limited to profiles with active/effective manager assignments.",
  "WORKSCHEDULE_MEMBER_NOT_READY and KPI_PARTICIPANT_NOT_READY are not duplicated; core readiness issues remain the canonical rows.",
]);

type NowProvider = () => number;

export class PeopleReadinessAdminService {
  constructor(
    private readonly readRepository: PeopleReadinessReadRepository,
    private readonly employmentTermsReadiness: EmploymentTermsReadinessReadonlyAccess,
    private readonly now: NowProvider = Date.now,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
  ) {}

  async getSummary(actor: Actor): Promise<PeopleReadinessSummaryResult> {
    await this.assertAccess(actor);
    const generatedAt = this.now();
    const snapshot = await this.readRepository.getSnapshot();
    const issues = generateIssues(
      snapshot,
      generatedAt,
      await this.readEmploymentTermsFacts(snapshot, generatedAt),
    );
    return {
      totalIssueCount: issues.length,
      countsByCategory: countBy(issues, (issue) => issue.category),
      countsBySeverity: countBy(issues, (issue) => issue.severity),
      countsByIssueCode: countBy(issues, (issue) => issue.issueCode),
      generatedAt,
      dataCoverage: {
        exactForSupportedIssueCodes: true,
        coverageNotes: COVERAGE_NOTES,
      },
    };
  }

  async listIssues(
    actor: Actor,
    query: ListPeopleReadinessIssuesQuery,
  ): Promise<PeopleReadinessIssueListResult> {
    await this.assertAccess(actor);
    const generatedAt = this.now();
    const snapshot = await this.readRepository.getSnapshot();
    const filters = parseFilters(query);
    const limit = parseLimit(query.limit);
    const offset = parseCursor(query.cursor);
    const issues = generateIssues(
      snapshot,
      generatedAt,
      await this.readEmploymentTermsFacts(snapshot, generatedAt),
    )
      .filter((issue) => matchesFilters(issue, filters));
    const items = issues.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < issues.length ? encodeCursor(nextOffset) : null,
      totalCount: issues.length,
      generatedAt,
      appliedFilters: filters,
    };
  }

  private async assertAccess(actor: Actor): Promise<void> {
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(
      actor,
      PermissionResolver.resolve(Permission.EMPLOYMENT_PROFILE_READ),
    );
    await requireAdminGlobalScopeAuthority({
      actor,
      permission: Permission.EMPLOYMENT_PROFILE_READ,
      authority: this.structuredAuthority,
      error: new PeopleReadinessValidationError(
        "People Readiness Admin surfaces require structured global scope",
      ),
    });
  }

  private readEmploymentTermsFacts(
    snapshot: PeopleReadinessSnapshot,
    generatedAt: number,
  ): Promise<ReadonlyMap<string, EmploymentTermsReadinessFacts>> {
    const profileIds = snapshot.employmentProfiles
      .filter((profile) => isProfileReady(profile))
      .map((profile) => profile.id);
    return this.employmentTermsReadiness.getReadinessFacts(
      profileIds,
      toHcmBusinessDateTimestamp(generatedAt),
    );
  }
}

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new PeopleReadinessValidationError(
        "Structured People Readiness authority is unavailable",
      );
    },
  });
}

export function generateIssues(
  snapshot: PeopleReadinessSnapshot,
  generatedAt: number,
  employmentTermsFacts: ReadonlyMap<string, EmploymentTermsReadinessFacts> = new Map(),
): readonly PeopleReadinessIssue[] {
  const issues: PeopleReadinessIssue[] = [];
  const users = new Map(snapshot.users.map((user) => [user.id, user]));
  const profiles = new Map(snapshot.employmentProfiles.map((profile) => [profile.id, profile]));
  const talents = new Map(snapshot.talents.map((talent) => [talent.id, talent]));
  const orgUnits = new Map(snapshot.orgUnits.map((orgUnit) => [orgUnit.id, orgUnit]));
  const groups = new Map(snapshot.talentGroups.map((group) => [group.id, group]));
  const nonArchivedProfilesByUser = new Map(
    snapshot.employmentProfiles
      .filter((profile) => profile.employmentStatus !== "ARCHIVED" && profile.linkedUserId)
      .map((profile) => [profile.linkedUserId as string, profile]),
  );
  const managerProfileIds = new Set<string>();
  const effectiveOrgAssignments = snapshot.orgUnitManagerAssignments.filter((assignment) =>
    isEffectiveAssignment(assignment, generatedAt),
  );
  const effectiveGroupAssignments = snapshot.talentGroupManagerAssignments.filter((assignment) =>
    isEffectiveAssignment(assignment, generatedAt),
  );
  [...effectiveOrgAssignments, ...effectiveGroupAssignments].forEach((assignment) =>
    managerProfileIds.add(assignment.managerEmploymentProfileId),
  );

  for (const user of snapshot.users.filter((item) => item.accountStatus === "ACTIVE")) {
    if (!nonArchivedProfilesByUser.has(user.id)) {
      issues.push(issue({
        code: "ACTIVE_USER_WITHOUT_EMPLOYMENT_PROFILE",
        category: "ACCOUNT_LOGIN_READY",
        severity: "WARNING",
        primary: userSummary(user),
        related: [],
        summary: "Active account has no non-archived linked EmploymentProfile.",
        repair: repair(userSummary(user), "Review account and EmploymentProfile linkage"),
        generatedAt,
        blocking: false,
      }));
    }
  }

  for (const profile of snapshot.employmentProfiles.filter((item) => item.employmentStatus !== "ARCHIVED")) {
    const user = profile.linkedUserId ? users.get(profile.linkedUserId) : undefined;
    if (!isProfileReady(profile)) {
      issues.push(profileIssue(
        "EMPLOYMENT_PROFILE_NOT_ACTIVE_FOR_OPERATIONS",
        "EMPLOYMENT_PROFILE_LIFECYCLE",
        "BLOCKER",
        profile,
        "EmploymentProfile is not eligible for new operational participation.",
        generatedAt,
      ));
      if (profile.linkedUserId) {
        issues.push(profileIssue(
          "SELF_SERVICE_PROFILE_NOT_ACTIVE",
          "SELF_SERVICE_READY",
          "BLOCKER",
          profile,
          "Linked EmploymentProfile is not active for Self-Service readiness.",
          generatedAt,
          user ? [userSummary(user)] : [],
        ));
      }
    }
    if (!profile.orgUnitId) {
      issues.push(profileIssue(
        "EMPLOYMENT_PROFILE_MISSING_ORG_UNIT",
        "ORGUNIT_PARTICIPATION",
        "BLOCKER",
        profile,
        "EmploymentProfile has no OrgUnit assignment.",
        generatedAt,
      ));
    } else {
      const orgUnit = orgUnits.get(profile.orgUnitId);
      if (!orgUnit || orgUnit.status !== "ACTIVE") {
        issues.push(profileIssue(
          "EMPLOYMENT_PROFILE_IN_INACTIVE_ORG_UNIT",
          "ORGUNIT_PARTICIPATION",
          "BLOCKER",
          profile,
          "EmploymentProfile is assigned to an inactive, archived, or missing OrgUnit.",
          generatedAt,
          orgUnit ? [orgUnitSummary(orgUnit)] : [],
        ));
      }
    }
    if (profile.linkedUserId && (!user || user.accountStatus !== "ACTIVE")) {
      issues.push(profileIssue(
        "EMPLOYMENT_PROFILE_LINKED_USER_INACTIVE",
        "ACCOUNT_LOGIN_READY",
        "WARNING",
        profile,
        "EmploymentProfile is linked to a missing or inactive account.",
        generatedAt,
        user ? [userSummary(user)] : [],
      ));
    }
    if (managerProfileIds.has(profile.id) && (!user || user.accountStatus !== "ACTIVE")) {
      issues.push(profileIssue(
        "EMPLOYMENT_PROFILE_REQUIRES_LOGIN_BUT_MISSING_ACTIVE_USER",
        "ACCOUNT_LOGIN_READY",
        "BLOCKER",
        profile,
        "Manager-assigned EmploymentProfile lacks an active linked account.",
        generatedAt,
        user ? [userSummary(user)] : [],
      ));
    }
    if (isProfileReady(profile)) {
      const termsIssue = employmentTermsIssue(
        profile,
        employmentTermsFacts.get(profile.id),
        generatedAt,
      );
      if (termsIssue) issues.push(termsIssue);
    }
  }

  for (const talent of snapshot.talents.filter(
    (item) => item.talentOrigin === "INTERNAL" && item.operationalStatus !== "ARCHIVED",
  )) {
    const profile = talent.linkedEmploymentProfileId
      ? profiles.get(talent.linkedEmploymentProfileId)
      : undefined;
    const displayTalent = withCanonicalInternalTalentDisplay(talent, profile);
    if (!profile) {
      issues.push(talentIssue(
        "INTERNAL_TALENT_MISSING_EMPLOYMENT_PROFILE",
        "TALENTGROUP_MEMBER_LINKAGE",
        "BLOCKER",
        displayTalent,
        "Internal Talent has no linked EmploymentProfile.",
        generatedAt,
      ));
    } else if (!isProfileReady(profile)) {
      issues.push(talentIssue(
        "INTERNAL_TALENT_LINKED_PROFILE_NOT_ACTIVE",
        "TALENTGROUP_MEMBER_LINKAGE",
        "BLOCKER",
        displayTalent,
        "Internal Talent is linked to a non-operational EmploymentProfile.",
        generatedAt,
        [profileSummary(profile)],
      ));
    }
  }

  for (const talent of snapshot.talents.filter(
    (item) => item.talentOrigin === "EXTERNAL" && item.operationalStatus !== "ARCHIVED" && item.linkedEmploymentProfileId,
  )) {
    const profile = profiles.get(talent.linkedEmploymentProfileId as string);
    issues.push(talentIssue(
      "EXTERNAL_TALENT_HAS_EMPLOYMENT_PROFILE_LINK",
      "TALENTGROUP_MEMBER_LINKAGE",
      "WARNING",
      talent,
      "External Talent has a forbidden EmploymentProfile link.",
      generatedAt,
      profile ? [profileSummary(profile)] : [],
    ));
  }

  const activeMembersByGroup = new Map<string, PeopleReadinessTalentGroupMember[]>();
  for (const member of snapshot.talentGroupMembers.filter((item) => item.membershipStatus === "ACTIVE")) {
    const group = groups.get(member.groupId);
    if (!group || group.status !== "ACTIVE") continue;
    const groupMembers = activeMembersByGroup.get(group.id) ?? [];
    groupMembers.push(member);
    activeMembersByGroup.set(group.id, groupMembers);
    const talent = talents.get(member.talentId);
    const profile = talent?.linkedEmploymentProfileId
      ? profiles.get(talent.linkedEmploymentProfileId)
      : undefined;
    const displayTalent = talent
      ? withCanonicalInternalTalentDisplay(talent, profile)
      : undefined;
    if (!talent || talent.operationalStatus !== "ACTIVE") {
      issues.push(memberIssue(
        "TALENTGROUP_ACTIVE_MEMBER_TALENT_NOT_ACTIVE",
        member, group, displayTalent, profile,
        "Active TalentGroup membership points to an inactive, archived, or missing Talent.",
        generatedAt,
      ));
    }
    if (!profile) {
      issues.push(memberIssue(
        "TALENTGROUP_ACTIVE_MEMBER_MISSING_EMPLOYMENT_PROFILE",
        member, group, displayTalent, profile,
        "Active TalentGroup member has no linked EmploymentProfile.",
        generatedAt,
      ));
    } else if (!isProfileReady(profile)) {
      issues.push(memberIssue(
        "TALENTGROUP_ACTIVE_MEMBER_LINKED_PROFILE_NOT_ACTIVE",
        member, group, displayTalent, profile,
        "Active TalentGroup member is linked to a non-operational EmploymentProfile.",
        generatedAt,
      ));
    }
  }

  for (const group of snapshot.talentGroups.filter((item) => item.status === "ACTIVE")) {
    const hasOperationalMember = (activeMembersByGroup.get(group.id) ?? []).some((member) => {
      const talent = talents.get(member.talentId);
      const profile = talent?.linkedEmploymentProfileId
        ? profiles.get(talent.linkedEmploymentProfileId)
        : undefined;
      return talent?.operationalStatus === "ACTIVE" && !!profile && isProfileReady(profile);
    });
    if (!hasOperationalMember) {
      issues.push(issue({
        code: "TALENTGROUP_HAS_NO_OPERATIONAL_MEMBERS",
        category: "TALENTGROUP_MEMBER_LINKAGE",
        severity: "WARNING",
        primary: groupSummary(group),
        related: [],
        summary: "Active TalentGroup has no active operational EmploymentProfile members.",
        repair: repair(groupSummary(group), "Review TalentGroup membership and links"),
        generatedAt,
        blocking: true,
      }));
    }
  }

  for (const orgUnit of snapshot.orgUnits.filter((item) => item.status === "ACTIVE")) {
    const hasReadyProfile = snapshot.employmentProfiles.some(
      (profile) => profile.orgUnitId === orgUnit.id && isProfileReady(profile),
    );
    if (!hasReadyProfile) {
      issues.push(issue({
        code: "ORGUNIT_HAS_NO_ACTIVE_EMPLOYMENT_PROFILES",
        category: "ORGUNIT_PARTICIPATION",
        severity: "WARNING",
        primary: orgUnitSummary(orgUnit),
        related: [],
        summary: "Active OrgUnit has no active or on-leave EmploymentProfiles.",
        repair: repair(orgUnitSummary(orgUnit), "Review OrgUnit membership"),
        generatedAt,
        blocking: false,
      }));
    }
  }

  effectiveOrgAssignments.forEach((assignment) => addManagerAssignmentIssues({
    issues, assignment, target: orgUnits.get(assignment.targetId), profile: profiles.get(assignment.managerEmploymentProfileId),
    users, generatedAt, assignmentType: "ORG_UNIT_MANAGER_ASSIGNMENT",
  }));
  effectiveGroupAssignments.forEach((assignment) => addManagerAssignmentIssues({
    issues, assignment, target: groups.get(assignment.targetId), profile: profiles.get(assignment.managerEmploymentProfileId),
    users, generatedAt, assignmentType: "TALENT_GROUP_MANAGER_ASSIGNMENT",
  }));

  return issues.sort(compareIssues);
}

function employmentTermsIssue(
  profile: PeopleReadinessEmploymentProfile,
  facts: EmploymentTermsReadinessFacts | undefined,
  generatedAt: number,
): PeopleReadinessIssue | null {
  const safeFacts = facts ?? {
    hasOnlyNonPayrollEligibleTerms: false,
    hasPendingApproval: false,
    hasCurrentValidSource: false,
    hasExpiredApprovedSource: false,
    hasCurrentCandidateMissingBaseSalary: false,
    hasOverlap: false,
  };
  let code: PeopleReadinessIssueCode;
  let severity: PeopleReadinessSeverity = "BLOCKER";
  let summary: string;

  if (safeFacts.hasOverlap) {
    code = "EMPLOYMENT_TERMS_OVERLAP";
    summary = "Approved payroll-source Employment Terms have overlapping effective ranges.";
  } else if (safeFacts.hasCurrentCandidateMissingBaseSalary) {
    code = "EMPLOYMENT_TERMS_MISSING_BASE_SALARY";
    summary = "Current payroll-source Employment Terms are missing valid base salary data.";
  } else if (safeFacts.hasPendingApproval) {
    code = "EMPLOYMENT_TERMS_PENDING_APPROVAL";
    severity = safeFacts.hasCurrentValidSource ? "WARNING" : "BLOCKER";
    summary = "Employment Terms are pending approval.";
  } else if (safeFacts.hasExpiredApprovedSource && !safeFacts.hasCurrentValidSource) {
    code = "EMPLOYMENT_TERMS_EXPIRED";
    summary = "Approved payroll-source Employment Terms have expired without a current replacement.";
  } else if (
    !safeFacts.hasCurrentValidSource
    && !safeFacts.hasOnlyNonPayrollEligibleTerms
  ) {
    code = "ACTIVE_PROFILE_MISSING_EMPLOYMENT_TERMS";
    summary = "Operational EmploymentProfile has no current approved payroll-source Employment Terms.";
  } else {
    return null;
  }

  const primary = profileSummary(profile);
  return issue({
    code,
    category: "EMPLOYMENT_TERMS_READY",
    severity,
    primary,
    related: [],
    summary,
    repair: {
      targetType: "EMPLOYMENT_PROFILE",
      targetId: profile.id,
      suggestedSurface: `/employment-profiles/${profile.id}#employment-terms`,
      suggestedAction: "Review Employment Terms",
    },
    generatedAt,
    blocking: severity === "BLOCKER",
  });
}

function addManagerAssignmentIssues(params: {
  issues: PeopleReadinessIssue[];
  assignment: PeopleReadinessManagerAssignment;
  target?: PeopleReadinessOrgUnit | PeopleReadinessTalentGroup;
  profile?: PeopleReadinessEmploymentProfile;
  users: ReadonlyMap<string, PeopleReadinessUser>;
  generatedAt: number;
  assignmentType: "ORG_UNIT_MANAGER_ASSIGNMENT" | "TALENT_GROUP_MANAGER_ASSIGNMENT";
}): void {
  const { assignment, profile, generatedAt } = params;
  const targetSummary = params.target
    ? "code" in params.target ? orgUnitSummary(params.target) : groupSummary(params.target)
    : undefined;
  const primary = assignmentSummary(assignment, params.assignmentType);
  const related = [
    ...(targetSummary ? [targetSummary] : []),
    ...(profile ? [profileSummary(profile)] : []),
  ];
  const prefix = params.assignmentType === "ORG_UNIT_MANAGER_ASSIGNMENT"
    ? "ORGUNIT_MANAGER_ASSIGNMENT"
    : "TALENTGROUP_MANAGER_ASSIGNMENT";
  if (!profile || !isProfileReady(profile)) {
    params.issues.push(issue({
      code: `${prefix}_MANAGER_NOT_PROFILE_READY` as PeopleReadinessIssueCode,
      category: "MANAGER_ASSIGNMENT_READY",
      severity: "BLOCKER",
      primary,
      related,
      summary: "Active/effective manager assignment manager is not profile-ready.",
      repair: profile ? repair(profileSummary(profile), "Review manager EmploymentProfile lifecycle") : repair(primary, "Review manager assignment"),
      generatedAt,
      blocking: true,
    }));
  }
  const user = profile?.linkedUserId ? params.users.get(profile.linkedUserId) : undefined;
  const accountContexts = normalizeAccountContexts(user?.accountContexts);
  if (
    !user ||
    user.accountStatus !== "ACTIVE" ||
    !accountContexts.includes("MANAGER_CONSOLE")
  ) {
    params.issues.push(issue({
      code: `${prefix}_MANAGER_NOT_LOGIN_READY` as PeopleReadinessIssueCode,
      category: "MANAGER_ASSIGNMENT_READY",
      severity: "BLOCKER",
      primary,
      related: [...related, ...(user ? [userSummary(user)] : [])],
      summary: "Active/effective manager assignment manager lacks an active linked account.",
      repair: profile ? repair(profileSummary(profile), "Review manager account linkage") : repair(primary, "Review manager assignment"),
      generatedAt,
      blocking: true,
    }));
  }
}

function issue(input: {
  code: PeopleReadinessIssueCode;
  category: PeopleReadinessCategory;
  severity: PeopleReadinessSeverity;
  primary: PeopleReadinessSafeEntitySummary;
  related: readonly PeopleReadinessSafeEntitySummary[];
  summary: string;
  repair: PeopleReadinessIssue["repairTarget"];
  generatedAt: number;
  blocking: boolean;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}): PeopleReadinessIssue {
  return {
    id: `${input.code}:${input.primary.entityType}:${input.primary.id}`,
    issueCode: input.code,
    category: input.category,
    severity: input.severity,
    primaryEntityType: input.primary.entityType,
    primaryEntity: input.primary,
    relatedEntities: input.related,
    summary: input.summary,
    repairTarget: input.repair,
    generatedAt: input.generatedAt,
    isBlockingForNewOperations: input.blocking,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function profileIssue(
  code: PeopleReadinessIssueCode,
  category: PeopleReadinessCategory,
  severity: PeopleReadinessSeverity,
  profile: PeopleReadinessEmploymentProfile,
  summary: string,
  generatedAt: number,
  related: readonly PeopleReadinessSafeEntitySummary[] = [],
): PeopleReadinessIssue {
  const primary = profileSummary(profile);
  return issue({ code, category, severity, primary, related, summary, repair: repair(primary, "Review EmploymentProfile readiness"), generatedAt, blocking: severity === "BLOCKER" });
}

function talentIssue(
  code: PeopleReadinessIssueCode,
  category: PeopleReadinessCategory,
  severity: PeopleReadinessSeverity,
  talent: PeopleReadinessTalent,
  summary: string,
  generatedAt: number,
  related: readonly PeopleReadinessSafeEntitySummary[] = [],
): PeopleReadinessIssue {
  const primary = talentSummary(talent);
  return issue({ code, category, severity, primary, related, summary, repair: repair(primary, "Review Talent employment link"), generatedAt, blocking: severity === "BLOCKER" });
}

function memberIssue(
  code: PeopleReadinessIssueCode,
  member: PeopleReadinessTalentGroupMember,
  group: PeopleReadinessTalentGroup,
  talent: PeopleReadinessTalent | undefined,
  profile: PeopleReadinessEmploymentProfile | undefined,
  summary: string,
  generatedAt: number,
): PeopleReadinessIssue {
  const primary = memberSummary(member);
  return issue({
    code,
    category: "TALENTGROUP_MEMBER_LINKAGE",
    severity: "BLOCKER",
    primary,
    related: [groupSummary(group), ...(talent ? [talentSummary(talent)] : []), ...(profile ? [profileSummary(profile)] : [])],
    summary,
    repair: repair(groupSummary(group), "Review TalentGroup membership"),
    generatedAt,
    blocking: true,
  });
}

function userSummary(user: PeopleReadinessUser): PeopleReadinessSafeEntitySummary {
  return { entityType: "USER", id: user.id, displayName: user.displayName, status: user.accountStatus, adminRepairTarget: `/users/${user.id}` };
}
function profileSummary(profile: PeopleReadinessEmploymentProfile): PeopleReadinessSafeEntitySummary {
  return { entityType: "EMPLOYMENT_PROFILE", id: profile.id, displayName: profile.displayName, code: profile.employeeCode, lifecycleStatus: profile.employmentStatus, adminRepairTarget: `/employment-profiles/${profile.id}` };
}
function talentSummary(talent: PeopleReadinessTalent): PeopleReadinessSafeEntitySummary {
  return { entityType: "TALENT", id: talent.id, displayName: talent.displayName, code: talent.talentCode, status: talent.operationalStatus, adminRepairTarget: `/talents/${talent.id}` };
}
function orgUnitSummary(orgUnit: PeopleReadinessOrgUnit): PeopleReadinessSafeEntitySummary {
  return { entityType: "ORG_UNIT", id: orgUnit.id, displayName: orgUnit.name, code: orgUnit.code, status: orgUnit.status, adminRepairTarget: `/org-units/${orgUnit.id}` };
}
function groupSummary(group: PeopleReadinessTalentGroup): PeopleReadinessSafeEntitySummary {
  return { entityType: "TALENT_GROUP", id: group.id, displayName: group.name, code: group.groupCode, status: group.status, adminRepairTarget: `/talent-groups/${group.id}` };
}
function memberSummary(member: PeopleReadinessTalentGroupMember): PeopleReadinessSafeEntitySummary {
  return { entityType: "TALENT_GROUP_MEMBER", id: member.id, displayName: `TalentGroup member ${member.id}`, status: member.membershipStatus, adminRepairTarget: `/talent-groups/${member.groupId}` };
}
function assignmentSummary(
  assignment: PeopleReadinessManagerAssignment,
  entityType: "ORG_UNIT_MANAGER_ASSIGNMENT" | "TALENT_GROUP_MANAGER_ASSIGNMENT",
): PeopleReadinessSafeEntitySummary {
  return { entityType, id: assignment.id, displayName: `${assignment.role} assignment`, status: assignment.status };
}
function repair(entity: PeopleReadinessSafeEntitySummary, suggestedAction: string): PeopleReadinessIssue["repairTarget"] {
  return { targetType: entity.entityType, targetId: entity.id, suggestedSurface: entity.adminRepairTarget ?? "ADMIN_PEOPLE_READINESS", suggestedAction };
}

function isProfileReady(profile: PeopleReadinessEmploymentProfile): boolean {
  return OPERATIONALLY_READY_STATUSES.has(profile.employmentStatus);
}
function withCanonicalInternalTalentDisplay(
  talent: PeopleReadinessTalent,
  profile: PeopleReadinessEmploymentProfile | undefined,
): PeopleReadinessTalent {
  if (talent.talentOrigin !== "INTERNAL" || !profile) return talent;
  return { ...talent, displayName: profile.displayName };
}
function isEffectiveAssignment(assignment: PeopleReadinessManagerAssignment, asOf: number): boolean {
  return assignment.status === "ACTIVE" && assignment.effectiveFrom <= asOf && (assignment.effectiveTo === null || assignment.effectiveTo >= asOf);
}
function countBy(issues: readonly PeopleReadinessIssue[], key: (issue: PeopleReadinessIssue) => string): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const issue of issues) counts[key(issue)] = (counts[key(issue)] ?? 0) + 1;
  return counts;
}
function compareIssues(left: PeopleReadinessIssue, right: PeopleReadinessIssue): number {
  const severityOrder: Record<PeopleReadinessSeverity, number> = { BLOCKER: 0, WARNING: 1, INFO: 2 };
  return severityOrder[left.severity] - severityOrder[right.severity]
    || left.category.localeCompare(right.category)
    || left.issueCode.localeCompare(right.issueCode)
    || left.primaryEntity.displayName.localeCompare(right.primaryEntity.displayName)
    || left.id.localeCompare(right.id);
}
function matchesFilters(issue: PeopleReadinessIssue, filters: PeopleReadinessAppliedFilters): boolean {
  return (!filters.category || issue.category === filters.category)
    && (!filters.issueCode || issue.issueCode === filters.issueCode)
    && (!filters.severity || issue.severity === filters.severity)
    && (!filters.entityType || issue.primaryEntityType === filters.entityType);
}
function parseFilters(query: ListPeopleReadinessIssuesQuery): PeopleReadinessAppliedFilters {
  return {
    ...(query.category ? { category: parseEnum(query.category, PEOPLE_READINESS_CATEGORIES, "category") } : {}),
    ...(query.issueCode ? { issueCode: parseEnum(query.issueCode, PEOPLE_READINESS_ISSUE_CODES, "issueCode") } : {}),
    ...(query.severity ? { severity: parseEnum(query.severity, PEOPLE_READINESS_SEVERITIES, "severity") } : {}),
    ...(query.entityType ? { entityType: parseEntityType(query.entityType) } : {}),
  };
}
function parseEnum<T extends string>(value: string, values: readonly T[], name: string): T {
  if (values.includes(value as T)) return value as T;
  throw new PeopleReadinessValidationError(`Unsupported ${name}: ${value}`);
}
function parseEntityType(value: string): PeopleReadinessEntityType {
  const values: readonly PeopleReadinessEntityType[] = [
    "USER", "EMPLOYMENT_PROFILE", "TALENT", "ORG_UNIT", "TALENT_GROUP",
    "TALENT_GROUP_MEMBER", "ORG_UNIT_MANAGER_ASSIGNMENT", "TALENT_GROUP_MANAGER_ASSIGNMENT",
  ];
  return parseEnum(value, values, "entityType");
}
function parseLimit(value?: string): number {
  if (value === undefined) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new PeopleReadinessValidationError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return parsed;
}
function parseCursor(value?: string): number {
  if (value === undefined) return 0;
  try {
    const parsed = Number(Buffer.from(value, "base64url").toString("utf8"));
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  } catch {}
  throw new PeopleReadinessValidationError("cursor is invalid");
}
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}
