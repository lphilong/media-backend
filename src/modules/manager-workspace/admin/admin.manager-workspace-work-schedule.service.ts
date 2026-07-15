import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { ResponsibilityManagedScopeReader } from "@modules/responsibility/domain/responsibility-managed-scope";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import {
  WorkSchedulePermissionScopeError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import {
  WorkScheduleEmploymentProfileReadonlyAccess,
  WorkScheduleReferencedEmploymentProfile,
} from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import { readExactRosterGeneratedTarget } from "@modules/work-schedule/domain/work-schedule-roster-target";
import { WorkShiftSourceType } from "@modules/work-schedule/domain/work-schedule.types";
import { WorkShiftReadRepository } from "@modules/work-schedule/read/work-schedule.read-repository";
import { WorkScheduleAvailabilityBatchRepository } from "@modules/work-schedule/domain/work-schedule-availability.repository";
import { WorkScheduleRequestBatchRepository } from "@modules/work-schedule/domain/work-schedule.repository";
import {
  assertManagerWorkSchedulePermission,
  hasManagerWorkScheduleTarget,
  hasManagerWorkScheduleTargets,
  resolveManagerWorkScheduleTargetAuthority,
} from "@modules/work-schedule/admin/manager-work-schedule-authority";

const DEFAULT_LIMIT = 100;
const MAX_COMPLETE_PAGES = 100;
const TIMEZONE = "Asia/Ho_Chi_Minh" as const;

async function collectAllPages<T>(
  load: (cursor?: string) => Promise<{
    readonly items: readonly T[];
    readonly nextCursor?: string;
  }>,
  family: string,
): Promise<readonly T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_COMPLETE_PAGES; page += 1) {
    const result = await load(cursor);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) return items;
  }
  throw new WorkScheduleValidationError(
    `Weekly schedule exceeds the bounded complete ${family} window`,
  );
}

export interface ManagerWorkShiftListQuery {
  readonly month?: string;
  readonly sourceType?: string;
  readonly search?: string;
  readonly cursor?: string;
}

export interface ManagerWorkShiftListItemView {
  readonly workShiftId: string;
  readonly title: string;
  readonly status: "ACTIVE";
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly timezone: typeof TIMEZONE;
  readonly sourceType: WorkShiftSourceType;
  readonly sourceRosterMonth: string | null;
  readonly member: {
    readonly employmentProfileId: string;
    readonly displayName: string;
    readonly employeeCode?: string;
  };
}

export interface ManagerWorkShiftListView {
  readonly items: readonly ManagerWorkShiftListItemView[];
  readonly meta: {
    readonly month: string;
    readonly timezone: typeof TIMEZONE;
    readonly managedMemberCount: number;
    readonly representedMemberCount: number;
    readonly returnedShiftCount: number;
    readonly nextCursor?: string;
  };
}

export interface ManagerWeeklyScheduleQuery {
  readonly scopeType?: string;
  readonly scopeId?: string;
  readonly weekStart?: string;
  readonly search?: string;
  readonly status?: string;
  readonly conflict?: string;
  readonly request?: string;
  readonly cursor?: string;
}

export interface ManagerWeeklyScheduleView {
  readonly scope: {
    readonly type: "ORG_UNIT" | "TALENT_GROUP";
    readonly id: string;
  };
  readonly window: {
    readonly weekStart: string;
    readonly weekEnd: string;
    readonly startAt: number;
    readonly endAt: number;
    readonly timezone: typeof TIMEZONE;
    readonly locked: boolean;
  };
  readonly days: readonly string[];
  readonly rows: readonly {
    readonly member: ManagerWorkShiftListItemView["member"];
    readonly shifts: readonly Omit<ManagerWorkShiftListItemView, "member">[];
    readonly availabilityIndicators: readonly {
      readonly lineId: string;
      readonly dateFrom: string;
      readonly dateTo: string;
      readonly status: string;
      readonly applyStatus: string;
      readonly type: string;
    }[];
    readonly requestIndicators: readonly {
      readonly lineId: string;
      readonly requestType: string;
      readonly status: string;
      readonly requestedStartAt: number | null;
      readonly requestedEndAt: number | null;
    }[];
    readonly conflicts: readonly {
      readonly code: "SHIFT_OVERLAP" | "UNAVAILABLE_WITH_SHIFT";
      readonly date: string;
    }[];
    readonly readiness: "READY" | "UNSCHEDULED" | "CONFLICT" | "LOCKED";
  }[];
  readonly summary: {
    readonly managedMemberCount: number;
    readonly returnedMemberCount: number;
    readonly scheduledMemberCount: number;
    readonly unscheduledMemberCount: number;
    readonly officialShiftCount: number;
    readonly availabilityIndicatorCount: number;
    readonly pendingRequestCount: number;
    readonly appliedRequestCount: number;
    readonly conflictCount: number;
    readonly indicatorCompleteness: "COMPLETE" | "UNAVAILABLE";
  };
  readonly filters: {
    readonly search: string | null;
    readonly status: string | null;
    readonly conflict: string | null;
    readonly request: string | null;
  };
  readonly nextCursor?: string;
}

