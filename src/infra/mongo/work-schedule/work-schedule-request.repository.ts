import {
  ClientSession,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  TransitionWorkScheduleRequestInput,
  WorkScheduleRequestListInput,
  WorkScheduleRequestListResult,
  WorkScheduleRequestRepository,
} from "@modules/work-schedule/domain/work-schedule.repository";
import {
  WorkScheduleRequestRecord,
  WorkScheduleRequestStatus,
  WorkScheduleRequestType,
} from "@modules/work-schedule/domain/work-schedule.types";

interface WorkScheduleRequestDocument {
  readonly _id: string;
  readonly requestCode: string;
  readonly requestType: WorkScheduleRequestType;
  readonly status: WorkScheduleRequestStatus;
  readonly targetKind: WorkScheduleRequestRecord["targetKind"];
  readonly requestSource: WorkScheduleRequestRecord["requestSource"];
  readonly targetEmploymentProfileId: string;
  readonly targetWorkShiftId: string | null;
  readonly requestedByUserId: string;
  readonly requestedByEmploymentProfileId: string | null;
  readonly reason: string;
  readonly proposedStartAt: number | null;
  readonly proposedEndAt: number | null;
  readonly proposedTitle: string | null;
  readonly proposedStudioResourceIds: readonly string[];
  readonly proposedDescription: string | null;
  readonly proposedExternalRef: string | null;
  readonly approvedByUserId: string | null;
  readonly approvedAt: number | null;
  readonly approvalNote: string | null;
  readonly rejectedByUserId: string | null;
  readonly rejectedAt: number | null;
  readonly rejectionReason: string | null;
  readonly cancelledByUserId: string | null;
  readonly cancelledAt: number | null;
  readonly cancellationReason: string | null;
  readonly appliedWorkShiftId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

type EncodedCursor = {
  readonly createdAt: number;
  readonly id: string;
};

export class NativeMongoWorkScheduleRequestRepository
  extends BaseRepository<WorkScheduleRequestDocument>
  implements WorkScheduleRequestRepository
{
  constructor(db: Db) {
    super(db, "work_schedule_requests");
  }

  async insert(
    request: WorkScheduleRequestRecord,
    session: ClientSession,
  ): Promise<WorkScheduleRequestRecord> {
    await this.collection.insertOne(
      toDocument(request),
      this.withSession(session),
    );

    return request;
  }

  async findById(
    requestId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestRecord | null> {
    const doc = await this.collection.findOne(
      { _id: requestId },
      this.withSession(session),
    );

    return doc ? toRecord(doc) : null;
  }

  async list(
    input: WorkScheduleRequestListInput,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestListResult> {
    const filters: Array<Record<string, unknown>> = [];

    if (input.status) {
      filters.push({ status: input.status });
    }

    if (input.requestType) {
      filters.push({ requestType: input.requestType });
    }

    if (input.targetEmploymentProfileId) {
      filters.push({
        targetEmploymentProfileId:
          input.targetEmploymentProfileId,
      });
    }

    if (input.targetWorkShiftId) {
      filters.push({
        targetWorkShiftId: input.targetWorkShiftId,
      });
    }

    if (input.requestedByUserId) {
      filters.push({
        requestedByUserId: input.requestedByUserId,
      });
    }

    if (
      input.visibleTargetEmploymentProfileIds ||
      input.visibleRequestedByUserId
    ) {
      const visibility: Array<Record<string, unknown>> = [];

      if (input.visibleTargetEmploymentProfileIds) {
        visibility.push({
          targetEmploymentProfileId: {
            $in: [...input.visibleTargetEmploymentProfileIds],
          },
        });
      }

      if (input.visibleRequestedByUserId) {
        visibility.push({
          requestedByUserId:
            input.visibleRequestedByUserId,
        });
      }

      filters.push({ $or: visibility });
    }

    const cursor = input.cursor
      ? decodeCursor(input.cursor)
      : null;

    if (cursor) {
      filters.push({
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          {
            createdAt: cursor.createdAt,
            _id: { $gt: cursor.id },
          },
        ],
      });
    }

    const docs = await this.collection
      .find(buildQuery(filters), this.withSession(session))
      .sort({ createdAt: -1, _id: 1 })
      .limit(input.limit + 1)
      .toArray();

    const hasNext = docs.length > input.limit;
    const page = hasNext ? docs.slice(0, input.limit) : docs;

    return {
      items: page.map(toRecord),
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(page[page.length - 1])
          : undefined,
    };
  }

  async transitionStatus(
    input: TransitionWorkScheduleRequestInput,
    session: ClientSession,
  ): Promise<WorkScheduleRequestRecord | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };

    if (input.approvedByUserId !== undefined) {
      set.approvedByUserId = input.approvedByUserId;
    }
    if (input.approvedAt !== undefined) {
      set.approvedAt = input.approvedAt;
    }
    if (input.approvalNote !== undefined) {
      set.approvalNote = input.approvalNote;
    }
    if (input.rejectedByUserId !== undefined) {
      set.rejectedByUserId = input.rejectedByUserId;
    }
    if (input.rejectedAt !== undefined) {
      set.rejectedAt = input.rejectedAt;
    }
    if (input.rejectionReason !== undefined) {
      set.rejectionReason = input.rejectionReason;
    }
    if (input.cancelledByUserId !== undefined) {
      set.cancelledByUserId = input.cancelledByUserId;
    }
    if (input.cancelledAt !== undefined) {
      set.cancelledAt = input.cancelledAt;
    }
    if (input.cancellationReason !== undefined) {
      set.cancellationReason = input.cancellationReason;
    }
    if (input.appliedWorkShiftId !== undefined) {
      set.appliedWorkShiftId = input.appliedWorkShiftId;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.requestId,
        status: input.fromStatus,
      },
      { $set: set },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toRecord(updated) : null;
  }
}

