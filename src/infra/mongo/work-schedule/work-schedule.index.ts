import {
  Collection,
  Db,
} from "mongodb";

export const WORK_SHIFT_SHIFT_CODE_UNIQ_INDEX_NAME =
  "uniq_work_shift_shift_code";
export const WORK_SHIFT_NORMALIZED_SHIFT_CODE_INDEX_NAME =
  "idx_work_shift_normalized_shift_code";
export const WORK_SHIFT_NORMALIZED_TITLE_INDEX_NAME =
  "idx_work_shift_normalized_title";
export const WORK_SHIFT_STATUS_WINDOW_INDEX_NAME =
  "idx_work_shift_status_window";
export const WORK_SHIFT_SUBJECT_EMPLOYMENT_PROFILE_STATUS_WINDOW_INDEX_NAME =
  "idx_work_shift_subject_employment_profile_status_window";
export const WORK_SHIFT_SUBJECT_TALENT_STATUS_WINDOW_INDEX_NAME =
  "idx_work_shift_subject_talent_status_window";
export const WORK_SHIFT_SUBJECT_TALENT_GROUP_STATUS_WINDOW_INDEX_NAME =
  "idx_work_shift_subject_talent_group_status_window";
export const WORK_SHIFT_RESOURCE_STATUS_WINDOW_INDEX_NAME =
  "idx_work_shift_resource_status_window";
export const WORK_SHIFT_SHIFT_START_AT_ID_INDEX_NAME =
  "idx_work_shift_shift_start_at";
export const WORK_SHIFT_CREATED_AT_ID_INDEX_NAME =
  "idx_work_shift_created_at";
export const WORK_SHIFT_SOURCE_LOOKUP_INDEX_NAME =
  "idx_work_shift_source_lookup";
export const WORK_SHIFT_SOURCE_GENERATION_RUN_INDEX_NAME =
  "idx_work_shift_source_generation_run";
export const WORK_SHIFT_ROSTER_GENERATED_UNIQ_INDEX_NAME =
  "uniq_work_shift_roster_generated_subject_date_slot";
export const WORK_SHIFT_CODE_SEQUENCE_MODULE_DATE_BUCKET_UNIQ_INDEX_NAME =
  "uniq_work_shift_code_sequence_module_date_bucket";
export const WORK_PATTERN_PATTERN_CODE_UNIQ_INDEX_NAME =
  "uniq_work_pattern_pattern_code";
export const WORK_PATTERN_STATUS_NAME_INDEX_NAME =
  "idx_work_pattern_status_name";
export const WORK_PATTERN_CREATED_AT_ID_INDEX_NAME =
  "idx_work_pattern_created_at";
export const WORK_PATTERN_NORMALIZED_PATTERN_CODE_INDEX_NAME =
  "idx_work_pattern_normalized_pattern_code";
export const HOLIDAY_CALENDAR_CALENDAR_CODE_UNIQ_INDEX_NAME =
  "uniq_holiday_calendar_calendar_code";
export const HOLIDAY_CALENDAR_STATUS_NAME_INDEX_NAME =
  "idx_holiday_calendar_status_name";
export const HOLIDAY_CALENDAR_CREATED_AT_ID_INDEX_NAME =
  "idx_holiday_calendar_created_at";
export const HOLIDAY_CALENDAR_NORMALIZED_CALENDAR_CODE_INDEX_NAME =
  "idx_holiday_calendar_normalized_calendar_code";
export const HOLIDAY_CALENDAR_ENTRY_DATE_LOOKUP_INDEX_NAME =
  "idx_holiday_calendar_entry_date_lookup";
export const MONTHLY_ROSTER_ROSTER_CODE_UNIQ_INDEX_NAME =
  "uniq_monthly_roster_roster_code";
export const MONTHLY_ROSTER_ACTIVE_TARGET_MONTH_UNIQ_INDEX_NAME =
  "uniq_monthly_roster_active_target_month";
