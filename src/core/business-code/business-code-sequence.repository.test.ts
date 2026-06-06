import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientSession } from "mongodb";
import {
  buildGeneratedBusinessCodeRegex,
  formatBusinessCode,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import { NativeMongoBusinessCodeSequenceRepository } from "@infra/mongo/business-code/business-code-sequence.repository";

test("business code helpers format, parse, and match generated values", () => {
  const policy = {
    moduleKey: "talent",
    bucket: "global",
    prefix: "TAL",
    width: 6,
  };

  assert.equal(formatBusinessCode(policy, 7), "TAL-000007");
  assert.equal(
    parseGeneratedBusinessCodeSequence("TAL-000123", policy),
    123,
  );
  assert.equal(
    parseGeneratedBusinessCodeSequence("TAL-CUSTOM", policy),
    null,
  );
  assert.equal(
    buildGeneratedBusinessCodeRegex(policy).test("TAL-000001"),
    true,
  );
  assert.equal(
    buildGeneratedBusinessCodeRegex(policy).test("EP-000001"),
    false,
  );
});

test("Mongo business code sequence repository uses module:bucket identity and propagates session", async () => {
  const session = { id: "session-1" } as unknown as ClientSession;
  const calls: unknown[] = [];
  const db = {
    collection(name: string) {
      assert.equal(name, "business_code_sequences");
      return {
        async findOneAndUpdate(
          filter: unknown,
          update: unknown,
          options: unknown,
        ) {
          calls.push({ filter, update, options });
          return { value: 42 };
        },
        async updateOne() {
          throw new Error("updateOne should not be called");
        },
      };
    },
  };
  const repository = new NativeMongoBusinessCodeSequenceRepository(
    db as never,
  );

  const next = await repository.allocateNext(
    "platform-account",
    "global",
    session,
  );

  assert.equal(next, 42);
  assert.deepEqual(calls[0], {
    filter: { _id: "platform-account:global" },
    update: {
      $inc: { value: 1 },
      $set: { updatedAt: (calls[0] as { update: { $set: { updatedAt: number } } }).update.$set.updatedAt },
      $setOnInsert: {
        module: "platform-account",
        bucket: "global",
        createdAt: (calls[0] as { update: { $setOnInsert: { createdAt: number } } }).update.$setOnInsert.createdAt,
      },
    },
    options: {
      session,
      upsert: true,
      returnDocument: "after",
    },
  });
});
