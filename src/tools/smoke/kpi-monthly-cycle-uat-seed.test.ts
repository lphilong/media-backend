import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildKpiMonthlyCycleUatSeedPlan,
  formatPublicSeedPlan,
  parseKpiMonthlyCycleUatSeedCliOptions,
  toPublicSeedPlan,
  validateSeedWriteEnv,
} from "./kpi-monthly-cycle-uat-seed";

const NOW = Date.UTC(2026, 4, 15, 0, 0, 0);

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    ALLOW_KPI_UAT_SEED: "true",
    NODE_ENV: "development",
    APP_ENV: "development",
    MONGO_URI: "mongodb://localhost:27017/media_dev",
    MONGO_DB_NAME: "media_dev",
    ...overrides,
  };
}

test("KPI UAT seed CLI defaults to dry-run monthly-cycle", () => {
  assert.deepEqual(parseKpiMonthlyCycleUatSeedCliOptions([]), {
    mode: "dry-run",
    scenario: "monthly-cycle",
    seedKey: "KPI-UAT",
    includeLegacyActive: false,
    json: false,
    help: false,
  });
});

test("KPI UAT seed write requires env file and rejects production override", () => {
  assert.throws(
    () => parseKpiMonthlyCycleUatSeedCliOptions(["--write"]),
    /requires --env-file/u,
  );
  assert.throws(
    () =>
      parseKpiMonthlyCycleUatSeedCliOptions([
        "--write",
        "--env-file",
        ".env.dev",
        "--allow-production",
      ]),
    /Production write is forbidden/u,
  );
});

test("KPI UAT seed write env refuses production-looking targets", () => {
  assert.throws(
    () =>
      validateSeedWriteEnv(
        baseEnv({
          NODE_ENV: "production",
          MONGO_DB_NAME: "media_prod",
        }),
        ".env.dev",
      ),
    /Production write is forbidden/u,
  );
  assert.equal(
    validateSeedWriteEnv(
      baseEnv({
        NODE_ENV: "development",
        APP_ENV: "staging",
        MONGO_DB_NAME: "media_staging",
      }),
      ".env.staging",
    ).mongoDbName,
    "media_staging",
  );
});

test("KPI UAT seed dry-run plan covers monthly lifecycle and published actual", () => {
  const plan = buildKpiMonthlyCycleUatSeedPlan({
    seedKey: "KPI-UAT",
    now: NOW,
    includeLegacyActive: true,
  });
  const publicPlan = toPublicSeedPlan(plan, "dry-run");
  assert.equal(publicPlan.periodMonth, "2026-05");
  assert.deepEqual(publicPlan.allocationStatuses, [
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "PUBLISHED",
    "REJECTED",
    "ACTIVE",
  ]);
  assert.equal(publicPlan.countsByCollection.kpi_actual_entries, 1);
  assert.equal(
    plan.records.find(
      (record) => record.collection === "kpi_actual_entries",
    )?.document.actualDate,
    "01-05-2026",
  );
  assert.equal(
    publicPlan.countsByCollection.talent_group_manager_assignments,
    1,
  );
});

test("KPI UAT dry-run output exposes summaries only", () => {
  const output = formatPublicSeedPlan(
    toPublicSeedPlan(
      buildKpiMonthlyCycleUatSeedPlan({
        seedKey: "KPI-UAT",
        now: NOW,
      }),
      "dry-run",
    ),
  );
  assert.match(output, /plannedRecords/u);
  for (const forbidden of [
    "legalName",
    "snapshotMemberDisplayName",
    "actualValue",
    "linkedUserId",
    "createdByActorId",
  ]) {
    assert.doesNotMatch(output, new RegExp(forbidden, "u"));
  }
});

test("KPI package scripts do not embed runtime modes", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    readonly scripts?: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts?.["kpi:allocation-data-smoke"],
    "ts-node -r tsconfig-paths/register src/tools/diagnostics/kpi-allocation-data-smoke.ts",
  );
  assert.equal(
    packageJson.scripts?.["kpi:monthly-cycle-uat-seed"],
    "ts-node -r tsconfig-paths/register src/tools/smoke/kpi-monthly-cycle-uat-seed.ts",
  );
  assert.doesNotMatch(
    packageJson.scripts?.["kpi:monthly-cycle-uat-seed"] ?? "",
    /--write/u,
  );
});