export const MONTHLY_ROSTER_STATUS_MONTH_INDEX_NAME =
  "idx_monthly_roster_status_month";
export const MONTHLY_ROSTER_DEPARTMENT_MONTH_STATUS_INDEX_NAME =
  "idx_monthly_roster_department_month_status";
export const MONTHLY_ROSTER_TARGET_MONTH_STATUS_INDEX_NAME =
  "idx_monthly_roster_target_month_status";
export const MONTHLY_ROSTER_PATTERN_LOOKUP_INDEX_NAME =
  "idx_monthly_roster_pattern_lookup";
export const MONTHLY_ROSTER_CALENDAR_LOOKUP_INDEX_NAME =
  "idx_monthly_roster_calendar_lookup";
export const MONTHLY_ROSTER_EXCEPTION_PROFILE_DATE_INDEX_NAME =
  "idx_monthly_roster_exception_profile_date";
export const WORK_SCHEDULE_REQUEST_CODE_UNIQ_INDEX_NAME =
  "uniq_work_schedule_request_code";
export const WORK_SCHEDULE_REQUEST_STATUS_CREATED_AT_INDEX_NAME =
  "idx_work_schedule_request_status_created_at";
export const WORK_SCHEDULE_REQUEST_TARGET_PROFILE_INDEX_NAME =
  "idx_work_schedule_request_target_profile";
export const WORK_SCHEDULE_REQUEST_REQUESTER_INDEX_NAME =
  "idx_work_schedule_request_requester";
export const WORK_SCHEDULE_REQUEST_BATCH_CODE_UNIQ_INDEX_NAME =
  "uniq_work_schedule_request_batch_code";
export const WORK_SCHEDULE_REQUEST_BATCH_CLIENT_TOKEN_UNIQ_INDEX_NAME =
  "uniq_work_schedule_request_batch_manager_client_token";
export const WORK_SCHEDULE_REQUEST_BATCH_STATUS_CREATED_AT_INDEX_NAME =
  "idx_work_schedule_request_batch_status_created_at";
export const WORK_SCHEDULE_REQUEST_BATCH_PERIOD_STATUS_INDEX_NAME =
  "idx_work_schedule_request_batch_period_status";
export const WORK_SCHEDULE_REQUEST_BATCH_SUBMITTER_INDEX_NAME =
  "idx_work_schedule_request_batch_submitter";
export const WORK_SCHEDULE_REQUEST_LINE_BATCH_STATUS_INDEX_NAME =
  "idx_work_schedule_request_line_batch_status";
export const WORK_SCHEDULE_REQUEST_LINE_MEMBER_STATUS_INDEX_NAME =
  "idx_work_schedule_request_line_member_status";
export const WORK_SCHEDULE_REQUEST_LINE_PENDING_DUPLICATE_INDEX_NAME =
  "idx_work_schedule_request_line_pending_duplicate";

interface WorkShiftLegacyDocument {
  readonly _id: string;
  readonly shiftCode?: unknown;
  readonly title?: unknown;
}

