import { Collection, Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import { DomainEventOutbox } from "./outbox.types";

/**
 * Mongo collection name
 */
export const DOMAIN_EVENT_OUTBOX_COLLECTION =
  "domain_event_outbox";

const OUTBOX_EVENT_ID_UNIQUE_INDEX_NAME = "uniq_eventId";

const OUTBOX_VALIDATOR = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "eventId",
      "aggregateId",
      "aggregateVersion",
      "type",
      "version",
      "payload",
      "occurredAt",
      "traceId",
      "status",
      "attempts",
      "maxAttempts",
      "createdAt",
    ],
    properties: {
      eventId: { bsonType: "string", minLength: 1 },
      aggregateId: { bsonType: "string", minLength: 1 },
      aggregateVersion: { bsonType: "number" },
      type: { bsonType: "string", minLength: 1 },
      version: { bsonType: "number" },
      payload: { bsonType: "object" },
      occurredAt: { bsonType: "number" },
      traceId: { bsonType: "string", minLength: 1 },
      status: {
        enum: [
          "PENDING",
          "PROCESSING",
          "RETRY",
          "DISPATCHED",
          "FAILED_FINAL",
        ],
      },
      attempts: { bsonType: "number" },
      maxAttempts: { bsonType: "number" },
      nextAttemptAt: { bsonType: "number" },
      lockedAt: { bsonType: "number" },
      lockedBy: { bsonType: "string" },
      lastError: {
        bsonType: "object",
        required: ["message", "at"],
        properties: {
          message: { bsonType: "string" },
          at: { bsonType: "number" },
        },
      },
      trace: { bsonType: "object" },
      createdAt: { bsonType: "number" },
      dispatchedAt: { bsonType: "number" },
    },
  },
} as const;

/**
 * Initialize Outbox collection & indexes
 * Must be called once at bootstrap (idempotent)
 */
export async function initDomainEventOutbox(
  db: Db,
): Promise<Collection<DomainEventOutbox>> {
  const collection = await ensureValidatedOutboxCollection(db);

  await collection.createIndex(
    { eventId: 1 },
    {
      unique: true,
      name: OUTBOX_EVENT_ID_UNIQUE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { status: 1, createdAt: 1 },
    { name: "idx_status_createdAt" },
  );

  await collection.createIndex(
    { status: 1, nextAttemptAt: 1 },
    { name: "idx_status_nextAttemptAt" },
  );

  await collection.createIndex(
    { lockedAt: 1 },
    { name: "idx_lockedAt" },
  );

  await collection.createIndex(
    {
      status: 1,
      attempts: 1,
      nextAttemptAt: 1,
      lockedAt: 1,
      createdAt: 1,
    },
    {
      name: "idx_claim_optimization",
    },
  );

  await assertUniqueEventIdIndex(collection);

  return collection;
}

async function ensureValidatedOutboxCollection(
  db: Db,
): Promise<Collection<DomainEventOutbox>> {
  const exists = await db
    .listCollections(
      { name: DOMAIN_EVENT_OUTBOX_COLLECTION },
      { nameOnly: true },
    )
    .hasNext();

  if (!exists) {
    await db.createCollection(
      DOMAIN_EVENT_OUTBOX_COLLECTION,
      {
        validator: OUTBOX_VALIDATOR,
        validationLevel: "strict",
        validationAction: "error",
      },
    );
  } else {
    await db.command({
      collMod: DOMAIN_EVENT_OUTBOX_COLLECTION,
      validator: OUTBOX_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error",
    });
  }

  return db.collection<DomainEventOutbox>(
    DOMAIN_EVENT_OUTBOX_COLLECTION,
  );
}

async function assertUniqueEventIdIndex(
  collection: Collection<DomainEventOutbox>,
): Promise<void> {
  const indexes = await collection.indexes();

  const matched = indexes.find((index) => {
    const name =
      typeof index.name === "string"
        ? index.name
        : undefined;

    return name === OUTBOX_EVENT_ID_UNIQUE_INDEX_NAME;
  });

  if (!matched) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${OUTBOX_EVENT_ID_UNIQUE_INDEX_NAME} missing on ${DOMAIN_EVENT_OUTBOX_COLLECTION}`,
    );
  }

  if (matched.unique !== true) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${OUTBOX_EVENT_ID_UNIQUE_INDEX_NAME} on ${DOMAIN_EVENT_OUTBOX_COLLECTION} must be unique`,
    );
  }

  if (!hasExactKeyShape(matched.key, { eventId: 1 })) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${OUTBOX_EVENT_ID_UNIQUE_INDEX_NAME} on ${DOMAIN_EVENT_OUTBOX_COLLECTION} has invalid key shape`,
    );
  }
}

function hasExactKeyShape(
  candidate: unknown,
  expected: Record<string, number>,
): boolean {
  if (
    typeof candidate !== "object" ||
    candidate === null
  ) {
    return false;
  }

  const candidateRecord = candidate as Record<
    string,
    unknown
  >;

  const expectedEntries =
    Object.entries(expected);

  if (
    Object.keys(candidateRecord).length !==
    expectedEntries.length
  ) {
    return false;
  }

  for (const [field, direction] of expectedEntries) {
    if (candidateRecord[field] !== direction) {
      return false;
    }
  }

  return true;
}
