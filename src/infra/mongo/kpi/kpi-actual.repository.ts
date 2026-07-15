import { ClientSession, Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import {
  ApplyKpiActualCorrectionInput,
  FindKpiActualEntryIdentityInput,
  KpiActualRepository,
  UpdateKpiActualEntryDirectInput,
} from "@modules/kpi/domain/kpi-actual.repository";
import {
  KpiActualCorrection,
  KpiActualEntry,
  KpiMetricCode,
} from "@modules/kpi/domain/kpi.types";
import type {
  KpiActualAggregationMethod,
  KpiActualCaptureMode,
  KpiActualEvidenceMode,
  KpiActualLifecycleStatus,
  KpiActualReviewMode,
} from "@modules/kpi/domain/kpi-actual-policy";

interface KpiActualEntryDocument {
  readonly _id: string;
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly memberEmploymentProfileId?: string | null;
  readonly memberTalentId?: string | null;
  readonly metricCode: KpiMetricCode;
  readonly actualDate: string;
  readonly actualValue: number;
  readonly effectiveValue: number;
  readonly acceptedValue?: number | null;
  readonly acceptedVersion?: number | null;
  readonly editCount: number;
  readonly correctionCount: number;
  readonly latestCorrectionId: string | null;
  readonly lifecycleStatus?: KpiActualLifecycleStatus;
  readonly entryVersion?: number;
  readonly captureMode?: KpiActualCaptureMode;
  readonly aggregationMethod?: KpiActualAggregationMethod;
  readonly reviewMode?: KpiActualReviewMode;
  readonly evidenceMode?: KpiActualEvidenceMode;
  readonly policyVersion?: string;
  readonly sourceFingerprint?: string | null;
  readonly acceptedInputVersions?: readonly string[];
  readonly derivationVersion?: string | null;
  readonly createdAt: number;
  readonly createdByActorId: string;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
  readonly lastEditedAt: number | null;
  readonly lastEditedByActorId: string | null;
}

interface KpiActualCorrectionDocument {
  readonly _id: string;
  readonly actualEntryId: string;
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly memberEmploymentProfileId?: string | null;
  readonly memberTalentId?: string | null;
  readonly metricCode: KpiMetricCode;
  readonly actualDate: string;
  readonly previousValue: number;
  readonly correctedValue: number;
  readonly previousEntryVersion?: number;
  readonly replacementEntryVersion?: number;
  readonly replacementLifecycleStatus?: "CORRECTED" | "UNDER_REVIEW";
  readonly requiresReview?: boolean;
  readonly idempotencyKey?: string;
  readonly payloadFingerprint?: string;
  readonly reason: string;
  readonly correctedByActorId: string;
  readonly correctedAt: number;
  readonly createdAt: number;
}

export class NativeMongoKpiActualRepository
  extends BaseRepository<KpiActualEntryDocument>
  implements KpiActualRepository
{
  private readonly correctionCollection: Collection<KpiActualCorrectionDocument>;

  constructor(db: Db) {
    super(db, "kpi_actual_entries");
    this.correctionCollection = db.collection<KpiActualCorrectionDocument>(
      "kpi_actual_corrections",
    );
  }

  async findEntryById(
    actualEntryId: string,
    session?: ClientSession,
  ): Promise<KpiActualEntry | null> {
    const doc = await this.collection.findOne(
      { _id: actualEntryId },
      this.withSession(session),
    );
    return doc ? toEntryDomain(doc) : null;
  }

  async findEntryByIdentity(
    input: FindKpiActualEntryIdentityInput,
    session?: ClientSession,
  ): Promise<KpiActualEntry | null> {
    const doc = await this.collection.findOne(
      {
        kpiPlanId: input.kpiPlanId,
        allocationId: input.allocationId,
        metricCode: input.metricCode,
        actualDate: input.actualDate,
      },
      this.withSession(session),
    );
    return doc ? toEntryDomain(doc) : null;
  }

  async insertEntry(
    entry: KpiActualEntry,
    session: ClientSession,
  ): Promise<KpiActualEntry> {
    await this.collection.insertOne(
      toEntryDocument(entry),
      this.withSession(session),
    );
    return entry;
  }

  async updateEntryDirect(
    input: UpdateKpiActualEntryDirectInput,
    session: ClientSession,
  ): Promise<KpiActualEntry | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.actualEntryId,
        entryVersion: input.expectedEntryVersion,
        editCount: { $lt: input.maxCurrentEditCountExclusive },
      },
      {
        $set: {
          actualValue: input.actualValue,
          effectiveValue: input.actualValue,
          acceptedValue: input.actualValue,
          acceptedVersion: input.expectedEntryVersion + 1,
          updatedAt: input.updatedAt,
          updatedByActorId: input.updatedByActorId,
          lastEditedAt: input.updatedAt,
          lastEditedByActorId: input.updatedByActorId,
        },
        $inc: { editCount: 1, entryVersion: 1 },
      },
      { ...this.withSession(session), returnDocument: "after" },
    );
    return updated ? toEntryDomain(updated) : null;
  }

  async insertCorrectionAndApply(
    input: ApplyKpiActualCorrectionInput,
    session: ClientSession,
  ): Promise<KpiActualEntry | null> {
    await this.correctionCollection.insertOne(
      toCorrectionDocument(input.correction),
      this.withSession(session),
    );
    const projectionSet: Record<string, unknown> = {
      latestCorrectionId: input.correction.id,
      lifecycleStatus:
        input.correction.replacementLifecycleStatus ?? "CORRECTED",
      entryVersion: input.correction.replacementEntryVersion,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    if (input.applyAcceptedProjection) {
      projectionSet.effectiveValue = input.correction.correctedValue;
      projectionSet.acceptedValue = input.correction.correctedValue;
      projectionSet.acceptedVersion = input.correction.replacementEntryVersion;
    }
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.correction.actualEntryId,
        entryVersion: input.expectedEntryVersion,
      },
      {
        $set: projectionSet,
        $inc: { correctionCount: 1 },
      },
      { ...this.withSession(session), returnDocument: "after" },
    );
    return updated ? toEntryDomain(updated) : null;
  }

  async listEntriesByPlanId(
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<readonly KpiActualEntry[]> {
    const docs = await this.collection
      .find({ kpiPlanId }, this.withSession(session))
      .sort({ allocationId: 1, metricCode: 1, actualDate: 1, _id: 1 })
      .toArray();
    return docs.map(toEntryDomain);
  }

  async listEntriesByPlanIds(
    kpiPlanIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly KpiActualEntry[]> {
    const ids = uniqueNonEmpty(kpiPlanIds);

    if (ids.length === 0) {
      return [];
    }

    const docs = await this.collection
      .find({ kpiPlanId: { $in: ids } }, this.withSession(session))
      .sort({
        kpiPlanId: 1,
        allocationId: 1,
        metricCode: 1,
        actualDate: 1,
        _id: 1,
      })
      .toArray();
    return docs.map(toEntryDomain);
  }

  async listEntriesByPlanIdAndActualDate(
    kpiPlanId: string,
    actualDate: string,
    session?: ClientSession,
  ): Promise<readonly KpiActualEntry[]> {
    const docs = await this.collection
      .find({ kpiPlanId, actualDate }, this.withSession(session))
      .sort({ allocationId: 1, metricCode: 1, _id: 1 })
      .toArray();
    return docs.map(toEntryDomain);
  }

  async listCorrectionsByActualEntryId(
    actualEntryId: string,
    session?: ClientSession,
  ): Promise<readonly KpiActualCorrection[]> {
    const docs = await this.correctionCollection
      .find({ actualEntryId }, this.withSession(session))
      .sort({ correctedAt: 1, createdAt: 1, _id: 1 })
      .toArray();
    return docs.map(toCorrectionDomain);
  }
}

function toEntryDocument(input: KpiActualEntry): KpiActualEntryDocument {
  return {
    _id: input.id,
    kpiPlanId: input.kpiPlanId,
    allocationId: input.allocationId,
    memberEmploymentProfileId: input.memberEmploymentProfileId,
    memberTalentId: input.memberTalentId,
    metricCode: input.metricCode,
    actualDate: input.actualDate,
    actualValue: input.actualValue,
    effectiveValue: input.effectiveValue,
    acceptedValue: input.acceptedValue,
    acceptedVersion: input.acceptedVersion,
    editCount: input.editCount,
    correctionCount: input.correctionCount,
    latestCorrectionId: input.latestCorrectionId,
    lifecycleStatus: input.lifecycleStatus,
    entryVersion: input.entryVersion,
    captureMode: input.captureMode,
    aggregationMethod: input.aggregationMethod,
    reviewMode: input.reviewMode,
    evidenceMode: input.evidenceMode,
    policyVersion: input.policyVersion,
    sourceFingerprint: input.sourceFingerprint,
    acceptedInputVersions: input.acceptedInputVersions,
    derivationVersion: input.derivationVersion,
    createdAt: input.createdAt,
    createdByActorId: input.createdByActorId,
    updatedAt: input.updatedAt,
    updatedByActorId: input.updatedByActorId,
    lastEditedAt: input.lastEditedAt,
    lastEditedByActorId: input.lastEditedByActorId,
  };
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return [
    ...new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  ];
}

function toEntryDomain(doc: KpiActualEntryDocument): KpiActualEntry {
  return {
    id: doc._id,
    kpiPlanId: doc.kpiPlanId,
    allocationId: doc.allocationId,
    memberEmploymentProfileId: doc.memberEmploymentProfileId ?? null,
    memberTalentId: doc.memberTalentId ?? null,
    metricCode: doc.metricCode,
    actualDate: doc.actualDate,
    actualValue: doc.actualValue,
    effectiveValue: doc.effectiveValue,
    acceptedValue: doc.acceptedValue,
    acceptedVersion: doc.acceptedVersion,
    editCount: doc.editCount,
    correctionCount: doc.correctionCount,
    latestCorrectionId: doc.latestCorrectionId,
    lifecycleStatus: doc.lifecycleStatus,
    entryVersion: doc.entryVersion,
    captureMode: doc.captureMode,
    aggregationMethod: doc.aggregationMethod,
    reviewMode: doc.reviewMode,
    evidenceMode: doc.evidenceMode,
    policyVersion: doc.policyVersion,
    sourceFingerprint: doc.sourceFingerprint,
    acceptedInputVersions: doc.acceptedInputVersions,
    derivationVersion: doc.derivationVersion,
    createdAt: doc.createdAt,
    createdByActorId: doc.createdByActorId,
    updatedAt: doc.updatedAt,
    updatedByActorId: doc.updatedByActorId,
    lastEditedAt: doc.lastEditedAt,
    lastEditedByActorId: doc.lastEditedByActorId,
  };
}

function toCorrectionDocument(
  input: KpiActualCorrection,
): KpiActualCorrectionDocument {
  return {
    _id: input.id,
    actualEntryId: input.actualEntryId,
    kpiPlanId: input.kpiPlanId,
    allocationId: input.allocationId,
    memberEmploymentProfileId: input.memberEmploymentProfileId,
    memberTalentId: input.memberTalentId,
    metricCode: input.metricCode,
    actualDate: input.actualDate,
    previousValue: input.previousValue,
    correctedValue: input.correctedValue,
    previousEntryVersion: input.previousEntryVersion,
    replacementEntryVersion: input.replacementEntryVersion,
    replacementLifecycleStatus: input.replacementLifecycleStatus,
    requiresReview: input.requiresReview,
    idempotencyKey: input.idempotencyKey,
    payloadFingerprint: input.payloadFingerprint,
    reason: input.reason,
    correctedByActorId: input.correctedByActorId,
    correctedAt: input.correctedAt,
    createdAt: input.createdAt,
  };
}

function toCorrectionDomain(
  doc: KpiActualCorrectionDocument,
): KpiActualCorrection {
  return {
    id: doc._id,
    actualEntryId: doc.actualEntryId,
    kpiPlanId: doc.kpiPlanId,
    allocationId: doc.allocationId,
    memberEmploymentProfileId: doc.memberEmploymentProfileId ?? null,
    memberTalentId: doc.memberTalentId ?? null,
    metricCode: doc.metricCode,
    actualDate: doc.actualDate,
    previousValue: doc.previousValue,
    correctedValue: doc.correctedValue,
    previousEntryVersion: doc.previousEntryVersion,
    replacementEntryVersion: doc.replacementEntryVersion,
    replacementLifecycleStatus: doc.replacementLifecycleStatus,
    requiresReview: doc.requiresReview,
    idempotencyKey: doc.idempotencyKey,
    payloadFingerprint: doc.payloadFingerprint,
    reason: doc.reason,
    correctedByActorId: doc.correctedByActorId,
    correctedAt: doc.correctedAt,
    createdAt: doc.createdAt,
  };
}
