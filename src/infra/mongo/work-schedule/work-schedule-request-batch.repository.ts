import { ClientSession, Collection, Db } from "mongodb";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  PendingDuplicateWorkScheduleRequestLineInput,
  TransitionWorkScheduleRequestLineInput,
  UpdateWorkScheduleRequestBatchDerivedInput,
  WorkScheduleRequestBatchListInput,
  WorkScheduleRequestBatchListResult,
  WorkScheduleRequestBatchRepository,
} from "@modules/work-schedule/domain/work-schedule.repository";
import {
  WorkScheduleRequestBatchRecord,
  WorkScheduleRequestBatchScopeSummary,
  WorkScheduleRequestBatchStatus,
  WorkScheduleRequestLineCounts,
  WorkScheduleRequestLineRecord,
  WorkScheduleRequestLineStatus,
  WorkScheduleRequestType,
} from "@modules/work-schedule/domain/work-schedule.types";

interface WorkScheduleRequestBatchDocument {
  readonly _id: string;
  readonly batchCode: string;
  readonly submittedByActorId: string;
  readonly submittedByEmploymentProfileId: string;
  readonly periodMonth: string;
  readonly scopeSummary: WorkScheduleRequestBatchScopeSummary;
  readonly status: WorkScheduleRequestBatchStatus;
  readonly note: string | null;
  readonly lineCounts: WorkScheduleRequestLineCounts;
  readonly clientToken: string;
  readonly submittedAt: number;
  readonly cancelledAt: number | null;
  readonly resolvedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface WorkScheduleRequestLineDocument {
  readonly _id: string;
  readonly batchId: string;
  readonly lineNo: number;
  readonly requestType: WorkScheduleRequestType;
  readonly memberEmploymentProfileId: string;
  readonly workShiftId: string | null;
  readonly requestedStartAt: number | null;
  readonly requestedEndAt: number | null;
  readonly timezone: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly reason: string;
  readonly status: WorkScheduleRequestLineStatus;
  readonly approvalNote: string | null;
  readonly rejectionReason: string | null;
  readonly cancellationReason: string | null;
  readonly failureReason: string | null;
  readonly appliedWorkShiftId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly approvedAt: number | null;
  readonly approvedByActorId: string | null;
  readonly rejectedAt: number | null;
  readonly rejectedByActorId: string | null;
  readonly cancelledAt: number | null;
  readonly cancelledByActorId: string | null;
  readonly failedAt: number | null;
  readonly failedByActorId: string | null;
  readonly submittedByEmploymentProfileId: string;
  readonly periodMonth: string;
}

type EncodedCursor = {
  readonly createdAt: number;
  readonly id: string;
};

export class NativeMongoWorkScheduleRequestBatchRepository
  implements WorkScheduleRequestBatchRepository
{
  private readonly batches: Collection<WorkScheduleRequestBatchDocument>;
  private readonly lines: Collection<WorkScheduleRequestLineDocument>;

  constructor(db: Db) {
    this.batches = db.collection("work_schedule_request_batches");
    this.lines = db.collection("work_schedule_request_lines");
  }

  async insertBatchWithLines(
    batch: WorkScheduleRequestBatchRecord,
    lines: readonly WorkScheduleRequestLineRecord[],
    session: ClientSession,
  ): Promise<WorkScheduleRequestBatchRecord> {
    await this.batches.insertOne(
      toBatchDocument(batch),
      withSession(session),
    );

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
  ): Promise<WorkScheduleRequestBatchRecord | null> {
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
  ): Promise<WorkScheduleRequestBatchRecord | null> {
    const doc = await this.batches.findOne(
      { submittedByEmploymentProfileId, clientToken },
      withSession(session),
    );

    return doc ? toBatchRecord(doc) : null;
  }

  async listBatches(
    input: WorkScheduleRequestBatchListInput,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestBatchListResult> {
    const filters: Array<Record<string, unknown>> = [];

    if (input.status) {
      filters.push({ status: input.status });
    }
    if (input.periodMonth) {
      filters.push({ periodMonth: input.periodMonth });
    }
    if (input.submittedByEmploymentProfileId) {
      filters.push({
        submittedByEmploymentProfileId:
          input.submittedByEmploymentProfileId,
      });
    }
    if (input.submittedByActorId) {
      filters.push({ submittedByActorId: input.submittedByActorId });
    }

    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    if (cursor) {
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
  ): Promise<readonly WorkScheduleRequestLineRecord[]> {
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
  ): Promise<WorkScheduleRequestLineRecord | null> {
    const doc = await this.lines.findOne(
      { _id: lineId, batchId },
      withSession(session),
    );

    return doc ? toLineRecord(doc) : null;
  }

  async findPendingDuplicateLine(
    input: PendingDuplicateWorkScheduleRequestLineInput,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestLineRecord | null> {
    const doc = await this.lines.findOne(
      {
        submittedByEmploymentProfileId: input.submittedByEmploymentProfileId,
        periodMonth: input.periodMonth,
        requestType: input.requestType,
        memberEmploymentProfileId: input.memberEmploymentProfileId,
        workShiftId: input.workShiftId,
        requestedStartAt: input.requestedStartAt,
        requestedEndAt: input.requestedEndAt,
        status: "PENDING",
      },
      withSession(session),
    );

    return doc ? toLineRecord(doc) : null;
  }

  async transitionLineStatus(
    input: TransitionWorkScheduleRequestLineInput,
    session: ClientSession,
  ): Promise<WorkScheduleRequestLineRecord | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };

    applyOptional(set, "approvalNote", input.approvalNote);
    applyOptional(set, "rejectionReason", input.rejectionReason);
    applyOptional(set, "cancellationReason", input.cancellationReason);
    applyOptional(set, "failureReason", input.failureReason);
    applyOptional(set, "appliedWorkShiftId", input.appliedWorkShiftId);
    applyOptional(set, "approvedAt", input.approvedAt);
    applyOptional(set, "approvedByActorId", input.approvedByActorId);
    applyOptional(set, "rejectedAt", input.rejectedAt);
    applyOptional(set, "rejectedByActorId", input.rejectedByActorId);
    applyOptional(set, "cancelledAt", input.cancelledAt);
    applyOptional(set, "cancelledByActorId", input.cancelledByActorId);
    applyOptional(set, "failedAt", input.failedAt);
    applyOptional(set, "failedByActorId", input.failedByActorId);

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
    input: UpdateWorkScheduleRequestBatchDerivedInput,
    session: ClientSession,
  ): Promise<WorkScheduleRequestBatchRecord | null> {
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
}

function toBatchDocument(
  batch: WorkScheduleRequestBatchRecord,
): WorkScheduleRequestBatchDocument {
  return {
    _id: batch.id,
    batchCode: batch.batchCode,
    submittedByActorId: batch.submittedByActorId,
    submittedByEmploymentProfileId: batch.submittedByEmploymentProfileId,
    periodMonth: batch.periodMonth,
    scopeSummary: batch.scopeSummary,
    status: batch.status,
    note: batch.note,
    lineCounts: { ...batch.lineCounts },
    clientToken: batch.clientToken,
    submittedAt: batch.submittedAt,
    cancelledAt: batch.cancelledAt,
    resolvedAt: batch.resolvedAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

function toBatchRecord(
  doc: WorkScheduleRequestBatchDocument,
): WorkScheduleRequestBatchRecord {
  return {
    id: doc._id,
    batchCode: doc.batchCode,
    submittedByActorId: doc.submittedByActorId,
    submittedByEmploymentProfileId: doc.submittedByEmploymentProfileId,
    periodMonth: doc.periodMonth,
    scopeSummary: doc.scopeSummary,
    status: doc.status,
    note: doc.note,
    lineCounts: { ...doc.lineCounts },
    clientToken: doc.clientToken,
    submittedAt: doc.submittedAt,
    cancelledAt: doc.cancelledAt,
    resolvedAt: doc.resolvedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toLineDocument(
  line: WorkScheduleRequestLineRecord,
): WorkScheduleRequestLineDocument {
  return {
    _id: line.id,
    batchId: line.batchId,
    lineNo: line.lineNo,
    requestType: line.requestType,
    memberEmploymentProfileId: line.memberEmploymentProfileId,
    workShiftId: line.workShiftId,
    requestedStartAt: line.requestedStartAt,
    requestedEndAt: line.requestedEndAt,
    timezone: line.timezone,
    title: line.title,
    description: line.description,
    externalRef: line.externalRef,
    reason: line.reason,
    status: line.status,
    approvalNote: line.approvalNote,
    rejectionReason: line.rejectionReason,
    cancellationReason: line.cancellationReason,
    failureReason: line.failureReason,
    appliedWorkShiftId: line.appliedWorkShiftId,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
    approvedAt: line.approvedAt,
    approvedByActorId: line.approvedByActorId,
    rejectedAt: line.rejectedAt,
    rejectedByActorId: line.rejectedByActorId,
    cancelledAt: line.cancelledAt,
    cancelledByActorId: line.cancelledByActorId,
    failedAt: line.failedAt,
    failedByActorId: line.failedByActorId,
    submittedByEmploymentProfileId: line.submittedByEmploymentProfileId,
    periodMonth: line.periodMonth,
  };
}

function toLineRecord(
  doc: WorkScheduleRequestLineDocument,
): WorkScheduleRequestLineRecord {
  return {
    id: doc._id,
    batchId: doc.batchId,
    lineNo: doc.lineNo,
    requestType: doc.requestType,
    memberEmploymentProfileId: doc.memberEmploymentProfileId,
    workShiftId: doc.workShiftId,
    requestedStartAt: doc.requestedStartAt,
    requestedEndAt: doc.requestedEndAt,
    timezone: doc.timezone,
    title: doc.title,
    description: doc.description,
    externalRef: doc.externalRef,
    reason: doc.reason,
    status: doc.status,
    approvalNote: doc.approvalNote,
    rejectionReason: doc.rejectionReason,
    cancellationReason: doc.cancellationReason,
    failureReason: doc.failureReason,
    appliedWorkShiftId: doc.appliedWorkShiftId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    approvedAt: doc.approvedAt,
    approvedByActorId: doc.approvedByActorId,
    rejectedAt: doc.rejectedAt,
    rejectedByActorId: doc.rejectedByActorId,
    cancelledAt: doc.cancelledAt,
    cancelledByActorId: doc.cancelledByActorId,
    failedAt: doc.failedAt,
    failedByActorId: doc.failedByActorId,
    submittedByEmploymentProfileId: doc.submittedByEmploymentProfileId,
    periodMonth: doc.periodMonth,
  };
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
  if (filters.length === 1) {
    return filters[0] ?? {};
  }
  return { $and: [...filters] };
}

function encodeCursor(
  doc: WorkScheduleRequestBatchDocument,
): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: doc.createdAt,
      id: doc._id,
    }),
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
    typeof parsed.createdAt !== "number" ||
    !Number.isInteger(parsed.createdAt) ||
    typeof parsed.id !== "string" ||
    !parsed.id.trim()
  ) {
    throw new WorkScheduleValidationError("cursor is invalid");
  }

  return {
    createdAt: parsed.createdAt,
    id: parsed.id,
  };
}
