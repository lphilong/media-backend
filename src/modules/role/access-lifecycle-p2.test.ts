import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_REVIEW_DEFAULT_GRACE_MS,
  ACCESS_REVIEW_MAXIMUM_GRACE_MS,
  classifyRoleAssignmentSuccessorPair,
  evaluateRoleAssignmentEffectiveness,
} from "./domain/role-assignment-lifecycle";
import {
  evaluateLifecycleApprovals,
  validateGraceException,
  validateImmutableLineage,
} from "./domain/access-lifecycle-policy";
import {
  evaluateGovernancePrincipalEligibility,
  GovernancePrincipalRecord,
} from "./domain/governance-principal";
import {
  evaluateOwnerAdminEnvironmentEligibility,
  ownerAdminBootstrapAllowed,
  parseAccessDeploymentEnvironment,
} from "./domain/access-environment-policy";
import {
  buildGovernanceBusinessCalendar,
  failClosedGovernanceReviewDeadline,
  nextGovernanceReviewDeadline,
} from "./domain/governance-business-calendar";
import {
  BREAK_GLASS_DEFAULT_DURATION_MS,
  BREAK_GLASS_MAXIMUM_DURATION_MS,
  BreakGlassRequestRecord,
  buildBreakGlassActivation,
  canRenewBreakGlassActivation,
  evaluateBreakGlassActivation,
  isBreakGlassActivationEffective,
  validateIndependentBreakGlassReview,
} from "./domain/break-glass";
import { StructuredScopeAuthorityService } from "./domain/structured-scope-authority";
import {
  buildCurrentlyEffectiveRoleAssignmentExpression,
  buildRoleAssignmentReviewAuthorityEndExpression,
} from "@infra/mongo/user/user.auth.repository";
import {
  parseAccessDecision,
  parseAccessSuccessorAction,
  parseBreakGlassReviewResult,
  parseBreakGlassUrgency,
} from "./domain/access-governance-command";

const hour = 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 17, 3, 0, 0);

test("high-risk review deadline suspends request-time authority immediately", () => {
  const before = evaluateRoleAssignmentEffectiveness(
    assignment({ riskTier: "HIGH", reviewDeadline: now }),
    now - 1,
  );
  const atDeadline = evaluateRoleAssignmentEffectiveness(
    assignment({ riskTier: "HIGH", reviewDeadline: now }),
    now,
  );
  assert.equal(before.effective, true);
  assert.equal(before.nextTransitionAt, now);
  assert.deepEqual(atDeadline, {
    effective: false,
    reason: "REVIEW_OVERDUE",
    riskTier: "HIGH",
    authorityEndsAt: now,
  });
});

test("lower-risk access receives exactly 72-hour default grace", () => {
  const record = assignment({ riskTier: "LOW", reviewDeadline: now });
  assert.equal(
    evaluateRoleAssignmentEffectiveness(
      record,
      now + ACCESS_REVIEW_DEFAULT_GRACE_MS - 1,
    ).effective,
    true,
  );
  assert.deepEqual(
    evaluateRoleAssignmentEffectiveness(
      record,
      now + ACCESS_REVIEW_DEFAULT_GRACE_MS,
    ),
    {
      effective: false,
      reason: "GRACE_EXPIRED",
      riskTier: "LOW",
      authorityEndsAt: now + ACCESS_REVIEW_DEFAULT_GRACE_MS,
    },
  );
});

test("grace exception is capped at seven days from original deadline", () => {
  const record = assignment({
    riskTier: "LOW",
    reviewDeadline: now,
    graceExceptionExpiresAt: now + 30 * 24 * hour,
  });
  assert.equal(
    evaluateRoleAssignmentEffectiveness(
      record,
      now + ACCESS_REVIEW_MAXIMUM_GRACE_MS - 1,
    ).effective,
    true,
  );
  assert.equal(
    evaluateRoleAssignmentEffectiveness(
      record,
      now + ACCESS_REVIEW_MAXIMUM_GRACE_MS,
    ).effective,
    false,
  );
});

test("unknown durable or current risk fails high", () => {
  const malformed = assignment({ riskTier: "UNKNOWN", reviewDeadline: now });
  assert.equal(
    evaluateRoleAssignmentEffectiveness(malformed, now).reason,
    "REVIEW_OVERDUE",
  );
  const durableLow = assignment({ riskTier: "LOW", reviewDeadline: now });
  assert.equal(
    evaluateRoleAssignmentEffectiveness(durableLow, now, "UNKNOWN").reason,
    "REVIEW_OVERDUE",
  );
});