function toDocument(
  request: WorkScheduleRequestRecord,
): WorkScheduleRequestDocument {
  return {
    _id: request.id,
    requestCode: request.requestCode,
    requestType: request.requestType,
    status: request.status,
    targetKind: request.targetKind,
    requestSource: request.requestSource,
    targetEmploymentProfileId:
      request.targetEmploymentProfileId,
    targetWorkShiftId: request.targetWorkShiftId,
    requestedByUserId: request.requestedByUserId,
    requestedByEmploymentProfileId:
      request.requestedByEmploymentProfileId,
    reason: request.reason,
    proposedStartAt: request.proposedStartAt,
    proposedEndAt: request.proposedEndAt,
    proposedTitle: request.proposedTitle,
    proposedStudioResourceIds: [
      ...request.proposedStudioResourceIds,
    ],
    proposedDescription: request.proposedDescription,
    proposedExternalRef: request.proposedExternalRef,
    approvedByUserId: request.approvedByUserId,
    approvedAt: request.approvedAt,
    approvalNote: request.approvalNote,
    rejectedByUserId: request.rejectedByUserId,
    rejectedAt: request.rejectedAt,
    rejectionReason: request.rejectionReason,
    cancelledByUserId: request.cancelledByUserId,
    cancelledAt: request.cancelledAt,
    cancellationReason: request.cancellationReason,
    appliedWorkShiftId: request.appliedWorkShiftId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function toRecord(
  doc: WorkScheduleRequestDocument,
): WorkScheduleRequestRecord {
  return {
    id: doc._id,
    requestCode: doc.requestCode,
    requestType: doc.requestType,
    status: doc.status,
    targetKind: doc.targetKind,
    requestSource: doc.requestSource,
    targetEmploymentProfileId:
      doc.targetEmploymentProfileId,
    targetWorkShiftId: doc.targetWorkShiftId,
    requestedByUserId: doc.requestedByUserId,
    requestedByEmploymentProfileId:
      doc.requestedByEmploymentProfileId,
    reason: doc.reason,
    proposedStartAt: doc.proposedStartAt,
    proposedEndAt: doc.proposedEndAt,
    proposedTitle: doc.proposedTitle,
    proposedStudioResourceIds: [
      ...doc.proposedStudioResourceIds,
    ],
    proposedDescription: doc.proposedDescription,
    proposedExternalRef: doc.proposedExternalRef,
    approvedByUserId: doc.approvedByUserId,
    approvedAt: doc.approvedAt,
    approvalNote: doc.approvalNote,
    rejectedByUserId: doc.rejectedByUserId,
    rejectedAt: doc.rejectedAt,
    rejectionReason: doc.rejectionReason,
    cancelledByUserId: doc.cancelledByUserId,
    cancelledAt: doc.cancelledAt,
    cancellationReason: doc.cancellationReason,
    appliedWorkShiftId: doc.appliedWorkShiftId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
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
  doc: WorkScheduleRequestDocument,
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
    throw new WorkScheduleValidationError(
      "cursor is invalid",
    );
  }

  if (
    typeof parsed.createdAt !== "number" ||
    !Number.isInteger(parsed.createdAt) ||
    typeof parsed.id !== "string" ||
    !parsed.id.trim()
  ) {
    throw new WorkScheduleValidationError(
      "cursor is invalid",
    );
  }

  return {
    createdAt: parsed.createdAt,
    id: parsed.id,
  };
}
