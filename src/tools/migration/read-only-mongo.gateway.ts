import {
  Db,
  Document,
  Filter,
  FindOptions,
  MongoClient,
  MongoClientOptions,
  ReadPreference,
} from "mongodb";

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

export type Risk001FailureCategory =
  | "CONFIGURATION_FAILED"
  | "CONNECTION_FAILED"
  | "READ_FAILED"
  | "VALIDATION_FAILED"
  | "MANUAL_SCOPE_ESCALATION_REQUIRED"
  | "OUTPUT_FAILED";

export class Risk001SanitizedError extends Error {
  constructor(
    readonly category: Risk001FailureCategory,
    message: string,
  ) {
    super(sanitizeSensitiveText(message));
    this.name = "Risk001SanitizedError";
  }
}

const READ_ONLY_AGGREGATE_STAGES = new Set([
  "$addFields",
  "$bucket",
  "$bucketAuto",
  "$count",
  "$densify",
  "$facet",
  "$fill",
  "$geoNear",
  "$group",
  "$limit",
  "$lookup",
  "$match",
  "$project",
  "$redact",
  "$replaceRoot",
  "$replaceWith",
  "$sample",
  "$set",
  "$setWindowFields",
  "$skip",
  "$sort",
  "$sortByCount",
  "$unionWith",
  "$unset",
  "$unwind",
]);

const PROHIBITED_AGGREGATE_STAGES = new Set(["$out", "$merge"]);

export function assertReadOnlyAggregatePipeline(
  pipeline: readonly ReadOnlyDocument[],
): void {
  let boundedLimit = false;
  for (const [index, stage] of pipeline.entries()) {
    assertNoNestedWriteStage(stage);
    const keys = Object.keys(stage);
    if (keys.length !== 1) {
      throw new Risk001SanitizedError(
        "VALIDATION_FAILED",
        `Aggregate stage ${index} must contain exactly one operator`,
      );
    }
    const operator = keys[0] as string;
    if (
      PROHIBITED_AGGREGATE_STAGES.has(operator) ||
      !READ_ONLY_AGGREGATE_STAGES.has(operator)
    ) {
      throw new Risk001SanitizedError(
        "VALIDATION_FAILED",
        `Aggregate stage ${operator} is not allowed in read-only mode`,
      );
    }
    if (operator === "$limit") {
      const limit = (stage as { readonly $limit?: unknown }).$limit;
      boundedLimit =
        typeof limit === "number" &&
        Number.isInteger(limit) &&
        limit >= 1 &&
        limit <= 10_000;
      if (!boundedLimit) {
        throw new Risk001SanitizedError(
          "VALIDATION_FAILED",
          "Aggregate result limit must be an integer from 1 through 10000",
        );
      }
    }
  }
  const finalStage = pipeline[pipeline.length - 1];
  if (!boundedLimit || !finalStage || Object.keys(finalStage)[0] !== "$limit") {
    throw new Risk001SanitizedError(
      "VALIDATION_FAILED",
      "Read-only aggregate pipeline requires a bounded final $limit stage",
    );
  }
}

function assertNoNestedWriteStage(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(assertNoNestedWriteStage);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED_AGGREGATE_STAGES.has(key)) {
      throw new Risk001SanitizedError(
        "VALIDATION_FAILED",
        `Aggregate stage ${key} is not allowed in read-only mode`,
      );
    }
    assertNoNestedWriteStage(child);
  }
}

export function sanitizeSensitiveText(value: unknown): string {
  const source = value instanceof Error ? value.message : String(value);
  return source
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/giu, "[REDACTED_MONGO_URI]")
    .replace(/\b(?:MONGO_URI|MONGO_URL|AUTH0_CLIENT_SECRET|PASSWORD)\s*[=:]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .replace(/\b[\w.+-]+:[^@\s]+@(?=[\w.-]+)/gu, "[REDACTED_CREDENTIALS]@")
    .replace(/\b[0-9a-f]{24}\b/giu, "[REDACTED_OBJECT_ID]");
}

export function sanitizedFailure(
  category: Risk001FailureCategory,
  error: unknown,
): Risk001SanitizedError {
  if (error instanceof Risk001SanitizedError) {
    return error;
  }
  const safeMessage = sanitizeSensitiveText(error);
  return new Risk001SanitizedError(category, safeMessage || category);
}

export class NativeReadOnlyMongoGateway implements ReadOnlyMongoGateway {
  constructor(private readonly db: Db) {}

  async ping(): Promise<void> {
    try {
      await this.db.command({ ping: 1 });
    } catch (error) {
      throw sanitizedFailure("CONNECTION_FAILED", error);
    }
  }

  async findOne<T extends ReadOnlyDocument>(
    collectionName: string,
    filter: ReadOnlyFilter,
    projection: ReadOnlyProjection,
  ): Promise<T | null> {
    try {
      return (await this.db
        .collection<Document>(assertCollectionName(collectionName))
        .findOne(filter as Filter<Document>, { projection })) as T | null;
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
    try {
      return (await this.db
        .collection<Document>(assertCollectionName(collectionName))
        .find(filter as Filter<Document>, {
          projection: options.projection,
        } as FindOptions<Document>)
        .sort(options.sort)
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
    try {
      return await this.db
        .collection<Document>(assertCollectionName(collectionName))
        .countDocuments(filter as Filter<Document>);
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
    try {
      return (await this.db
        .collection<Document>(assertCollectionName(collectionName))
        .distinct(field, filter as Filter<Document>)) as T[];
    } catch (error) {
      throw sanitizedFailure("READ_FAILED", error);
    }
  }

  async aggregate<T extends ReadOnlyDocument>(
    collectionName: string,
    pipeline: readonly ReadOnlyDocument[],
    options: ReadOnlyAggregateOptions = {},
  ): Promise<readonly T[]> {
    assertReadOnlyAggregatePipeline(pipeline);
    try {
      return (await this.db
        .collection<Document>(assertCollectionName(collectionName))
        .aggregate(pipeline as Document[], {
          allowDiskUse: false,
          maxTimeMS: options.maxTimeMS ?? 10_000,
        })
        .toArray()) as T[];
    } catch (error) {
      throw sanitizedFailure("READ_FAILED", error);
    }
  }
}

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
