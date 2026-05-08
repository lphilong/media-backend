import {
  ClientSession,
  Collection,
  Db,
  Filter,
  WithId,
} from "mongodb";
import {
  DomainEventOutbox,
  OutboxStatus,
} from "./outbox.types";
import {
  DOMAIN_EVENT_OUTBOX_COLLECTION,
} from "./outbox.schema";
import { SystemInvariantError } from "@core/error/system-error";

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

export class DomainEventOutboxRepository {
  private readonly collection: Collection<DomainEventOutbox>;
  private readonly lockTtlMs: number;

  constructor(
    db: Db,
    options?: { lockTtlMs?: number },
  ) {
    this.collection =
      db.collection<DomainEventOutbox>(
        DOMAIN_EVENT_OUTBOX_COLLECTION,
      );

    this.lockTtlMs =
      options?.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  }

  async insertMany(
    events: Omit<
      DomainEventOutbox,
      | "status"
      | "attempts"
      | "maxAttempts"
      | "createdAt"
    >[],
    session: ClientSession,
  ): Promise<void> {
    if (events.length === 0) return;

    const now = Date.now();

    const docs: DomainEventOutbox[] =
      events.map((e) => ({
        ...e,
        status: "PENDING",
        attempts: 0,
        maxAttempts: 5,
        createdAt: now,
      }));

    await this.collection.insertMany(docs, {
      session,
      ordered: true,
    });
  }

  async containsAll(
    eventIds: readonly string[],
  ): Promise<boolean> {
    if (eventIds.length === 0) {
      return false;
    }

    const observed = await this.collection.countDocuments(
      {
        eventId: { $in: [...eventIds] },
      },
      {
        limit: eventIds.length,
      },
    );

    return observed === eventIds.length;
  }

  /**
   * Atomic claim with:
   * - attempts < maxAttempts
   * - TTL reclaim
   * - FIFO ordering
   */
async claimNext(
  workerId: string,
): Promise<WithId<DomainEventOutbox> | null> {
  const now = Date.now();
  const lockExpiry = now - this.lockTtlMs;

  const filter: Filter<DomainEventOutbox> = {
    $and: [
      {
        $expr: {
          $lt: ["$attempts", "$maxAttempts"],
        },
      },
      {
        $or: [
          { status: "PENDING" },
          { status: "RETRY", nextAttemptAt: { $lte: now } },
          {
            status: "PROCESSING",
            lockedAt: { $lte: lockExpiry },
          },
        ],
      },
    ],
  };

  const record = await this.collection.findOneAndUpdate(
    filter,
    {
      $set: {
        status: "PROCESSING" as OutboxStatus,
        lockedAt: now,
        lockedBy: workerId,
      },
    },
    {
      sort: { createdAt: 1 },
      returnDocument: "after",
    },
  );

  return record ?? null;
}


  async markDispatched(
    eventId: string,
    workerId: string,
  ): Promise<void> {
    const result = await this.collection.updateOne(
      {
        eventId,
        status: "PROCESSING",
        lockedBy: workerId,
      },
      {
        $set: {
          status: "DISPATCHED",
          dispatchedAt: Date.now(),
        },
      },
    );

    if (result.modifiedCount !== 1) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "OUTBOX_MARK_DISPATCHED_OWNERSHIP_MISMATCH",
      );
    }
  }

  async markRetry(
    record: DomainEventOutbox,
    workerId: string,
    error: Error,
    nextAttemptAt: number,
  ): Promise<void> {
    const result = await this.collection.updateOne(
      {
        eventId: record.eventId,
        status: "PROCESSING",
        lockedBy: workerId,
      },
      {
        $inc: { attempts: 1 },
        $set: {
          status: "RETRY",
          nextAttemptAt,
          lastError: {
            message: error.message,
            at: Date.now(),
          },
        },
      },
    );

    if (result.modifiedCount !== 1) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "OUTBOX_MARK_RETRY_OWNERSHIP_MISMATCH",
      );
    }
  }

  async markFailedFinal(
    record: DomainEventOutbox,
    workerId: string,
    error: Error,
  ): Promise<void> {
    const result = await this.collection.updateOne(
      {
        eventId: record.eventId,
        status: "PROCESSING",
        lockedBy: workerId,
      },
      {
        $inc: { attempts: 1 },
        $set: {
          status: "FAILED_FINAL",
          lastError: {
            message: error.message,
            at: Date.now(),
          },
        },
      },
    );

    if (result.modifiedCount !== 1) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "OUTBOX_MARK_FAILED_FINAL_OWNERSHIP_MISMATCH",
      );
    }
  }
}
