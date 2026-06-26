import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import {
  buildMonthlyRosterPreview,
  rosterMonthUtcWindow as buildRosterMonthUtcWindow,
} from "@modules/work-schedule/domain/work-schedule-roster-preview";
import {
  WorkScheduleNotFoundError,
  WorkSchedulePermissionScopeError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import {
  WorkScheduleEmploymentProfileReadonlyAccess,
  WorkScheduleReferencedEmploymentProfile,
} from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import { WorkScheduleOrgUnitReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-org-unit-readonly-access";
import { WorkScheduleTalentGroupReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-talent-group-readonly-access";
import {
  HOLIDAY_CALENDAR_TIMEZONE,
  MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE,
  MONTHLY_ROSTER_TARGET_SUBJECT_KIND,
  MONTHLY_ROSTER_TARGET_TYPES,
  MONTHLY_ROSTER_TIMEZONE,
  MONTHLY_ROSTER_STATUSES,
  MonthlyRosterMemberExclusionReasonCode,
  MonthlyRosterStatus,
  MonthlyRosterTargetType,
  MonthlyRosterPreviewView,
  MonthlyRosterView,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  HolidayCalendarReadRepository,
  MonthlyRosterReadRepository,
  WorkPatternReadRepository,
  WorkShiftReadRepository,
} from "@modules/work-schedule/read/work-schedule.read-repository";
import {
  GetMonthlyRosterDetailQuery,
  GetMonthlyRosterDetailResult,
  ListMonthlyRostersQuery,
  ListMonthlyRostersResult,
  PreviewMonthlyRosterQuery,
  PreviewMonthlyRosterResult,
} from "@modules/work-schedule/shared/work-schedule.contracts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class MonthlyRosterAdminQueryService {
  constructor(
    private readonly readRepository: MonthlyRosterReadRepository,
    private readonly employmentProfileReadonlyAccess: WorkScheduleEmploymentProfileReadonlyAccess,
    private readonly workPatternReadRepository: WorkPatternReadRepository,
    private readonly holidayCalendarReadRepository: HolidayCalendarReadRepository,
    private readonly workShiftReadRepository: WorkShiftReadRepository,
    private readonly orgUnitReadonlyAccess: WorkScheduleOrgUnitReadonlyAccess,
    private readonly talentGroupReadonlyAccess: WorkScheduleTalentGroupReadonlyAccess = createMissingTalentGroupReadonlyAccess(),
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
  ) {}

  async listMonthlyRosters(
    actor: Actor,
    query: ListMonthlyRostersQuery,
  ): Promise<ListMonthlyRostersResult> {
    this.assertReadPermission(actor);
    const scope = parseRequestedScope(query.scope);
    const departmentOrgUnitId =
      normalizeOptionalText(
        query.departmentOrgUnitId,
        "departmentOrgUnitId",
      );
    const targetType =
      query.targetType === undefined
        ? undefined
        : normalizeRosterTargetType(query.targetType);
    const targetOrgUnitId = normalizeOptionalText(
      query.targetOrgUnitId,
      "targetOrgUnitId",
    );
    const targetTalentGroupId = normalizeOptionalText(
      query.targetTalentGroupId,
      "targetTalentGroupId",
    );
    await this.assertRosterReadScope(
      actor,
      scope,
    );

    return this.readRepository.listMonthlyRosters({
      status: parseOptionalStatus(query.status),
      rosterMonth:
        query.rosterMonth === undefined
          ? undefined
          : normalizeRosterMonth(query.rosterMonth),
      departmentOrgUnitId,
      targetType,
      targetOrgUnitId,
      targetTalentGroupId,
      workPatternId: normalizeOptionalText(
        query.workPatternId,
        "workPatternId",
      ),
      holidayCalendarId: normalizeOptionalText(
        query.holidayCalendarId,
        "holidayCalendarId",
      ),
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
    });
  }

  async getMonthlyRosterDetail(
    actor: Actor,
    query: GetMonthlyRosterDetailQuery,
  ): Promise<GetMonthlyRosterDetailResult> {
    this.assertReadPermission(actor);
    const monthlyRosterId = normalizeRequiredText(
      query.monthlyRosterId,
      "monthlyRosterId",
    );
    const detail =
      await this.readRepository.getMonthlyRosterDetail(
        monthlyRosterId,
      );

    if (!detail) {
      throw new WorkScheduleNotFoundError(
        monthlyRosterId,
      );
    }

    await this.requireStructuredRosterReadAuthority(
      actor,
      detail,
      parseRequestedScope(query.scope),
    );

    return detail;
  }

  async previewMonthlyRoster(
    actor: Actor,
    query: PreviewMonthlyRosterQuery,
  ): Promise<PreviewMonthlyRosterResult> {
    this.assertReadPermission(actor);
    const monthlyRosterId = normalizeRequiredText(
      query.monthlyRosterId,
      "monthlyRosterId",
    );
    const roster =
      await this.readRepository.getMonthlyRosterDetail(
        monthlyRosterId,
      );

    if (!roster) {
      throw new WorkScheduleNotFoundError(
        monthlyRosterId,
      );
    }

    await this.requireStructuredRosterReadAuthority(
      actor,
      roster,
      parseRequestedScope(query.scope),
    );

    assertPreviewRosterState(roster);
    await this.assertActiveRosterTarget(roster);

    const pattern =
      await this.workPatternReadRepository.getWorkPatternDetail(
        roster.workPatternId,
      );

    if (!pattern || pattern.status !== "ACTIVE") {
      throw new WorkScheduleValidationError(
        `Work Pattern must be ACTIVE for Monthly Roster preview: ${roster.workPatternId}`,
      );
    }

    if (pattern.timezone !== MONTHLY_ROSTER_TIMEZONE) {
      throw new WorkScheduleValidationError(
        `Work Pattern timezone must be ${MONTHLY_ROSTER_TIMEZONE}`,
      );
    }

    const calendar =
      await this.holidayCalendarReadRepository.getHolidayCalendarDetail(
        roster.holidayCalendarId,
      );

    if (!calendar || calendar.status !== "ACTIVE") {
      throw new WorkScheduleValidationError(
        `Holiday Calendar must be ACTIVE for Monthly Roster preview: ${roster.holidayCalendarId}`,
      );
    }

    if (
      calendar.scopeType !== "GLOBAL" ||
      calendar.timezone !== HOLIDAY_CALENDAR_TIMEZONE
    ) {
      throw new WorkScheduleValidationError(
        `Holiday Calendar must be GLOBAL and ${HOLIDAY_CALENDAR_TIMEZONE}`,
      );
    }

    const memberResolution =
      await this.resolveRosterMembers(roster);
    const profiles = memberResolution.eligibleProfiles;
    const eligibleProfileIds = profiles.map(
      (profile) => profile.id,
    );
    const monthWindow = buildRosterMonthUtcWindow(
      roster.rosterMonth,
    );
    const activeShifts =
      await this.workShiftReadRepository.listActiveEmploymentProfileShiftsForWindow(
        {
          subjectEmploymentProfileIds:
            eligibleProfileIds,
          windowStartAt: monthWindow.windowStartAt,
          windowEndAt: monthWindow.windowEndAt,
        },
      );
    const preview = buildMonthlyRosterPreview({
      roster,
      pattern,
      activeHolidayEntries: calendar.entries.filter(
        (entry) => entry.status === "ACTIVE",
      ),
      eligibleProfiles: profiles.map((profile) => ({
        id: profile.id,
        employmentStatus: "ACTIVE",
        orgUnitId: profile.orgUnitId,
      })),
      excludedMembers:
        memberResolution.excludedMembers,
      existingActiveShifts: activeShifts,
    });

    return enrichMonthlyRosterPreviewReferences(
      preview,
      roster,
      profiles,
    );
  }

  private assertReadPermission(actor: Actor): void {
    assertAdminActorType(actor);

    const permission =
      PermissionResolver.resolve(
        Permission.WORK_SCHEDULE_READ,
      );
    PermissionGuard.assert(actor, permission);
  }

  private async assertRosterReadScope(
    actor: Actor,
    requestedScope: "global" | undefined,
  ): Promise<void> {
    if (
      requestedScope !== undefined &&
      requestedScope !== "global"
    ) {
      throw new WorkSchedulePermissionScopeError(
        "Admin Monthly Roster reads require workSchedule.global scope",
      );
    }

    if (
      !PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "global",
      )
    ) {
      throw new WorkSchedulePermissionScopeError(
        "Admin Monthly Roster reads require workSchedule.global scope",
      );
    }
  }

  private async requireStructuredRosterReadAuthority(
    actor: Actor,
    roster: MonthlyRosterView,
    requestedScope: "global" | undefined,
  ): Promise<void> {
    if (requestedScope !== undefined && requestedScope !== "global") {
      throw new WorkSchedulePermissionScopeError(
        "Admin Monthly Roster reads accept only the legacy global request context",
      );
    }

    const scope = buildStructuredRosterScope(roster);
    await requireAdminObjectScopeAuthority({
      actor,
      permission: Permission.WORK_SCHEDULE_READ,
      scope,
      authority: this.structuredAuthority,
      error: new WorkSchedulePermissionScopeError(
        `Monthly Roster read requires matching ${scope.scopeType} authority for target ${scope.targetId}`,
      ),
    });
  }

  private async assertActiveRosterTarget(
    roster: MonthlyRosterView,
  ): Promise<void> {
    if (roster.targetMode !== "EXACT_ONLY") {
      throw new WorkScheduleValidationError(
        "Monthly Roster targetMode must be EXACT_ONLY",
      );
    }

    if (roster.targetType === "ORG_UNIT") {
      const targetOrgUnitId = requireRosterTargetId(
        roster.targetOrgUnitId,
        "targetOrgUnitId",
      );
      const orgUnit =
        await this.orgUnitReadonlyAccess.findById(
          targetOrgUnitId,
        );

      if (!orgUnit) {
        throw new WorkScheduleValidationError(
          `Roster target Org Unit does not exist: ${targetOrgUnitId}`,
        );
      }

      if (orgUnit.status !== "ACTIVE") {
        throw new WorkScheduleValidationError(
          `Roster target Org Unit must be ACTIVE: ${targetOrgUnitId}`,
        );
      }

      return;
    }

    const targetTalentGroupId = requireRosterTargetId(
      roster.targetTalentGroupId,
      "targetTalentGroupId",
    );
    const talentGroup =
      await this.talentGroupReadonlyAccess.findById(
        targetTalentGroupId,
      );

    if (!talentGroup) {
      throw new WorkScheduleValidationError(
        `Roster target Talent Group does not exist: ${targetTalentGroupId}`,
      );
    }

    if (talentGroup.status !== "ACTIVE") {
      throw new WorkScheduleValidationError(
        `Roster target Talent Group must be ACTIVE: ${targetTalentGroupId}`,
      );
    }
  }

  private async resolveRosterMembers(
    roster: MonthlyRosterView,
  ): Promise<{
    readonly eligibleProfiles: readonly WorkScheduleReferencedEmploymentProfile[];
    readonly excludedMembers: MonthlyRosterPreviewView["excludedMembers"];
  }> {
    if (roster.targetType === "ORG_UNIT") {
      const targetOrgUnitId = requireRosterTargetId(
        roster.targetOrgUnitId,
        "targetOrgUnitId",
      );
      const eligibleProfiles = (
        await this.employmentProfileReadonlyAccess.listByOrgUnitId(
          targetOrgUnitId,
        )
      )
        .filter(
          (profile) =>
            profile.employmentStatus === "ACTIVE" &&
            profile.orgUnitId === targetOrgUnitId,
        )
        .sort((left, right) =>
          left.id.localeCompare(right.id),
        );

      return {
        eligibleProfiles,
        excludedMembers: [],
      };
    }

    const targetTalentGroupId = requireRosterTargetId(
      roster.targetTalentGroupId,
      "targetTalentGroupId",
    );
    const resolutions =
      await this.employmentProfileReadonlyAccess.listTalentGroupMemberEmploymentProfileResolutions(
        targetTalentGroupId,
      );
    const seenEmploymentProfileIds = new Set<string>();
    const eligibleProfiles: WorkScheduleReferencedEmploymentProfile[] = [];
    const excludedMembers: MonthlyRosterPreviewView["excludedMembers"][number][] = [];

    for (const resolution of resolutions) {
      const reasonCode =
        getTalentGroupMemberExclusionReason(
          resolution,
          seenEmploymentProfileIds,
        );

      if (reasonCode) {
        excludedMembers.push({
          memberId: resolution.memberId,
          talentId: resolution.talentId,
          linkedEmploymentProfileId:
            resolution.linkedEmploymentProfileId,
          linkedEmploymentProfileRef:
            resolution.employmentProfile?.ref ?? null,
          reasonCode,
        });
        continue;
      }

      const employmentProfile =
        resolution.employmentProfile as WorkScheduleReferencedEmploymentProfile;
      seenEmploymentProfileIds.add(employmentProfile.id);
      eligibleProfiles.push(employmentProfile);
    }

    return {
      eligibleProfiles: eligibleProfiles.sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      excludedMembers,
    };
  }
}

function parseOptionalStatus(
  value: unknown,
): MonthlyRosterStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `status must be one of ${MONTHLY_ROSTER_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    MONTHLY_ROSTER_STATUSES.includes(
      normalized as MonthlyRosterStatus,
    )
  ) {
    return normalized as MonthlyRosterStatus;
  }

  throw new WorkScheduleValidationError(
    `status must be one of ${MONTHLY_ROSTER_STATUSES.join(", ")}`,
  );
}

function normalizeRosterMonth(value: unknown): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "rosterMonth must be a YYYY-MM string",
    );
  }

  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})$/u.exec(
    normalized,
  );

  if (!match) {
    throw new WorkScheduleValidationError(
      "rosterMonth must be a YYYY-MM string",
    );
  }

  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    throw new WorkScheduleValidationError(
      "rosterMonth must contain a real calendar month",
    );
  }

  return normalized;
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_LIMIT;
  }

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_LIMIT
  ) {
    throw new WorkScheduleValidationError(
      `limit must be an integer between 1 and ${MAX_LIMIT}`,
    );
  }

  return parsed;
}

function parseOptionalCursor(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "cursor must be a string",
    );
  }

  const normalized = value.trim();

  return normalized.length > 0
    ? normalized
    : undefined;
}

function parseOptionalSearch(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "search must be a string",
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();

  return normalized.length > 0
    ? normalized
    : undefined;
}

function enrichMonthlyRosterPreviewReferences(
  preview: MonthlyRosterPreviewView,
  roster: MonthlyRosterView,
  profiles: readonly WorkScheduleReferencedEmploymentProfile[],
): MonthlyRosterPreviewView {
  const profileRefMap = new Map(
    profiles.map((profile) => [profile.id, profile.ref ?? null]),
  );
  const departmentOrgUnitRef =
    roster.departmentOrgUnitRef ?? null;
  const targetOrgUnitRef =
    roster.targetOrgUnitRef ?? null;
  const targetTalentGroupRef =
    roster.targetTalentGroupRef ?? null;
  const targetRef = roster.targetRef ?? null;

  return {
    ...preview,
    targetOrgUnitRef,
    targetTalentGroupRef,
    targetRef,
    departmentOrgUnitRef,
    workPatternRef: roster.workPatternRef ?? null,
    holidayCalendarRef:
      roster.holidayCalendarRef ?? null,
    eligibleProfiles: preview.eligibleProfiles.map(
      (profile) => ({
        ...profile,
        subjectEmploymentProfileRef:
          profileRefMap.get(
            profile.subjectEmploymentProfileId,
          ) ?? null,
        departmentOrgUnitRef,
      }),
    ),
    rows: preview.rows.map((row) => ({
      ...row,
      targetOrgUnitRef,
      targetTalentGroupRef,
      targetRef,
      departmentOrgUnitRef,
      subjectEmploymentProfileRef:
        profileRefMap.get(
          row.subjectEmploymentProfileId,
        ) ?? null,
    })),
    excludedMembers: preview.excludedMembers.map(
      (member) => ({
        ...member,
        linkedEmploymentProfileRef:
          member.linkedEmploymentProfileRef ??
          (member.linkedEmploymentProfileId
            ? (profileRefMap.get(
                member.linkedEmploymentProfileId,
              ) ?? null)
            : null),
      }),
    ),
  };
}

function normalizeOptionalText(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return normalizeRequiredText(value, field);
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new WorkScheduleValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function normalizeRosterTargetType(
  value: unknown,
): MonthlyRosterTargetType {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `targetType must be one of ${MONTHLY_ROSTER_TARGET_TYPES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    MONTHLY_ROSTER_TARGET_TYPES.includes(
      normalized as MonthlyRosterTargetType,
    )
  ) {
    return normalized as MonthlyRosterTargetType;
  }

  throw new WorkScheduleValidationError(
    `targetType must be one of ${MONTHLY_ROSTER_TARGET_TYPES.join(", ")}`,
  );
}

