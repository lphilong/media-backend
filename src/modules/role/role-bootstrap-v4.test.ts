import assert from "node:assert/strict";
import test from "node:test";
import type { Db } from "mongodb";
import {
  AUTHORITY_SLOT_IDENTITY_INDEX_NAME,
  AUTHORITY_SLOT_RECLAIM_INDEX_NAME,
  FINAL_ROLE_INDEX_SPECS,
  ROLE_ACTIVE_ASSIGNMENT_UNIQ_INDEX,
  RoleSchemaMigrationRequiredError,
} from "@infra/mongo/role/role.index";
import { createRoleBootstrapRegistrar } from "./shared/role.bootstrap";

test("retained or unknown Role schema is mutation-free and missing final schema is typed migration-required", async () => {
  const db = new IndexCaptureDb();
  const registrar = createRoleBootstrapRegistrar();
  await registrar.initIndexes!(db.asDb());
  assert.equal(db.createCalls.length, 0);
  assert.equal(db.updateCalls, 0);
  assert.equal(db.dropCalls, 0);
  await assert.rejects(
    registrar.assertReadiness!(db.asDb()),
    (error: unknown) =>
      error instanceof RoleSchemaMigrationRequiredError &&
      error.migrationRequired &&
      /MIGRATION_REQUIRED role-authority-schema\/v4/u.test(error.message),
  );
});

test("proven-fresh creation and readiness consume the exact same canonical final specification", async () => {
  const db = new IndexCaptureDb();
  const registrar = createRoleBootstrapRegistrar({
    provenance: "PROVEN_FRESH_WAVE_1",
  });
  await registrar.initIndexes!(db.asDb());
  assert.deepEqual(
    db.createCalls.map((item) => ({ collection: item.collection, name: item.options.name })),
    FINAL_ROLE_INDEX_SPECS.map((item) => ({ collection: item.collection, name: item.name })),
  );
  assert.equal(db.updateCalls, 0);
  assert.equal(db.dropCalls, 0);
  await registrar.assertReadiness!(db.asDb());
  assert.ok(AUTHORITY_SLOT_IDENTITY_INDEX_NAME.endsWith("_v1"));
  assert.deepEqual(
    FINAL_ROLE_INDEX_SPECS.find(
      (item) => item.name === AUTHORITY_SLOT_RECLAIM_INDEX_NAME,
    )?.key,
    { status: 1, releaseAt: 1, _id: 1 },
  );
  assert.equal(
    FINAL_ROLE_INDEX_SPECS.some((item) => item.name === ROLE_ACTIVE_ASSIGNMENT_UNIQ_INDEX),
    false,
  );
});

test("legacy ACTIVE-only or ACTIVE/SUSPENDED assignment uniqueness cannot satisfy final readiness", async () => {
  for (const states of [["ACTIVE"], ["ACTIVE", "SUSPENDED"]]) {
    const db = new IndexCaptureDb();
    db.seedIndex("role_assignments", {
      name: ROLE_ACTIVE_ASSIGNMENT_UNIQ_INDEX,
      key: { roleId: 1, userId: 1, scopeFingerprint: 1 },
      unique: true,
      partialFilterExpression: {
        state: states.length === 1 ? states[0] : { $in: states },
      },
    });
    await assert.rejects(
      createRoleBootstrapRegistrar().assertReadiness!(db.asDb()),
      RoleSchemaMigrationRequiredError,
    );
  }
});

class IndexCaptureDb {
  readonly createCalls: Array<{
    collection: string;
    key: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];
  updateCalls = 0;
  dropCalls = 0;
  private readonly indexesByCollection = new Map<string, Array<Record<string, unknown>>>();

  collection(name: string) {
    return {
      createIndex: async (
        key: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        this.createCalls.push({ collection: name, key, options });
        this.seedIndex(name, { key, ...options });
        return String(options.name);
      },
      indexes: async () => structuredClone(this.indexesByCollection.get(name) ?? []),
      updateMany: async () => { this.updateCalls += 1; },
      dropIndex: async () => { this.dropCalls += 1; },
    };
  }

  seedIndex(collection: string, index: Record<string, unknown>): void {
    const current = this.indexesByCollection.get(collection) ?? [];
    current.push(structuredClone(index));
    this.indexesByCollection.set(collection, current);
  }

  asDb(): Db { return this as unknown as Db; }
}