export class ManagerWorkspaceWorkScheduleAdminService {
  constructor(
    private readonly employmentProfileRepository: Pick<
      EmploymentProfileRepository,
      "findNonArchivedByLinkedUserId"
    >,
    private readonly employmentProfileReadonlyAccess: Pick<
      WorkScheduleEmploymentProfileReadonlyAccess,
      "listByOrgUnitId" | "listTalentGroupMemberEmploymentProfileResolutions"
    >,
    private readonly managedScopeReader: ResponsibilityManagedScopeReader,
    private readonly readRepository: Pick<
      WorkShiftReadRepository,
      "listWorkShifts"
    >,
    private readonly structuredAuthority: StructuredScopeAuthorityService,
    private readonly clock: () => number = Date.now,
    private readonly availabilityRepository?: Pick<
      WorkScheduleAvailabilityBatchRepository,
      "listBatches" | "listLinesByBatchId"
    >,
    private readonly requestRepository?: Pick<
      WorkScheduleRequestBatchRepository,
      "listBatches" | "listLinesByBatchId"
    >,
  ) {}

  async getWeeklySchedule(
    actor: Actor,
    query: ManagerWeeklyScheduleQuery,
  ): Promise<ManagerWeeklyScheduleView> {
    assertManagerWorkSchedulePermission(actor, Permission.WORK_SCHEDULE_READ);
    const managerProfile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );
    if (!managerProfile || !isManagerReady(managerProfile.employmentStatus)) {
      throw new WorkSchedulePermissionScopeError(
        "Manager-ready linked Employment Profile is required",
      );
    }

    const scope = parseWeeklyScope(query.scopeType, query.scopeId);
    const now = this.clock();
    const authority = await resolveManagerWorkScheduleTargetAuthority({
      actor,
      managerEmploymentProfileId: managerProfile.id,
      permission: Permission.WORK_SCHEDULE_READ,
      managedScopeReader: this.managedScopeReader,
      structuredAuthority: this.structuredAuthority,
      asOf: now,
    });
    if (!hasManagerWorkScheduleTarget(authority, scope.type, scope.id)) {
      throw new WorkSchedulePermissionScopeError(
        "Exact assigned Manager WorkSchedule scope is required",
      );
    }