export async function initWorkShiftIndexes(
  db: Db,
): Promise<void> {
  const collection =
    db.collection<WorkShiftLegacyDocument>(
      "work_shifts",
    );

  await backfillNormalizedSearchFields(collection);

  await collection.createIndex(
    {
      shiftCode: 1,
    },
    {
      name: WORK_SHIFT_SHIFT_CODE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    {
      normalizedShiftCode: 1,
      _id: 1,
    },
    {
      name:
        WORK_SHIFT_NORMALIZED_SHIFT_CODE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedTitle: 1,
      _id: 1,
    },
    {
      name: WORK_SHIFT_NORMALIZED_TITLE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      status: 1,
      shiftStartAt: 1,
      shiftEndAt: 1,
    },
    {
      name: WORK_SHIFT_STATUS_WINDOW_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      subjectKind: 1,
      subjectEmploymentProfileId: 1,
      status: 1,
      shiftStartAt: 1,
      shiftEndAt: 1,
    },
    {
      name:
        WORK_SHIFT_SUBJECT_EMPLOYMENT_PROFILE_STATUS_WINDOW_INDEX_NAME,
      partialFilterExpression: {
        subjectEmploymentProfileId: {
          $type: "string",
        },
      },
    },
  );

  await collection.createIndex(
    {
      subjectKind: 1,
      subjectTalentId: 1,
      status: 1,
      shiftStartAt: 1,
      shiftEndAt: 1,
    },
    {
      name:
        WORK_SHIFT_SUBJECT_TALENT_STATUS_WINDOW_INDEX_NAME,
      partialFilterExpression: {
        subjectTalentId: {
          $type: "string",
        },
      },
    },
  );

  await collection.createIndex(
    {
      subjectKind: 1,
      subjectTalentGroupId: 1,
      status: 1,
      shiftStartAt: 1,
      shiftEndAt: 1,
    },
    {
      name:
        WORK_SHIFT_SUBJECT_TALENT_GROUP_STATUS_WINDOW_INDEX_NAME,
      partialFilterExpression: {
        subjectTalentGroupId: {
          $type: "string",
        },
      },
    },
  );

  await collection.createIndex(
    {
      studioResourceIds: 1,
      status: 1,
      shiftStartAt: 1,
      shiftEndAt: 1,
    },
    {
      name:
        WORK_SHIFT_RESOURCE_STATUS_WINDOW_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      shiftStartAt: 1,
      _id: 1,
    },
    {
      name:
        WORK_SHIFT_SHIFT_START_AT_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name: WORK_SHIFT_CREATED_AT_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      sourceType: 1,
      sourceRosterId: 1,
      sourceDepartmentOrgUnitId: 1,
      sourceRosterMonth: 1,
    },
    {
      name: WORK_SHIFT_SOURCE_LOOKUP_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      sourceGenerationRunId: 1,
    },
    {
      name:
        WORK_SHIFT_SOURCE_GENERATION_RUN_INDEX_NAME,
      partialFilterExpression: {
        sourceGenerationRunId: {
          $type: "string",
        },
      },
    },
  );

  await collection.createIndex(
    {
      sourceRosterId: 1,
      subjectEmploymentProfileId: 1,
      sourceRosterLocalDate: 1,
      sourceRosterSlotKey: 1,
    },
    {
      name:
        WORK_SHIFT_ROSTER_GENERATED_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        sourceType: "ROSTER_GENERATED",
      },
    },
  );

  await initWorkShiftCodeSequenceIndexes(db);
  await initWorkPatternIndexes(db);
  await initHolidayCalendarIndexes(db);
  await initMonthlyRosterIndexes(db);
  await initWorkScheduleRequestIndexes(db);
  await initWorkScheduleRequestBatchIndexes(db);
}

async function initWorkShiftCodeSequenceIndexes(
  db: Db,
): Promise<void> {
  await db
    .collection("work_shift_code_sequences")
    .createIndex(
      {
        module: 1,
        dateBucket: 1,
      },
      {
        name:
          WORK_SHIFT_CODE_SEQUENCE_MODULE_DATE_BUCKET_UNIQ_INDEX_NAME,
        unique: true,
      },
    );
}

