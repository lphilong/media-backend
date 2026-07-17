import {
  Db,
  Document,
  Filter,
  FindOptions,
  MongoClient,
  MongoClientOptions,
  ReadPreference,
} from "mongodb";
import { normalizeRisk001QueryValue } from "./risk-001-query-value-contract";
import {
  assertReadOnlyAggregatePipeline,
  bindRisk001ReadOnlyGatewayCapabilities,
  normalizeReadOnlyAggregateMaxTimeMS,
  sanitizedFailure,
} from "./risk-001-read-only-gateway-capabilities";
import { Risk001SanitizedError } from "./risk-001-sanitized-error";
export {
  assertReadOnlyAggregatePipeline,
  normalizeReadOnlyAggregateMaxTimeMS,
  sanitizedFailure,
} from "./risk-001-read-only-gateway-capabilities";
export { Risk001SanitizedError, sanitizeSensitiveText } from "./risk-001-sanitized-error";
export type { Risk001GatewayFailureCategory as Risk001FailureCategory } from "./risk-001-sanitized-error";

export type ReadOnlyDocument = object;
export type ReadOnlyFilter = Readonly<Record<string, unknown>>;
export type ReadOnlyProjection = Readonly<Record<string, 0 | 1>>;
export type ReadOnlySort = Readonly<Record<string, 1 | -1>>;

export interface ReadOnlyFindOptions {
  readonly projection: ReadOnlyProjection;
  readonly sort: ReadOnlySort;
  readonly limit: number;
}

export interface ReadOnlyAggregateOptions {
  readonly maxTimeMS?: number;
}

/** The complete DB capability surface made available to RISK-001 loaders. */
export interface ReadOnlyMongoGateway {
  ping(): Promise<void>;
  findOne<T extends ReadOnlyDocument>(
    collectionName: string,
    filter: ReadOnlyFilter,
    projection: ReadOnlyProjection,
  ): Promise<T | null>;
  find<T extends ReadOnlyDocument>(
    collectionName: string,
    filter: ReadOnlyFilter,
    options: ReadOnlyFindOptions,
  ): Promise<readonly T[]>;
  countDocuments(
    collectionName: string,
    filter: ReadOnlyFilter,
  ): Promise<number>;
  distinct<T>(
    collectionName: string,
    field: string,
    filter: ReadOnlyFilter,
  ): Promise<readonly T[]>;
  aggregate<T extends ReadOnlyDocument>(
    collectionName: string,
    pipeline: readonly ReadOnlyDocument[],
    options?: ReadOnlyAggregateOptions,
  ): Promise<readonly T[]>;
}

export class NativeReadOnlyMongoGateway implements ReadOnlyMongoGateway {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async ping(): Promise<void> {
    try {
      await this.#db.command({ ping: 1 });
    } catch (error) {
      throw sanitizedFailure("CONNECTION_FAILED", error);
    }
  }

  async findOne<T extends ReadOnlyDocument>(
    collectionName: string,
    filter: ReadOnlyFilter,
    projection: ReadOnlyProjection,
  ): Promise<T | null> {
    const normalizedFilter = normalizeRisk001QueryValue(filter) as ReadOnlyFilter;
    const normalizedProjection = normalizeRisk001QueryValue(projection) as ReadOnlyProjection;
    try {
      return (await this.#db
        .collection<Document>(assertCollectionName(collectionName))
        .findOne(normalizedFilter as Filter<Document>, { projection: normalizedProjection })) as T | null;
    } catch (error) {
      throw sanitizedFailure("READ_FAILED", error);
    }
  }

  async find<T extends ReadOnlyDocument>(
    collectionName: string,
    filter: ReadOnlyFilter,
    options: ReadOnlyFindOptions,
  ): Promise<readonly T[]> {
    assertPositiveLimit(options.limit);
    const normalizedFilter = normalizeRisk001QueryValue(filter) as ReadOnlyFilter;
    const normalizedProjection = normalizeRisk001QueryValue(options.projection) as ReadOnlyProjection;
    const normalizedSort = normalizeRisk001QueryValue(options.sort) as ReadOnlySort;
    try {
      return (await this.#db
        .collection<Document>(assertCollectionName(collectionName))
        .find(normalizedFilter as Filter<Document>, {
          projection: normalizedProjection,
        } as FindOptions<Document>)
        .sort(normalizedSort)
        .limit(options.limit)
        .toArray()) as T[];
    } catch (error) {
      throw sanitizedFailure("READ_FAILED", error);
    }
  }

