import { ClientSession, Collection, Db } from "mongodb";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  PendingDuplicateWorkScheduleAvailabilityLineInput,
  TransitionWorkScheduleAvailabilityLineInput,
  UpdateWorkScheduleAvailabilityLineApplyStateInput,
  UpdateWorkScheduleAvailabilityBatchDerivedInput,
  WorkScheduleAvailabilityBatchListInput,
  WorkScheduleAvailabilityBatchListResult,
  WorkScheduleAvailabilityBatchRepository,
} from "@modules/work-schedule/domain/work-schedule-availability.repository";
import {
  WorkScheduleAvailabilityBatchRecord,
  WorkScheduleAvailabilityLineRecord,
} from "@modules/work-schedule/domain/work-schedule-availability.types";

type WorkScheduleAvailabilityBatchDocument = Omit<
  WorkScheduleAvailabilityBatchRecord,
  "id"
> & { readonly _id: string };

type WorkScheduleAvailabilityLineDocument = Omit<
  WorkScheduleAvailabilityLineRecord,
  "id"
> & { readonly _id: string };

interface EncodedCursor {
  readonly createdAt: number;
  readonly id: string;
}

export class NativeMongoWorkScheduleAvailabilityBatchRepository
  implements WorkScheduleAvailabilityBatchRepository
{
  private readonly batches: Collection<WorkScheduleAvailabilityBatchDocument>;
  private readonly lines: Collection<WorkScheduleAvailabilityLineDocument>;

  constructor(db: Db) {
    this.batches = db.collection("work_schedule_availability_batches");
    this.lines = db.collection("work_schedule_availability_lines");
  }

  async insertBatchWithLines(
    batch: WorkScheduleAvailabilityBatchRecord,
    lines: readonly WorkScheduleAvailabilityLineRecord[],
    session: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchRecord> {
    await this.batches.insertOne(toBatchDocument(batch), withSession(session));
    if (lines.length > 0) {
      await this.lines.insertMany(
        lines.map(toLineDocument),
        withSession(session),
      );
    }
    return batch;
  }

  async findBatchById(
    batchId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchRecord | null> {
    const doc = await this.batches.findOne(
      { _id: batchId },
      withSession(session),
    );
    return doc ? toBatchRecord(doc) : null;
  }

  async findBatchByClientToken(
    submittedByEmploymentProfileId: string,
    clientToken: string,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchRecord | null> {
    const doc = await this.batches.findOne(
      { submittedByEmploymentProfileId, clientToken },
      withSession(session),
    );
    return doc ? toBatchRecord(doc) : null;
  }

  async listBatches(
    input: WorkScheduleAvailabilityBatchListInput,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchListResult> {
    const filters: Record<string, unknown>[] = [];
    addFilter(filters, "status", input.status);
    addFilter(filters, "periodMonth", input.periodMonth);
    addFilter(filters, "targetType", input.targetType);
    addFilter(filters, "targetOrgUnitId", input.targetOrgUnitId);
    addFilter(filters, "targetTalentGroupId", input.targetTalentGroupId);
    addFilter(
      filters,
      "submittedByEmploymentProfileId",
      input.submittedByEmploymentProfileId,
    );

    if (input.cursor) {
      const cursor = decodeCursor(input.cursor);
      filters.push({
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $gt: cursor.id } },
        ],
      });
    }

    const docs = await this.batches
      .find(buildQuery(filters), withSession(session))
      .sort({ createdAt: -1, _id: 1 })
      .limit(input.limit + 1)
      .toArray();
    const hasNext = docs.length > input.limit;
    const page = hasNext ? docs.slice(0, input.limit) : docs;

    return {
      items: page.map(toBatchRecord),
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(page[page.length - 1])
          : undefined,
    };
  }

  async listLinesByBatchId(
    batchId: string,
    session?: ClientSession,
  ): Promise<readonly WorkScheduleAvailabilityLineRecord[]> {
    const docs = await this.lines
      .find({ batchId }, withSession(session))
      .sort({ lineNo: 1, _id: 1 })
      .toArray();
    return docs.map(toLineRecord);
  }

  async findLineById(
    batchId: string,
    lineId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityLineRecord | null> {
    const doc = await this.lines.findOne(
      { _id: lineId, batchId },
      withSession(session),
    );
    return doc ? toLineRecord(doc) : null;
  }

  async listLinesByIds(
    lineIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly WorkScheduleAvailabilityLineRecord[]> {
    if (lineIds.length === 0) {
      return [];
    }

    const docs = await this.lines
      .find(
        { _id: { $in: [...lineIds] } },
        withSession(session),
      )
      .toArray();
    return docs.map(toLineRecord);
  }

  async findPendingDuplicateLine(
    input: PendingDuplicateWorkScheduleAvailabilityLineInput,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityLineRecord | null> {
    const doc = await this.lines.findOne(
      {
        pendingDuplicateKey: input.pendingDuplicateKey,
        status: "PENDING",
      },
      withSession(session),
    );
    return doc ? toLineRecord(doc) : null;
  }

  async transitionLineStatus(
    input: TransitionWorkScheduleAvailabilityLineInput,
    session: ClientSession,
  ): Promise<WorkScheduleAvailabilityLineRecord | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };
    applyOptional(set, "adminDecisionNote", input.adminDecisionNote);
    applyOptional(set, "rejectionReason", input.rejectionReason);
    applyOptional(set, "cancellationReason", input.cancellationReason);
    applyOptional(set, "approvedAt", input.approvedAt);
    applyOptional(set, "approvedByActorId", input.approvedByActorId);
    applyOptional(set, "rejectedAt", input.rejectedAt);
    applyOptional(set, "rejectedByActorId", input.rejectedByActorId);
    applyOptional(set, "cancelledAt", input.cancelledAt);
    applyOptional(set, "cancelledByActorId", input.cancelledByActorId);

    const updated = await this.lines.findOneAndUpdate(
      {
        _id: input.lineId,
        batchId: input.batchId,
        status: input.fromStatus,
      },
      { $set: set },
      {
        ...withSession(session),
        returnDocument: "after",
      },
    );
    return updated ? toLineRecord(updated) : null;
  }

  async updateBatchDerived(
    input: UpdateWorkScheduleAvailabilityBatchDerivedInput,
    session: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchRecord | null> {
    const set: Record<string, unknown> = {
      status: input.status,
      lineCounts: input.lineCounts,
      updatedAt: input.updatedAt,
    };
    applyOptional(set, "cancelledAt", input.cancelledAt);
    applyOptional(set, "resolvedAt", input.resolvedAt);

    const updated = await this.batches.findOneAndUpdate(
      { _id: input.batchId },
      { $set: set },
      {
        ...withSession(session),
        returnDocument: "after",
      },
    );
    return updated ? toBatchRecord(updated) : null;
  }

  async updateLineApplyState(
    input: UpdateWorkScheduleAvailabilityLineApplyStateInput,
    session: ClientSession,
  ): Promise<WorkScheduleAvailabilityLineRecord | null> {
    const set: Record<string, unknown> = {
      applyStatus: input.applyStatus,
      updatedAt: input.updatedAt,
    };
    applyOptional(set, "appliedRosterId", input.appliedRosterId);
    applyOptional(
      set,
      "appliedRosterExceptionId",
      input.appliedRosterExceptionId,
    );
    applyOptional(
      set,
      "appliedRosterExceptionIds",
      input.appliedRosterExceptionIds,
    );
    applyOptional(set, "appliedAt", input.appliedAt);
    applyOptional(set, "appliedByActorId", input.appliedByActorId);

    const updated = await this.lines.findOneAndUpdate(
      {
        _id: input.lineId,
        batchId: input.batchId,
        applyStatus: { $in: [...input.fromApplyStatuses] },
      },
      { $set: set },
      {
        ...withSession(session),
        returnDocument: "after",
      },
    );
    return updated ? toLineRecord(updated) : null;
  }
}

function toBatchDocument(
  record: WorkScheduleAvailabilityBatchRecord,
): WorkScheduleAvailabilityBatchDocument {
  const { id, ...document } = record;
  return { _id: id, ...document };
}

function toBatchRecord(
  document: WorkScheduleAvailabilityBatchDocument,
): WorkScheduleAvailabilityBatchRecord {
  const { _id, ...record } = document;
  return { id: _id, ...record };
}

function toLineDocument(
  record: WorkScheduleAvailabilityLineRecord,
): WorkScheduleAvailabilityLineDocument {
  const { id, ...document } = record;
  return { _id: id, ...document };
}

function toLineRecord(
  document: WorkScheduleAvailabilityLineDocument,
): WorkScheduleAvailabilityLineRecord {
  const { _id, ...record } = document;
  return { id: _id, ...record };
}

function addFilter(
  filters: Record<string, unknown>[],
  key: string,
  value: unknown,
): void {
  if (value !== undefined) {
    filters.push({ [key]: value });
  }
}

function applyOptional(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function withSession(
  session?: ClientSession,
): { session?: ClientSession } {
  return session ? { session } : {};
}

function buildQuery(
  filters: readonly Record<string, unknown>[],
): Record<string, unknown> {
  if (filters.length === 0) {
    return {};
  }
  return filters.length === 1 ? (filters[0] ?? {}) : { $and: [...filters] };
}

function encodeCursor(
  document: WorkScheduleAvailabilityBatchDocument,
): string {
  return Buffer.from(
    JSON.stringify({ createdAt: document.createdAt, id: document._id }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(cursor: string): EncodedCursor {
  let parsed: Partial<EncodedCursor>;
  try {
    parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<EncodedCursor>;
  } catch {
    throw new WorkScheduleValidationError("cursor is invalid");
  }
  if (
    !Number.isInteger(parsed.createdAt) ||
    typeof parsed.id !== "string" ||
    !parsed.id.trim()
  ) {
    throw new WorkScheduleValidationError("cursor is invalid");
  }
  return { createdAt: parsed.createdAt as number, id: parsed.id };
}
