import {
  MongoClient,
  Db,
  MongoClientOptions,
  ReadPreference,
} from "mongodb";
import { InfrastructureError } from "@infra/errors/infrastructure.error";
import { env } from "@config/env";

export interface MongoRuntime {
  readonly client: MongoClient;
  readonly primaryDb: Db;
  readonly secondaryDb: Db;
}

const MONGO_SERVER_SELECTION_TIMEOUT_MS = 10_000;
const MONGO_CONNECT_TIMEOUT_MS = 10_000;
const MONGO_SOCKET_TIMEOUT_MS = 30_000;

function parsePoolSize(): number {
  const parsed = env.MONGO_MAX_POOL_SIZE;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InfrastructureError(
      "INVALID_MONGO_POOL_SIZE",
      "MONGO_MAX_POOL_SIZE must be positive integer",
    );
  }

  return parsed;
}

function buildMongoOptions(): MongoClientOptions {
  return {
    maxPoolSize: parsePoolSize(),
    retryReads: true,
    retryWrites: true,
    serverSelectionTimeoutMS:
      MONGO_SERVER_SELECTION_TIMEOUT_MS,
    connectTimeoutMS: MONGO_CONNECT_TIMEOUT_MS,
    socketTimeoutMS: MONGO_SOCKET_TIMEOUT_MS,
  };
}

async function verifyPrimaryReadiness(
  primaryDb: Db,
): Promise<void> {
  try {
    await primaryDb.command({ ping: 1 });
  } catch (error) {
    throw new InfrastructureError(
      "MONGO_BOOTSTRAP_PING_FAILED",
      "Mongo primary readiness ping failed",
    );
  }
}

async function closeClientSafely(
  client: MongoClient,
): Promise<void> {
  try {
    await client.close();
  } catch {
    // Bootstrap failure path must remain deterministic.
  }
}

export async function createMongoRuntime(): Promise<MongoRuntime> {
  const uri = env.MONGO_URI;
  const dbName = env.MONGO_DB_NAME;

  if (!uri || !dbName) {
    throw new InfrastructureError(
      "MONGO_CONFIG_MISSING",
      "Mongo URI or DB name is not configured",
    );
  }

  const client = new MongoClient(uri, buildMongoOptions());

  try {
    await client.connect();

    const primaryDb = client.db(dbName, {
      readPreference: ReadPreference.primary,
    });

    await verifyPrimaryReadiness(primaryDb);

    const secondaryDb = client.db(dbName, {
      readPreference: ReadPreference.secondaryPreferred,
    });

    return Object.freeze({
      client,
      primaryDb,
      secondaryDb,
    });
  } catch (error) {
    await closeClientSafely(client);

    if (error instanceof InfrastructureError) {
      throw error;
    }

    throw new InfrastructureError(
      "MONGO_RUNTIME_BOOTSTRAP_FAILED",
      error instanceof Error
        ? `Mongo runtime bootstrap failed: ${error.message}`
        : "Mongo runtime bootstrap failed",
    );
  }
}

export async function closeMongoRuntime(
  runtime: Pick<MongoRuntime, "client">,
): Promise<void> {
  await runtime.client.close();
}