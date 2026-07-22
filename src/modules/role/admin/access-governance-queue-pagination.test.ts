import assert from "node:assert/strict";
import test from "node:test";
import {
  GOVERNANCE_QUEUE_MAXIMUM_CANDIDATES,
  scanBoundedVisibleQueue,
} from "./access-governance-queue-pagination";
import { AccessGovernanceQueueCursorCodec } from "./access-governance-queue-cursor";

type QueueRecord = { _id: string; requestedAt: number; visible: boolean };

class QueueCursor {
  constructor(private records: QueueRecord[]) {}
  sort(): this {
    this.records.sort((left, right) =>
      left.requestedAt - right.requestedAt || left._id.localeCompare(right._id));
    return this;
  }
  limit(value: number): this { this.records = this.records.slice(0, value); return this; }
  async toArray(): Promise<QueueRecord[]> { return structuredClone(this.records); }
}

class QueueCollection {
  calls = 0;
  constructor(private readonly records: QueueRecord[]) {}
  find(query: Record<string, unknown>): QueueCursor {
    this.calls += 1;
    return new QueueCursor(this.records.filter((record) => matches(record, query)));
  }
}

test("streaming queue finds visible rows after 100 hidden candidates and stops at limit plus one", async () => {
  const records = Array.from({ length: 300 }, (_, index) => ({
    _id: `record-${String(index).padStart(3, "0")}`,
    requestedAt: index,
    visible: index >= 100,
  }));
  const collection = new QueueCollection(records);
  const page = await scanBoundedVisibleQueue({
    collection: collection as never,
    baseFilter: {},
    sortField: "requestedAt",
    direction: 1,
    pageSize: 2,
    project: async (record) => record.visible ? { recordId: record._id } : null,
  });
  assert.deepEqual(page.items, [
    { recordId: "record-100" },
    { recordId: "record-101" },
  ]);
  assert.equal(page.exhausted, false);
  assert.ok(page.nextPosition);
  assert.equal(collection.calls, 2);

  const next = await scanBoundedVisibleQueue({
    collection: collection as never,
    baseFilter: {},
    sortField: "requestedAt",
    direction: 1,
    position: page.nextPosition,
    pageSize: 2,
    project: async (record) => record.visible ? { recordId: record._id } : null,
  });
  assert.deepEqual(next.items.map((item) => item.recordId), ["record-102", "record-103"]);
});

test("streaming queue stops at the fixed 500-candidate ceiling with honest continuation", async () => {
  const records = Array.from({ length: 700 }, (_, index) => ({
    _id: `hidden-${String(index).padStart(3, "0")}`,
    requestedAt: index,
    visible: false,
  }));
  const collection = new QueueCollection(records);
  let projected = 0;
  const page = await scanBoundedVisibleQueue({
    collection: collection as never,
    baseFilter: {},
    sortField: "requestedAt",
    direction: 1,
    pageSize: 25,
    project: async () => { projected += 1; return null; },
  });
  assert.equal(projected, GOVERNANCE_QUEUE_MAXIMUM_CANDIDATES);
  assert.equal(collection.calls, 5);
  assert.equal(page.exhausted, false);
  assert.ok(page.nextPosition);
});

test("cursor is confidential, expiring, and bound to actor queue permission query and page", () => {
  const codec = new AccessGovernanceQueueCursorCodec(Buffer.alloc(32, 7), 1_000);
  const binding = {
    actorId: "actor-secret-id",
    queue: "lifecycle:review",
    permission: "role:assignment:review",
    queryIdentity: "target-secret-id",
    pageSize: 25,
  };
  const token = codec.seal({ value: 1_234_567, id: "hidden-record-id" }, binding, 100);
  assert.equal(token.includes("hidden-record-id"), false);
  assert.equal(token.includes("1234567"), false);
  assert.deepEqual(codec.open(token, binding, 1_099), {
    value: 1_234_567,
    id: "hidden-record-id",
  });
  for (const mismatch of [
    { ...binding, actorId: "other" },
    { ...binding, queue: "lifecycle:grace" },
    { ...binding, permission: "other" },
    { ...binding, queryIdentity: "other" },
    { ...binding, pageSize: 50 },
  ]) {
    assert.throws(() => codec.open(token, mismatch, 1_099), /INVALID_QUEUE_CURSOR/u);
  }
  const tamperedFinalCharacter = token.endsWith("A") ? "Q" : "A";
  assert.throws(
    () => codec.open(`${token.slice(0, -1)}${tamperedFinalCharacter}`, binding, 1_099),
    /INVALID_QUEUE_CURSOR/u,
  );
  assert.throws(() => codec.open(token, binding, 1_100), /INVALID_QUEUE_CURSOR/u);
});

function matches(record: QueueRecord, query: Record<string, unknown>): boolean {
  if (Array.isArray(query.$and)) return query.$and.every((part) => matches(record, part));
  if (Array.isArray(query.$or)) return query.$or.some((part) => matches(record, part));
  return Object.entries(query).every(([key, expected]) => {
    if (key.startsWith("$")) return true;
    const actual = record[key as keyof QueueRecord];
    if (expected && typeof expected === "object") {
      const operators = expected as Record<string, unknown>;
      if ("$gt" in operators) {
        if (typeof actual === "number" && typeof operators.$gt === "number") {
          return actual > operators.$gt;
        }
        return typeof actual === "string" && typeof operators.$gt === "string" &&
          actual > operators.$gt;
      }
      if ("$lt" in operators) {
        if (typeof actual === "number" && typeof operators.$lt === "number") {
          return actual < operators.$lt;
        }
        return typeof actual === "string" && typeof operators.$lt === "string" &&
          actual < operators.$lt;
      }
    }
    return actual === expected;
  });
}