    const profiles = await this.resolveManagedProfiles(
      scope.type === "ORG_UNIT" ? [scope.id] : [],
      scope.type === "TALENT_GROUP" ? [scope.id] : [],
    );
    const week = parseWeek(query.weekStart, now);
    const search = normalizeOptionalText(query.search)?.toLocaleLowerCase();
    const selectedProfiles = new Map(
      [...profiles.entries()].filter(([, profile]) => {
        if (!search) return true;
        const haystack =
          `${profile.ref?.displayName ?? ""} ${profile.ref?.code ?? ""}`.toLocaleLowerCase();
        return haystack.includes(search);
      }),
    );
    if (normalizeOptionalText(query.cursor)) {
      throw new WorkScheduleValidationError(
        "Weekly schedule is a complete member window and does not accept a shift cursor",
      );
    }
    const allShiftItems: Awaited<
      ReturnType<WorkShiftReadRepository["listWorkShifts"]>
    >["items"][number][] = [];
    let shiftCursor: string | undefined;
    for (let page = 0; page < MAX_COMPLETE_PAGES; page += 1) {
      const result = await this.readRepository.listWorkShifts({
        status: "ACTIVE",
        subjectKind: "EMPLOYMENT_PROFILE",
        windowStartAt: week.startAt,
        windowEndAt: week.endAt,
        ...(shiftCursor ? { cursor: shiftCursor } : {}),
        limit: DEFAULT_LIMIT,
        sortField: "shiftStartAt",
        sortDirection: "ASC",
        scopeEmploymentProfileIds: [...selectedProfiles.keys()].sort(),
      });
      allShiftItems.push(...result.items);
      shiftCursor = result.nextCursor;
      if (!shiftCursor) break;
      if (page === MAX_COMPLETE_PAGES - 1) {
        throw new WorkScheduleValidationError(
          "Weekly schedule exceeds the bounded complete shift window",
        );
      }
    }
    const shifts = allShiftItems.filter((shift) => {
      const profileId = shift.subjectEmploymentProfileId;
      if (
        !profileId ||
        !selectedProfiles.has(profileId) ||
        shift.status !== "ACTIVE"
      ) {
        return false;
      }
      if (shift.sourceType !== "ROSTER_GENERATED") return true;
      const target = readExactRosterGeneratedTarget(shift);
      return Boolean(
        target && target.kind === scope.type && target.id === scope.id,
      );
    });

    const months = weekMonths(week.days);
    const availabilityLines = this.availabilityRepository
      ? (
          await Promise.all(
            months.map(async (periodMonth) => {
              const batches = await collectAllPages(
                (cursor) =>
                  this.availabilityRepository!.listBatches({
                    periodMonth,
                    targetType: scope.type,
                    ...(scope.type === "ORG_UNIT"
                      ? { targetOrgUnitId: scope.id }
                      : { targetTalentGroupId: scope.id }),
                    limit: DEFAULT_LIMIT,
                    ...(cursor ? { cursor } : {}),
                  }),
                "availability",
              );
              return (
                await Promise.all(
                  batches.map((batch) =>
                    this.availabilityRepository!.listLinesByBatchId(batch.id),
                  ),
                )
              ).flat();
            }),
          )
        ).flat()
      : [];
    const requestLines = this.requestRepository
      ? (
          await Promise.all(
            months.map(async (periodMonth) => {
              const batches = await collectAllPages(
                (cursor) =>
                  this.requestRepository!.listBatches({
                    periodMonth,
                    submittedByEmploymentProfileId: managerProfile.id,
                    limit: DEFAULT_LIMIT,
                    ...(cursor ? { cursor } : {}),
                  }),
                "request",
              );
              return (
                await Promise.all(
                  batches.map((batch) =>
                    this.requestRepository!.listLinesByBatchId(batch.id),
                  ),
                )
              ).flat();
            }),
          )
        ).flat()
      : [];