test("malformed lifecycle and terminal assignment states fail closed", () => {
  assert.equal(
    evaluateRoleAssignmentEffectiveness({ state: "MYSTERY" }, now).effective,
    false,
  );
  assert.equal(
    evaluateRoleAssignmentEffectiveness(
      assignment({ riskTier: "LOW", reviewDeadline: Number.NaN }),
      now,
    ).effective,
    false,
  );
});

test("current HIGH authority with no resolvable review anchor fails closed immediately", () => {
  for (const effectiveAt of [undefined, null, "invalid"] as const) {
    const evaluation = evaluateRoleAssignmentEffectiveness(
      {
        state: "ACTIVE",
        ...(effectiveAt === undefined
          ? {}
          : { effectiveAt: effectiveAt as any }),
      },
      now,
      { riskTier: "HIGH", reviewDeadline: null },
    );
    assert.deepEqual(evaluation, {
      effective: false,
      reason: "REVIEW_DEADLINE_UNRESOLVABLE",
      riskTier: "HIGH",
      authorityEndsAt: 0,
    });
  }
});

test("successor pair classifier rejects every one-sided or malformed representation", () => {
  const cases = [
    [{}, "NO_SUCCESSOR"],
    [
      { successorAssignmentId: null, successorEffectiveAt: null },
      "NO_SUCCESSOR",
    ],
    [
      { successorAssignmentId: "successor", successorEffectiveAt: now + 1 },
      "VALID_SUCCESSOR",
    ],
    [{ successorAssignmentId: "successor" }, "MALFORMED_SUCCESSOR"],
    [{ successorEffectiveAt: now + 1 }, "MALFORMED_SUCCESSOR"],
    [
      { successorAssignmentId: "", successorEffectiveAt: now + 1 },
      "MALFORMED_SUCCESSOR",
    ],
    [
      { successorAssignmentId: "   ", successorEffectiveAt: now + 1 },
      "MALFORMED_SUCCESSOR",
    ],
    [
      { successorAssignmentId: 42, successorEffectiveAt: now + 1 },
      "MALFORMED_SUCCESSOR",
    ],
    [
      { successorAssignmentId: "successor", successorEffectiveAt: "bad" },
      "MALFORMED_SUCCESSOR",
    ],
  ] as const;
  for (const [lifecycle, expected] of cases) {
    assert.equal(
      classifyRoleAssignmentSuccessorPair({ lifecycle } as any).kind,
      expected,
    );
    if (expected === "MALFORMED_SUCCESSOR") {
      assert.equal(
        evaluateRoleAssignmentEffectiveness(
          {
            state: "ACTIVE",
            effectiveAt: 1,
            lifecycle: {
              riskTier: "LOW",
              reviewDeadline: now + 10_000,
              ...lifecycle,
            },
          } as any,
          now,
        ).reason,
        "MALFORMED_SUCCESSOR",
      );
    }
  }
});

test("high-risk lifecycle requires two distinct independent approvals", () => {
  const evaluation = evaluateLifecycleApprovals({
    riskTier: "HIGH",
    targetUserId: "target",
    requesterUserId: "requester",
    approvals: [approval("reviewer-a"), approval("reviewer-b")],
  });
  assert.deepEqual(evaluation, {
    allowed: true,
    blockers: [],
    requiredApprovalCount: 2,
  });
  assert.deepEqual(
    evaluateLifecycleApprovals({
      riskTier: "HIGH",
      targetUserId: "target",
      requesterUserId: "requester",
      approvals: [approval("requester"), approval("requester")],
    }).blockers,
    ["REQUESTER_CANNOT_APPROVE", "APPROVERS_MUST_BE_DISTINCT"],
  );
});

test("grace and lineage validators enforce immutable bounded evidence", () => {
  assert.deepEqual(
    validateGraceException({
      reviewDeadline: now,
      requestedExpiresAt: now + ACCESS_REVIEW_MAXIMUM_GRACE_MS + 1,
      requestedBy: "requester",
      targetUserId: "target",
      approvedBy: "requester",
      reason: "business continuity",
    }),
    ["GRACE_EXCEEDS_MAXIMUM_ABSOLUTE_END", "REQUESTER_CANNOT_APPROVE"],
  );
  assert.deepEqual(
    validateImmutableLineage({
      lineageId: "lineage",
      action: "RENEWAL",
      predecessorAssignmentId: "same",
      successorAssignmentId: "same",
      targetUserId: "target",
      requestedBy: "requester",
      approvals: [],
      reason: "renew",
      idempotencyKey: "renew-1",
      appliedAt: now,
    }),
    ["SUCCESSOR_MUST_BE_NEW_AUTHORITY"],
  );
});

