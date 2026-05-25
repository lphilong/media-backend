import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { NativeMongoMonthlyRosterReadRepository } from "@infra/mongo/work-schedule/monthly-roster.read-repository";
import { NativeMongoWorkShiftReadRepository } from "@infra/mongo/work-schedule/work-schedule.read-repository";
import { MonthlyRosterAdminQueryService } from "@modules/work-schedule/admin/admin.monthly-roster.query-service";
import {
  MonthlyRosterAdminExposure,
  WorkScheduleAdminDetailExposure,
} from "@modules/work-schedule/shared/work-schedule.exposure";

type FindCall = {
  readonly collection: string;
  readonly query: unknown;
  readonly options: unknown;
};

const workShift = {
  _id: "shift-1",
  shiftCode: "SHIFT-1",
  normalizedShiftCode: "shift-1",
  title: "Morning shift",
  normalizedTitle: "morning shift",
  subjectKind: "EMPLOYMENT_PROFILE",
  subjectEmploymentProfileId: "ep-1",
  subjectTalentId: null,
  subjectTalentGroupId: null,
  studioResourceIds: ["studio-missing", "studio-1"],
  status: "ACTIVE",
  shiftStartAt: 1_700_000_000_000,
  shiftEndAt: 1_700_003_600_000,
  description: null,
  externalRef: null,
  sourceType: "ROSTER_GENERATED",
  sourceRosterId: "roster-1",
  sourcePatternId: "pattern-1",
  sourceExceptionId: null,
  sourceGenerationRunId: "run-1",
  sourceRosterMonth: "2026-05",
  sourceDepartmentOrgUnitId: "ou-1",
  sourceRosterLocalDate: "2026-05-01",
  sourceRosterSlotKey: "STANDARD",
  createdAt: 1,
  updatedAt: 2,
};

const talentWorkShift = {
  ...workShift,
  _id: "shift-talent",
  shiftCode: "SHIFT-TALENT",
  normalizedShiftCode: "shift-talent",
  title: "Talent shift",
  normalizedTitle: "talent shift",
  subjectKind: "TALENT",
  subjectEmploymentProfileId: null,
  subjectTalentId: "talent-1",
  subjectTalentGroupId: null,
  studioResourceIds: [],
  sourceType: "MANUAL",
  sourceRosterId: null,
  sourcePatternId: null,
  sourceRosterMonth: null,
  sourceDepartmentOrgUnitId: null,
  sourceRosterLocalDate: null,
  sourceRosterSlotKey: null,
};

const externalTalentWorkShift = {
  ...talentWorkShift,
  _id: "shift-external-talent",
  shiftCode: "SHIFT-EXTERNAL",
  normalizedShiftCode: "shift-external",
  subjectTalentId: "talent-external",
};

