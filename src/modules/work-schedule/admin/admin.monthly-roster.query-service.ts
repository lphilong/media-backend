import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
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
import {
  HOLIDAY_CALENDAR_TIMEZONE,
  MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE,
  MONTHLY_ROSTER_TARGET_SUBJECT_KIND,
  MONTHLY_ROSTER_TIMEZONE,
  MONTHLY_ROSTER_STATUSES,
  MonthlyRosterStatus,
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
    await this.assertRosterReadScope(
      actor,
      scope,
      departmentOrgUnitId,
    );

    return this.readRepository.listMonthlyRosters({
      status: parseOptionalStatus(query.status),
      rosterMonth:
        query.rosterMonth === undefined
          ? undefined
          : normalizeRosterMonth(query.rosterMonth),
      departmentOrgUnitId,
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

    await this.assertRosterReadScope(
      actor,
      parseRequestedScope(query.scope),
      detail.departmentOrgUnitId,
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

    await this.assertRosterReadScope(
      actor,
      parseRequestedScope(query.scope),
      roster.departmentOrgUnitId,
    );

    assertPreviewRosterState(roster);
    await this.assertActiveDepartment(
      roster.departmentOrgUnitId,
    );

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

    const profiles = (
      await this.employmentProfileReadonlyAccess.listByOrgUnitId(
        roster.departmentOrgUnitId,
      )
    )
      .filter(
        (profile) =>
          profile.employmentStatus === "ACTIVE" &&
          profile.orgUnitId === roster.departmentOrgUnitId,
      )
      .sort((left, right) =>
        left.id.localeCompare(right.id),
      );
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
    requestedScope: "department" | "global" | undefined,
    departmentOrgUnitId: string | undefined,
  ): Promise<void> {
    if (requestedScope) {
      if (
        !PermissionGuard.hasWorkScheduleScopeGrant(
          actor,
          requestedScope,
        )
      ) {
        throw new WorkSchedulePermissionScopeError(
          `Scope ${requestedScope} is not authorized for actor`,
        );
      }

      if (
        requestedScope === "department"
      ) {
        if (!departmentOrgUnitId) {
          throw new WorkSchedulePermissionScopeError(
            "Department Monthly Roster read scope requires departmentOrgUnitId",
          );
        }

        await this.assertActorDepartment(
          actor,
          departmentOrgUnitId,
        );
      }

      return;
    }

    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "global",
      )
    ) {
      return;
    }

    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "department",
      ) &&
      departmentOrgUnitId
    ) {
      await this.assertActorDepartment(
        actor,
        departmentOrgUnitId,
      );
      return;
    }

    throw new WorkSchedulePermissionScopeError(
      "Monthly Roster read requires global scope or a department-scoped query for the actor's exact department",
    );
  }

  private async assertActorDepartment(
    actor: Actor,
    departmentOrgUnitId: string,
  ): Promise<void> {
    const actorProfile =
      await this.employmentProfileReadonlyAccess.findByLinkedUserId(
        actor.id,
      );

    if (
      !actorProfile ||
      actorProfile.employmentStatus !== "ACTIVE" ||
      actorProfile.orgUnitId !== departmentOrgUnitId
    ) {
      throw new WorkSchedulePermissionScopeError(
        "Department roster scope can read only the actor's exact current department",
      );
    }
  }

  private async assertActiveDepartment(
    departmentOrgUnitId: string,
  ): Promise<void> {
    const orgUnit =
      await this.orgUnitReadonlyAccess.findById(
        departmentOrgUnitId,
      );

    if (!orgUnit) {
      throw new WorkScheduleValidationError(
        `Roster target Org Unit does not exist: ${departmentOrgUnitId}`,
      );
    }

    if (orgUnit.type !== "DEPARTMENT") {
      throw new WorkScheduleValidationError(
        `Roster target Org Unit must be type DEPARTMENT: ${departmentOrgUnitId}`,
      );
    }

    if (orgUnit.status !== "ACTIVE") {
      throw new WorkScheduleValidationError(
        `Roster target Org Unit must be ACTIVE: ${departmentOrgUnitId}`,
      );
    }
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

  return {
    ...preview,
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
      departmentOrgUnitRef,
      subjectEmploymentProfileRef:
        profileRefMap.get(
          row.subjectEmploymentProfileId,
        ) ?? null,
    })),
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

function parseRequestedScope(
  value: unknown,
): "department" | "global" | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "scope must be department or global for Monthly Roster",
    );
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized === "department" ||
    normalized === "global"
  ) {
    return normalized;
  }

  throw new WorkScheduleValidationError(
    "scope must be department or global for Monthly Roster",
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
    MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE
  ) {
    throw new WorkScheduleValidationError(
      "Monthly Roster preview supports only EXACT_ONLY department targets in MVP-A",
    );
  }
}

function assertAdminActorType(actor: Actor): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Monthly Roster access requires actor.type admin, received ${actor.type}`,
  );
}