function requireRosterTargetId(
  value: string | null,
  field: string,
): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  throw new WorkScheduleValidationError(
    `${field} is required`,
  );
}

function getTalentGroupMemberExclusionReason(
  resolution: {
    readonly membershipStatus: string;
    readonly talentOperationalStatus: string | null;
    readonly linkedEmploymentProfileId: string | null;
    readonly employmentProfile: WorkScheduleReferencedEmploymentProfile | null;
  },
  seenEmploymentProfileIds: ReadonlySet<string>,
): MonthlyRosterMemberExclusionReasonCode | null {
  if (resolution.membershipStatus !== "ACTIVE") {
    return "MEMBERSHIP_INACTIVE";
  }

  if (resolution.talentOperationalStatus === null) {
    return "TALENT_NOT_FOUND";
  }

  if (resolution.talentOperationalStatus !== "ACTIVE") {
    return "TALENT_INACTIVE";
  }

  if (!resolution.linkedEmploymentProfileId) {
    return "MISSING_LINKED_EMPLOYMENT_PROFILE";
  }

  if (!resolution.employmentProfile) {
    return "EMPLOYMENT_PROFILE_NOT_FOUND";
  }

  if (
    resolution.employmentProfile.employmentStatus !== "ACTIVE"
  ) {
    return "EMPLOYMENT_PROFILE_INACTIVE";
  }

  if (
    seenEmploymentProfileIds.has(
      resolution.employmentProfile.id,
    )
  ) {
    return "DUPLICATE_EMPLOYMENT_PROFILE";
  }

  return null;
}