    const rows = [...selectedProfiles.values()].map((profile) => {
      const memberShifts = shifts.filter(
        (shift) => shift.subjectEmploymentProfileId === profile.id,
      );
      const memberAvailability = availabilityLines.filter(
        (line) =>
          line.memberEmploymentProfileId === profile.id &&
          line.dateRangeEnd >= week.days[0]! &&
          line.dateRangeStart <= week.days[6]!,
      );
      const memberRequests = requestLines.filter((line) => {
        if (line.memberEmploymentProfileId !== profile.id) return false;
        if (line.requestedStartAt !== null) {
          return (
            line.requestedStartAt >= week.startAt &&
            line.requestedStartAt < week.endAt
          );
        }
        return memberShifts.some((shift) => shift.id === line.workShiftId);
      });
      const conflicts = deriveWeeklyConflicts(memberShifts, memberAvailability);
      const readiness: ManagerWeeklyScheduleView["rows"][number]["readiness"] =
        week.locked
          ? "LOCKED"
          : conflicts.length > 0
            ? "CONFLICT"
            : memberShifts.length === 0
              ? "UNSCHEDULED"
              : "READY";
      return {
        member: {
          employmentProfileId: profile.id,
          displayName:
            profile.ref?.displayName ?? profile.ref?.code ?? profile.id,
          ...(profile.ref?.code ? { employeeCode: profile.ref.code } : {}),
        },
        shifts: memberShifts.map((shift) => ({
          workShiftId: shift.id,
          title: shift.title,
          status: "ACTIVE" as const,
          shiftStartAt: shift.shiftStartAt,
          shiftEndAt: shift.shiftEndAt,
          timezone: TIMEZONE,
          sourceType: shift.sourceType,
          sourceRosterMonth: shift.sourceRosterMonth,
        })),
        availabilityIndicators: memberAvailability.map((line) => ({
          lineId: line.id,
          dateFrom: line.dateRangeStart,
          dateTo: line.dateRangeEnd,
          status: line.status,
          applyStatus: line.applyStatus,
          type: line.availabilityType,
        })),
        requestIndicators: memberRequests.map((line) => ({
          lineId: line.id,
          requestType: line.requestType,
          status: line.status,
          requestedStartAt: line.requestedStartAt,
          requestedEndAt: line.requestedEndAt,
        })),
        conflicts,
        readiness,
      };
    });
    const filteredRows = rows.filter((row) => {
      if (query.status && query.status !== row.readiness) return false;
      if (query.conflict === "WITH_CONFLICT" && row.conflicts.length === 0)
        return false;
      if (query.conflict === "WITHOUT_CONFLICT" && row.conflicts.length > 0)
        return false;
      if (
        query.request === "WITH_REQUEST" &&
        row.requestIndicators.length === 0
      )
        return false;
      if (
        query.request === "WITHOUT_REQUEST" &&
        row.requestIndicators.length > 0
      )
        return false;
      return true;
    });
    const conflictCount = filteredRows.reduce(
      (sum, row) => sum + row.conflicts.length,
      0,
    );
    return {
      scope,
      window: {
        weekStart: week.days[0]!,
        weekEnd: week.days[6]!,
        startAt: week.startAt,
        endAt: week.endAt,
        timezone: TIMEZONE,
        locked: week.locked,
      },
      days: week.days,
      rows: filteredRows,
      summary: {
        managedMemberCount: profiles.size,
        returnedMemberCount: filteredRows.length,
        scheduledMemberCount: filteredRows.filter(
          (row) => row.shifts.length > 0,
        ).length,
        unscheduledMemberCount: filteredRows.filter(
          (row) => row.shifts.length === 0,
        ).length,
        officialShiftCount: filteredRows.reduce(
          (sum, row) => sum + row.shifts.length,
          0,
        ),
        availabilityIndicatorCount: filteredRows.reduce(
          (sum, row) => sum + row.availabilityIndicators.length,
          0,
        ),
        pendingRequestCount: filteredRows.reduce(
          (sum, row) =>
            sum +
            row.requestIndicators.filter((item) => item.status === "PENDING")
              .length,
          0,
        ),
        appliedRequestCount: filteredRows.reduce(
          (sum, row) =>
            sum +
            row.requestIndicators.filter((item) => item.status === "APPROVED")
              .length,
          0,
        ),
        conflictCount,
        indicatorCompleteness:
          this.availabilityRepository && this.requestRepository
            ? "COMPLETE"
            : "UNAVAILABLE",
      },
      filters: {
        search: search ?? null,
        status: normalizeOptionalText(query.status) ?? null,
        conflict: normalizeOptionalText(query.conflict) ?? null,
        request: normalizeOptionalText(query.request) ?? null,
      },
    };
  }

  async listWorkShifts(
    actor: Actor,
    query: ManagerWorkShiftListQuery,
  ): Promise<ManagerWorkShiftListView> {
    assertManagerWorkSchedulePermission(actor, Permission.WORK_SCHEDULE_READ);
    const managerProfile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );

    if (!managerProfile || !isManagerReady(managerProfile.employmentStatus)) {
      throw new WorkSchedulePermissionScopeError(
        "Manager-ready linked Employment Profile is required",
      );
    }

    const asOf = this.clock();
    const targetAuthority = await resolveManagerWorkScheduleTargetAuthority({
      actor,
      managerEmploymentProfileId: managerProfile.id,
      permission: Permission.WORK_SCHEDULE_READ,
      managedScopeReader: this.managedScopeReader,
      structuredAuthority: this.structuredAuthority,
      asOf,
    });
    const orgUnitIds = [...targetAuthority.orgUnitIds];
    const talentGroupIds = [...targetAuthority.talentGroupIds];
    const managedProfiles = await this.resolveManagedProfiles(
      orgUnitIds,
      talentGroupIds,
    );
    const month = parseMonth(query.month, asOf);
    const window = monthWindow(month);

    if (
      !hasManagerWorkScheduleTargets(targetAuthority) ||
      managedProfiles.size === 0
    ) {
      return {
        items: [],
        meta: {
          month,
          timezone: TIMEZONE,
          managedMemberCount: 0,
          representedMemberCount: 0,
          returnedShiftCount: 0,
        },
      };
    }

    const result = await this.readRepository.listWorkShifts({
      status: "ACTIVE",
      subjectKind: "EMPLOYMENT_PROFILE",
      sourceType: parseSourceType(query.sourceType),
      windowStartAt: window.startAt,
      windowEndAt: window.endAt,
      search: normalizeOptionalText(query.search),
      cursor: normalizeOptionalText(query.cursor),
      limit: DEFAULT_LIMIT,
      sortField: "shiftStartAt",
      sortDirection: "ASC",
      scopeEmploymentProfileIds: [...managedProfiles.keys()].sort(),
    });
    const items = result.items.flatMap(
      (shift): ManagerWorkShiftListItemView[] => {
        const employmentProfileId = shift.subjectEmploymentProfileId;
        const profile = employmentProfileId
          ? managedProfiles.get(employmentProfileId)
          : undefined;

        if (!employmentProfileId || !profile || shift.status !== "ACTIVE") {
          return [];
        }
        if (shift.sourceType === "ROSTER_GENERATED") {
          const target = readExactRosterGeneratedTarget(shift);
          if (
            !target ||
            !hasManagerWorkScheduleTarget(
              targetAuthority,
              target.kind,
              target.id,
            )
          ) {
            return [];
          }
        }

        return [
          {
            workShiftId: shift.id,
            title: shift.title,
            status: "ACTIVE",
            shiftStartAt: shift.shiftStartAt,
            shiftEndAt: shift.shiftEndAt,
            timezone: TIMEZONE,
            sourceType: shift.sourceType,
            sourceRosterMonth: shift.sourceRosterMonth,
            member: {
              employmentProfileId,
              displayName:
                profile.ref?.displayName ??
                profile.ref?.code ??
                employmentProfileId,
              ...(profile.ref?.code ? { employeeCode: profile.ref.code } : {}),
            },
          },
        ];
      },
    );

    return {
      items,
      meta: {
        month,
        timezone: TIMEZONE,
        managedMemberCount: managedProfiles.size,
        representedMemberCount: new Set(
          items.map((item) => item.member.employmentProfileId),
        ).size,
        returnedShiftCount: items.length,
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      },
    };
  }

  private async resolveManagedProfiles(
    orgUnitIds: readonly string[],
    talentGroupIds: readonly string[],
  ): Promise<Map<string, WorkScheduleReferencedEmploymentProfile>> {
    const profiles = new Map<string, WorkScheduleReferencedEmploymentProfile>();
    const [orgUnitProfileLists, talentGroupResolutionLists] = await Promise.all(
      [
        Promise.all(
          [...new Set(orgUnitIds)].map((orgUnitId) =>
            this.employmentProfileReadonlyAccess.listByOrgUnitId(orgUnitId),
          ),
        ),
        Promise.all(
          [...new Set(talentGroupIds)].map((talentGroupId) =>
            this.employmentProfileReadonlyAccess.listTalentGroupMemberEmploymentProfileResolutions(
              talentGroupId,
            ),
          ),
        ),
      ],
    );

    for (const profile of orgUnitProfileLists.flat()) {
      if (profile.employmentStatus === "ACTIVE") {
        profiles.set(profile.id, profile);
      }
    }

    for (const resolution of talentGroupResolutionLists.flat()) {
      const profile = resolution.employmentProfile;
      if (
        resolution.membershipStatus === "ACTIVE" &&
        resolution.talentOperationalStatus === "ACTIVE" &&
        profile?.employmentStatus === "ACTIVE"
      ) {
        profiles.set(profile.id, profile);
      }
    }

    return profiles;
  }
}

