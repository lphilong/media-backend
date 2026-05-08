import {
  Collection,
  ClientSession,
  Document as MongoDocument,
  Db,
} from "mongodb";

import { InfrastructureError } from "@infra/errors/infrastructure.error";

export abstract class BaseRepository<
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

    this.collection = db.collection<TDocument>(collectionName);
  }

  protected withSession(
    session?: ClientSession,
  ): { session?: ClientSession } {
    return session ? { session } : {};
  }
}
