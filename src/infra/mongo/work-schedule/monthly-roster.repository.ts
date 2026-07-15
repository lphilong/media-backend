import { ClientSession, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  AddRosterExceptionInput,
  InsertMonthlyRosterInput,
  MonthlyRosterRepository,
  PublishMonthlyRosterInput,
  RemoveRosterExceptionInput,
  TransitionMonthlyRosterStatusInput,
  UpdateMonthlyRosterDraftInput,
  UpdateRosterExceptionInput,
} from "@modules/work-schedule/domain/work-schedule.repository";
import {
  MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE,
  MONTHLY_ROSTER_TARGET_SUBJECT_KIND,
  MONTHLY_ROSTER_TIMEZONE,
  MonthlyRosterRecord,
  MonthlyRosterStatus,
  MonthlyRosterTargetMode,
  MonthlyRosterTargetType,
  RosterExceptionRecord,
} from "@modules/work-schedule/domain/work-schedule.types";

interface MonthlyRosterDocument {
  readonly _id: string;
  readonly rosterCode: string;
  readonly normalizedRosterCode: string;
  readonly rosterMonth: string;
  readonly timezone: typeof MONTHLY_ROSTER_TIMEZONE;
  readonly targetSubjectKind: typeof MONTHLY_ROSTER_TARGET_SUBJECT_KIND;
  readonly targetOrgUnitMode: typeof MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE;
  readonly targetType?: MonthlyRosterTargetType;
  readonly targetMode?: MonthlyRosterTargetMode;
  readonly targetOrgUnitId?: string | null;
  readonly targetTalentGroupId?: string | null;
  readonly departmentOrgUnitId?: string | null;
  readonly workPatternId: string;
  readonly holidayCalendarId: string;
  readonly status: MonthlyRosterStatus;
  readonly draftVersion: number;
  readonly previewHash: string | null;
  readonly lastPreviewedAt: number | null;
  readonly publishedAt: number | null;
  readonly publishedByUserId: string | null;
  readonly publishGenerationRunId: string | null;
  readonly publicationVersion?: number;
  readonly sourceSnapshot?: MonthlyRosterRecord["sourceSnapshot"];
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly exceptions: readonly RosterExceptionRecord[];
  readonly archivedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoMonthlyRosterRepository
  extends BaseRepository<MonthlyRosterDocument>
  implements MonthlyRosterRepository
{
  constructor(db: Db) {
    super(db, "work_monthly_rosters");
  }

  async insert(
    monthlyRoster: InsertMonthlyRosterInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord> {
    await this.collection.insertOne(
      toMonthlyRosterDocument(monthlyRoster),
      this.withSession(session),
    );

    return monthlyRoster;
  }

  async findById(
    monthlyRosterId: string,
    session?: ClientSession,
  ): Promise<MonthlyRosterRecord | null> {
    const doc = await this.collection.findOne(
      { _id: monthlyRosterId },
      this.withSession(session),
    );

    return doc ? toMonthlyRosterRecord(doc) : null;
  }

  async findByRosterCode(
    rosterCode: string,
    session?: ClientSession,
  ): Promise<MonthlyRosterRecord | null> {
    const doc = await this.collection.findOne(
      { rosterCode },
      this.withSession(session),
    );

    return doc ? toMonthlyRosterRecord(doc) : null;
  }

  async findActiveByTargetAndMonth(
    target: {
      readonly targetType: MonthlyRosterTargetType;
      readonly targetOrgUnitId: string | null;
      readonly targetTalentGroupId: string | null;
    },
    rosterMonth: string,
    session?: ClientSession,
  ): Promise<MonthlyRosterRecord | null> {
    const targetFilter: Record<string, unknown> =
      target.targetType === "ORG_UNIT"
        ? {
            $or: [
              {
                targetType: "ORG_UNIT",
                targetOrgUnitId: target.targetOrgUnitId,
              },
              {
                targetType: { $exists: false },
                departmentOrgUnitId: target.targetOrgUnitId,
              },
            ],
          }
        : {
            targetType: "TALENT_GROUP",
            targetTalentGroupId: target.targetTalentGroupId,
          };
    const doc = await this.collection.findOne(
      {
        ...targetFilter,
        rosterMonth,
        status: {
          $ne: "ARCHIVED",
        },
      },
      this.withSession(session),
    );

    return doc ? toMonthlyRosterRecord(doc) : null;
  }

  async updateDraft(
    input: UpdateMonthlyRosterDraftInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.rosterMonth !== undefined) {
      set.rosterMonth = input.rosterMonth;
    }

    if (input.departmentOrgUnitId !== undefined) {
      set.departmentOrgUnitId = input.departmentOrgUnitId;
    }

    if (input.targetType !== undefined) {
      set.targetType = input.targetType;
    }

    if (input.targetMode !== undefined) {
      set.targetMode = input.targetMode;
    }

    if (input.targetOrgUnitId !== undefined) {
      set.targetOrgUnitId = input.targetOrgUnitId;
    }

    if (input.targetTalentGroupId !== undefined) {
      set.targetTalentGroupId = input.targetTalentGroupId;
    }

    if (input.workPatternId !== undefined) {
      set.workPatternId = input.workPatternId;
    }

    if (input.holidayCalendarId !== undefined) {
      set.holidayCalendarId = input.holidayCalendarId;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.monthlyRosterId,
        status: "DRAFT",
      },
      {
        $set: set,
        $inc: { draftVersion: 1 },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toMonthlyRosterRecord(updated) : null;
  }

  async transitionStatus(
    input: TransitionMonthlyRosterStatusInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };

    if (input.archivedAt !== undefined) {
      set.archivedAt = input.archivedAt;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.monthlyRosterId,
        status: { $in: [...input.fromStatuses] },
      },
      {
        $set: set,
        $inc: { draftVersion: 1 },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toMonthlyRosterRecord(updated) : null;
  }

  async publish(
    input: PublishMonthlyRosterInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.monthlyRosterId,
        status: input.fromStatus,
      },
      {
        $set: {
          status: "PUBLISHED",
          previewHash: input.previewHash,
          lastPreviewedAt: input.lastPreviewedAt,
          publishedAt: input.publishedAt,
          publishedByUserId: input.publishedByUserId,
          publishGenerationRunId: input.publishGenerationRunId,
          publicationVersion: input.publicationVersion,
          sourceSnapshot: input.sourceSnapshot,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toMonthlyRosterRecord(updated) : null;
  }

  async addException(
    input: AddRosterExceptionInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null> {
    const filter: Record<string, unknown> = {
      _id: input.monthlyRosterId,
      status: "DRAFT",
    };
    const guardClauses: Record<string, unknown>[] = [];

    if (input.expectedNoActiveSourceAvailabilityLineId) {
      guardClauses.push({
        exceptions: {
          $not: {
            $elemMatch: {
              status: "ACTIVE",
              sourceAvailabilityLineId:
                input.expectedNoActiveSourceAvailabilityLineId,
            },
          },
        },
      });
    }

    if (input.expectedNoActiveStandardException) {
      guardClauses.push({
        exceptions: {
          $not: {
            $elemMatch: {
              status: "ACTIVE",
              subjectEmploymentProfileId:
                input.expectedNoActiveStandardException
                  .subjectEmploymentProfileId,
              exceptionDate:
                input.expectedNoActiveStandardException.exceptionDate,
              exceptionType: { $ne: "ADD_SPECIAL_SHIFT" },
            },
          },
        },
      });
    }

    if (guardClauses.length === 1) {
      Object.assign(filter, guardClauses[0]);
    } else if (guardClauses.length > 1) {
      filter.$and = guardClauses;
    }

    const updated = await this.collection.findOneAndUpdate(
      filter,
      {
        $push: { exceptions: input.exception },
        $set: { updatedAt: input.updatedAt },
        $inc: { draftVersion: 1 },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toMonthlyRosterRecord(updated) : null;
  }

  async updateException(
    input: UpdateRosterExceptionInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null> {
    const set: Record<string, unknown> = {
      "exceptions.$.updatedAt": input.updatedAt,
      updatedAt: input.updatedAt,
    };

    for (const [field, value] of Object.entries(input)) {
      if (
        field === "monthlyRosterId" ||
        field === "rosterExceptionId" ||
        field === "updatedAt" ||
        value === undefined
      ) {
        continue;
      }

      set[`exceptions.$.${field}`] = value;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.monthlyRosterId,
        status: "DRAFT",
        "exceptions.rosterExceptionId": input.rosterExceptionId,
        "exceptions.status": "ACTIVE",
      },
      {
        $set: set,
        $inc: { draftVersion: 1 },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toMonthlyRosterRecord(updated) : null;
  }

  async removeException(
    input: RemoveRosterExceptionInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.monthlyRosterId,
        status: "DRAFT",
        "exceptions.rosterExceptionId": input.rosterExceptionId,
        "exceptions.status": "ACTIVE",
      },
      {
        $set: {
          "exceptions.$.status": "REMOVED",
          "exceptions.$.removedAt": input.removedAt,
          "exceptions.$.updatedAt": input.updatedAt,
          updatedAt: input.updatedAt,
        },
        $inc: { draftVersion: 1 },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toMonthlyRosterRecord(updated) : null;
  }
}

function toMonthlyRosterDocument(
  record: MonthlyRosterRecord,
): MonthlyRosterDocument {
  return {
    _id: record.monthlyRosterId,
    rosterCode: record.rosterCode,
    normalizedRosterCode: record.normalizedRosterCode,
    rosterMonth: record.rosterMonth,
    timezone: record.timezone,
    targetSubjectKind: record.targetSubjectKind,
    targetOrgUnitMode: record.targetOrgUnitMode,
    targetType: record.targetType,
    targetMode: record.targetMode,
    targetOrgUnitId: record.targetOrgUnitId,
    targetTalentGroupId: record.targetTalentGroupId,
    departmentOrgUnitId: record.departmentOrgUnitId,
    workPatternId: record.workPatternId,
    holidayCalendarId: record.holidayCalendarId,
    status: record.status,
    draftVersion: record.draftVersion,
    previewHash: record.previewHash,
    lastPreviewedAt: record.lastPreviewedAt,
    publishedAt: record.publishedAt,
    publishedByUserId: record.publishedByUserId,
    publishGenerationRunId: record.publishGenerationRunId,
    publicationVersion: record.publicationVersion,
    sourceSnapshot: record.sourceSnapshot,
    description: record.description,
    externalRef: record.externalRef,
    exceptions: record.exceptions.map((exception) => ({
      ...exception,
      studioResourceIds: [...exception.studioResourceIds],
    })),
    archivedAt: record.archivedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toMonthlyRosterRecord(
  document: MonthlyRosterDocument,
): MonthlyRosterRecord {
  return {
    monthlyRosterId: document._id,
    rosterCode: document.rosterCode,
    normalizedRosterCode: document.normalizedRosterCode,
    rosterMonth: document.rosterMonth,
    timezone: document.timezone,
    targetSubjectKind: document.targetSubjectKind,
    targetOrgUnitMode: document.targetOrgUnitMode,
    targetType: document.targetType ?? "ORG_UNIT",
    targetMode: document.targetMode ?? document.targetOrgUnitMode,
    targetOrgUnitId:
      document.targetOrgUnitId ?? document.departmentOrgUnitId ?? null,
    targetTalentGroupId: document.targetTalentGroupId ?? null,
    departmentOrgUnitId:
      document.departmentOrgUnitId ?? document.targetOrgUnitId ?? null,
    workPatternId: document.workPatternId,
    holidayCalendarId: document.holidayCalendarId,
    status: document.status,
    draftVersion: document.draftVersion,
    previewHash: document.previewHash,
    lastPreviewedAt: document.lastPreviewedAt,
    publishedAt: document.publishedAt,
    publishedByUserId: document.publishedByUserId,
    publishGenerationRunId: document.publishGenerationRunId,
    publicationVersion: document.publicationVersion,
    sourceSnapshot: document.sourceSnapshot,
    description: document.description,
    externalRef: document.externalRef,
    exceptions: document.exceptions.map((exception) => ({
      ...exception,
      studioResourceIds: [...exception.studioResourceIds],
    })),
    archivedAt: document.archivedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