  async countDocuments(
    collectionName: string,
    filter: ReadOnlyFilter,
  ): Promise<number> {
    const normalizedFilter = normalizeRisk001QueryValue(filter) as ReadOnlyFilter;
    try {
      return await this.#db
        .collection<Document>(assertCollectionName(collectionName))
        .countDocuments(normalizedFilter as Filter<Document>);
    } catch (error) {
      throw sanitizedFailure("READ_FAILED", error);
    }
  }

  async distinct<T>(
    collectionName: string,
    field: string,
    filter: ReadOnlyFilter,
  ): Promise<readonly T[]> {
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/u.test(field)) {
      throw new Risk001SanitizedError(
        "VALIDATION_FAILED",
        "Invalid distinct field",
      );
    }
    const normalizedFilter = normalizeRisk001QueryValue(filter) as ReadOnlyFilter;
    try {
      return (await this.#db
        .collection<Document>(assertCollectionName(collectionName))
        .distinct(field, normalizedFilter as Filter<Document>)) as T[];
    } catch (error) {
      throw sanitizedFailure("READ_FAILED", error);
    }
  }

  async aggregate<T extends ReadOnlyDocument>(
    collectionName: string,
    pipeline: readonly ReadOnlyDocument[],
    options: ReadOnlyAggregateOptions = {},
  ): Promise<readonly T[]> {
    const normalizedPipeline = normalizeRisk001QueryValue(pipeline) as readonly ReadOnlyDocument[];
    assertReadOnlyAggregatePipeline(normalizedPipeline);
    const maxTimeMS = normalizeReadOnlyAggregateMaxTimeMS(options.maxTimeMS);
    try {
      return (await this.#db
        .collection<Document>(assertCollectionName(collectionName))
        .aggregate(normalizedPipeline as Document[], {
          allowDiskUse: false,
          maxTimeMS,
        })
        .toArray()) as T[];
    } catch (error) {
      throw sanitizedFailure("READ_FAILED", error);
    }
  }
}

/** Import-safe binding: concrete production gateway may expose only the seam descriptor's methods. */
export const NATIVE_READ_ONLY_MONGO_GATEWAY_CAPABILITIES = bindRisk001ReadOnlyGatewayCapabilities(
  NativeReadOnlyMongoGateway.prototype,
);

interface ReadOnlyMongoClientLike {
  connect(): Promise<unknown>;
  db(name: string, options: { readonly readPreference: ReadPreference }): Db;
  close(): Promise<unknown>;
}

export interface ReadOnlyMongoConnectionOptions {
  readonly mongoUri: string;
  readonly mongoDbName: string;
  readonly clientFactory?: (
    uri: string,
    options: MongoClientOptions,
  ) => ReadOnlyMongoClientLike;
}

export async function withReadOnlyMongoGateway<T>(
  options: ReadOnlyMongoConnectionOptions,
  useGateway: (gateway: ReadOnlyMongoGateway) => Promise<T>,
): Promise<T> {
  const client = (options.clientFactory ?? defaultClientFactory)(
    options.mongoUri,
    {
      maxPoolSize: 2,
      minPoolSize: 0,
      retryReads: true,
      retryWrites: false,
      readPreference: ReadPreference.secondaryPreferred,
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
      socketTimeoutMS: 30_000,
    },
  );
  try {
    await client.connect();
    const gateway = new NativeReadOnlyMongoGateway(
      client.db(options.mongoDbName, {
        readPreference: ReadPreference.secondaryPreferred,
      }),
    );
    await gateway.ping();
    return await useGateway(gateway);
  } catch (error) {
    throw sanitizedFailure("CONNECTION_FAILED", error);
  } finally {
    try {
      await client.close();
    } catch {
      // The caller receives only the primary sanitized failure/result.
    }
  }
}

function defaultClientFactory(
  uri: string,
  options: MongoClientOptions,
): ReadOnlyMongoClientLike {
  return new MongoClient(uri, options);
}

function assertCollectionName(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(name)) {
    throw new Risk001SanitizedError(
      "VALIDATION_FAILED",
      "Invalid collection name",
    );
  }
  return name;
}

function assertPositiveLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Risk001SanitizedError(
      "VALIDATION_FAILED",
      "Read limit must be an integer between 1 and 1000",
    );
  }
}
