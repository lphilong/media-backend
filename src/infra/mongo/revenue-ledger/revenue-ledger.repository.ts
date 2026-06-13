import {
  ClientSession,
  Db,
} from "mongodb";
import {
  buildGeneratedBusinessCodeRegex,
  BusinessCodePolicy,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  RevenueEntryRepository,
  TransitionRevenueEntryStatusInput,
  UpdateRevenueEntryDraftCoreInput,
} from "@modules/revenue-ledger/domain/revenue-ledger.repository";
import {
  RevenueEntry,
  RevenueEntrySource,
  RevenueEntryStatus,
  RevenueKind,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";

interface RevenueEntryDocument {
  readonly _id: string;
  readonly revenueEntryCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionTalentGroupId?: string | null;
  readonly attributionEmploymentProfileId?: string | null;
  readonly attributionEventId: string | null;
  readonly revenueKind: RevenueKind;
  readonly entrySource: RevenueEntrySource;
  readonly sourceBatchIds?: readonly string[];
  readonly sourceSummaryRef?: string | null;
  readonly sourceLineCount?: number | null;
  readonly sourceSummarySnapshot?: RevenueEntry["sourceSummarySnapshot"];
  readonly conversionSnapshot?: RevenueEntry["conversionSnapshot"];
  readonly platformCutSnapshot?: RevenueEntry["platformCutSnapshot"];
  readonly commissionableBasisSnapshot?: RevenueEntry["commissionableBasisSnapshot"];
  readonly status: RevenueEntryStatus;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
  readonly finalizedAt: number | null;
  readonly reconciledAt: number | null;
  readonly voidedAt: number | null;
  readonly reconciliationReference: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoRevenueEntryRepository
  extends BaseRepository<RevenueEntryDocument>
  implements RevenueEntryRepository
{
  constructor(db: Db) {
    super(db, "revenue_entries");
  }

  async insert(
    revenueEntry: RevenueEntry,
    session: ClientSession,
  ): Promise<RevenueEntry> {
    await this.collection.insertOne(
      toRevenueEntryDocument(revenueEntry),
      this.withSession(session),
    );

    return revenueEntry;
  }

  async findById(
    revenueEntryId: string,
    session?: ClientSession,
  ): Promise<RevenueEntry | null> {
    const document = await this.collection.findOne(
      {
        _id: revenueEntryId,
      },
      this.withSession(session),
    );

    return document
      ? toRevenueEntry(document)
      : null;
  }

  async findByRevenueEntryCode(
    revenueEntryCode: string,
    session?: ClientSession,
  ): Promise<RevenueEntry | null> {
    const document = await this.collection.findOne(
      {
        revenueEntryCode,
      },
      this.withSession(session),
    );

    return document
      ? toRevenueEntry(document)
      : null;
  }

  async findMaxGeneratedRevenueEntryCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number> {
    const document = await this.collection
      .find(
        {
          revenueEntryCode:
            buildGeneratedBusinessCodeRegex(policy),
        },
        this.withSession(session),
      )
      .sort({ revenueEntryCode: -1 })
      .limit(1)
      .next();

    if (!document) {
      return 0;
    }

    return (
      parseGeneratedBusinessCodeSequence(
        document.revenueEntryCode,
        policy,
      ) ?? 0
    );
  }

  async updateDraftCore(
    input: UpdateRevenueEntryDraftCoreInput,
    session: ClientSession,
  ): Promise<RevenueEntry | null> {
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

    if (input.subjectTalentId !== undefined) {
      set.subjectTalentId = input.subjectTalentId;
    }

    if (
      input.attributionPlatformAccountId !== undefined
    ) {
      set.attributionPlatformAccountId =
        input.attributionPlatformAccountId;
    }

    if (input.attributionEventId !== undefined) {
      set.attributionEventId =
        input.attributionEventId;
    }

    if (input.revenueKind !== undefined) {
      set.revenueKind = input.revenueKind;
    }

    if (input.currencyCode !== undefined) {
      set.currencyCode = input.currencyCode;
    }

    if (input.recognizedAmount !== undefined) {
      set.recognizedAmount = input.recognizedAmount;
    }

    if (input.recognizedAt !== undefined) {
      set.recognizedAt = input.recognizedAt;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.revenueEntryId,
        status: "DRAFT",
      },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toRevenueEntry(updated) : null;
  }

  async transitionStatus(
    input: TransitionRevenueEntryStatusInput,
    session: ClientSession,
  ): Promise<RevenueEntry | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };

    if (input.finalizedAt !== undefined) {
      set.finalizedAt = input.finalizedAt;
    }

    if (input.reconciledAt !== undefined) {
      set.reconciledAt = input.reconciledAt;
    }

    if (input.voidedAt !== undefined) {
      set.voidedAt = input.voidedAt;
    }

    if (
      input.reconciliationReference !== undefined
    ) {
      set.reconciliationReference =
        input.reconciliationReference;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.revenueEntryId,
        status: {
          $in: [...input.fromStatuses],
        },
      },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toRevenueEntry(updated) : null;
  }
}

