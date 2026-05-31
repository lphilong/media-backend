import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertPiISafeOutput,
  buildRecommendationHints,
  createSampleKpiAllocationDataSmokeReport,
  formatKpiAllocationDataSmokeReport,
  parseKpiAllocationDataSmokeCliOptions,
} from "./kpi-allocation-data-smoke";

const NOW = Date.UTC(2026, 4, 15, 0, 0, 0);

test("KPI smoke recommendation hints classify ACTIVE posture", () => {
  assert.deepEqual(
    buildRecommendationHints({
      allocationStatusCounts: [{ allocationStatus: "PUBLISHED", count: 2 }],
      activeAndPublishedByPlanStatusPeriod: [],
      activeAllocationActualEntryCount: 0,
      now: NOW,
    }),
    ["PUBLISHED-only posture appears data-safe: ACTIVE count is 0."],
  );

  const hints = buildRecommendationHints({
    allocationStatusCounts: [{ allocationStatus: "ACTIVE", count: 1 }],
    activeAndPublishedByPlanStatusPeriod: [
      {
        allocationStatus: "ACTIVE",
        planStatus: "PUBLISHED",
        periodMonth: "2026-05",
        periodStartAt: NOW,
        periodEndAt: NOW,
        count: 1,
      },
    ],
    activeAllocationActualEntryCount: 2,
    now: NOW,
  });
  assert.match(hints[0] ?? "", /migration vs grandfather/u);
  assert.match(hints[1] ?? "", /current period/u);
});

test("KPI smoke sample mode is DB-free and PII-safe", async () => {
  const options = parseKpiAllocationDataSmokeCliOptions([
    "--sample",
    "--json",
  ]);
  assert.equal(options.sample, true);
  assert.equal(options.readOnly, false);

  const output = formatKpiAllocationDataSmokeReport(
    await createSampleKpiAllocationDataSmokeReport(NOW),
  );
  assert.match(output, /activeAllocationSamples/u);
  assert.doesNotMatch(output, /snapshotMemberDisplayName/u);
  assert.doesNotMatch(output, /actualValue/u);
});

test("KPI smoke requires explicit read-only DB mode", () => {
  assert.throws(
    () =>
      parseKpiAllocationDataSmokeCliOptions([
        "--env-file",
        ".env.dev",
      ]),
    /requires explicit --read-only/u,
  );
  assert.equal(
    parseKpiAllocationDataSmokeCliOptions([
      "--env-file",
      ".env.dev",
      "--read-only",
    ]).readOnly,
    true,
  );
});

test("KPI smoke rejects write-like flags", () => {
  for (const flag of [
    "--write",
    "--fix",
    "--repair",
    "--migrate",
    "--cleanup",
  ]) {
    assert.throws(
      () => parseKpiAllocationDataSmokeCliOptions(["--sample", flag]),
      /Write-like flag is forbidden/u,
    );
  }
});

test("KPI smoke PII allowlist fails closed", () => {
  assert.throws(
    () => assertPiISafeOutput({ snapshotMemberDisplayName: "private" }),
    /Forbidden KPI smoke output field/u,
  );
});