const monthlyRoster = {
  _id: "roster-1",
  rosterCode: "MR-1",
  normalizedRosterCode: "mr-1",
  rosterMonth: "2026-05",
  timezone: "Asia/Ho_Chi_Minh",
  targetSubjectKind: "EMPLOYMENT_PROFILE",
  targetOrgUnitMode: "EXACT_ONLY",
  departmentOrgUnitId: "ou-1",
  workPatternId: "pattern-1",
  holidayCalendarId: "calendar-1",
  status: "DRAFT",
  draftVersion: 1,
  previewHash: null,
  lastPreviewedAt: null,
  publishedAt: null,
  publishedByUserId: null,
  publishGenerationRunId: null,
  description: null,
  externalRef: null,
  exceptions: [
    {
      rosterExceptionId: "exception-1",
      monthlyRosterId: "roster-1",
      exceptionType: "ADD_SPECIAL_SHIFT",
      exceptionDate: "2026-05-03",
      subjectEmploymentProfileId: "ep-1",
      status: "ACTIVE",
      title: "Extra shift",
      startLocalTime: "13:00",
      endLocalTime: "16:00",
      workingMinutes: 120,
      breakMinutes: 30,
      studioResourceIds: ["studio-1", "studio-missing"],
      reason: null,
      sourceNote: null,
      description: null,
      externalRef: null,
      removedAt: null,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  archivedAt: null,
  createdAt: 1,
  updatedAt: 2,
};

function createFindResult(documents: readonly unknown[]) {
  return {
    sort() {
      return {
        limit() {
          return {
            toArray: async () => [...documents],
          };
        },
      };
    },
    toArray: async () => [...documents],
  };
}

test("Work Schedule Work Shift refs enrich after page read, preserve raw IDs, and keep resource order", async () => {
  const calls: FindCall[] = [];
  const repository = new NativeMongoWorkShiftReadRepository({
    collection(name: string) {
      return {
        find(query: unknown, options: unknown) {
          calls.push({ collection: name, query, options });
          if (name === "work_shifts") {
            return createFindResult([
              workShift,
              talentWorkShift,
              externalTalentWorkShift,
            ]);
          }
          if (name === "employment_profiles") {
            return createFindResult([
              {
                _id: "ep-1",
                employeeCode: "EMP-1",
                legalName: "Alice Legal",
                displayName: "Alice",
                employmentStatus: "ACTIVE",
              },
              {
                _id: "ep-binh",
                employeeCode: "EMP-2",
                legalName: "Binh Tran Legal",
                displayName: "Binh Tran",
                employmentStatus: "ACTIVE",
              },
            ]);
          }
          if (name === "talents") {
            return createFindResult([
              {
                _id: "talent-1",
                talentCode: "TAL-1",
                stageName: "Stale Internal Stage",
                legalName: "Stale Internal Legal",
                displayShortName: "Stale Internal Short",
                talentOrigin: "INTERNAL",
                linkedEmploymentProfileId: "ep-binh",
                operationalStatus: "ACTIVE",
              },
              {
                _id: "talent-external",
                talentCode: "TAL-2",
                stageName: "External Stage",
                legalName: "External Legal",
                displayShortName: "External Short",
                talentOrigin: "EXTERNAL",
                linkedEmploymentProfileId: null,
                operationalStatus: "ACTIVE",
              },
            ]);
          }
          if (name === "studio_resources") {
            return createFindResult([
              {
                _id: "studio-1",
                resourceCode: "SR-1",
                name: "Main Studio",
                operationalStatus: "ACTIVE",
              },
            ]);
          }
          if (name === "org_units") {
            return createFindResult([
              { _id: "ou-1", code: "OU-1", name: "Sales", status: "ACTIVE" },
            ]);
          }
          if (name === "work_monthly_rosters") {
            return createFindResult([
              {
                _id: "roster-1",
                rosterCode: "MR-1",
                rosterMonth: "2026-05",
                status: "DRAFT",
              },
            ]);
          }
          if (name === "work_patterns") {
            return createFindResult([
              {
                _id: "pattern-1",
                patternCode: "WP-1",
                name: "Standard",
                status: "ACTIVE",
              },
            ]);
          }
          return createFindResult([]);
        },
        findOne: async () => workShift,
      };
    },
  } as never);

  const list = await repository.listWorkShifts({ limit: 10 });
  const detail = await repository.getWorkShiftDetail("shift-1");

  assert.equal(list.items[0].subjectEmploymentProfileId, "ep-1");
  assert.deepEqual(list.items[0].subjectRef, {
    id: "ep-1",
    code: "EMP-1",
    displayName: "Alice",
    name: "Alice Legal",
    status: "ACTIVE",
  });
  assert.deepEqual(list.items[1].subjectRef, {
    id: "talent-1",
    code: "TAL-1",
    name: "Binh Tran",
    displayName: "Binh Tran",
    status: "ACTIVE",
  });
  assert.notEqual(
    list.items[1].subjectRef?.displayName,
    "Stale Internal Stage",
  );
  assert.notEqual(
    list.items[1].subjectRef?.displayName,
    "Stale Internal Legal",
  );
  assert.notEqual(
    list.items[1].subjectRef?.displayName,
    "Stale Internal Short",
  );
  assert.deepEqual(list.items[2].subjectRef, {
    id: "talent-external",
    code: "TAL-2",
    name: "External Short",
    displayName: "External Short",
    status: "ACTIVE",
  });
  assert.equal(detail?.studioResourceIds[0], "studio-missing");
  assert.deepEqual(
    detail?.studioResourceRefs?.map((ref) => ref.id),
    ["studio-missing", "studio-1"],
  );
  assert.equal(detail?.sourceRosterRef?.code, "MR-1");
  assert.equal(detail?.sourcePatternRef?.code, "WP-1");
  assert.equal(detail?.sourceDepartmentOrgUnitRef?.code, "OU-1");
  assert.equal(
    WorkScheduleAdminDetailExposure.expose(detail!).studioResourceRefs !==
      undefined,
    true,
  );
  assert.deepEqual(
    calls.find((call) => call.collection === "studio_resources")?.options,
    {
      projection: {
        _id: 1,
        resourceCode: 1,
        name: 1,
        operationalStatus: 1,
      },
    },
  );
  assert.equal(
    calls.filter((call) => call.collection === "studio_resources").length,
    1,
  );
});

test("Monthly Roster refs enrich structural fields and exception refs without dropping raw IDs", async () => {
  const calls: FindCall[] = [];
  const repository = new NativeMongoMonthlyRosterReadRepository({
    collection(name: string) {
      return {
        find(query: unknown, options: unknown) {
          calls.push({ collection: name, query, options });
          if (name === "work_monthly_rosters") {
            return createFindResult([monthlyRoster]);
          }
          if (name === "org_units") {
            return createFindResult([
              { _id: "ou-1", code: "OU-1", name: "Sales", status: "ACTIVE" },
            ]);
          }
          if (name === "work_patterns") {
            return createFindResult([
              {
                _id: "pattern-1",
                patternCode: "WP-1",
                name: "Standard",
                status: "ACTIVE",
              },
            ]);
          }
          if (name === "work_holiday_calendars") {
            return createFindResult([
              {
                _id: "calendar-1",
                calendarCode: "HC-1",
                name: "VN holidays",
                status: "ACTIVE",
              },
            ]);
          }
          if (name === "employment_profiles") {
            return createFindResult([
              {
                _id: "ep-1",
                employeeCode: "EMP-1",
                legalName: "Alice Legal",
                displayName: "Alice",
                employmentStatus: "ACTIVE",
              },
            ]);
          }
          if (name === "studio_resources") {
            return createFindResult([
              {
                _id: "studio-1",
                resourceCode: "SR-1",
                name: "Main Studio",
                operationalStatus: "ACTIVE",
              },
            ]);
          }
          return createFindResult([]);
        },
        findOne: async () => monthlyRoster,
      };
    },
  } as never);

  const list = await repository.listMonthlyRosters({ limit: 10 });
  const detail = await repository.getMonthlyRosterDetail("roster-1");

  assert.equal(list.items[0].departmentOrgUnitId, "ou-1");
  assert.equal(list.items[0].departmentOrgUnitRef?.code, "OU-1");
  assert.equal(list.items[0].workPatternRef?.code, "WP-1");
  assert.equal(list.items[0].holidayCalendarRef?.code, "HC-1");
  assert.equal(detail?.exceptions[0].subjectEmploymentProfileId, "ep-1");
  assert.equal(
    detail?.exceptions[0].subjectEmploymentProfileRef?.code,
    "EMP-1",
  );
  assert.deepEqual(
    detail?.exceptions[0].studioResourceRefs?.map((ref) => ref.id),
    ["studio-1", "studio-missing"],
  );
  assert.equal(
    MonthlyRosterAdminExposure.exposeDetail(detail!).departmentOrgUnitRef !==
      undefined,
    true,
  );
  assert.equal(
    calls.filter((call) => call.collection === "org_units").length,
    2,
  );
  assert.deepEqual(
    calls.find((call) => call.collection === "work_holiday_calendars")?.options,
    {
      projection: {
        _id: 1,
        calendarCode: 1,
        name: 1,
        status: 1,
      },
    },
  );
});

test("Monthly Roster preview decorates rows and eligible profiles with refs after calculation", async () => {
  const actor = new Actor({
    id: "admin-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [Permission.WORK_SCHEDULE_READ],
    scopeGrants: { workSchedule: ["global"] },
    isActive: true,
  });
  const rosterDetail = {
    ...monthlyRoster,
    monthlyRosterId: monthlyRoster._id,
    exceptionCount: 0,
    departmentOrgUnitRef: {
      id: "ou-1",
      code: "OU-1",
      name: "Sales",
      status: "ACTIVE",
    },
    workPatternRef: {
      id: "pattern-1",
      code: "WP-1",
      name: "Standard",
      status: "ACTIVE",
    },
    holidayCalendarRef: {
      id: "calendar-1",
      code: "HC-1",
      name: "VN holidays",
      status: "ACTIVE",
    },
    previewHash: null,
    lastPreviewedAt: null,
    publishedAt: null,
    publishedByUserId: null,
    publishGenerationRunId: null,
    exceptions: [],
  };
  const service = new MonthlyRosterAdminQueryService(
    {
      listMonthlyRosters: async () => ({ items: [] }),
      getMonthlyRosterDetail: async () => rosterDetail,
    } as never,
    {
      listByOrgUnitId: async () => [
        {
          id: "ep-1",
          employmentStatus: "ACTIVE",
          orgUnitId: "ou-1",
          managerEmploymentProfileId: null,
          linkedUserId: null,
          ref: {
            id: "ep-1",
            code: "EMP-1",
            displayName: "Alice",
            name: "Alice Legal",
            status: "ACTIVE",
          },
        },
      ],
      findById: async () => null,
      findByLinkedUserId: async () => null,
      listIdsByManagerEmploymentProfileId: async () => [],
      listIdsByActiveTalentGroupIds: async () => [],
      listIdsByOrgUnitId: async () => [],
    } as never,
    {
      listWorkPatterns: async () => ({ items: [] }),
      getWorkPatternDetail: async () => ({
        workPatternId: "pattern-1",
        patternCode: "WP-1",
        name: "Standard",
        status: "ACTIVE",
        timezone: "Asia/Ho_Chi_Minh",
        startLocalTime: "09:00",
        endLocalTime: "17:30",
        workingMinutes: 480,
        breakMinutes: 30,
        workingDays: ["MON"],
        description: null,
        externalRef: null,
        activatedAt: 1,
        archivedAt: null,
        createdAt: 1,
        updatedAt: 2,
      }),
    } as never,
    {
      listHolidayCalendars: async () => ({ items: [] }),
      getHolidayCalendarDetail: async () => ({
        holidayCalendarId: "calendar-1",
        calendarCode: "HC-1",
        name: "VN holidays",
        scopeType: "GLOBAL",
        timezone: "Asia/Ho_Chi_Minh",
        status: "ACTIVE",
        entries: [],
        description: null,
        externalRef: null,
        activatedAt: 1,
        archivedAt: null,
        createdAt: 1,
        updatedAt: 2,
      }),
      listActiveEntriesForDateRange: async () => [],
    } as never,
    {
      listWorkShifts: async () => ({ items: [] }),
      listWorkShiftsBySubject: async () => ({ items: [] }),
      listWorkShiftsByResource: async () => ({ items: [] }),
      getWorkShiftDetail: async () => null,
      listActiveEmploymentProfileShiftsForWindow: async () => [],
    } as never,
    {
      findById: async () => ({
        id: "ou-1",
        type: "DEPARTMENT",
        status: "ACTIVE",
      }),
    } as never,
  );

  const preview = await service.previewMonthlyRoster(actor, {
    monthlyRosterId: "roster-1",
    scope: "global",
  });

  assert.equal(preview.departmentOrgUnitRef?.code, "OU-1");
  assert.equal(preview.workPatternRef?.code, "WP-1");
  assert.equal(preview.holidayCalendarRef?.code, "HC-1");
  assert.equal(preview.eligibleProfiles[0].subjectEmploymentProfileId, "ep-1");
  assert.equal(
    preview.eligibleProfiles[0].subjectEmploymentProfileRef?.code,
    "EMP-1",
  );
  assert.equal(preview.rows[0].departmentOrgUnitId, "ou-1");
  assert.equal(preview.rows[0].departmentOrgUnitRef?.code, "OU-1");
  assert.equal(preview.rows[0].subjectEmploymentProfileRef?.code, "EMP-1");
});
