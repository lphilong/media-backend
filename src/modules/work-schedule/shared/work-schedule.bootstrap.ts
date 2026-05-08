import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  WORK_SHIFT_CREATED_AT_ID_INDEX_NAME,
  WORK_SHIFT_CODE_SEQUENCE_MODULE_DATE_BUCKET_UNIQ_INDEX_NAME,
  WORK_SHIFT_NORMALIZED_SHIFT_CODE_INDEX_NAME,
  WORK_SHIFT_NORMALIZED_TITLE_INDEX_NAME,
  WORK_SHIFT_RESOURCE_STATUS_WINDOW_INDEX_NAME,
  WORK_SHIFT_ROSTER_GENERATED_UNIQ_INDEX_NAME,
  WORK_SHIFT_SHIFT_CODE_UNIQ_INDEX_NAME,
  WORK_SHIFT_SHIFT_START_AT_ID_INDEX_NAME,
  WORK_SHIFT_SOURCE_GENERATION_RUN_INDEX_NAME,
  WORK_SHIFT_SOURCE_LOOKUP_INDEX_NAME,
  WORK_SHIFT_STATUS_WINDOW_INDEX_NAME,
  WORK_SHIFT_SUBJECT_EMPLOYMENT_PROFILE_STATUS_WINDOW_INDEX_NAME,
  WORK_SHIFT_SUBJECT_TALENT_GROUP_STATUS_WINDOW_INDEX_NAME,
  WORK_SHIFT_SUBJECT_TALENT_STATUS_WINDOW_INDEX_NAME,
  WORK_PATTERN_CREATED_AT_ID_INDEX_NAME,
  WORK_PATTERN_NORMALIZED_PATTERN_CODE_INDEX_NAME,
  WORK_PATTERN_PATTERN_CODE_UNIQ_INDEX_NAME,
  WORK_PATTERN_STATUS_NAME_INDEX_NAME,
  HOLIDAY_CALENDAR_CALENDAR_CODE_UNIQ_INDEX_NAME,
  HOLIDAY_CALENDAR_CREATED_AT_ID_INDEX_NAME,
  HOLIDAY_CALENDAR_ENTRY_DATE_LOOKUP_INDEX_NAME,
  HOLIDAY_CALENDAR_NORMALIZED_CALENDAR_CODE_INDEX_NAME,
  HOLIDAY_CALENDAR_STATUS_NAME_INDEX_NAME,
  MONTHLY_ROSTER_ACTIVE_DEPARTMENT_MONTH_UNIQ_INDEX_NAME,
  MONTHLY_ROSTER_CALENDAR_LOOKUP_INDEX_NAME,
  MONTHLY_ROSTER_DEPARTMENT_MONTH_STATUS_INDEX_NAME,
  MONTHLY_ROSTER_EXCEPTION_PROFILE_DATE_INDEX_NAME,
  MONTHLY_ROSTER_PATTERN_LOOKUP_INDEX_NAME,
  MONTHLY_ROSTER_ROSTER_CODE_UNIQ_INDEX_NAME,
  MONTHLY_ROSTER_STATUS_MONTH_INDEX_NAME,
  initWorkShiftIndexes,
} from "@infra/mongo/work-schedule/work-schedule.index";
import { registerPresenters } from "./work-schedule.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createWorkScheduleBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "work-schedule",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initWorkShiftIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "work_shifts",
        WORK_SHIFT_SHIFT_CODE_UNIQ_INDEX_NAME,
        {
          shiftCode: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_shifts",
        WORK_SHIFT_NORMALIZED_SHIFT_CODE_INDEX_NAME,
        {
          normalizedShiftCode: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_shifts",
        WORK_SHIFT_NORMALIZED_TITLE_INDEX_NAME,
        {
          normalizedTitle: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_shifts",
        WORK_SHIFT_STATUS_WINDOW_INDEX_NAME,
        {
          status: 1,
          shiftStartAt: 1,
          shiftEndAt: 1,
        },
      );

      await assertRequiredPartialIndex(
        db,
        "work_shifts",
        WORK_SHIFT_SUBJECT_EMPLOYMENT_PROFILE_STATUS_WINDOW_INDEX_NAME,
        {
          subjectKind: 1,
          subjectEmploymentProfileId: 1,
          status: 1,
          shiftStartAt: 1,
          shiftEndAt: 1,
        },
        {
          subjectEmploymentProfileId: {
            $ne: null,
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "work_shifts",
        WORK_SHIFT_SUBJECT_TALENT_STATUS_WINDOW_INDEX_NAME,
        {
          subjectKind: 1,
          subjectTalentId: 1,
          status: 1,
          shiftStartAt: 1,
          shiftEndAt: 1,
        },
        {
          subjectTalentId: {
            $ne: null,
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "work_shifts",
        WORK_SHIFT_SUBJECT_TALENT_GROUP_STATUS_WINDOW_INDEX_NAME,
        {
          subjectKind: 1,
          subjectTalentGroupId: 1,
          status: 1,
          shiftStartAt: 1,
          shiftEndAt: 1,
        },
        {
          subjectTalentGroupId: {
            $ne: null,
          },
        },
      );

      await assertRequiredIndex(
        db,
        "work_shifts",
        WORK_SHIFT_RESOURCE_STATUS_WINDOW_INDEX_NAME,
        {
          studioResourceIds: 1,
          status: 1,
          shiftStartAt: 1,
          shiftEndAt: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_shifts",
        WORK_SHIFT_SHIFT_START_AT_ID_INDEX_NAME,
        {
          shiftStartAt: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_shifts",
        WORK_SHIFT_CREATED_AT_ID_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_shifts",
        WORK_SHIFT_SOURCE_LOOKUP_INDEX_NAME,
        {
          sourceType: 1,
          sourceRosterId: 1,
          sourceDepartmentOrgUnitId: 1,
          sourceRosterMonth: 1,
        },
      );

      await assertRequiredPartialIndex(
        db,
        "work_shifts",
        WORK_SHIFT_SOURCE_GENERATION_RUN_INDEX_NAME,
        {
          sourceGenerationRunId: 1,
        },
        {
          sourceGenerationRunId: {
            $ne: null,
          },
        },
      );

      await assertRequiredPartialUniqueIndex(
        db,
        "work_shifts",
        WORK_SHIFT_ROSTER_GENERATED_UNIQ_INDEX_NAME,
        {
          sourceRosterId: 1,
          subjectEmploymentProfileId: 1,
          sourceRosterLocalDate: 1,
          sourceRosterSlotKey: 1,
        },
        {
          sourceType: "ROSTER_GENERATED",
        },
      );

      await assertRequiredUniqueIndex(
        db,
        "work_shift_code_sequences",
        WORK_SHIFT_CODE_SEQUENCE_MODULE_DATE_BUCKET_UNIQ_INDEX_NAME,
        {
          module: 1,
          dateBucket: 1,
        },
      );

      await assertRequiredUniqueIndex(
        db,
        "work_patterns",
        WORK_PATTERN_PATTERN_CODE_UNIQ_INDEX_NAME,
        {
          patternCode: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_patterns",
        WORK_PATTERN_STATUS_NAME_INDEX_NAME,
        {
          status: 1,
          normalizedName: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_patterns",
        WORK_PATTERN_CREATED_AT_ID_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_patterns",
        WORK_PATTERN_NORMALIZED_PATTERN_CODE_INDEX_NAME,
        {
          normalizedPatternCode: 1,
          _id: 1,
        },
      );

      await assertRequiredUniqueIndex(
        db,
        "work_holiday_calendars",
        HOLIDAY_CALENDAR_CALENDAR_CODE_UNIQ_INDEX_NAME,
        {
          calendarCode: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_holiday_calendars",
        HOLIDAY_CALENDAR_STATUS_NAME_INDEX_NAME,
        {
          status: 1,
          normalizedName: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_holiday_calendars",
        HOLIDAY_CALENDAR_CREATED_AT_ID_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_holiday_calendars",
        HOLIDAY_CALENDAR_NORMALIZED_CALENDAR_CODE_INDEX_NAME,
        {
          normalizedCalendarCode: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_holiday_calendars",
        HOLIDAY_CALENDAR_ENTRY_DATE_LOOKUP_INDEX_NAME,
        {
          _id: 1,
          "entries.status": 1,
          "entries.date": 1,
        },
      );

      await assertRequiredUniqueIndex(
        db,
        "work_monthly_rosters",
        MONTHLY_ROSTER_ROSTER_CODE_UNIQ_INDEX_NAME,
        {
          rosterCode: 1,
        },
      );

      await assertRequiredPartialUniqueIndex(
        db,
        "work_monthly_rosters",
        MONTHLY_ROSTER_ACTIVE_DEPARTMENT_MONTH_UNIQ_INDEX_NAME,
        {
          rosterMonth: 1,
          departmentOrgUnitId: 1,
        },
        {
          status: {
            $ne: "ARCHIVED",
          },
        },
      );

      await assertRequiredIndex(
        db,
        "work_monthly_rosters",
        MONTHLY_ROSTER_STATUS_MONTH_INDEX_NAME,
        {
          status: 1,
          rosterMonth: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_monthly_rosters",
        MONTHLY_ROSTER_DEPARTMENT_MONTH_STATUS_INDEX_NAME,
        {
          departmentOrgUnitId: 1,
          rosterMonth: 1,
          status: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_monthly_rosters",
        MONTHLY_ROSTER_PATTERN_LOOKUP_INDEX_NAME,
        {
          workPatternId: 1,
          status: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_monthly_rosters",
        MONTHLY_ROSTER_CALENDAR_LOOKUP_INDEX_NAME,
        {
          holidayCalendarId: 1,
          status: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "work_monthly_rosters",
        MONTHLY_ROSTER_EXCEPTION_PROFILE_DATE_INDEX_NAME,
        {
          _id: 1,
          "exceptions.subjectEmploymentProfileId": 1,
          "exceptions.exceptionDate": 1,
          "exceptions.status": 1,
        },
      );
    },
  });
}

async function assertRequiredPartialUniqueIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
  expectedPartialFilterExpression: Record<
    string,
    unknown
  >,
): Promise<void> {
  const matched = await assertRequiredPartialIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
    expectedPartialFilterExpression,
  );

  if (matched.unique !== true) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} must be unique`,
    );
  }
}

async function assertRequiredUniqueIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
): Promise<void> {
  const matched = await assertRequiredIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
  );

  if (matched.unique !== true) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} must be unique`,
    );
  }
}

async function assertRequiredPartialIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
  expectedPartialFilterExpression: Record<
    string,
    unknown
  >,
): Promise<IndexMetadata> {
  const matched = await assertRequiredIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
  );

  if (
    !hasDeepExactShape(
      matched.partialFilterExpression,
      expectedPartialFilterExpression,
    )
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid partialFilterExpression`,
    );
  }

  return matched;
}

async function assertRequiredIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
): Promise<IndexMetadata> {
  const indexes = await db
    .collection(collectionName)
    .indexes();

  const matched = indexes.find((index) => {
    const name =
      typeof index.name === "string"
        ? index.name
        : undefined;

    return name === indexName;
  });

  if (!matched) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} missing on ${collectionName}`,
    );
  }

  if (!hasDeepExactShape(matched.key, expectedKey)) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid key shape`,
    );
  }

  return matched as IndexMetadata;
}

function hasDeepExactShape(
  candidate: unknown,
  expected: unknown,
): boolean {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof expected !== "object" ||
    expected === null
  ) {
    return Object.is(candidate, expected);
  }

  if (
    Array.isArray(candidate) ||
    Array.isArray(expected)
  ) {
    return false;
  }

  const candidateRecord = candidate as Record<
    string,
    unknown
  >;
  const expectedRecord = expected as Record<
    string,
    unknown
  >;
  const candidateKeys = Object.keys(candidateRecord);
  const expectedKeys = Object.keys(expectedRecord);

  if (candidateKeys.length !== expectedKeys.length) {
    return false;
  }

  for (const key of expectedKeys) {
    if (!(key in candidateRecord)) {
      return false;
    }

    if (
      !hasDeepExactShape(
        candidateRecord[key],
        expectedRecord[key],
      )
    ) {
      return false;
    }
  }

  return true;
}
