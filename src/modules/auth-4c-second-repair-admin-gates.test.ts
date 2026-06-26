import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const HELPER_FILES: readonly string[] = [
  "src/modules/revenue-ledger/admin/admin.revenue-ledger.service.ts",
  "src/modules/revenue-ledger/admin/admin.revenue-ledger.query-service.ts",
  "src/modules/commission/admin/admin.commission.service.ts",
  "src/modules/commission/admin/admin.commission.query-service.ts",
  "src/modules/work-schedule/admin/admin.monthly-roster.service.ts",
  "src/modules/work-schedule/admin/admin.monthly-roster.query-service.ts",
  "src/modules/work-schedule/admin/admin.work-schedule.service.ts",
  "src/modules/work-schedule/admin/admin.work-schedule.query-service.ts",
  "src/modules/work-schedule/admin/admin.work-schedule-request.service.ts",
  "src/modules/work-schedule/admin/admin.work-schedule-request-batch.service.ts",
  "src/modules/work-schedule/admin/admin.work-pattern.service.ts",
  "src/modules/work-schedule/admin/admin.work-pattern.query-service.ts",
  "src/modules/work-schedule/admin/admin.holiday-calendar.service.ts",
  "src/modules/work-schedule/admin/admin.holiday-calendar.query-service.ts",
  "src/modules/contract-registry/admin/admin.contract-registry.service.ts",
  "src/modules/contract-registry/admin/admin.contract-registry.query-service.ts",
  "src/modules/contract-registry/admin/admin.contract-obligation.service.ts",
  "src/modules/contract-registry/admin/admin.contract-obligation-event-evidence-link.service.ts",
  "src/modules/event-assignment/admin/admin.event-assignment.service.ts",
  "src/modules/event-assignment/admin/admin.event-assignment.query-service.ts",
  "src/modules/studio-resource/admin/admin.studio-resource.service.ts",
  "src/modules/studio-resource/admin/admin.studio-resource.query-service.ts",
  "src/modules/dashboard-lite/admin/admin.dashboard-lite.query-service.ts",
  "src/modules/kpi/admin/admin.kpi.service.ts",
  "src/modules/talent-kpi/admin/admin.talent-kpi.service.ts",
  "src/modules/talent-kpi/admin/admin.talent-kpi.query-service.ts",
];

const DIRECT_GATE_FILES: readonly string[] = [
  "src/modules/revenue-ledger/admin/admin.platform-earning.service.ts",
  "src/modules/work-schedule/admin/admin.work-schedule-availability-batch.service.ts",
  "src/modules/contract-registry/admin/admin.contract-obligation.query-service.ts",
  "src/modules/contract-registry/admin/admin.contract-obligation-event-evidence-link.query-service.ts",
];

test("AUTH-4C second repair module-local admin helpers do not authorize from actor.type", () => {
  for (const relativePath of HELPER_FILES) {
    const source = readSource(relativePath);
    const helpers = source.match(
      /function assertAdminActorType[\s\S]*?\n\}/gu,
    );
    assert.ok(helpers?.length, `${relativePath} has no local admin helper`);

    for (const helper of helpers) {
      assert.match(
        helper,
        /PermissionGuard\.assertAdminActor\(actor\)/u,
        `${relativePath} helper must delegate to the shared admin-console guard`,
      );
      assert.doesNotMatch(
        helper,
        /actor\.type|actor\.context/u,
        `${relativePath} helper must not inspect actor.type or actor.context locally`,
      );
    }
  }
});

test("AUTH-4C second repair direct module admin gates use shared admin guard", () => {
  for (const relativePath of DIRECT_GATE_FILES) {
    const source = readSource(relativePath);
    assert.match(
      source,
      /PermissionGuard\.assertAdminActor\(actor\)/u,
      `${relativePath} must require shared admin-console guard`,
    );
    assert.doesNotMatch(
      source,
      /actor\.type\s*[!=]==?\s*["']admin["']|requires actor\.type admin/u,
      `${relativePath} must not contain direct actor.type admin gate`,
    );
  }
});

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}
