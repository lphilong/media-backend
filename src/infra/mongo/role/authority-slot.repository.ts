import { ClientSession, Collection, Db, MongoServerError } from "mongodb";
import {
  AuthoritySlotRecord,
  AuthoritySlotReleaseResult,
  AuthoritySlotReservationCommand,
  planAuthoritySlotRelease,
  planAuthoritySlotReservation,
  planAuthoritySlotScheduledRelease,
} from "@modules/role/domain/authority-slot";
import { RoleAssignmentConflictError } from "@modules/role/domain/role.errors";

interface AuthoritySlotDocument extends Omit<AuthoritySlotRecord, "id"> {
  readonly _id: string;
}

export class NativeMongoAuthoritySlotRepository {
  private readonly slots: Collection<AuthoritySlotDocument>;

  constructor(db: Db) {
    this.slots = db.collection<AuthoritySlotDocument>(
      "role_assignment_authority_slots",
    );
  }

  async reserve(
    command: AuthoritySlotReservationCommand,
    session: ClientSession,
  ): Promise<AuthoritySlotRecord> {
    let existing = await this.findById(command.id, session);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const plan = planAuthoritySlotReservation(existing, command);
      if (plan.kind === "IDEMPOTENT") return plan.record;
      if (plan.kind === "INSERT") {
        try {
          await this.slots.insertOne(toDocument(plan.record), { session });
          return plan.record;
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          existing = await this.findById(command.id, session);
          continue;
        }
      }
      const updated = await this.slots.updateOne(
        { _id: command.id, version: plan.expectedVersion },
        { $set: toSetFields(plan.record) },
        { session },
      );
      if (updated.modifiedCount === 1) return plan.record;
      existing = await this.findById(command.id, session);
    }
    throw new RoleAssignmentConflictError("AUTHORITY_SLOT_CONCURRENT_WRITE");
  }

  async releaseAssignment(
    slotId: string,
    assignmentId: string,
    transitionIdentity: string,
    now: number,
    session: ClientSession,
  ): Promise<AuthoritySlotReleaseResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await this.findById(slotId, session);
      if (!existing) return "NO_OP";
      const plan = planAuthoritySlotRelease(
        existing,
        assignmentId,
        transitionIdentity,
        now,
      );
      if (plan.kind === "NO_OP") return plan.result;
      const updated = await this.slots.updateOne(
        { _id: slotId, version: plan.expectedVersion },
        { $set: toSetFields(plan.record) },
        { session },
      );
      if (updated.modifiedCount === 1) return plan.result;
    }
    throw new RoleAssignmentConflictError("AUTHORITY_SLOT_CONCURRENT_WRITE");
  }

  async scheduleRelease(
    slotId: string,
    expectedEffectiveAssignmentId: string,
    releaseAt: number,
    transitionIdentity: string,
    now: number,
    session: ClientSession,
  ): Promise<"SCHEDULED" | "IDEMPOTENT"> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await this.findById(slotId, session);
      const plan = planAuthoritySlotScheduledRelease(
        existing,
        expectedEffectiveAssignmentId,
        releaseAt,
        transitionIdentity,
        now,
      );
      if (plan.kind === "IDEMPOTENT") return "IDEMPOTENT";
      const updated = await this.slots.updateOne(
        { _id: slotId, version: plan.expectedVersion },
        { $set: toSetFields(plan.record) },
        { session },
      );
      if (updated.modifiedCount === 1) return "SCHEDULED";
    }
    throw new RoleAssignmentConflictError("AUTHORITY_SLOT_CONCURRENT_WRITE");
  }

  async findById(
    id: string,
    session?: ClientSession,
  ): Promise<AuthoritySlotRecord | null> {
    const found = await this.slots.findOne(
      { _id: id },
      session ? { session } : {},
    );
    return found ? fromDocument(found) : null;
  }
}

function toDocument(record: AuthoritySlotRecord): AuthoritySlotDocument {
  const { id, ...rest } = record;
  return { _id: id, ...rest };
}

function fromDocument(document: AuthoritySlotDocument): AuthoritySlotRecord {
  const { _id, ...rest } = document;
  return { id: _id, ...rest };
}

function toSetFields(
  record: AuthoritySlotRecord,
): Omit<AuthoritySlotDocument, "_id" | "createdAt"> {
  const { id: _id, createdAt: _createdAt, ...fields } = record;
  return fields;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    (error instanceof MongoServerError && error.code === 11000) ||
    (typeof error === "object" && error !== null && "code" in error &&
      (error as { readonly code?: unknown }).code === 11000)
  );
}
