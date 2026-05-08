import {
  ClientSession,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  ActiveEmploymentProfileWorkShiftConflictRecord,
  ActiveEmploymentProfileWorkShiftLookupInput,
  GeneratedWorkShiftRosterSummary,
  ReassignWorkShiftSubjectInput,
  ReplaceWorkShiftResourcesInput,
  RescheduleWorkShiftInput,
  TransitionWorkShiftStatusInput,
  UpdateWorkShiftCoreInput,
  WorkShiftOverlapResourceCheckInput,
  WorkShiftOverlapSubjectCheckInput,
  WorkShiftRepository,
  WorkShiftSubjectReferenceInput,
} from "@modules/work-schedule/domain/work-schedule.repository";
import {
  WorkShiftRecord,
  WorkShiftSourceType,
  WorkShiftStatus,
  WorkShiftSubjectKind,
} from "@modules/work-schedule/domain/work-schedule.types";

interface WorkShiftDocument {
  readonly _id: string;
  readonly shiftCode: string;
  readonly normalizedShiftCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectKind: WorkShiftSubjectKind;
  readonly subjectEmploymentProfileId: string | null;
  readonly subjectTalentId: string | null;
  readonly subjectTalentGroupId: string | null;
  readonly studioResourceIds: readonly string[];
  readonly status: WorkShiftStatus;
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly sourceType?: WorkShiftSourceType | null;
  readonly sourceRosterId?: string | null;
  readonly sourcePatternId?: string | null;
  readonly sourceExceptionId?: string | null;
  readonly sourceGenerationRunId?: string | null;
  readonly sourceRosterMonth?: string | null;
  readonly sourceDepartmentOrgUnitId?: string | null;
  readonly sourceRosterLocalDate?: string | null;
  readonly sourceRosterSlotKey?: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoWorkShiftRepository
  extends BaseRepository<WorkShiftDocument>
  implements WorkShiftRepository
{
  constructor(db: Db) {
    super(db, "work_shifts");
  }

  async insert(
    workShift: WorkShiftRecord,
    session: ClientSession,
  ): Promise<WorkShiftRecord> {
    await this.collection.insertOne(
      toWorkShiftDocument(workShift),
      this.withSession(session),
    );

    return workShift;
  }

  async findById(
    workShiftId: string,
    session?: ClientSession,
  ): Promise<WorkShiftRecord | null> {
    const doc = await this.collection.findOne(
      { _id: workShiftId },
      this.withSession(session),
    );

    return doc ? toWorkShiftRecord(doc) : null;
  }

  async findByShiftCode(
    shiftCode: string,
    session?: ClientSession,
  ): Promise<WorkShiftRecord | null> {
    const doc = await this.collection.findOne(
      { shiftCode },
      this.withSession(session),
    );

    return doc ? toWorkShiftRecord(doc) : null;
  }

  async updateCore(
    input: UpdateWorkShiftCoreInput,
    session: ClientSession,
  ): Promise<WorkShiftRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.title !== undefined) {
      set.title = input.title;
    }

