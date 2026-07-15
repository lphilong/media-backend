import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLinkedKpiAllocationCorrection,
  planKpiLifecycleMigrationDryRun,
  readKpiAllocationLifecycleStatus,
  readKpiPlanLifecycleStatus,
  validateExactAllocationMetric,
} from "./kpi-allocation-lifecycle";
import { KpiAllocation } from "./kpi.types";

describe("KPI allocation lifecycle V2", () => {
  it("maps historical plan and allocation statuses without rewriting them", () => {
    assert.equal(readKpiPlanLifecycleStatus("PUBLISHED"), "ACTIVE");
    assert.equal(
      readKpiAllocationLifecycleStatus("PENDING_APPROVAL"),
      "SUBMITTED",
    );
    assert.equal(
      readKpiAllocationLifecycleStatus("REJECTED", "change target"),
      "CHANGES_REQUESTED",
    );
    assert.equal(
      readKpiAllocationLifecycleStatus("REJECTED", null),
      "LEGACY_REJECTED",
    );
  });

  it("uses exact decimal arithmetic and rejects hidden or excessive allocation", () => {
    assert.equal(
      validateExactAllocationMetric({
        metricCode: "LIVE_HOURS",
        groupTarget: "0.3",
        memberTargets: ["0.1", "0.2"],
        mode: "MEMBER_ALLOCATED",
      }).delta,
      "0",
    );
    assert.throws(
      () =>
        validateExactAllocationMetric({
          metricCode: "LIVE_HOURS",
          groupTarget: "1",
          memberTargets: ["0.7", "0.4"],
          mode: "MEMBER_ALLOCATED",
        }),
      /over-allocated/u,
    );
    assert.throws(
      () =>
        validateExactAllocationMetric({
          metricCode: "LIVE_HOURS",
          groupTarget: "1",
          memberTargets: ["0.7"],
          mode: "MEMBER_ALLOCATED",
        }),
      /exact sum/u,
    );
  });

  it("allows only an explicit exact HYBRID remainder", () => {
    assert.equal(
      validateExactAllocationMetric({
        metricCode: "REVENUE_VND",
        groupTarget: "100",
        memberTargets: ["70"],
        mode: "HYBRID",
        groupRemainder: "30",
      }).groupRemainder,
      "30",
    );
    assert.throws(
      () =>
        validateExactAllocationMetric({
          metricCode: "REVENUE_VND",
          groupTarget: "100",
          memberTargets: ["70"],
          mode: "HYBRID",
          groupRemainder: "29",
        }),
      /exact group remainder/u,
    );
  });

  it("creates correction lineage without erasing published evidence", () => {
    const source = allocation({
      lifecycleStatus: "PUBLISHED",
      allocationVersion: 4,
    });
    const linked = createLinkedKpiAllocationCorrection({
      source,
      replacementId: "allocation-v5",
      actorId: "checker-2",
      now: 500,
      reason: "correct membership snapshot",
      idempotencyKey: "correct-v5",
    });
    assert.equal(linked.previous.lifecycleStatus, "SUPERSEDED");
    assert.equal(linked.previous.id, source.id);
    assert.equal(linked.replacement.correctsAllocationId, source.id);
    assert.equal(linked.replacement.allocationVersion, 5);
    assert.equal(linked.replacement.allocationStatus, "DRAFT");
  });

  it("plans an idempotent dry run and flags ambiguous legacy history", () => {
    const result = planKpiLifecycleMigrationDryRun({
      plans: [{ id: "plan-1", status: "PUBLISHED" }],
      allocations: [
        {
          id: "allocation-1",
          allocationStatus: "PENDING_APPROVAL",
          rejectionReason: null,
        },
        {
          id: "allocation-2",
          allocationStatus: "REJECTED",
          rejectionReason: null,
        },
      ],
    });
    assert.equal(result.dryRun, true);
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(result.requiresManualReview, ["allocation-2"]);
    assert.equal(result.rollbackStrategy, "FORWARD_REPAIR_FROM_AUDIT_LINEAGE");
  });
});

function allocation(overrides: Partial<KpiAllocation> = {}): KpiAllocation {
  return {
    id: "allocation-v4",
    kpiPlanId: "plan-1",
    subjectType: "ORG_UNIT",
    subjectId: "org-1",
    groupId: null,
    memberEmploymentProfileId: "ep-1",
    memberTalentId: null,
    membershipId: null,
    allocationStatus: "PUBLISHED",
    allocationStartDate: "2026-07-01",
    allocationEndDate: null,
    targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
    snapshotMemberDisplayName: "Member",
    note: null,
    createdAt: 100,
    createdByActorId: "manager-1",
    updatedAt: 400,
    updatedByActorId: "publisher-1",
    submittedAt: 200,
    submittedByActorId: "manager-1",
    approvedAt: 300,
    approvedByActorId: "checker-1",
    approvalNote: null,
    rejectedAt: null,
    rejectedByActorId: null,
    rejectionReason: null,
    publishedAt: 400,
    publishedByActorId: "publisher-1",
    closedAt: null,
    ...overrides,
  };
}