test("governance principal eligibility is independent of Role possession", () => {
  const principal = primaryOwner();
  assert.equal(
    evaluateGovernancePrincipalEligibility(
      principal,
      {
        userId: principal.userId,
        userActive: true,
        authLinked: true,
        accountEligible: true,
      },
      now,
    ).eligible,
    true,
  );
  assert.deepEqual(
    evaluateGovernancePrincipalEligibility(
      { ...principal, status: "MYSTERY" as never },
      {
        userId: principal.userId,
        userActive: true,
        authLinked: true,
        accountEligible: true,
      },
      now,
    ).blockers,
    ["PRINCIPAL_NOT_ACTIVE"],
  );
});

test("OWNER_ADMIN is production-prohibited and non-production Primary-Owner-only", () => {
  assert.equal(parseAccessDeploymentEnvironment("production"), "PRODUCTION");
  assert.equal(parseAccessDeploymentEnvironment("unexpected"), null);
  assert.equal(ownerAdminBootstrapAllowed("STAGING"), true);
  assert.equal(ownerAdminBootstrapAllowed("PRODUCTION"), false);
  assert.deepEqual(
    evaluateOwnerAdminEnvironmentEligibility({
      environment: "PRODUCTION",
      assignmentUserId: "owner",
      primaryOwnerUserId: "owner",
      primaryOwnerEligible: true,
      reviewDeadline: now + hour,
      now,
    }).blockers,
    ["OWNER_ADMIN_PRODUCTION_PROHIBITED"],
  );
  assert.equal(
    evaluateOwnerAdminEnvironmentEligibility({
      environment: "TEST",
      assignmentUserId: "owner",
      primaryOwnerUserId: "owner",
      primaryOwnerEligible: true,
      reviewDeadline: now + hour,
      now,
    }).eligible,
    true,
  );
});

test("business calendar freezes next business day 17:00 Asia/Ho_Chi_Minh", () => {
  const fridayEnd = Date.UTC(2026, 6, 17, 11, 0, 0); // Friday 18:00 ICT
  const due = nextGovernanceReviewDeadline(fridayEnd, {
    version: "vn-2026-v1",
    holidayDates: new Set(["2026-07-20"]),
  });
  assert.equal(due.calendarVersion, "vn-2026-v1");
  assert.equal(due.timeZone, "Asia/Ho_Chi_Minh");
  assert.equal(due.dueAt, Date.UTC(2026, 6, 21, 10, 0, 0));
});

test("governance calendar provider validates configuration and skips consecutive holidays", () => {
  assert.throws(
    () =>
      buildGovernanceBusinessCalendar({
        version: undefined,
        holidayDates: "2026-07-20",
      }),
    /INVALID_CALENDAR_VERSION/u,
  );
  assert.throws(
    () =>
      buildGovernanceBusinessCalendar({
        version: "vn-2026-v2",
        holidayDates: "",
      }),
    /GOVERNANCE_HOLIDAY_DATES_REQUIRED/u,
  );
  assert.throws(
    () =>
      buildGovernanceBusinessCalendar({
        version: "vn-2026-v2",
        holidayDates: "2026-02-30",
      }),
    /INVALID_GOVERNANCE_HOLIDAY_DATE/u,
  );
  const calendar = buildGovernanceBusinessCalendar({
    version: "vn-2026-v2",
    holidayDates: "2026-07-20,2026-07-21",
  });
  const due = nextGovernanceReviewDeadline(
    Date.UTC(2026, 6, 17, 11, 0, 0),
    calendar,
  );
  assert.equal(due.dueAt, Date.UTC(2026, 6, 22, 10, 0, 0));
  assert.equal(due.calendarVersion, "vn-2026-v2");
});

test("unresolvable calendar uses the earlier activation-end deadline", () => {
  const due = failClosedGovernanceReviewDeadline(Number.NaN, {
    version: "",
    holidayDates: new Set(),
  });
  assert.equal(Number.isNaN(due.dueAt), true);
  assert.equal(due.calendarVersion, "UNRESOLVED");
});

