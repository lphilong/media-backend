import assert from "node:assert/strict";
import test from "node:test";
import type { ClientSession, Db, MongoClient } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuditContext, runWithAuditContext } from "@core/audit/audit.context";
import { AuditGuard } from "@core/audit/audit.guard";
import { MongoAuditLogger } from "@core/audit/mongo.audit.logger";
import { MongoAuditWriteRepository } from "@infra/mongo/audit/audit.write.repository";
import { Permission } from "@core/permission/permission.enum";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { bindTraceId } from "@core/trace/trace.context";
import { getCurrentDomainEventCollector } from "@system/event-bridge/domain-event.types";
import { createBreakGlassDeadlineExpiredEvent } from "@modules/role/domain/role.events";
import { issueAccessDeadlineWorkerInvocationForRegistrar } from "./authoritative-system-mutation.policy";
import { MongoAuthoritativeAdminMutationBridge } from "./mongo-authoritative-admin-mutation.bridge";

type Doc = Record<string, any> & { _id?: string };

class FakeCollection {
  records: Doc[] = [];
  failInsert = false;
  async insertOne(record: Doc): Promise<{ insertedId: string }> {
    if (this.failInsert) {
      this.failInsert = false;
      throw new Error("INJECTED_AUDIT_STORAGE_FAILURE");
    }
    const copy = structuredClone(record);
    this.records.push(copy);
    return { insertedId: String(copy._id) };
  }
  async insertMany(records: Doc[]): Promise<void> {
    this.records.push(...structuredClone(records));
  }
  async findOne(query: Record<string, unknown>): Promise<Doc | null> {
    return this.records.find((record) => matches(record, query)) ?? null;
  }
  async updateOne(
    query: Record<string, unknown>,
    update: Record<string, any>,
    options?: { upsert?: boolean },
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    let record = this.records.find((candidate) => matches(candidate, query));
    if (!record && options?.upsert) {
      record = { ...query };
      this.records.push(record);
      Object.assign(record, structuredClone(update.$setOnInsert ?? {}));
    }
    if (!record) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(record, structuredClone(update.$set ?? {}));
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async countDocuments(query: Record<string, unknown>): Promise<number> {
    return this.records.filter((record) => matches(record, query)).length;
  }
}

class FakeDb {
  collections = new Map<string, FakeCollection>();
  collection(name: string): FakeCollection {
    let value = this.collections.get(name);
    if (!value) { value = new FakeCollection(); this.collections.set(name, value); }
    return value;
  }
  snapshot(): Map<string, Doc[]> {
    return new Map([...this.collections].map(([name, collection]) => [name, structuredClone(collection.records)]));
  }
  restore(snapshot: Map<string, Doc[]>): void {
    for (const collection of this.collections.values()) {
      collection.records = [];
    }
    for (const [name, records] of snapshot) this.collection(name).records = structuredClone(records);
  }
  asDb(): Db { return this as unknown as Db; }
}

class FakeSession {
  private active = false;
  private snapshot?: Map<string, Doc[]>;
  constructor(private db: FakeDb) {}
  startTransaction(): void { this.snapshot = this.db.snapshot(); this.active = true; }
  async commitTransaction(): Promise<void> { this.active = false; }
  async abortTransaction(): Promise<void> {
    if (this.snapshot) this.db.restore(this.snapshot);
    this.active = false;
  }
  inTransaction(): boolean { return this.active; }
  async endSession(): Promise<void> {}
}

test("existing ADMIN and narrow SYSTEM mutations share the authoritative transaction executor", async () => {
  const db = new FakeDb();
  const bridge = createBridge(db);
  const audit = createAudit(db);
  const adminActor = new Actor({
    id: "admin-1", type: "admin", context: "ADMIN", roles: [],
    permissions: [Permission.ROLE_ASSIGNMENT_REVIEW], accountContexts: ["ADMIN_CONSOLE"], isActive: true,
  });
  const adminPermission = PermissionResolver.resolve(Permission.ROLE_ASSIGNMENT_REVIEW);
  await scoped("trace-admin", () => bridge.execute(
    {
      actor: adminActor,
      traceId: "trace-admin",
      requiredPermission: adminPermission,
      mutationIdentity: "role.assignment.review",
      mutationTargetDescriptor: "assignment-review:1",
    },
    async (session, controls) => {
      await db.collection("business").updateOne({ _id: "admin" }, { $set: { state: "DONE" } }, { upsert: true });
      await audit.record(adminActor, adminPermission, "target", { mutationType: "role.assignment.review" }, session);
      controls.markAuthSecurityTruthChanged();
      return "ADMIN_OK";
    },
  ));

  const invocation = issueAccessDeadlineWorkerInvocationForRegistrar("job-bridge");
  await scoped("trace-system", () => bridge.executeSystem(
    {
      actor: invocation.actor,
      invocation,
      traceId: "trace-system",
      mutationIdentity: "break-glass.deadline-expire",
      mutationTargetDescriptor: "deadline-break-glass:1",
      command: {
        kind: "BREAK_GLASS_DEADLINE_EXPIRE",
        activationId: "activation-1",
        candidateDeadline: 1,
        transitionId: "transition-1",
      },
    },
    async (session, controls, auditPermission) => {
      await db.collection("business").updateOne({ _id: "system" }, { $set: { state: "EXPIRED" } }, { upsert: true });
      await audit.record(invocation.actor, auditPermission, "target", { mutationType: "break-glass.deadline-expire" }, session);
      getCurrentDomainEventCollector().emit(createBreakGlassDeadlineExpiredEvent({
        activationId: "activation-1", targetUserId: "target", deadline: 1,
        transitionId: "transition-1", occurredAt: 1,
      }));
      controls.markAuthSecurityTruthChanged();
      return "SYSTEM_OK";
    },
  ));

  const audits = db.collection("audit_logs").records;
  assert.equal(audits.length, 2);
  assert.equal(audits[0]?.actorType, "admin");
  assert.equal(audits[1]?.actorType, "system");
  assert.equal(audits[1]?.actorId, "SYSTEM_ACCESS_DEADLINE_WORKER");
  assert.equal(audits[1]?.context, "SYSTEM");
  assert.equal(db.collection("domain_event_outbox").records.length, 1);
  assert.equal(db.collection("auth_security_versions").records.length, 1);
});

test("audit storage failure rolls back SYSTEM business state and security version", async () => {
  const db = new FakeDb();
  const bridge = createBridge(db);
  const audit = createAudit(db);
  const invocation = issueAccessDeadlineWorkerInvocationForRegistrar("job-rollback");
  db.collection("audit_logs").failInsert = true;
  await assert.rejects(
    scoped("trace-rollback", () => bridge.executeSystem(
      {
        actor: invocation.actor,
        invocation,
        traceId: "trace-rollback",
        mutationIdentity: "break-glass.deadline-expire",
        mutationTargetDescriptor: "deadline-break-glass:rollback",
        command: {
          kind: "BREAK_GLASS_DEADLINE_EXPIRE",
          activationId: "activation-rollback",
          candidateDeadline: 1,
          transitionId: "transition-rollback",
        },
      },
      async (session, controls, auditPermission) => {
        await db.collection("business").updateOne({ _id: "rollback" }, { $set: { state: "EXPIRED" } }, { upsert: true });
        await audit.record(invocation.actor, auditPermission, "target", { mutationType: "break-glass.deadline-expire" }, session);
        controls.markAuthSecurityTruthChanged();
        return true;
      },
    )),
    /Audit logging failed/u,
  );
  assert.equal(db.collection("business").records.length, 0);
  assert.equal(db.collection("auth_security_versions").records.length, 0);
  assert.equal(db.collection("audit_logs").records.length, 0);
});

function createBridge(db: FakeDb): MongoAuthoritativeAdminMutationBridge {
  const client = {
    startSession: () => new FakeSession(db) as unknown as ClientSession,
  } as unknown as MongoClient;
  return new MongoAuthoritativeAdminMutationBridge(client, db.asDb());
}

function createAudit(db: FakeDb): AuditGuard {
  return new AuditGuard(
    new MongoAuditLogger(new MongoAuditWriteRepository(db.asDb())),
    new AuditContext(),
  );
}

function scoped<T>(traceId: string, run: () => Promise<T>): Promise<T> {
  return bindTraceId(traceId, () => runWithAuditContext(run));
}

function getPath(value: any, path: string): unknown {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function matches(record: Doc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([path, expected]) => {
    const actual = getPath(record, path);
    if (typeof expected === "object" && expected !== null && "$in" in expected) {
      return (expected as { $in: unknown[] }).$in.includes(actual);
    }
    return actual === expected;
  });
}