async function initWorkPatternIndexes(
  db: Db,
): Promise<void> {
  const collection =
    db.collection("work_patterns");

  await collection.createIndex(
    {
      patternCode: 1,
    },
    {
      name: WORK_PATTERN_PATTERN_CODE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    {
      status: 1,
      normalizedName: 1,
      _id: 1,
    },
    {
      name: WORK_PATTERN_STATUS_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name: WORK_PATTERN_CREATED_AT_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedPatternCode: 1,
      _id: 1,
    },
    {
      name:
        WORK_PATTERN_NORMALIZED_PATTERN_CODE_INDEX_NAME,
    },
  );
}

async function initHolidayCalendarIndexes(
  db: Db,
): Promise<void> {
  const collection = db.collection(
    "work_holiday_calendars",
  );

  await collection.createIndex(
    {
      calendarCode: 1,
    },
    {
      name:
        HOLIDAY_CALENDAR_CALENDAR_CODE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    {
      status: 1,
      normalizedName: 1,
      _id: 1,
    },
    {
      name: HOLIDAY_CALENDAR_STATUS_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name: HOLIDAY_CALENDAR_CREATED_AT_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedCalendarCode: 1,
      _id: 1,
    },
    {
      name:
        HOLIDAY_CALENDAR_NORMALIZED_CALENDAR_CODE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      _id: 1,
      "entries.status": 1,
      "entries.date": 1,
    },
    {
      name:
        HOLIDAY_CALENDAR_ENTRY_DATE_LOOKUP_INDEX_NAME,
    },
  );
}

async function initMonthlyRosterIndexes(
  db: Db,
): Promise<void> {
  const collection = db.collection(
    "work_monthly_rosters",
  );

  await collection.createIndex(
    {
      rosterCode: 1,
    },
    {
      name: MONTHLY_ROSTER_ROSTER_CODE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    {
      rosterMonth: 1,
      targetType: 1,
      targetOrgUnitId: 1,
      targetTalentGroupId: 1,
    },
    {
      name:
        MONTHLY_ROSTER_ACTIVE_TARGET_MONTH_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "PUBLISHED", "LOCKED"],
        },
        targetType: {
          $in: ["ORG_UNIT", "TALENT_GROUP"],
        },
      },
    },
  );

  await collection.createIndex(
    {
      status: 1,
      rosterMonth: 1,
      _id: 1,
    },
    {
      name: MONTHLY_ROSTER_STATUS_MONTH_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      departmentOrgUnitId: 1,
      rosterMonth: 1,
      status: 1,
      _id: 1,
    },
    {
      name:
        MONTHLY_ROSTER_DEPARTMENT_MONTH_STATUS_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      targetType: 1,
      targetOrgUnitId: 1,
      targetTalentGroupId: 1,
      rosterMonth: 1,
      status: 1,
      _id: 1,
    },
    {
      name:
        MONTHLY_ROSTER_TARGET_MONTH_STATUS_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      workPatternId: 1,
      status: 1,
      _id: 1,
    },
    {
      name:
        MONTHLY_ROSTER_PATTERN_LOOKUP_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      holidayCalendarId: 1,
      status: 1,
      _id: 1,
    },
    {
      name:
        MONTHLY_ROSTER_CALENDAR_LOOKUP_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      _id: 1,
      "exceptions.subjectEmploymentProfileId": 1,
      "exceptions.exceptionDate": 1,
      "exceptions.status": 1,
    },
    {
      name:
        MONTHLY_ROSTER_EXCEPTION_PROFILE_DATE_INDEX_NAME,
    },
  );
}

