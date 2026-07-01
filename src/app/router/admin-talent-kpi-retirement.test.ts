import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("Admin router does not mount retired Talent KPI routes", async () => {
  const source = await readFile(
    join(process.cwd(), "src/app/router/admin.routes.ts"),
    "utf8",
  );

  assert.equal(source.includes("/talent-kpi-records"), false);
  assert.equal(source.includes("adminTalentKpiRoutes"), false);
});