function parseRequestedScope(
  value: unknown,
): "global" | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkSchedulePermissionScopeError(
      "Admin Monthly Roster reads require workSchedule.global scope",
    );
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "global") {
    return "global";
  }

  throw new WorkSchedulePermissionScopeError(
    "Admin Monthly Roster reads require workSchedule.global scope",
  );
}

function assertPreviewRosterState(
  roster: MonthlyRosterView,
): void {
  if (roster.status === "ARCHIVED") {
    throw new WorkScheduleValidationError(
      "Archived Monthly Rosters cannot be previewed",
    );
  }

  if (roster.timezone !== MONTHLY_ROSTER_TIMEZONE) {
    throw new WorkScheduleValidationError(
      `Monthly Roster timezone must be ${MONTHLY_ROSTER_TIMEZONE}`,
    );
  }

  normalizeRosterMonth(roster.rosterMonth);

  if (
    roster.targetSubjectKind !==
    MONTHLY_ROSTER_TARGET_SUBJECT_KIND
  ) {
    throw new WorkScheduleValidationError(
      "Monthly Roster preview supports only EMPLOYMENT_PROFILE targets in MVP-A",
    );
  }

  if (
    roster.targetOrgUnitMode !==
      MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE ||
    roster.targetMode !== "EXACT_ONLY"
  ) {
    throw new WorkScheduleValidationError(
      "Monthly Roster preview supports only EXACT_ONLY targets",
    );
  }
}