function toRevenueEntryDocument(
  input: RevenueEntry,
): RevenueEntryDocument {
  return {
    _id: input.id,
    revenueEntryCode: input.revenueEntryCode,
    title: input.title,
    normalizedTitle: input.normalizedTitle,
    subjectTalentId: input.subjectTalentId,
    attributionPlatformAccountId:
      input.attributionPlatformAccountId,
    attributionTalentGroupId:
      input.attributionTalentGroupId,
    attributionEmploymentProfileId:
      input.attributionEmploymentProfileId,
    attributionEventId: input.attributionEventId,
    revenueKind: input.revenueKind,
    entrySource: input.entrySource,
    sourceBatchIds: input.sourceBatchIds,
    sourceSummaryRef: input.sourceSummaryRef,
    sourceLineCount: input.sourceLineCount,
    sourceSummarySnapshot:
      input.sourceSummarySnapshot,
    conversionSnapshot: input.conversionSnapshot,
    platformCutSnapshot: input.platformCutSnapshot,
    commissionableBasisSnapshot:
      input.commissionableBasisSnapshot,
    status: input.status,
    currencyCode: input.currencyCode,
    recognizedAmount: input.recognizedAmount,
    recognizedAt: input.recognizedAt,
    finalizedAt: input.finalizedAt,
    reconciledAt: input.reconciledAt,
    voidedAt: input.voidedAt,
    reconciliationReference:
      input.reconciliationReference,
    description: input.description,
    externalRef: input.externalRef,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toRevenueEntry(
  document: RevenueEntryDocument,
): RevenueEntry {
  return {
    id: document._id,
    revenueEntryCode: document.revenueEntryCode,
    title: document.title,
    normalizedTitle: document.normalizedTitle,
    subjectTalentId: document.subjectTalentId,
    attributionPlatformAccountId:
      document.attributionPlatformAccountId,
    attributionTalentGroupId:
      document.attributionTalentGroupId ?? null,
    attributionEmploymentProfileId:
      document.attributionEmploymentProfileId ?? null,
    attributionEventId: document.attributionEventId,
    revenueKind: document.revenueKind,
    entrySource: document.entrySource,
    sourceBatchIds: document.sourceBatchIds ?? [],
    sourceSummaryRef:
      document.sourceSummaryRef ?? null,
    sourceLineCount:
      document.sourceLineCount ?? null,
    sourceSummarySnapshot:
      document.sourceSummarySnapshot ?? null,
    conversionSnapshot:
      document.conversionSnapshot ?? null,
    platformCutSnapshot:
      document.platformCutSnapshot ?? null,
    commissionableBasisSnapshot:
      document.commissionableBasisSnapshot ?? null,
    status: document.status,
    currencyCode: document.currencyCode,
    recognizedAmount: document.recognizedAmount,
    recognizedAt: document.recognizedAt,
    finalizedAt: document.finalizedAt,
    reconciledAt: document.reconciledAt,
    voidedAt: document.voidedAt,
    reconciliationReference:
      document.reconciliationReference,
    description: document.description,
    externalRef: document.externalRef,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
