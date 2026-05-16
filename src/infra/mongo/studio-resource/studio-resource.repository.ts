import { ClientSession, Db } from "mongodb";
import {
  buildGeneratedBusinessCodeRegex,
  BusinessCodePolicy,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  StudioResourceRepository,
  TransitionStudioResourceOperationalStatusInput,
  UpdateStudioResourceCoreInput,
} from "@modules/studio-resource/domain/studio-resource.repository";
import {
  StudioResourceClass,
  StudioResourceOperationalStatus,
  StudioResourceRecord,
} from "@modules/studio-resource/domain/studio-resource.types";

interface StudioResourceDocument {
  readonly _id: string;
  readonly resourceCode: string;
  readonly normalizedResourceCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly shortName: string | null;
  readonly normalizedShortName: string | null;
  readonly resourceClass: StudioResourceClass;
  readonly operationalStatus: StudioResourceOperationalStatus;
  readonly locationLabel: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly maxOccupancy: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoStudioResourceRepository
  extends BaseRepository<StudioResourceDocument>
  implements StudioResourceRepository
{
  constructor(db: Db) {
    super(db, "studio_resources");
  }

  async insert(
    studioResource: StudioResourceRecord,
    session: ClientSession,
  ): Promise<StudioResourceRecord> {
    await this.collection.insertOne(
      toStudioResourceDocument(studioResource),
      this.withSession(session),
    );

    return studioResource;
  }

  async findById(
    studioResourceId: string,
    session?: ClientSession,
  ): Promise<StudioResourceRecord | null> {
    const doc = await this.collection.findOne(
      { _id: studioResourceId },
      this.withSession(session),
    );

    return doc ? toStudioResourceRecord(doc) : null;
  }

  async findByResourceCode(
    resourceCode: string,
    session?: ClientSession,
  ): Promise<StudioResourceRecord | null> {
    const doc = await this.collection.findOne(
      { resourceCode },
      this.withSession(session),
    );

    return doc ? toStudioResourceRecord(doc) : null;
  }

  async findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number> {
    const doc = await this.collection
      .find(
        {
          resourceCode:
            buildGeneratedBusinessCodeRegex(policy),
        },
        this.withSession(session),
      )
      .sort({ resourceCode: -1 })
      .limit(1)
      .next();

    if (!doc) {
      return 0;
    }

    return (
      parseGeneratedBusinessCodeSequence(
        doc.resourceCode,
        policy,
      ) ?? 0
    );
  }

  async updateCore(
    input: UpdateStudioResourceCoreInput,
    session: ClientSession,
  ): Promise<StudioResourceRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.name !== undefined) {
      set.name = input.name;
    }

    if (input.normalizedName !== undefined) {
      set.normalizedName = input.normalizedName;
    }

    if (input.shortName !== undefined) {
      set.shortName = input.shortName;
    }

    if (input.normalizedShortName !== undefined) {
      set.normalizedShortName =
        input.normalizedShortName;
    }

    if (input.locationLabel !== undefined) {
      set.locationLabel = input.locationLabel;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    if (input.maxOccupancy !== undefined) {
      set.maxOccupancy = input.maxOccupancy;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.studioResourceId },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toStudioResourceRecord(updated) : null;
  }

  async transitionOperationalStatus(
    input: TransitionStudioResourceOperationalStatusInput,
    session: ClientSession,
  ): Promise<StudioResourceRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.studioResourceId,
        operationalStatus: {
          $in: [...input.fromStatuses],
        },
      },
      {
        $set: {
          operationalStatus: input.toStatus,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toStudioResourceRecord(updated) : null;
  }
}

function toStudioResourceDocument(
  studioResource: StudioResourceRecord,
): StudioResourceDocument {
  return {
    _id: studioResource.id,
    resourceCode: studioResource.resourceCode,
    normalizedResourceCode:
      canonicalizeStudioResourceSearchText(
        studioResource.resourceCode,
      ),
    name: studioResource.name,
    normalizedName: studioResource.normalizedName,
    shortName: studioResource.shortName,
    normalizedShortName:
      studioResource.normalizedShortName,
    resourceClass: studioResource.resourceClass,
    operationalStatus:
      studioResource.operationalStatus,
    locationLabel: studioResource.locationLabel,
    description: studioResource.description,
    externalRef: studioResource.externalRef,
    maxOccupancy: studioResource.maxOccupancy,
    createdAt: studioResource.createdAt,
    updatedAt: studioResource.updatedAt,
  };
}

function toStudioResourceRecord(
  document: StudioResourceDocument,
): StudioResourceRecord {
  return {
    id: document._id,
    resourceCode: document.resourceCode,
    name: document.name,
    normalizedName: document.normalizedName,
    shortName: document.shortName,
    normalizedShortName:
      document.normalizedShortName,
    resourceClass: document.resourceClass,
    operationalStatus: document.operationalStatus,
    locationLabel: document.locationLabel,
    description: document.description,
    externalRef: document.externalRef,
    maxOccupancy: document.maxOccupancy,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function canonicalizeStudioResourceSearchText(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
