import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { MonthlyRosterAdminQueryService } from "@modules/work-schedule/admin/admin.monthly-roster.query-service";
import type { WorkScheduleReferencedEmploymentProfile } from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import type { WorkScheduleReferencedOrgUnit } from "@modules/work-schedule/domain/work-schedule-org-unit-readonly-access";
import {
  WorkSchedulePermissionScopeError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import type {
  HolidayCalendarEntryRecord,
  HolidayCalendarRecord,
  HolidayCalendarStatus,
  MonthlyRosterRecord,
  MonthlyRosterStatus,
  RosterExceptionRecord,
  WorkPatternRecord,
  WorkPatternStatus,
  WorkShiftDetailView,
} from "@modules/work-schedule/domain/work-schedule.types";
import type {
  ActiveEmploymentProfileWorkShiftConflictView,
  ActiveEmploymentProfileWorkShiftLookupInput,
  HolidayCalendarListReadInput,
  HolidayCalendarListReadResult,
  HolidayCalendarReadRepository,
  MonthlyRosterListReadInput,
  MonthlyRosterListReadResult,
  MonthlyRosterReadRepository,
  WorkPatternListReadInput,
  WorkPatternListReadResult,
  WorkPatternReadRepository,
  WorkShiftByResourceListReadInput,
  WorkShiftByResourceListReadResult,
  WorkShiftBySubjectListReadInput,
  WorkShiftBySubjectListReadResult,
  WorkShiftListReadInput,
  WorkShiftListReadResult,
  WorkShiftReadRepository,
} from "@modules/work-schedule/read/work-schedule.read-repository";

class MemoryMonthlyRosterReadRepository
  implements MonthlyRosterReadRepository
{
  constructor(
    readonly records: readonly MonthlyRosterRecord[],
  ) {}

  async listMonthlyRosters(
    _input: MonthlyRosterListReadInput,
  ): Promise<MonthlyRosterListReadResult> {
    return {
      items: [],
    };
  }

  async getMonthlyRosterDetail(
    monthlyRosterId: string,
  ) {
    const roster =
      this.records.find(
        (record) =>
          record.monthlyRosterId === monthlyRosterId,
      ) ?? null;

    return roster
      ? {
          ...roster,
          exceptionCount: roster.exceptions.filter(
            (exception) => exception.status === "ACTIVE",
          ).length,
        }
      : null;
  }
}

class MemoryWorkPatternReadRepository
  implements WorkPatternReadRepository
{
  constructor(
    readonly records: readonly WorkPatternRecord[],
  ) {}

  async listWorkPatterns(
    _input: WorkPatternListReadInput,
  ): Promise<WorkPatternListReadResult> {
    return {
      items: [],
    };
  }

  async getWorkPatternDetail(workPatternId: string) {
    return (
      this.records.find(
        (record) =>
          record.workPatternId === workPatternId,
      ) ?? null
    );
  }
}

class MemoryHolidayCalendarReadRepository
  implements HolidayCalendarReadRepository
{
  constructor(
    readonly records: readonly HolidayCalendarRecord[],
  ) {}

  async listHolidayCalendars(
    _input: HolidayCalendarListReadInput,
  ): Promise<HolidayCalendarListReadResult> {
    return {
      items: [],
    };
  }

  async getHolidayCalendarDetail(
    holidayCalendarId: string,
  ) {
    return (
      this.records.find(
        (record) =>
          record.holidayCalendarId ===
          holidayCalendarId,
      ) ?? null
    );
  }

  async listActiveEntriesForDateRange(): Promise<
    readonly HolidayCalendarEntryRecord[]
  > {
    return [];
  }
}

class MemoryWorkShiftReadRepository
  implements WorkShiftReadRepository
{
  lookupCount = 0;

  constructor(
    readonly conflicts: readonly ActiveEmploymentProfileWorkShiftConflictView[] = [],
  ) {}

  async listWorkShifts(
    _input: WorkShiftListReadInput,
  ): Promise<WorkShiftListReadResult> {
    return {
      items: [],
    };
  }

  async listWorkShiftsBySubject(
    _input: WorkShiftBySubjectListReadInput,
  ): Promise<WorkShiftBySubjectListReadResult> {
    return {
      items: [],
    };
  }

  async listWorkShiftsByResource(
    _input: WorkShiftByResourceListReadInput,
  ): Promise<WorkShiftByResourceListReadResult> {
    return {
      items: [],
    };
  }

  async getWorkShiftDetail(): Promise<WorkShiftDetailView | null> {
    return null;
  }

  async listActiveEmploymentProfileShiftsForWindow(
    input: ActiveEmploymentProfileWorkShiftLookupInput,
  ): Promise<
    readonly ActiveEmploymentProfileWorkShiftConflictView[]
  > {
    this.lookupCount += 1;
    const profileIds = new Set(
      input.subjectEmploymentProfileIds,
    );

    return this.conflicts.filter(
      (shift) =>
        profileIds.has(
          shift.subjectEmploymentProfileId,
        ) &&
        shift.shiftStartAt < input.windowEndAt &&
        shift.shiftEndAt > input.windowStartAt,
    );
  }
}

function createService(params: {
  readonly rosters?: readonly MonthlyRosterRecord[];
  readonly orgUnits?: readonly WorkScheduleReferencedOrgUnit[];
  readonly profiles?: readonly WorkScheduleReferencedEmploymentProfile[];
  readonly patterns?: readonly WorkPatternRecord[];
  readonly calendars?: readonly HolidayCalendarRecord[];
  readonly workShiftReadRepository?: MemoryWorkShiftReadRepository;
} = {}): MonthlyRosterAdminQueryService {
  const orgUnits =
    params.orgUnits ??
    [
      {
        id: "dept-1",
        type: "DEPARTMENT",
        status: "ACTIVE",
      },
    ];
  const profiles =
    params.profiles ??
    [
      seedProfile("emp-2", "ACTIVE", "dept-1"),
      seedProfile("emp-1", "ACTIVE", "dept-1"),
      seedProfile("emp-inactive", "ON_LEAVE", "dept-1"),
      seedProfile("emp-other", "ACTIVE", "dept-2"),
      {
        id: "actor-profile",
        employmentStatus: "ACTIVE",
        orgUnitId: "dept-1",
        managerEmploymentProfileId: null,
        linkedUserId: "admin-user-1",
      },
    ];

  return new MonthlyRosterAdminQueryService(
    new MemoryMonthlyRosterReadRepository(
      params.rosters ?? [seedRoster()],
    ),
    {
      findById: async (id: string) =>
        profiles.find((profile) => profile.id === id) ??
        null,
      findByLinkedUserId: async (linkedUserId: string) =>
        profiles.find(
          (profile) =>
            profile.linkedUserId === linkedUserId,
        ) ?? null,
      listIdsByManagerEmploymentProfileId: async () => [],
      listIdsByActiveTalentGroupIds: async () => [],
      listIdsByOrgUnitId: async (orgUnitId: string) =>
        profiles
          .filter(
            (profile) => profile.orgUnitId === orgUnitId,
          )
          .map((profile) => profile.id)
          .sort(),
      listByOrgUnitId: async (orgUnitId: string) =>
        profiles
          .filter(
            (profile) => profile.orgUnitId === orgUnitId,
          )
          .sort((left, right) =>
            left.id.localeCompare(right.id),
          ),
    },
    new MemoryWorkPatternReadRepository(
      params.patterns ?? [seedPattern()],
    ),
    new MemoryHolidayCalendarReadRepository(
      params.calendars ?? [seedCalendar()],
    ),
    params.workShiftReadRepository ??
      new MemoryWorkShiftReadRepository(),
    {
      findById: async (id: string) =>
        orgUnits.find((unit) => unit.id === id) ?? null,
    },
  );
}

test("Monthly Roster preview returns deterministic rows from draft, pattern, calendar, active exact-department profiles, exceptions, and conflicts", async () => {
  await bindTraceId("trace-roster-preview-basic", async () => {
    const conflictShift = seedConflictShift({
      subjectEmploymentProfileId: "emp-2",
      shiftStartAt: vietnamUtc(
        "2026-05-05",
        "09:30",
      ),
      shiftEndAt: vietnamUtc(
        "2026-05-05",
        "10:00",
      ),
    });
    const workShiftReadRepository =
      new MemoryWorkShiftReadRepository([
        conflictShift,
      ]);
    const service = createService({
      profiles: [
        seedProfile("emp-2", "ACTIVE", "dept-1"),
        seedProfile("emp-1", "ACTIVE", "dept-1"),
        seedProfile("emp-inactive", "ON_LEAVE", "dept-1"),
        seedProfile("emp-other", "ACTIVE", "dept-2"),
      ],
      rosters: [
        seedRoster({
          previewHash: "stored-preview-hash",
          exceptions: [
            seedException({
              rosterExceptionId: "ex-off",
              exceptionType: "WORKING_TO_OFF",
              exceptionDate: "2026-05-04",
              subjectEmploymentProfileId: "emp-1",
            }),
            seedException({
              rosterExceptionId: "ex-change",
              exceptionType: "CHANGE_TIME",
              exceptionDate: "2026-05-05",
              subjectEmploymentProfileId: "emp-2",
              startLocalTime: "09:00",
            }),
            seedException({
              rosterExceptionId: "ex-special-sat",
              exceptionType: "ADD_SPECIAL_SHIFT",
              exceptionDate: "2026-05-02",
              subjectEmploymentProfileId: "emp-1",
              startLocalTime: "10:00",
              workingMinutes: 120,
              breakMinutes: 30,
            }),
            seedException({
              rosterExceptionId: "ex-special-holiday",
              exceptionType: "ADD_SPECIAL_SHIFT",
              exceptionDate: "2026-05-01",
              subjectEmploymentProfileId: "emp-1",
              startLocalTime: "14:00",
              workingMinutes: 60,
              breakMinutes: 0,
            }),
            seedException({
              rosterExceptionId: "ex-removed",
              exceptionType: "WORKING_TO_OFF",
              exceptionDate: "2026-05-06",
              subjectEmploymentProfileId: "emp-2",
              status: "REMOVED",
            }),
          ],
        }),
      ],
      calendars: [
        seedCalendar({
          entries: [
            seedCalendarEntry("entry-active", "2026-05-01", "ACTIVE"),
            seedCalendarEntry("entry-removed", "2026-05-04", "REMOVED"),
          ],
        }),
      ],
      workShiftReadRepository,
    });

    const first = await service.previewMonthlyRoster(
      createActor([Permission.WORK_SCHEDULE_READ]),
      {
        monthlyRosterId: "roster-1",
        scope: "global",
      },
    );
    const second = await service.previewMonthlyRoster(
      createActor([Permission.WORK_SCHEDULE_READ]),
      {
        monthlyRosterId: "roster-1",
        scope: "global",
      },
    );

    assert.deepEqual(first, second);
    assert.equal(first.currentPreviewHash, "stored-preview-hash");
    assert.equal(first.draftVersion, 7);
    assert.deepEqual(
      first.eligibleProfiles.map(
        (profile) =>
          profile.subjectEmploymentProfileId,
      ),
      ["emp-1", "emp-2"],
    );
    assert.equal(workShiftReadRepository.lookupCount, 2);

    const holidayRows = first.rows.filter(
      (row) => row.rowKind === "HOLIDAY_SUPPRESSED",
    );
    assert.equal(holidayRows.length, 2);
    assert.equal(
      holidayRows[0].holidayCalendarEntryId,
      "entry-active",
    );

    const offRow = first.rows.find(
      (row) => row.rowKind === "WORKING_TO_OFF",
    );
    assert.equal(offRow?.sourceExceptionId, "ex-off");
    assert.equal(offRow?.isCandidateShift, false);

    const changeRow = first.rows.find(
      (row) => row.rowKind === "CHANGE_TIME",
    );
    assert.equal(changeRow?.sourceExceptionId, "ex-change");
    assert.equal(changeRow?.startLocalTime, "09:00");
    assert.equal(changeRow?.endLocalTime, "18:00");
    assert.equal(
      changeRow?.shiftStartAt,
      vietnamUtc("2026-05-05", "09:00"),
    );
    assert.equal(changeRow?.conflicts.length, 1);
    assert.equal(
      changeRow?.conflicts[0].workShiftId,
      "shift-conflict",
    );

    const specialRows = first.rows.filter(
      (row) => row.rowKind === "ADD_SPECIAL_SHIFT",
    );
    assert.equal(specialRows.length, 2);
    assert.deepEqual(
      specialRows.map((row) => row.sourceRosterSlotKey),
      [
        "ADD_SPECIAL_SHIFT:ex-special-holiday",
        "ADD_SPECIAL_SHIFT:ex-special-sat",
      ],
    );
    assert.equal(specialRows[0].holidayName, "Holiday");

    assert.equal(
      first.summary.totalEligibleProfiles,
      2,
    );
    assert.equal(first.summary.totalWorkingToOff, 1);
    assert.equal(first.summary.totalChangeTime, 1);
    assert.equal(first.summary.totalAddSpecialShift, 2);
    assert.equal(first.summary.totalConflicts, 1);
    assert.equal(
      first.summary.totalCandidateShiftsAfterExceptions,
      first.rows.filter((row) => row.isCandidateShift)
        .length,
    );
    assert.ok(
      first.rows.every((row) =>
        row.previewRowId.startsWith("roster-1:"),
      ),
    );
  });
});

test("Monthly Roster preview rejects unusable roster dependencies and invalid persisted exception state", async () => {
  await bindTraceId("trace-roster-preview-invalid", async () => {
    await assert.rejects(
      () =>
        createService({
          rosters: [
            seedRoster({
              status: "ARCHIVED",
            }),
          ],
        }).previewMonthlyRoster(
          createActor([Permission.WORK_SCHEDULE_READ]),
          {
            monthlyRosterId: "roster-1",
          },
        ),
      WorkScheduleValidationError,
    );

    await assert.rejects(
      () =>
        createService({
          orgUnits: [
            {
              id: "dept-1",
              type: "TEAM",
              status: "ACTIVE",
            },
          ],
        }).previewMonthlyRoster(
          createActor([Permission.WORK_SCHEDULE_READ]),
          {
            monthlyRosterId: "roster-1",
          },
        ),
      WorkScheduleValidationError,
    );

    await assert.rejects(
      () =>
        createService({
          patterns: [
            seedPattern({
              status: "DRAFT",
            }),
          ],
        }).previewMonthlyRoster(
          createActor([Permission.WORK_SCHEDULE_READ]),
          {
            monthlyRosterId: "roster-1",
          },
        ),
      WorkScheduleValidationError,
    );

    await assert.rejects(
      () =>
        createService({
          rosters: [
            seedRoster({
              exceptions: [
                seedException({
                  rosterExceptionId: "ex-invalid",
                  exceptionType: "CHANGE_TIME",
                  exceptionDate: "2026-05-02",
                  subjectEmploymentProfileId: "emp-1",
                }),
              ],
            }),
          ],
        }).previewMonthlyRoster(
          createActor([Permission.WORK_SCHEDULE_READ]),
          {
            monthlyRosterId: "roster-1",
          },
        ),
      WorkScheduleValidationError,
    );
  });
});

test("Monthly Roster preview surfaces candidate self-conflicts for overlapping special shifts", async () => {
  await bindTraceId(
    "trace-roster-preview-candidate-self-conflict",
    async () => {
      const preview = await createService({
        rosters: [
          seedRoster({
            exceptions: [
              seedException({
                rosterExceptionId:
                  "ex-special-overlap-standard",
                exceptionType: "ADD_SPECIAL_SHIFT",
                exceptionDate: "2026-05-04",
                subjectEmploymentProfileId: "emp-1",
                startLocalTime: "10:00",
                workingMinutes: 60,
                breakMinutes: 0,
              }),
            ],
          }),
        ],
      }).previewMonthlyRoster(
        createActor([Permission.WORK_SCHEDULE_READ]),
        {
          monthlyRosterId: "roster-1",
        },
      );

      const affectedRows = preview.rows.filter(
        (row) =>
          row.subjectEmploymentProfileId === "emp-1" &&
          row.localDate === "2026-05-04" &&
          (row.rowKind === "STANDARD" ||
            row.rowKind === "ADD_SPECIAL_SHIFT"),
      );

      assert.equal(affectedRows.length, 2);
      assert.equal(
        affectedRows.every(
          (row) => row.conflicts.length === 1,
        ),
        true,
      );
      assert.deepEqual(
        affectedRows.map(
          (row) => row.conflicts[0].conflictKind,
        ),
        [
          "CANDIDATE_SUBJECT_OVERLAP",
          "CANDIDATE_SUBJECT_OVERLAP",
        ],
      );
      assert.deepEqual(
        affectedRows.map(
          (row) =>
            row.conflicts[0].relatedPreviewRowId,
        ),
        [
          affectedRows[1].previewRowId,
          affectedRows[0].previewRowId,
        ],
      );
      assert.equal(preview.summary.totalConflicts, 2);
    },
  );
});

test("Monthly Roster preview does not surface candidate self-conflicts for touching boundaries or different profiles", async () => {
  await bindTraceId(
    "trace-roster-preview-candidate-no-self-conflict",
    async () => {
      const boundaryPreview = await createService({
        rosters: [
          seedRoster({
            exceptions: [
              seedException({
                rosterExceptionId:
                  "ex-special-boundary",
                exceptionType: "ADD_SPECIAL_SHIFT",
                exceptionDate: "2026-05-04",
                subjectEmploymentProfileId: "emp-1",
                startLocalTime: "17:00",
                workingMinutes: 60,
                breakMinutes: 0,
              }),
            ],
          }),
        ],
      }).previewMonthlyRoster(
        createActor([Permission.WORK_SCHEDULE_READ]),
        {
          monthlyRosterId: "roster-1",
        },
      );

      assert.equal(
        boundaryPreview.summary.totalConflicts,
        0,
      );

      const crossProfilePreview = await createService({
        rosters: [
          seedRoster({
            exceptions: [
              seedException({
                rosterExceptionId: "ex-special-emp-1",
                exceptionType: "ADD_SPECIAL_SHIFT",
                exceptionDate: "2026-05-02",
                subjectEmploymentProfileId: "emp-1",
                startLocalTime: "10:00",
                workingMinutes: 120,
                breakMinutes: 0,
              }),
              seedException({
                rosterExceptionId: "ex-special-emp-2",
                exceptionType: "ADD_SPECIAL_SHIFT",
                exceptionDate: "2026-05-02",
                subjectEmploymentProfileId: "emp-2",
                startLocalTime: "10:30",
                workingMinutes: 60,
                breakMinutes: 0,
              }),
            ],
          }),
        ],
      }).previewMonthlyRoster(
        createActor([Permission.WORK_SCHEDULE_READ]),
        {
          monthlyRosterId: "roster-1",
        },
      );

      assert.equal(
        crossProfilePreview.summary.totalConflicts,
        0,
      );
    },
  );
});

test("Monthly Roster preview surfaces conflicts between overlapping special shift exceptions for the same profile", async () => {
  await bindTraceId(
    "trace-roster-preview-special-special-self-conflict",
    async () => {
      const preview = await createService({
        rosters: [
          seedRoster({
            exceptions: [
              seedException({
                rosterExceptionId: "ex-special-a",
                exceptionType: "ADD_SPECIAL_SHIFT",
                exceptionDate: "2026-05-02",
                subjectEmploymentProfileId: "emp-1",
                startLocalTime: "10:00",
                workingMinutes: 120,
                breakMinutes: 0,
              }),
              seedException({
                rosterExceptionId: "ex-special-b",
                exceptionType: "ADD_SPECIAL_SHIFT",
                exceptionDate: "2026-05-02",
                subjectEmploymentProfileId: "emp-1",
                startLocalTime: "11:00",
                workingMinutes: 60,
                breakMinutes: 0,
              }),
            ],
          }),
        ],
      }).previewMonthlyRoster(
        createActor([Permission.WORK_SCHEDULE_READ]),
        {
          monthlyRosterId: "roster-1",
        },
      );

      const specialRows = preview.rows.filter(
        (row) => row.rowKind === "ADD_SPECIAL_SHIFT",
      );

      assert.equal(specialRows.length, 2);
      assert.equal(
        specialRows.every(
          (row) =>
            row.conflicts[0]?.conflictKind ===
            "CANDIDATE_SUBJECT_OVERLAP",
        ),
        true,
      );
      assert.equal(preview.summary.totalConflicts, 2);
    },
  );
});

test("Monthly Roster preview fails closed for malformed persisted ACTIVE exception dates", async (t) => {
  const invalidCases: readonly {
    readonly name: string;
    readonly exceptionDate: string;
  }[] = [
    {
      name: "impossible day 99",
      exceptionDate: "2026-05-99",
    },
    {
      name: "impossible day 00",
      exceptionDate: "2026-05-00",
    },
    {
      name: "malformed non-padded month",
      exceptionDate: "2026-5-01",
    },
    {
      name: "malformed timestamp",
      exceptionDate: "2026-05-01T00:00",
    },
    {
      name: "real date outside roster month",
      exceptionDate: "2026-06-01",
    },
  ];

  for (const testCase of invalidCases) {
    await t.test(testCase.name, async () => {
      await bindTraceId(
        `trace-roster-preview-invalid-date-${testCase.name.replace(/\W+/gu, "-")}`,
        async () => {
          await assert.rejects(
            () =>
              createService({
                rosters: [
                  seedRoster({
                    exceptions: [
                      seedException({
                        rosterExceptionId:
                          "ex-invalid-date",
                        exceptionType:
                          "WORKING_TO_OFF",
                        exceptionDate:
                          testCase.exceptionDate,
                        subjectEmploymentProfileId:
                          "emp-1",
                      }),
                    ],
                  }),
                ],
              }).previewMonthlyRoster(
                createActor([
                  Permission.WORK_SCHEDULE_READ,
                ]),
                {
                  monthlyRosterId: "roster-1",
                },
              ),
            WorkScheduleValidationError,
          );
        },
      );
    });
  }
});

test("Monthly Roster preview ignores malformed REMOVED persisted exception dates", async () => {
  await bindTraceId(
    "trace-roster-preview-removed-bad-date",
    async () => {
      const preview =
        await createService({
          rosters: [
            seedRoster({
              exceptions: [
                seedException({
                  rosterExceptionId:
                    "ex-removed-bad-date",
                  exceptionType: "WORKING_TO_OFF",
                  exceptionDate: "2026-05-99",
                  subjectEmploymentProfileId: "emp-1",
                  status: "REMOVED",
                }),
              ],
            }),
          ],
        }).previewMonthlyRoster(
          createActor([Permission.WORK_SCHEDULE_READ]),
          {
            monthlyRosterId: "roster-1",
          },
        );

      assert.equal(preview.rosterStatus, "DRAFT");
      assert.equal(preview.summary.totalWorkingToOff, 0);
      assert.equal(
        preview.rows.some(
          (row) =>
            row.sourceExceptionId ===
            "ex-removed-bad-date",
        ),
        false,
      );
    },
  );
});

test("Monthly Roster preview still applies valid persisted ACTIVE exception dates", async () => {
  await bindTraceId(
    "trace-roster-preview-valid-active-date",
    async () => {
      const preview =
        await createService({
          rosters: [
            seedRoster({
              exceptions: [
                seedException({
                  rosterExceptionId:
                    "ex-valid-change",
                  exceptionType: "CHANGE_TIME",
                  exceptionDate: "2026-05-04",
                  subjectEmploymentProfileId: "emp-1",
                  startLocalTime: "10:00",
                }),
              ],
            }),
          ],
        }).previewMonthlyRoster(
          createActor([Permission.WORK_SCHEDULE_READ]),
          {
            monthlyRosterId: "roster-1",
          },
        );

      const row = preview.rows.find(
        (candidate) =>
          candidate.sourceExceptionId ===
          "ex-valid-change",
      );

      assert.equal(row?.rowKind, "CHANGE_TIME");
      assert.equal(row?.localDate, "2026-05-04");
      assert.equal(row?.startLocalTime, "10:00");
      assert.equal(row?.endLocalTime, "19:00");
      assert.equal(preview.summary.totalChangeTime, 1);
    },
  );
});

test("Monthly Roster preview requires global read authority", async () => {
  await bindTraceId("trace-roster-preview-scope", async () => {
    const service = createService();

    await assert.rejects(
      () =>
        service.previewMonthlyRoster(
          createActor([]),
          {
            monthlyRosterId: "roster-1",
          },
        ),
      Error,
    );

    await assert.rejects(
      () =>
        service.previewMonthlyRoster(
          createActor(
            [Permission.WORK_SCHEDULE_READ],
            ["department"],
          ),
          {
            monthlyRosterId: "roster-1",
            scope: "global",
          },
        ),
      WorkSchedulePermissionScopeError,
    );

    await assert.rejects(
      () =>
        service.previewMonthlyRoster(
          createActor(
            [Permission.WORK_SCHEDULE_READ],
            ["department"],
          ),
          {
            monthlyRosterId: "roster-1",
            scope: "department",
          },
        ),
      WorkSchedulePermissionScopeError,
    );

    const preview = await service.previewMonthlyRoster(
        createActor(
          [Permission.WORK_SCHEDULE_READ],
          ["global"],
        ),
        {
          monthlyRosterId: "roster-1",
          scope: "global",
        },
      );

    assert.equal(
      preview.departmentOrgUnitId,
      "dept-1",
    );
  });
});

test("Monthly Roster preview does not mutate roster status/version or create Work Shifts/shift codes", async () => {
  await bindTraceId("trace-roster-preview-readonly", async () => {
    const roster = seedRoster({
      status: "DRAFT",
      draftVersion: 12,
    });
    const readRepository =
      new MemoryWorkShiftReadRepository();
    const service = createService({
      rosters: [roster],
      workShiftReadRepository: readRepository,
    });

    await service.previewMonthlyRoster(
      createActor([Permission.WORK_SCHEDULE_READ]),
      {
        monthlyRosterId: "roster-1",
      },
    );

    assert.equal(roster.status, "DRAFT");
    assert.equal(roster.draftVersion, 12);
    assert.equal(roster.previewHash, null);
    assert.equal(readRepository.lookupCount, 1);
  });
});

function createActor(
  permissions: readonly Permission[],
  workScheduleScopes: readonly string[] = ["global"],
): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants: {
      workSchedule: workScheduleScopes as never,
    },
    isActive: true,
  });
}