function isManagerReady(status: string): boolean {
  return status === "ACTIVE" || status === "ON_LEAVE";
}

function parseMonth(value: string | undefined, now: number): string {
  const month = normalizeOptionalText(value);
  if (!month) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
    });
    const parts = formatter.formatToParts(new Date(now));
    const year = parts.find((part) => part.type === "year")?.value;
    const monthPart = parts.find((part) => part.type === "month")?.value;
    return `${year}-${monthPart}`;
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new WorkScheduleValidationError("month must use YYYY-MM");
  }
  return month;
}

function monthWindow(month: string): {
  readonly startAt: number;
  readonly endAt: number;
} {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonth = monthIndex === 11 ? 1 : monthIndex + 2;

  return {
    startAt: Date.parse(`${month}-01T00:00:00+07:00`),
    endAt: Date.parse(
      `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+07:00`,
    ),
  };
}

function parseSourceType(
  value: string | undefined,
): WorkShiftSourceType | undefined {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }
  if (normalized !== "MANUAL" && normalized !== "ROSTER_GENERATED") {
    throw new WorkScheduleValidationError("sourceType is invalid");
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseWeeklyScope(
  typeValue: string | undefined,
  idValue: string | undefined,
): { readonly type: "ORG_UNIT" | "TALENT_GROUP"; readonly id: string } {
  const type = normalizeOptionalText(typeValue);
  const id = normalizeOptionalText(idValue);
  if ((type !== "ORG_UNIT" && type !== "TALENT_GROUP") || !id) {
    throw new WorkScheduleValidationError(
      "scopeType and scopeId must identify one exact assigned scope",
    );
  }
  return { type, id };
}

function parseWeek(
  value: string | undefined,
  now: number,
): {
  readonly startAt: number;
  readonly endAt: number;
  readonly days: readonly string[];
  readonly locked: boolean;
} {
  let start = normalizeOptionalText(value);
  if (!start) {
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now));
    const date = new Date(`${localDate}T00:00:00Z`);
    const offset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    start = date.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    throw new WorkScheduleValidationError("weekStart must use YYYY-MM-DD");
  }
  const anchor = new Date(`${start}T00:00:00Z`);
  if (
    Number.isNaN(anchor.valueOf()) ||
    anchor.toISOString().slice(0, 10) !== start ||
    anchor.getUTCDay() !== 1
  ) {
    throw new WorkScheduleValidationError("weekStart must be a valid Monday");
  }
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(anchor);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  const startAt = Date.parse(`${days[0]}T00:00:00+07:00`);
  const endDate = new Date(anchor);
  endDate.setUTCDate(endDate.getUTCDate() + 7);
  const endAt = Date.parse(
    `${endDate.toISOString().slice(0, 10)}T00:00:00+07:00`,
  );
  return { startAt, endAt, days, locked: endAt <= now };
}

