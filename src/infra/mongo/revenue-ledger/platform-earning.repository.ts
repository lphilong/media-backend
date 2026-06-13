import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import {
  ApprovePlatformEarningBatchInput,
  CreatePlatformEarningBatchInput,
  PlatformEarningBatch,
  PlatformEarningBatchListFilters,
  PlatformEarningBatchListPage,
  PlatformEarningLine,
  PlatformEarningLineListFilters,
  PlatformEarningLineListPage,
  PlatformEarningRepository,
  UpdatePlatformEarningBatchDraftInput,
  UpdatePlatformEarningLineInput,
} from "@modules/revenue-ledger/domain/platform-earning.repository";
import { PlatformEarningBatchStatus } from "@modules/revenue-ledger/domain/revenue-ledger.types";

type PlatformEarningBatchDocument =
  PlatformEarningBatch & { readonly _id: string };
type PlatformEarningLineDocument =
  PlatformEarningLine & { readonly _id: string };

export class NativeMongoPlatformEarningRepository
  implements PlatformEarningRepository
{
  private readonly batches: Collection<PlatformEarningBatchDocument>;
  private readonly lines: Collection<PlatformEarningLineDocument>;

  constructor(db: Db) {
    this.batches = db.collection<PlatformEarningBatchDocument>(
      "platform_earning_batches",
    );
    this.lines = db.collection<PlatformEarningLineDocument>(
      "platform_earning_lines",
    );
  }

  async insertBatch(
    input: CreatePlatformEarningBatchInput,
    session: ClientSession,
  ): Promise<PlatformEarningBatch> {
    const batch: PlatformEarningBatch = {
      id: input.id,
      batchCode: input.batchCode,
      platform: input.platform,
      platformAccountId: input.platformAccountId,
      talentGroupId: input.talentGroupId,
      sourceType: input.sourceType,
      sourceUnit: input.sourceUnit,
      periodMonth: input.periodMonth,
      sourceDateFrom: input.sourceDateFrom,
      sourceDateTo: input.sourceDateTo,
      status: "DRAFT",
      sourceLineCount: 0,
      rawQuantityTotal: 0,
      conversionSnapshot: null,
      platformCutSnapshot: null,
      companyNetAmount: null,
      commissionableBasisAmount: null,
      submittedByActorId: null,
      submittedAt: null,
      reviewedByActorId: null,
      reviewedAt: null,
      approvedByActorId: null,
      approvedAt: null,
      rejectedByActorId: null,
      rejectedAt: null,
      rejectionReason: null,
      voidedByActorId: null,
      voidedAt: null,
      voidReason: null,
      archivedByActorId: null,
      archivedAt: null,
      sourceFingerprint: null,
      revenueEntryId: null,
      revenueEntryCreatedByActorId: null,
      revenueEntryCreatedAt: null,
      createdByActorId: input.createdByActorId,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };

    await this.batches.insertOne(
      toBatchDocument(batch),
      withSession(session),
    );

    return batch;
  }

  async findBatchById(
    batchId: string,
    session?: ClientSession,
  ): Promise<PlatformEarningBatch | null> {
    const document = await this.batches.findOne(
      { _id: batchId },
      withSession(session),
    );

    return document ? fromBatchDocument(document) : null;
  }

  async listBatches(
    filters: PlatformEarningBatchListFilters,
    session?: ClientSession,
  ): Promise<PlatformEarningBatchListPage> {
    const query: Record<string, unknown> = {};
    if (filters.status) query.status = filters.status;
    if (filters.platform) query.platform = filters.platform;
    if (filters.platformAccountId) {
      query.platformAccountId = filters.platformAccountId;
    }
    if (filters.talentGroupId) query.talentGroupId = filters.talentGroupId;
    if (filters.sourceType) query.sourceType = filters.sourceType;
    if (filters.periodMonth) query.periodMonth = filters.periodMonth;
    if (filters.createdBeforeAt !== undefined) {
      query.createdAt = { $lt: filters.createdBeforeAt };
    }
    if (filters.cursor) {
      query._id = { $gt: filters.cursor };
    }

    const documents = await this.batches
      .find(query, withSession(session))
      .sort({ _id: 1 })
      .limit(filters.limit + 1)
      .toArray();

    const page = documents.slice(0, filters.limit);
    return {
      items: page.map(fromBatchDocument),
      nextCursor:
        documents.length > filters.limit
          ? page[page.length - 1]?._id
          : undefined,
    };
  }

  async updateDraftBatch(
    input: UpdatePlatformEarningBatchDraftInput,
    session: ClientSession,
  ): Promise<PlatformEarningBatch | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };
    if (input.platformAccountId !== undefined) {
      set.platformAccountId = input.platformAccountId;
    }
    if (input.talentGroupId !== undefined) {
      set.talentGroupId = input.talentGroupId;
    }
    if (input.sourceDateFrom !== undefined) {
      set.sourceDateFrom = input.sourceDateFrom;
    }
    if (input.sourceDateTo !== undefined) {
      set.sourceDateTo = input.sourceDateTo;
    }

    const updated = await this.batches.findOneAndUpdate(
      { _id: input.batchId, status: "DRAFT" },
      { $set: set },
      { ...withSession(session), returnDocument: "after" },
    );

    return updated ? fromBatchDocument(updated) : null;
  }

  async transitionBatchStatus(
    input: {
      readonly batchId: string;
      readonly fromStatuses: readonly PlatformEarningBatchStatus[];
      readonly toStatus: PlatformEarningBatchStatus;
      readonly submittedByActorId?: string | null;
      readonly submittedAt?: number | null;
      readonly reviewedByActorId?: string | null;
      readonly reviewedAt?: number | null;
      readonly rejectedByActorId?: string | null;
      readonly rejectedAt?: number | null;
      readonly rejectionReason?: string | null;
      readonly voidedByActorId?: string | null;
      readonly voidedAt?: number | null;
      readonly voidReason?: string | null;
      readonly archivedByActorId?: string | null;
      readonly archivedAt?: number | null;
      readonly updatedAt: number;
    },
    session: ClientSession,
  ): Promise<PlatformEarningBatch | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };
    copyOptional(set, input, "submittedByActorId");
    copyOptional(set, input, "submittedAt");
    copyOptional(set, input, "reviewedByActorId");
    copyOptional(set, input, "reviewedAt");
    copyOptional(set, input, "rejectedByActorId");
    copyOptional(set, input, "rejectedAt");
    copyOptional(set, input, "rejectionReason");
    copyOptional(set, input, "voidedByActorId");
    copyOptional(set, input, "voidedAt");
    copyOptional(set, input, "voidReason");
    copyOptional(set, input, "archivedByActorId");
    copyOptional(set, input, "archivedAt");

    const updated = await this.batches.findOneAndUpdate(
      {
        _id: input.batchId,
        status: { $in: [...input.fromStatuses] },
      },
      { $set: set },
      { ...withSession(session), returnDocument: "after" },
    );

    if (!updated) {
      return null;
    }

    await this.lines.updateMany(
      { batchId: input.batchId },
      {
        $set: {
          batchStatus: input.toStatus,
          updatedAt: input.updatedAt,
          ...(input.submittedByActorId !== undefined
            ? { submittedByActorId: input.submittedByActorId }
            : {}),
          ...(input.submittedAt !== undefined
            ? { submittedAt: input.submittedAt }
            : {}),
        },
      },
      withSession(session),
    );

    return fromBatchDocument(updated);
  }

  async approveBatch(
    input: ApprovePlatformEarningBatchInput,
    session: ClientSession,
  ): Promise<PlatformEarningBatch | null> {
    const updated = await this.batches.findOneAndUpdate(
      { _id: input.batchId, status: "UNDER_REVIEW" },
      {
        $set: {
          status: "APPROVED",
          conversionSnapshot: input.conversionSnapshot,
          platformCutSnapshot: input.platformCutSnapshot,
          companyNetAmount: input.companyNetAmount,
          commissionableBasisAmount:
            input.commissionableBasisAmount,
          sourceFingerprint: input.sourceFingerprint,
          approvedByActorId: input.approvedByActorId,
          approvedAt: input.approvedAt,
          updatedAt: input.updatedAt,
        },
      },
      { ...withSession(session), returnDocument: "after" },
    );

    if (!updated) {
      return null;
    }

    await this.lines.updateMany(
      { batchId: input.batchId },
      {
        $set: {
          batchStatus: "APPROVED",
          updatedAt: input.updatedAt,
        },
      },
      withSession(session),
    );

    return fromBatchDocument(updated);
  }

  async markRevenueEntryCreated(
    input: {
      readonly batchId: string;
      readonly revenueEntryId: string;
      readonly revenueEntryCreatedByActorId: string;
      readonly revenueEntryCreatedAt: number;
      readonly updatedAt: number;
    },
    session: ClientSession,
  ): Promise<PlatformEarningBatch | null> {
    const updated = await this.batches.findOneAndUpdate(
      {
        _id: input.batchId,
        status: "APPROVED",
        revenueEntryId: null,
      },
      {
        $set: {
          revenueEntryId: input.revenueEntryId,
          revenueEntryCreatedByActorId:
            input.revenueEntryCreatedByActorId,
          revenueEntryCreatedAt: input.revenueEntryCreatedAt,
          updatedAt: input.updatedAt,
        },
      },
      { ...withSession(session), returnDocument: "after" },
    );

    return updated ? fromBatchDocument(updated) : null;
  }

  async insertLine(
    line: PlatformEarningLine,
    session: ClientSession,
  ): Promise<PlatformEarningLine> {
    await this.lines.insertOne(
      toLineDocument(line),
      withSession(session),
    );
    await this.rebuildBatchTotals(line.batchId, session);
    return line;
  }

  async findLineById(
    lineId: string,
    session?: ClientSession,
  ): Promise<PlatformEarningLine | null> {
    const document = await this.lines.findOne(
      { _id: lineId },
      withSession(session),
    );
    return document ? fromLineDocument(document) : null;
  }

  async findLineByDuplicateDetectionKey(
    duplicateDetectionKey: string,
    session?: ClientSession,
  ): Promise<PlatformEarningLine | null> {
    const document = await this.lines.findOne(
      { duplicateDetectionKey },
      withSession(session),
    );
    return document ? fromLineDocument(document) : null;
  }

  async updateDraftLine(
    input: UpdatePlatformEarningLineInput,
    session: ClientSession,
  ): Promise<PlatformEarningLine | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };
    copyOptional(set, input, "sourceDate");
    copyOptional(set, input, "memberTalentId");
    copyOptional(set, input, "memberEmploymentProfileId");
    copyOptional(set, input, "eventId");
    copyOptional(set, input, "rawQuantity");
    copyOptional(set, input, "externalSourceRef");
    copyOptional(set, input, "notes");
    copyOptional(set, input, "duplicateDetectionKey");

    const updated = await this.lines.findOneAndUpdate(
      { _id: input.lineId, batchStatus: "DRAFT" },
      { $set: set },
      { ...withSession(session), returnDocument: "after" },
    );

    if (!updated) {
      return null;
    }

    await this.rebuildBatchTotals(updated.batchId, session);
    return fromLineDocument(updated);
  }

  async listLines(
    filters: PlatformEarningLineListFilters,
    session?: ClientSession,
  ): Promise<PlatformEarningLineListPage> {
    const query: Record<string, unknown> = {};
    if (filters.batchId) query.batchId = filters.batchId;
    if (filters.periodMonth) query.periodMonth = filters.periodMonth;
    if (filters.status) query.batchStatus = filters.status;
    if (filters.platform) query.platform = filters.platform;
    if (filters.platformAccountId) {
      query.platformAccountId = filters.platformAccountId;
    }
    if (filters.talentGroupId) query.talentGroupId = filters.talentGroupId;
    if (filters.memberTalentId) {
      query.memberTalentId = filters.memberTalentId;
    }
    if (filters.cursor) {
      query._id = { $gt: filters.cursor };
    }

    const documents = await this.lines
      .find(query, withSession(session))
      .sort({ _id: 1 })
      .limit(filters.limit + 1)
      .toArray();

    const page = documents.slice(0, filters.limit);
    return {
      items: page.map(fromLineDocument),
      nextCursor:
        documents.length > filters.limit
          ? page[page.length - 1]?._id
          : undefined,
    };
  }

  async findLinesByBatchId(
    batchId: string,
    session?: ClientSession,
  ): Promise<readonly PlatformEarningLine[]> {
    const documents = await this.lines
      .find({ batchId }, withSession(session))
      .sort({ sourceDate: 1, _id: 1 })
      .toArray();
    return documents.map(fromLineDocument);
  }

  private async rebuildBatchTotals(
    batchId: string,
    session: ClientSession,
  ): Promise<void> {
    const result = await this.lines
      .aggregate<{ count: number; rawQuantityTotal: number }>(
        [
          { $match: { batchId } },
          {
            $group: {
              _id: "$batchId",
              count: { $sum: 1 },
              rawQuantityTotal: { $sum: "$rawQuantity" },
            },
          },
        ],
        withSession(session),
      )
      .next();

    await this.batches.updateOne(
      { _id: batchId, status: "DRAFT" },
      {
        $set: {
          sourceLineCount: result?.count ?? 0,
          rawQuantityTotal: result?.rawQuantityTotal ?? 0,
        },
      },
      withSession(session),
    );
  }
}

function toBatchDocument(
  input: PlatformEarningBatch,
): PlatformEarningBatchDocument {
  return { ...input, _id: input.id };
}

function fromBatchDocument(
  input: PlatformEarningBatchDocument,
): PlatformEarningBatch {
  const { _id: _ignored, ...rest } = input;
  return rest;
}

function toLineDocument(
  input: PlatformEarningLine,
): PlatformEarningLineDocument {
  return { ...input, _id: input.id };
}

function fromLineDocument(
  input: PlatformEarningLineDocument,
): PlatformEarningLine {
  const { _id: _ignored, ...rest } = input;
  return rest;
}

function withSession(
  session?: ClientSession,
): { session?: ClientSession } {
  return session ? { session } : {};
}

function copyOptional<T extends object>(
  target: Record<string, unknown>,
  source: T,
  key: string,
): void {
  const value = Reflect.get(source, key);
  if (value !== undefined) {
    target[key] = value;
  }
}