    if (input.normalizedTitle !== undefined) {
      set.normalizedTitle = input.normalizedTitle;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.workShiftId,
      },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toWorkShiftRecord(updated) : null;
  }

  async reschedule(
    input: RescheduleWorkShiftInput,
    session: ClientSession,
  ): Promise<WorkShiftRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.workShiftId,
      },
      {
        $set: {
          shiftStartAt: input.shiftStartAt,
          shiftEndAt: input.shiftEndAt,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toWorkShiftRecord(updated) : null;
  }

  async reassignSubject(
    input: ReassignWorkShiftSubjectInput,
    session: ClientSession,
  ): Promise<WorkShiftRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.workShiftId,
      },
      {
        $set: {
          subjectKind: input.subjectKind,
          subjectEmploymentProfileId:
            input.subjectEmploymentProfileId,
          subjectTalentId: input.subjectTalentId,
          subjectTalentGroupId:
            input.subjectTalentGroupId,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toWorkShiftRecord(updated) : null;
  }

  async replaceResources(
    input: ReplaceWorkShiftResourcesInput,
    session: ClientSession,
  ): Promise<WorkShiftRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.workShiftId,
      },
      {
        $set: {
          studioResourceIds: [
            ...input.studioResourceIds,
          ],
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toWorkShiftRecord(updated) : null;
  }

  async transitionStatus(
    input: TransitionWorkShiftStatusInput,
    session: ClientSession,
  ): Promise<WorkShiftRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.workShiftId,
        status: {
          $in: [...input.fromStatuses],
        },
      },
      {
        $set: {
          status: input.toStatus,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toWorkShiftRecord(updated) : null;
  }

  async hasActiveOverlappingSubjectShift(
    input: WorkShiftOverlapSubjectCheckInput,
    session?: ClientSession,
  ): Promise<boolean> {
    const subjectFilter =
      toSubjectEqualityFilter(input);
    const query: Record<string, unknown> = {
      status: "ACTIVE",
      shiftStartAt: {
        $lt: input.shiftEndAt,
      },
      shiftEndAt: {
        $gt: input.shiftStartAt,
      },
      ...subjectFilter,
    };

    if (input.excludeWorkShiftId) {
      query["_id"] = {
        $ne: input.excludeWorkShiftId,
      };
    }

    const doc = await this.collection.findOne(query, {
      projection: {
        _id: 1,
      },
      ...this.withSession(session),
    });

    return doc !== null;
  }

  async hasActiveOverlappingResourceShift(
    input: WorkShiftOverlapResourceCheckInput,
    session?: ClientSession,
  ): Promise<boolean> {
    if (input.studioResourceIds.length === 0) {
      return false;
    }

    const query: Record<string, unknown> = {
      status: "ACTIVE",
      studioResourceIds: {
        $in: [...input.studioResourceIds],
      },
      shiftStartAt: {
        $lt: input.shiftEndAt,
      },
      shiftEndAt: {
        $gt: input.shiftStartAt,
      },
    };

    if (input.excludeWorkShiftId) {
      query["_id"] = {
        $ne: input.excludeWorkShiftId,
      };
    }

    const doc = await this.collection.findOne(query, {
      projection: {
        _id: 1,
      },
      ...this.withSession(session),
    });

    return doc !== null;
  }

  async listActiveEmploymentProfileShiftsForWindow(
    input: ActiveEmploymentProfileWorkShiftLookupInput,
    session?: ClientSession,
  ): Promise<
    readonly ActiveEmploymentProfileWorkShiftConflictRecord[]
  > {
    if (input.subjectEmploymentProfileIds.length === 0) {
      return [];
    }

    const docs = await this.collection
      .find(
        {
          status: "ACTIVE",
          subjectKind: "EMPLOYMENT_PROFILE",
          subjectEmploymentProfileId: {
            $in: [...input.subjectEmploymentProfileIds],
          },
          shiftStartAt: {
            $lt: input.windowEndAt,
          },
          shiftEndAt: {
            $gt: input.windowStartAt,
          },
        },
        this.withSession(session),
      )
      .sort({
        subjectEmploymentProfileId: 1,
        shiftStartAt: 1,
        _id: 1,
      })
      .toArray();

    return docs
      .filter(
        (doc) =>
          doc.subjectEmploymentProfileId !== null,
      )
      .map(toActiveEmploymentProfileConflictRecord);
  }

  async summarizeGeneratedByRoster(
    monthlyRosterId: string,
    session?: ClientSession,
  ): Promise<GeneratedWorkShiftRosterSummary> {
    const docs = await this.collection
      .find(
        {
          sourceType: "ROSTER_GENERATED",
          sourceRosterId: monthlyRosterId,
        },
        {
          projection: {
            _id: 1,
            sourceExceptionId: 1,
            sourceRosterSlotKey: 1,
          },
          ...this.withSession(session),
        },
      )
      .sort({ _id: 1 })
      .toArray();

    return {
      workShiftIds: docs.map((doc) => doc._id),
      generatedWorkShiftCount: docs.length,
      changeTimeCount: docs.filter(
        (doc) =>
          doc.sourceExceptionId != null &&
          doc.sourceRosterSlotKey === "STANDARD",
      ).length,
      addSpecialShiftCount: docs.filter(
        (doc) =>
          typeof doc.sourceRosterSlotKey === "string" &&
          doc.sourceRosterSlotKey.startsWith(
            "ADD_SPECIAL_SHIFT:",
          ),
      ).length,
    };
  }
}

