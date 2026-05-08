import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  FindNonArchivedByMeasurementIdentityInput,
  TalentKpiRepository,
  TouchTalentKpiDraftInput,
  TransitionTalentKpiStatusInput,
  UpdateTalentKpiDraftCoreInput,
} from "@modules/talent-kpi/domain/talent-kpi.repository";
import {
  TalentKpiMeasurementSource,
  TalentKpiMetricCode,
  TalentKpiMetricValue,
  TalentKpiRecord,
  TalentKpiRecordStatus,
} from "@modules/talent-kpi/domain/talent-kpi.types";

interface TalentKpiRecordDocument {
  readonly _id: string;
  readonly kpiRecordCode: string;
  readonly normalizedKpiRecordCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionEventId: string | null;
  readonly measurementSource: TalentKpiMeasurementSource;
  readonly status: TalentKpiRecordStatus;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly publishedAt: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface TalentKpiMetricValueDocument {
  readonly _id: string;
  readonly kpiRecordId: string;
  readonly metricCode: TalentKpiMetricCode;
  readonly numericValue: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoTalentKpiRepository
  extends BaseRepository<TalentKpiRecordDocument>
  implements TalentKpiRepository
{
  private readonly metricCollection: Collection<TalentKpiMetricValueDocument>;

  constructor(db: Db) {
    super(db, "talent_kpi_records");
    this.metricCollection =
      db.collection<TalentKpiMetricValueDocument>(
        "talent_kpi_metric_values",
      );
  }

  async insertRecord(
    record: TalentKpiRecord,
    session: ClientSession,
  ): Promise<TalentKpiRecord> {
    await this.collection.insertOne(
      toTalentKpiRecordDocument(record),
      this.withSession(session),
    );

    return record;
  }

  async insertMetricValues(
    metricValues: readonly TalentKpiMetricValue[],
    session: ClientSession,
  ): Promise<readonly TalentKpiMetricValue[]> {
    if (metricValues.length === 0) {
      return [];
    }

    await this.metricCollection.insertMany(
      metricValues.map(
        toTalentKpiMetricValueDocument,
      ),
      this.withSession(session),
    );

    return metricValues;
  }

  async findRecordById(
    talentKpiRecordId: string,
    session?: ClientSession,
  ): Promise<TalentKpiRecord | null> {
    const document = await this.collection.findOne(
      {
        _id: talentKpiRecordId,
      },
      this.withSession(session),
    );

    return document
      ? toTalentKpiRecord(document)
      : null;
  }

  async findRecordByKpiRecordCode(
    kpiRecordCode: string,
    session?: ClientSession,
  ): Promise<TalentKpiRecord | null> {
    const document = await this.collection.findOne(
      {
        kpiRecordCode,
      },
      this.withSession(session),
    );

    return document
      ? toTalentKpiRecord(document)
      : null;
  }

  async findNonArchivedByMeasurementIdentity(
    input: FindNonArchivedByMeasurementIdentityInput,
    session?: ClientSession,
  ): Promise<TalentKpiRecord | null> {
    const query: Record<string, unknown> = {
      subjectTalentId: input.subjectTalentId,
      attributionPlatformAccountId:
        input.attributionPlatformAccountId,
      attributionEventId: input.attributionEventId,
      periodStartAt: input.periodStartAt,
      periodEndAt: input.periodEndAt,
      measurementSource: input.measurementSource,
      status: {
        $ne: "ARCHIVED",
      },
    };

    if (input.excludeTalentKpiRecordId) {
      query._id = {
        $ne: input.excludeTalentKpiRecordId,
      };
    }

    const document = await this.collection.findOne(
      query,
      this.withSession(session),
    );

    return document
      ? toTalentKpiRecord(document)
      : null;
  }

  async updateDraftCore(
    input: UpdateTalentKpiDraftCoreInput,
    session: ClientSession,
  ): Promise<TalentKpiRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.title !== undefined) {
      set.title = input.title;
    }

    if (input.normalizedTitle !== undefined) {
      set.normalizedTitle = input.normalizedTitle;
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

    if (input.periodStartAt !== undefined) {
      set.periodStartAt = input.periodStartAt;
    }

    if (input.periodEndAt !== undefined) {
      set.periodEndAt = input.periodEndAt;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.talentKpiRecordId,
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

    return updated
      ? toTalentKpiRecord(updated)
      : null;
  }

  async touchDraftRecord(
    input: TouchTalentKpiDraftInput,
    session: ClientSession,
  ): Promise<TalentKpiRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.talentKpiRecordId,
        status: "DRAFT",
      },
      {
        $set: {
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated
      ? toTalentKpiRecord(updated)
      : null;
  }

  async transitionStatus(
    input: TransitionTalentKpiStatusInput,
    session: ClientSession,
  ): Promise<TalentKpiRecord | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };

    if (input.publishedAt !== undefined) {
      set.publishedAt = input.publishedAt;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.talentKpiRecordId,
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

    return updated
      ? toTalentKpiRecord(updated)
      : null;
  }

  async listMetricValuesByRecordId(
    talentKpiRecordId: string,
    session?: ClientSession,
  ): Promise<readonly TalentKpiMetricValue[]> {
    const documents = await this.metricCollection
      .find(
        {
          kpiRecordId: talentKpiRecordId,
        },
        this.withSession(session),
      )
      .sort({
        metricCode: 1,
        _id: 1,
      })
      .toArray();

    return documents.map(toTalentKpiMetricValue);
  }

  async deleteMetricValuesByRecordId(
    talentKpiRecordId: string,
    session: ClientSession,
  ): Promise<void> {
    await this.metricCollection.deleteMany(
      {
        kpiRecordId: talentKpiRecordId,
      },
      this.withSession(session),
    );
  }
}

function toTalentKpiRecordDocument(
  input: TalentKpiRecord,
): TalentKpiRecordDocument {
  return {
    _id: input.id,
    kpiRecordCode: input.kpiRecordCode,
    normalizedKpiRecordCode:
      input.normalizedKpiRecordCode,
    title: input.title,
    normalizedTitle: input.normalizedTitle,
    subjectTalentId: input.subjectTalentId,
    attributionPlatformAccountId:
      input.attributionPlatformAccountId,
    attributionEventId: input.attributionEventId,
    measurementSource: input.measurementSource,
    status: input.status,
    periodStartAt: input.periodStartAt,
    periodEndAt: input.periodEndAt,
    publishedAt: input.publishedAt,
    description: input.description,
    externalRef: input.externalRef,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toTalentKpiMetricValueDocument(
  input: TalentKpiMetricValue,
): TalentKpiMetricValueDocument {
  return {
    _id: input.id,
    kpiRecordId: input.kpiRecordId,
    metricCode: input.metricCode,
    numericValue: input.numericValue,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toTalentKpiRecord(
  document: TalentKpiRecordDocument,
): TalentKpiRecord {
  return {
    id: document._id,
    kpiRecordCode: document.kpiRecordCode,
    normalizedKpiRecordCode:
      document.normalizedKpiRecordCode,
    title: document.title,
    normalizedTitle: document.normalizedTitle,
    subjectTalentId: document.subjectTalentId,
    attributionPlatformAccountId:
      document.attributionPlatformAccountId,
    attributionEventId: document.attributionEventId,
    measurementSource: document.measurementSource,
    status: document.status,
    periodStartAt: document.periodStartAt,
    periodEndAt: document.periodEndAt,
    publishedAt: document.publishedAt,
    description: document.description,
    externalRef: document.externalRef,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toTalentKpiMetricValue(
  document: TalentKpiMetricValueDocument,
): TalentKpiMetricValue {
  return {
    id: document._id,
    kpiRecordId: document.kpiRecordId,
    metricCode: document.metricCode,
    numericValue: document.numericValue,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