function assertAdminActorType(actor: Actor): void {
  PermissionGuard.assertAdminActor(actor);
}

function createMissingTalentGroupReadonlyAccess(): WorkScheduleTalentGroupReadonlyAccess {
  return {
    async findById(): Promise<null> {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "WorkScheduleTalentGroupReadonlyAccess is required for Monthly Roster Talent Group targets",
      );
    },
  };
}

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId() {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "StructuredScopeAuthorityService is required for Monthly Roster reads",
      );
    },
  });
}

function buildStructuredRosterScope(
  roster: MonthlyRosterView,
):
  | { readonly scopeType: "managedOrgUnit"; readonly targetId: string }
  | { readonly scopeType: "managedTalentGroup"; readonly targetId: string } {
  if (roster.targetMode !== "EXACT_ONLY") {
    throw new WorkSchedulePermissionScopeError(
      "Monthly Roster structured authority requires targetMode EXACT_ONLY",
    );
  }

  if (roster.targetType === "ORG_UNIT") {
    if (roster.targetTalentGroupId !== null) {
      throw new WorkSchedulePermissionScopeError(
        "Malformed ORG_UNIT Monthly Roster target",
      );
    }
    return {
      scopeType: "managedOrgUnit",
      targetId: requireRosterTargetId(
        roster.targetOrgUnitId,
        "targetOrgUnitId",
      ),
    };
  }

  if (roster.targetType === "TALENT_GROUP") {
    if (roster.targetOrgUnitId !== null) {
      throw new WorkSchedulePermissionScopeError(
        "Malformed TALENT_GROUP Monthly Roster target",
      );
    }
    return {
      scopeType: "managedTalentGroup",
      targetId: requireRosterTargetId(
        roster.targetTalentGroupId,
        "targetTalentGroupId",
      ),
    };
  }

  throw new WorkSchedulePermissionScopeError(
    "Unsupported Monthly Roster targetType for structured authority",
  );
}