test("urgent break-glass is Primary-Owner-only and exact authority is mandatory", () => {
  const request = breakGlassRequest("URGENT");
  assert.deepEqual(
    evaluateBreakGlassActivation({
      request,
      activatorUserId: "owner",
      activePrimaryOwnerUserId: "owner",
      primaryOwnerEligible: true,
      stepUpSupported: false,
      stepUpState: "NOT_SUPPORTED",
    }),
    [],
  );
  assert.deepEqual(
    evaluateBreakGlassActivation({
      request: { ...request, permissions: [] },
      activatorUserId: "not-owner",
      activePrimaryOwnerUserId: "owner",
      primaryOwnerEligible: true,
      stepUpSupported: true,
      stepUpState: "NOT_SATISFIED",
    }),
    [
      "EXACT_PERMISSION_REQUIRED",
      "URGENT_ACTIVATION_PRIMARY_OWNER_ONLY",
      "STEP_UP_REQUIRED",
    ],
  );
});

test("non-urgent break-glass requires two independent approvers", () => {
  const request = {
    ...breakGlassRequest("NON_URGENT"),
    approvals: [
      { ...approval("approver-a"), decision: "APPROVED" as const },
      { ...approval("approver-b"), decision: "APPROVED" as const },
    ],
  };
  assert.deepEqual(
    evaluateBreakGlassActivation({
      request,
      activatorUserId: "operator",
      activePrimaryOwnerUserId: "owner",
      primaryOwnerEligible: true,
      stepUpSupported: false,
      stepUpState: "NOT_SUPPORTED",
    }),
    [],
  );
});

test("activation defaults to 60 minutes, caps at four hours, expires request-time, and cannot renew", () => {
  const request = breakGlassRequest("URGENT");
  const activation = buildBreakGlassActivation({
    activationId: "activation-1",
    request,
    activatorUserId: "owner",
    activatedAt: now,
    stepUpState: "NOT_SUPPORTED",
    calendar: { version: "v1", holidayDates: new Set() },
    auditCorrelationId: "audit-1",
  });
  assert.equal(activation.expiresAt, now + BREAK_GLASS_DEFAULT_DURATION_MS);
  assert.equal(
    isBreakGlassActivationEffective(activation, activation.expiresAt - 1),
    true,
  );
  assert.equal(
    isBreakGlassActivationEffective(activation, activation.expiresAt),
    false,
  );
  assert.equal(canRenewBreakGlassActivation(activation), false);
  assert.throws(
    () =>
      buildBreakGlassActivation({
        activationId: "activation-2",
        request,
        activatorUserId: "owner",
        activatedAt: now,
        durationMs: BREAK_GLASS_MAXIMUM_DURATION_MS + 1,
        stepUpState: "NOT_SUPPORTED",
        calendar: { version: "v1", holidayDates: new Set() },
        auditCorrelationId: "audit-2",
      }),
    /DURATION_EXCEEDS_FOUR_HOUR_MAXIMUM/u,
  );
  assert.deepEqual(
    validateIndependentBreakGlassReview({
      activation,
      reviewerUserId: "owner",
    }),
    ["POST_USE_REVIEW_REQUIRES_EXPIRED_ACTIVATION", "ACTIVATOR_CANNOT_REVIEW"],
  );
  assert.deepEqual(
    validateIndependentBreakGlassReview({
      activation: { ...activation, status: "EXPIRED" },
      reviewerUserId: "independent-reviewer",
    }),
    [],
  );
});

test("external governance command parsers reject missing, malformed, case, and whitespace variants", () => {
  assert.equal(parseAccessDecision("APPROVED"), "APPROVED");
  assert.equal(parseBreakGlassUrgency("NON_URGENT"), "NON_URGENT");
  assert.equal(parseBreakGlassReviewResult("MISUSE_FOUND"), "MISUSE_FOUND");
  assert.equal(parseAccessSuccessorAction("RESTORATION"), "RESTORATION");

  for (const invalid of [
    undefined,
    null,
    "",
    "approved",
    " APPROVED",
    "APPROVED ",
    "UNKNOWN",
  ]) {
    assert.throws(
      () => parseAccessDecision(invalid),
      /must be exactly one of/u,
    );
  }
  for (const invalid of [undefined, "urgent", " URGENT", "NORMAL"]) {
    assert.throws(
      () => parseBreakGlassUrgency(invalid),
      /must be exactly one of/u,
    );
  }
  for (const invalid of [undefined, "APPROVED", "MISUSE_FOUND ", "SAFE"]) {
    assert.throws(
      () => parseBreakGlassReviewResult(invalid),
      /must be exactly one of/u,
    );
  }
  for (const invalid of [undefined, "renewal", " RENEWAL", "GRANT"]) {
    assert.throws(
      () => parseAccessSuccessorAction(invalid),
      /must be exactly one of/u,
    );
  }
});

