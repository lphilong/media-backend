import assert from "node:assert/strict";
import test from "node:test";
import {
  RISK_001_EXECUTABLE_CASES,
  RISK_001_CONTROLLING_CONTRACT_IDS,
  RISK_001_INVARIANT_IDS,
  validateRisk001CoverageRegistry,
} from "./risk-001-contract-coverage.registry";

const outcomes = new Map<string, "PASS" | "FAIL">();

test("RISK-001 frozen inventory and explicit ownership registry reconcile exactly", () => {
  validateRisk001CoverageRegistry();
  assert.equal(RISK_001_EXECUTABLE_CASES.length, 299, "exact executable denominator");
  assert.equal(RISK_001_CONTROLLING_CONTRACT_IDS.length, 63);
  assert.equal(RISK_001_INVARIANT_IDS.length, 82);
});

test("RISK-001 executable behavior cells are individually named and directly asserted", async (context) => {
  for (const coverageCase of RISK_001_EXECUTABLE_CASES) {
    await context.test(coverageCase.caseId, async () => {
      try {
        await coverageCase.run();
        outcomes.set(coverageCase.caseId, "PASS");
      } catch (error) {
        outcomes.set(coverageCase.caseId, "FAIL");
        throw error;
      }
    });
  }
  assert.equal(outcomes.size, RISK_001_EXECUTABLE_CASES.length, "every registry case executed");
  assert.equal([...outcomes.values()].every((outcome) => outcome === "PASS"), true, "zero failed cells");
});