async function initWorkScheduleRequestIndexes(
  db: Db,
): Promise<void> {
  const collection = db.collection(
    "work_schedule_requests",
  );

  await collection.createIndex(
    {
      requestCode: 1,
    },
    {
      name: WORK_SCHEDULE_REQUEST_CODE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    {
      status: 1,
      createdAt: -1,
      _id: 1,
    },
    {
      name:
        WORK_SCHEDULE_REQUEST_STATUS_CREATED_AT_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      targetEmploymentProfileId: 1,
      status: 1,
      createdAt: -1,
      _id: 1,
    },
    {
      name:
        WORK_SCHEDULE_REQUEST_TARGET_PROFILE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      requestedByUserId: 1,
      status: 1,
      createdAt: -1,
      _id: 1,
    },
    {
      name: WORK_SCHEDULE_REQUEST_REQUESTER_INDEX_NAME,
    },
  );
}

async function initWorkScheduleRequestBatchIndexes(
  db: Db,
): Promise<void> {
  const batches = db.collection(
    "work_schedule_request_batches",
  );
  const lines = db.collection(
    "work_schedule_request_lines",
  );

  await batches.createIndex(
    { batchCode: 1 },
    {
      name: WORK_SCHEDULE_REQUEST_BATCH_CODE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await batches.createIndex(
    {
      submittedByEmploymentProfileId: 1,
      clientToken: 1,
    },
    {
      name:
        WORK_SCHEDULE_REQUEST_BATCH_CLIENT_TOKEN_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await batches.createIndex(
    {
      status: 1,
      createdAt: -1,
      _id: 1,
    },
    {
      name:
        WORK_SCHEDULE_REQUEST_BATCH_STATUS_CREATED_AT_INDEX_NAME,
    },
  );

  await batches.createIndex(
    {
      periodMonth: 1,
      status: 1,
      createdAt: -1,
      _id: 1,
    },
    {
      name:
        WORK_SCHEDULE_REQUEST_BATCH_PERIOD_STATUS_INDEX_NAME,
    },
  );

  await batches.createIndex(
    {
      submittedByEmploymentProfileId: 1,
      status: 1,
      createdAt: -1,
      _id: 1,
    },
    {
      name: WORK_SCHEDULE_REQUEST_BATCH_SUBMITTER_INDEX_NAME,
    },
  );

  await lines.createIndex(
    {
      batchId: 1,
      status: 1,
      lineNo: 1,
      _id: 1,
    },
    {
      name: WORK_SCHEDULE_REQUEST_LINE_BATCH_STATUS_INDEX_NAME,
    },
  );

  await lines.createIndex(
    {
      memberEmploymentProfileId: 1,
      status: 1,
      createdAt: -1,
      _id: 1,
    },
    {
      name: WORK_SCHEDULE_REQUEST_LINE_MEMBER_STATUS_INDEX_NAME,
    },
  );

  await lines.createIndex(
    {
      submittedByEmploymentProfileId: 1,
      periodMonth: 1,
      requestType: 1,
      memberEmploymentProfileId: 1,
      workShiftId: 1,
      requestedStartAt: 1,
      requestedEndAt: 1,
      status: 1,
    },
    {
      name:
        WORK_SCHEDULE_REQUEST_LINE_PENDING_DUPLICATE_INDEX_NAME,
      partialFilterExpression: {
        status: "PENDING",
      },
    },
  );
}

async function backfillNormalizedSearchFields(
  collection: Collection<WorkShiftLegacyDocument>,
): Promise<void> {
  const cursor = collection.find(
    {
      $or: [
        {
          normalizedShiftCode: {
            $exists: false,
          },
        },
        {
          normalizedTitle: {
            $exists: false,
          },
        },
      ],
    },
    {
      projection: {
        _id: 1,
        shiftCode: 1,
        title: 1,
      },
    },
  );
  const operations: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: {
        $set: Record<string, unknown>;
      };
    };
  }> = [];

  for await (const document of cursor) {
    const shiftCode =
      typeof document.shiftCode === "string"
        ? document.shiftCode
        : "";
    const title =
      typeof document.title === "string"
        ? document.title
        : "";

    operations.push({
      updateOne: {
        filter: { _id: document._id },
        update: {
          $set: {
            normalizedShiftCode:
              canonicalizeWorkShiftSearchToken(
                shiftCode,
              ),
            normalizedTitle:
              canonicalizeWorkShiftSearchToken(
                title,
              ),
          },
        },
      },
    });

    if (operations.length >= 500) {
      await collection.bulkWrite(operations, {
        ordered: true,
      });
      operations.length = 0;
    }
  }

  if (operations.length > 0) {
    await collection.bulkWrite(operations, {
      ordered: true,
    });
  }
}

function canonicalizeWorkShiftSearchToken(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
