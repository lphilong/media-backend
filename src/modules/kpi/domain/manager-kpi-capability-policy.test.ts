import assert from "node:assert/strict";
import test from "node:test";
import { Permission } from "@core/permission/permission.enum";
import { projectManagerKpiCapabilities } from "./manager-kpi-capability-policy";

test("Manager KPI capabilities keep Allocation and Actual authority independent", () => {
  const actualOnly = projectManagerKpiCapabilities(
    new Set([Permission.KPI_ENTER_ACTUAL]),
  );
  assert.equal(actualOnly.enterActual, true);
  assert.equal(actualOnly.manageAllocation, false);

  const allocationOnly = projectManagerKpiCapabilities(
    new Set([Permission.KPI_MANAGE_ALLOCATION]),
  );
  assert.equal(allocationOnly.manageAllocation, true);
  assert.equal(allocationOnly.enterActual, false);
  assert.equal(allocationOnly.approveAllocation, false);
});

test("Manager KPI approval is a separate permission", () => {
  const capabilities = projectManagerKpiCapabilities(
    new Set([Permission.KPI_APPROVE_ALLOCATION]),
  );
  assert.equal(capabilities.approveAllocation, true);
  assert.equal(capabilities.manageAllocation, false);
  assert.equal(capabilities.enterActual, false);
});
