import { ClientSession, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { BusinessCodeSequenceRepository } from "@core/business-code/business-code-sequence.repository";
import { BUSINESS_CODE_SEQUENCE_COLLECTION } from "./business-code-sequence.index";

interface BusinessCodeSequenceDocument {
  readonly _id: string;
  readonly module: string;
  readonly bucket: string;
  readonly value: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoBusinessCodeSequenceRepository
  extends BaseRepository<BusinessCodeSequenceDocument>
  implements BusinessCodeSequenceRepository
{
  constructor(db: Db) {
    super(db, BUSINESS_CODE_SEQUENCE_COLLECTION);
  }

  async allocateNext(
    moduleKey: string,
    bucket: string,
    session: ClientSession,
  ): Promise<number> {
    const now = Date.now();
    const document =
      await this.collection.findOneAndUpdate(
        {
          _id: buildSequenceId(moduleKey, bucket),
        },
        {
          $inc: {
            value: 1,
          },
          $set: {
            updatedAt: now,
          },
          $setOnInsert: {
            module: moduleKey,
            bucket,
            createdAt: now,
          },
        },
        {
          ...this.withSession(session),
          upsert: true,
          returnDocument: "after",
        },
      );

    if (!document) {
      throw new Error(
        `Failed to allocate business code sequence for ${moduleKey}:${bucket}`,
      );
    }

    return document.value;
  }

  async ensureAtLeast(
    moduleKey: string,
    bucket: string,
    minimumValue: number,
    session: ClientSession,
  ): Promise<void> {
    if (minimumValue <= 0) {
      return;
    }

    const now = Date.now();
    await this.collection.updateOne(
      {
        _id: buildSequenceId(moduleKey, bucket),
      },
      {
        $max: {
          value: minimumValue,
        },
        $set: {
          module: moduleKey,
          bucket,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      {
        ...this.withSession(session),
        upsert: true,
      },
    );
  }
}

function buildSequenceId(
  moduleKey: string,
  bucket: string,
): string {
  return `${moduleKey}:${bucket}`;
}