function toWorkShiftDocument(
  workShift: WorkShiftRecord,
): WorkShiftDocument {
  return {
    _id: workShift.id,
    shiftCode: workShift.shiftCode,
    normalizedShiftCode:
      workShift.normalizedShiftCode,
    title: workShift.title,
    normalizedTitle: workShift.normalizedTitle,
    subjectKind: workShift.subjectKind,
    subjectEmploymentProfileId:
      workShift.subjectEmploymentProfileId,
    subjectTalentId: workShift.subjectTalentId,
    subjectTalentGroupId:
      workShift.subjectTalentGroupId,
    studioResourceIds: [
      ...workShift.studioResourceIds,
    ],
    status: workShift.status,
    shiftStartAt: workShift.shiftStartAt,
    shiftEndAt: workShift.shiftEndAt,
    description: workShift.description,
    externalRef: workShift.externalRef,
    sourceType: workShift.sourceType,
    sourceRosterId: workShift.sourceRosterId,
    sourcePatternId: workShift.sourcePatternId,
    sourceExceptionId:
      workShift.sourceExceptionId,
    sourceGenerationRunId:
      workShift.sourceGenerationRunId,
    sourceRosterMonth: workShift.sourceRosterMonth,
    sourceDepartmentOrgUnitId:
      workShift.sourceDepartmentOrgUnitId,
    sourceRosterLocalDate:
      workShift.sourceRosterLocalDate,
    sourceRosterSlotKey:
      workShift.sourceRosterSlotKey,
    createdAt: workShift.createdAt,
    updatedAt: workShift.updatedAt,
  };
}

function toWorkShiftRecord(
  document: WorkShiftDocument,
): WorkShiftRecord {
  return {
    id: document._id,
    shiftCode: document.shiftCode,
    normalizedShiftCode:
      document.normalizedShiftCode,
    title: document.title,
    normalizedTitle: document.normalizedTitle,
    subjectKind: document.subjectKind,
    subjectEmploymentProfileId:
      document.subjectEmploymentProfileId,
    subjectTalentId: document.subjectTalentId,
    subjectTalentGroupId:
      document.subjectTalentGroupId,
    studioResourceIds: [
      ...document.studioResourceIds,
    ],
    status: document.status,
    shiftStartAt: document.shiftStartAt,
    shiftEndAt: document.shiftEndAt,
    description: document.description,
    externalRef: document.externalRef,
    sourceType: normalizeSourceType(
      document.sourceType,
    ),
    sourceRosterId:
      document.sourceRosterId ?? null,
    sourcePatternId:
      document.sourcePatternId ?? null,
    sourceExceptionId:
      document.sourceExceptionId ?? null,
    sourceGenerationRunId:
      document.sourceGenerationRunId ?? null,
    sourceRosterMonth:
      document.sourceRosterMonth ?? null,
    sourceDepartmentOrgUnitId:
      document.sourceDepartmentOrgUnitId ?? null,
    sourceRosterLocalDate:
      document.sourceRosterLocalDate ?? null,
    sourceRosterSlotKey:
      document.sourceRosterSlotKey ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function normalizeSourceType(
  value: WorkShiftSourceType | null | undefined,
): WorkShiftSourceType {
  return value === "ROSTER_GENERATED"
    ? "ROSTER_GENERATED"
    : "MANUAL";
}

function toActiveEmploymentProfileConflictRecord(
  document: WorkShiftDocument,
): ActiveEmploymentProfileWorkShiftConflictRecord {
  return {
    workShiftId: document._id,
    shiftCode: document.shiftCode,
    title: document.title,
    subjectEmploymentProfileId:
      document.subjectEmploymentProfileId as string,
    status: "ACTIVE",
    shiftStartAt: document.shiftStartAt,
    shiftEndAt: document.shiftEndAt,
    sourceType: normalizeSourceType(
      document.sourceType,
    ),
    sourceRosterId:
      document.sourceRosterId ?? null,
    sourceRosterMonth:
      document.sourceRosterMonth ?? null,
    sourceRosterLocalDate:
      document.sourceRosterLocalDate ?? null,
    sourceRosterSlotKey:
      document.sourceRosterSlotKey ?? null,
  };
}

function toSubjectEqualityFilter(
  input: WorkShiftSubjectReferenceInput,
): Record<string, unknown> {
  switch (input.subjectKind) {
    case "EMPLOYMENT_PROFILE":
      return {
        subjectKind: input.subjectKind,
        subjectEmploymentProfileId:
          input.subjectEmploymentProfileId,
      };

    case "TALENT":
      return {
        subjectKind: input.subjectKind,
        subjectTalentId: input.subjectTalentId,
      };

    case "TALENT_GROUP":
      return {
        subjectKind: input.subjectKind,
        subjectTalentGroupId:
          input.subjectTalentGroupId,
      };
  }
}