test("canonical structured authority adds only exact active break-glass permission and scope", async () => {
  const request = breakGlassRequest("URGENT");
  const activation = buildBreakGlassActivation({
    activationId: "activation-exact",
    request,
    activatorUserId: "owner",
    activatedAt: now,
    stepUpState: "NOT_SUPPORTED",
    calendar: { version: "v1", holidayDates: new Set() },
    auditCorrelationId: "audit-exact",
  });
  const service = new StructuredScopeAuthorityService({
    listByUserId: async () => [],
    listBreakGlassByUserId: async () => [activation],
  });
  assert.equal(
    await service.hasAuthority({
      userId: "target",
      permission: "contract.read",
      scope: { scopeType: "contractPortfolio", targetKey: "portfolio-a" },
      now: now + 1,
    }),
    true,
  );
  assert.equal(
    await service.hasAuthority({
      userId: "target",
      permission: "contract.read",
      scope: { scopeType: "contractPortfolio", targetKey: "portfolio-b" },
      now: now + 1,
    }),
    false,
  );
  assert.equal(
    await service.hasAuthority({
      userId: "target",
      permission: "contract.write",
      scope: { scopeType: "contractPortfolio", targetKey: "portfolio-a" },
      now: now + 1,
    }),
    false,
  );
});

test("Mongo lifecycle expression shares review/grace boundaries with the canonical JS policy", () => {
  const expression = JSON.stringify(
    buildCurrentlyEffectiveRoleAssignmentExpression(now),
  );
  const reviewEnd = JSON.stringify(
    buildRoleAssignmentReviewAuthorityEndExpression(),
  );
  assert.match(expression, /lifecycle\.reviewDeadline/u);
  assert.match(expression, /lifecycle\.riskTier/u);
  assert.match(expression, /259200000/u);
  assert.match(expression, /604800000/u);
  assert.match(reviewEnd, /graceExceptionExpiresAt/u);
});

function assignment(lifecycle: {
  readonly riskTier: string;
  readonly reviewDeadline: number;
  readonly graceExceptionExpiresAt?: number;
}) {
  return {
    state: "ACTIVE",
    effectiveAt: now - hour,
    expiresAt: null,
    lifecycle,
  };
}

function approval(approverUserId: string) {
  return {
    approverUserId,
    decision: "APPROVED" as const,
    reason: "independent review",
    decidedAt: now,
  };
}

function primaryOwner(): GovernancePrincipalRecord {
  return {
    principalId: "principal-owner",
    userId: "owner",
    principalType: "PRIMARY_OWNER",
    status: "ACTIVE",
    effectiveAt: now - hour,
    expiresAt: null,
    predecessorPrincipalId: null,
    successorPrincipalId: null,
    createdBy: "governance-maker",
    approvedBy: "governance-checker",
    reason: "initial governance owner",
    createdAt: now - 2 * hour,
    approvedAt: now - hour,
  };
}

function breakGlassRequest(
  urgency: "URGENT" | "NON_URGENT",
): BreakGlassRequestRecord {
  return {
    requestId: `request-${urgency.toLowerCase()}`,
    idempotencyKey: `idempotency-${urgency.toLowerCase()}`,
    payloadFingerprint: `payload-${urgency.toLowerCase()}`,
    targetUserId: "target",
    permissions: ["contract.read"],
    structuredScopeGrants: [
      { scopeType: "contractPortfolio", targetKey: "portfolio-a" },
    ],
    scopeFingerprint: "scope:v1:contractPortfolio|targetKey=portfolio-a",
    urgency,
    incidentReferenceId: "INC-2026-001",
    reason: "urgent incident response",
    requesterUserId: urgency === "URGENT" ? "owner" : "requester",
    requestedAt: now,
    requestedDurationMs: BREAK_GLASS_DEFAULT_DURATION_MS,
    approvals: [],
    status: urgency === "URGENT" ? "APPROVED" : "PENDING_APPROVAL",
  };
}
