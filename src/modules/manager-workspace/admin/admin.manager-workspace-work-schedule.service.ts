import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { ResponsibilityManagedScopeReader } from "@modules/responsibility/domain/responsibility-managed-scope";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { WorkSchedulePermissionScopeError, WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  WorkScheduleEmploymentProfileReadonlyAccess,
  WorkScheduleReferencedEmploymentProfile,
} from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import { WorkShiftSourceType } from "@modules/work-schedule/domain/work-schedule.types";
import { WorkShiftReadRepository } from "@modules/work-schedule/read/work-schedule.read-repository";

const DEFAULT_LIMIT = 100;
const TIMEZONE = "Asia/Ho_Chi_Minh" as const;

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
    private readonly readRepository: Pick<WorkShiftReadRepository, "listWorkShifts">,
    private readonly structuredAuthority: StructuredScopeAuthorityService,
    private readonly clock: () => number = Date.now,
  ) {}

  async listWorkShifts(
    actor: Actor,
    query: ManagerWorkShiftListQuery,
  ): Promise<ManagerWorkShiftListView> {
    this.assertReadAuthority(actor);
    const managerProfile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(actor.id);

    if (!managerProfile || !isManagerReady(managerProfile.employmentStatus)) {
      throw new WorkSchedulePermissionScopeError(
        "Manager-ready linked Employment Profile is required",
      );
    }

    const asOf = this.clock();
    const managedScope =
      await this.managedScopeReader.resolveManagedScopeByResponsibleEmploymentProfile(
        {
          responsibleEmploymentProfileId: managerProfile.id,
          asOf,
        },
      );
    const [orgUnitIds, talentGroupIds] = await Promise.all([
      filterManagedOrgUnitIds(
        this.structuredAuthority,
        actor,
        managedScope.orgUnitIds,
      ),
      filterManagedTalentGroupIds(
        this.structuredAuthority,
        actor,
        managedScope.talentGroupIds,
      ),
    ]);
    const managedProfiles = await this.resolveManagedProfiles(
      orgUnitIds,
      talentGroupIds,
    );
    const month = parseMonth(query.month, asOf);
    const window = monthWindow(month);

    if (managedProfiles.size === 0) {
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
    const items = result.items.flatMap((shift): ManagerWorkShiftListItemView[] => {
      const employmentProfileId = shift.subjectEmploymentProfileId;
      const profile = employmentProfileId ? managedProfiles.get(employmentProfileId) : undefined;

      if (!employmentProfileId || !profile || shift.status !== "ACTIVE") {
        return [];
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
              profile.ref?.displayName ?? profile.ref?.code ?? employmentProfileId,
            ...(profile.ref?.code ? { employeeCode: profile.ref.code } : {}),
          },
        },
      ];
    });

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
    const [orgUnitProfileLists, talentGroupResolutionLists] = await Promise.all([
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
    ]);

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

  private assertReadAuthority(actor: Actor): void {
    if (!actor.accountContexts.includes("MANAGER_CONSOLE")) {
      throw new WorkSchedulePermissionScopeError(
        "Manager Workspace WorkSchedule requires MANAGER_CONSOLE account context",
      );
    }
    PermissionGuard.assert(
      actor,
      PermissionResolver.resolve(Permission.WORK_SCHEDULE_READ),
    );
  }
}

async function filterManagedOrgUnitIds(
  service: StructuredScopeAuthorityService,
  actor: Actor,
  orgUnitIds: readonly string[],
): Promise<readonly string[]> {
  const authorized = await Promise.all(
    [...new Set(orgUnitIds)].map(async (orgUnitId) =>
      (await service.hasAuthority({
        userId: actor.id,
        permission: Permission.WORK_SCHEDULE_READ,
        scope: { scopeType: "managedOrgUnit", targetId: orgUnitId },
      }))
        ? orgUnitId
        : null,
    ),
  );
  return authorized.filter((id): id is string => id !== null).sort();
}

async function filterManagedTalentGroupIds(
  service: StructuredScopeAuthorityService,
  actor: Actor,
  talentGroupIds: readonly string[],
): Promise<readonly string[]> {
  const authorized = await Promise.all(
    [...new Set(talentGroupIds)].map(async (talentGroupId) =>
      (await service.hasAuthority({
        userId: actor.id,
        permission: Permission.WORK_SCHEDULE_READ,
        scope: { scopeType: "managedTalentGroup", targetId: talentGroupId },
      }))
        ? talentGroupId
        : null,
    ),
  );
  return authorized.filter((id): id is string => id !== null).sort();
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

function monthWindow(month: string): { readonly startAt: number; readonly endAt: number } {
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

function parseSourceType(value: string | undefined): WorkShiftSourceType | undefined {
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