function seedProfile(
  id: string,
  employmentStatus: WorkScheduleReferencedEmploymentProfile["employmentStatus"],
  orgUnitId: string,
): WorkScheduleReferencedEmploymentProfile {
  return {
    id,
    employmentStatus,
    orgUnitId,
    managerEmploymentProfileId: null,
    linkedUserId: null,
  };
}

function seedPattern(params: {
  readonly status?: WorkPatternStatus;
  readonly workingDays?: readonly WorkPatternRecord["workingDays"][number][];
} = {}): WorkPatternRecord {
  return {
    workPatternId: "pattern-1",
    patternCode: "PAT-1",
    normalizedPatternCode: "pat-1",
    name: "Office",
    normalizedName: "office",
    status: params.status ?? "ACTIVE",
    timezone: "Asia/Ho_Chi_Minh",
    startLocalTime: "08:00",
    endLocalTime: "17:00",
    workingMinutes: 480,
    breakMinutes: 60,
    workingDays:
      params.workingDays ?? [
        "MON",
        "TUE",
        "WED",
        "THU",
        "FRI",
      ],
    description: null,
    externalRef: null,
    activatedAt: 1,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function seedCalendar(params: {
  readonly status?: HolidayCalendarStatus;
  readonly entries?: readonly HolidayCalendarEntryRecord[];
} = {}): HolidayCalendarRecord {
  return {
    holidayCalendarId: "calendar-1",
    calendarCode: "CAL-1",
    normalizedCalendarCode: "cal-1",
    name: "Vietnam",
    normalizedName: "vietnam",
    scopeType: "GLOBAL",
    timezone: "Asia/Ho_Chi_Minh",
    status: params.status ?? "ACTIVE",
    entries: params.entries ?? [],
    description: null,
    externalRef: null,
    activatedAt: 1,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function seedCalendarEntry(
  id: string,
  date: string,
  status: HolidayCalendarEntryRecord["status"],
): HolidayCalendarEntryRecord {
  return {
    holidayCalendarEntryId: id,
    date,
    entryType: "HOLIDAY",
    name: "Holiday",
    status,
    description: null,
    externalRef: null,
    removedAt: status === "REMOVED" ? 2 : null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function seedRoster(params: {
  readonly status?: MonthlyRosterStatus;
  readonly draftVersion?: number;
  readonly previewHash?: string | null;
  readonly exceptions?: readonly RosterExceptionRecord[];
} = {}): MonthlyRosterRecord {
  return {
    monthlyRosterId: "roster-1",
    rosterCode: "MR-2026-05-HR",
    normalizedRosterCode: "mr-2026-05-hr",
    rosterMonth: "2026-05",
    timezone: "Asia/Ho_Chi_Minh",
    targetSubjectKind: "EMPLOYMENT_PROFILE",
    targetOrgUnitMode: "EXACT_ONLY",
    departmentOrgUnitId: "dept-1",
    workPatternId: "pattern-1",
    holidayCalendarId: "calendar-1",
    status: params.status ?? "DRAFT",
    draftVersion: params.draftVersion ?? 7,
    previewHash: params.previewHash ?? null,
    lastPreviewedAt: null,
    publishedAt: null,
    publishedByUserId: null,
    publishGenerationRunId: null,
    description: null,
    externalRef: null,
    exceptions: params.exceptions ?? [],
    archivedAt:
      params.status === "ARCHIVED" ? 3 : null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function seedException(params: {
  readonly rosterExceptionId: string;
  readonly exceptionType: RosterExceptionRecord["exceptionType"];
  readonly exceptionDate: string;
  readonly subjectEmploymentProfileId: string;
  readonly status?: RosterExceptionRecord["status"];
  readonly startLocalTime?: string | null;
  readonly workingMinutes?: number | null;
  readonly breakMinutes?: number | null;
}): RosterExceptionRecord {
  const isSpecial =
    params.exceptionType === "ADD_SPECIAL_SHIFT";

  return {
    rosterExceptionId: params.rosterExceptionId,
    monthlyRosterId: "roster-1",
    exceptionType: params.exceptionType,
    exceptionDate: params.exceptionDate,
    subjectEmploymentProfileId:
      params.subjectEmploymentProfileId,
    status: params.status ?? "ACTIVE",
    title: isSpecial ? "Special shift" : null,
    startLocalTime:
      params.exceptionType === "WORKING_TO_OFF"
        ? null
        : (params.startLocalTime ?? "09:00"),
    endLocalTime:
      params.exceptionType === "WORKING_TO_OFF"
        ? null
        : "18:00",
    workingMinutes:
      isSpecial
        ? (params.workingMinutes ?? 120)
        : null,
    breakMinutes:
      isSpecial
        ? (params.breakMinutes ?? 30)
        : null,
    studioResourceIds: [],
    reason: null,
    sourceNote: null,
    description: null,
    externalRef: null,
    removedAt:
      params.status === "REMOVED" ? 2 : null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function seedConflictShift(params: {
  readonly subjectEmploymentProfileId: string;
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
}): ActiveEmploymentProfileWorkShiftConflictView {
  return {
    workShiftId: "shift-conflict",
    shiftCode: "WS-1",
    title: "Manual overlap",
    subjectEmploymentProfileId:
      params.subjectEmploymentProfileId,
    status: "ACTIVE",
    shiftStartAt: params.shiftStartAt,
    shiftEndAt: params.shiftEndAt,
    sourceType: "MANUAL",
    sourceRosterId: null,
    sourceRosterMonth: null,
    sourceRosterLocalDate: null,
    sourceRosterSlotKey: null,
  };
}

function vietnamUtc(date: string, time: string): number {
  const [year, month, day] = date
    .split("-")
    .map(Number);
  const [hour, minute] = time.split(":").map(Number);

  return Date.UTC(
    year,
    month - 1,
    day,
    hour - 7,
    minute,
  );
}
