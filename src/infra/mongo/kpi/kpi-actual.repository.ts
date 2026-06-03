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
  readonly editCount: number;
  readonly correctionCount: number;
  readonly latestCorrectionId: string | null;
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
    this.correctionCollection =
      db.collection<KpiActualCorrectionDocument>("kpi_actual_corrections");
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
        editCount: { $lt: input.maxCurrentEditCountExclusive },
      },
      {
        $set: {
          actualValue: input.actualValue,
          effectiveValue: input.actualValue,
          updatedAt: input.updatedAt,
          updatedByActorId: input.updatedByActorId,
          lastEditedAt: input.updatedAt,
          lastEditedByActorId: input.updatedByActorId,
        },
        $inc: { editCount: 1 },
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
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.correction.actualEntryId },
      {
        $set: {
          effectiveValue: input.correction.correctedValue,
          latestCorrectionId: input.correction.id,
          updatedAt: input.updatedAt,
          updatedByActorId: input.updatedByActorId,
        },
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
      .sort({ kpiPlanId: 1, allocationId: 1, metricCode: 1, actualDate: 1, _id: 1 })
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
    editCount: input.editCount,
    correctionCount: input.correctionCount,
    latestCorrectionId: input.latestCorrectionId,
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
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
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
    editCount: doc.editCount,
    correctionCount: doc.correctionCount,
    latestCorrectionId: doc.latestCorrectionId,
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
    reason: doc.reason,
    correctedByActorId: doc.correctedByActorId,
    correctedAt: doc.correctedAt,
    createdAt: doc.createdAt,
  };
}
