import {
  Collection,
  Document as MongoDocument,
  Db,
} from "mongodb";

import { InfrastructureError } from "@infra/errors/infrastructure.error";

abstract class ReadSurfaceRepositoryBase<
  TDocument extends MongoDocument,
> {
  protected readonly collection: Collection<TDocument>;

  protected constructor(
    db: Db,
    collectionName: string,
  ) {
    if (!collectionName) {
      throw new InfrastructureError(
        "INVALID_COLLECTION_NAME",
        "Collection name is required",
      );
    }

    this.collection = db.collection<TDocument>(
      collectionName,
    );
  }

  protected denyWrite(): never {
    throw new InfrastructureError(
      "READONLY_WRITE_FORBIDDEN",
      "Write operation is not allowed",
    );
  }
}

export abstract class PrimaryCriticalRepositoryBase<
  TDocument extends MongoDocument,
> extends ReadSurfaceRepositoryBase<TDocument> {}

export abstract class StaleSafeReadonlyRepositoryBase<
  TDocument extends MongoDocument,
> extends ReadSurfaceRepositoryBase<TDocument> {}