function weekMonths(days: readonly string[]): readonly string[] {
  return [...new Set(days.map((day) => day.slice(0, 7)))];
}

function deriveWeeklyConflicts(
  shifts: readonly {
    readonly shiftStartAt: number;
    readonly shiftEndAt: number;
  }[],
  availability: readonly {
    readonly availabilityType: string;
    readonly dateRangeStart: string;
    readonly dateRangeEnd: string;
  }[],
): readonly {
  readonly code: "SHIFT_OVERLAP" | "UNAVAILABLE_WITH_SHIFT";
  readonly date: string;
}[] {
  const conflicts: {
    code: "SHIFT_OVERLAP" | "UNAVAILABLE_WITH_SHIFT";
    date: string;
  }[] = [];
  const sorted = [...shifts].sort((a, b) => a.shiftStartAt - b.shiftStartAt);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.shiftStartAt < sorted[index - 1]!.shiftEndAt) {
      conflicts.push({
        code: "SHIFT_OVERLAP",
        date: hcmDate(sorted[index]!.shiftStartAt),
      });
    }
  }
  for (const shift of shifts) {
    const date = hcmDate(shift.shiftStartAt);
    if (
      availability.some(
        (line) =>
          line.availabilityType === "UNAVAILABLE_FULL_DAY" &&
          line.dateRangeStart <= date &&
          line.dateRangeEnd >= date,
      )
    ) {
      conflicts.push({ code: "UNAVAILABLE_WITH_SHIFT", date });
    }
  }
  return conflicts.filter(
    (item, index) =>
      conflicts.findIndex(
        (candidate) =>
          candidate.code === item.code && candidate.date === item.date,
      ) === index,
  );
}

function hcmDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}
