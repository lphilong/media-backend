import assert from "node:assert/strict";
import { test } from "node:test";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import {
  buildRoleAssignmentScopeFingerprint,
  normalizeRoleAssignmentScopeGrants,
} from "@modules/role/domain/role-assignment-scope";
import { isRoleAssignmentCurrentlyEffective } from "@modules/role/domain/role-assignment-lifecycle";
import { getRoleBundle } from "@modules/role/domain/role-bundle.catalog";
import { EffectiveAccessAdminService } from "@modules/role/admin/admin.effective-access.service";
import { NativeMongoUserRoleAssignmentRepository } from "@infra/mongo/role/role.repository";
import {
  buildCurrentRoleRequiresReviewExpression,
  buildCurrentRoleReviewDeadlineExpression,
  buildCurrentRoleRiskTierExpression,
  buildCurrentlyEffectiveRoleAssignmentExpression,
  buildRoleAssignmentReviewAuthorityEndExpression,
  MongoUserAuthRepository,
} from "@infra/mongo/user/user.auth.repository";
import {
  buildCurrentRoleAssignmentPolicy,
  PRIVILEGED_ACCESS_REVIEW_WINDOW_DAYS,
} from "@modules/role/domain/sensitive-access-policy";
import {
  buildRoleAssignmentFutureSuccessorCutoverTransitionExpression,
  buildRoleAssignmentSuccessorCutoverEligibilityExpression,
  buildRoleAssignmentSuccessorPairClassificationExpression,
} from "@infra/mongo/role/role-assignment-successor-cutover.expression";

test("scope fingerprint is deterministic and object-bound", () => {
  const first = normalizeRoleAssignmentScopeGrants([
    { scopeType: "managedTalentGroup", targetId: "group-a" },
    { scopeType: "financePeriod", periodKey: "2026-06" },
  ]);
  const reordered = normalizeRoleAssignmentScopeGrants([
    { scopeType: "financePeriod", periodKey: "2026-06" },
    { scopeType: "managedTalentGroup", targetId: "group-a" },
  ]);
  const otherTarget = normalizeRoleAssignmentScopeGrants([
    { scopeType: "managedTalentGroup", targetId: "group-b" },
    { scopeType: "financePeriod", periodKey: "2026-06" },
  ]);

  assert.equal(
    buildRoleAssignmentScopeFingerprint(first),
    buildRoleAssignmentScopeFingerprint(reordered),
  );
  assert.notEqual(
    buildRoleAssignmentScopeFingerprint(first),
    buildRoleAssignmentScopeFingerprint(otherTarget),
  );
});

test("finance global, finance period, global, and self fingerprints remain distinct", () => {
  const fingerprints = [
    [{ scopeType: "financeGlobal" }],
    [{ scopeType: "financePeriod", periodKey: "2026-06" }],
    [{ scopeType: "global" }],
    [{ scopeType: "self" }],
  ].map((grants) =>
    buildRoleAssignmentScopeFingerprint(
      normalizeRoleAssignmentScopeGrants(grants),
    ),
  );
  assert.equal(new Set(fingerprints).size, 4);
});

test("object and period scopes reject missing or invalid targets", () => {
  assert.throws(
    () => normalizeRoleAssignmentScopeGrants([{ scopeType: "managedOrgUnit" }]),
    RoleValidationError,
  );
  assert.throws(
    () =>
      normalizeRoleAssignmentScopeGrants([
        { scopeType: "financePeriod", periodKey: "June-2026" },
      ]),
    RoleValidationError,
  );
  assert.throws(
    () =>
      normalizeRoleAssignmentScopeGrants([
        { scopeType: "global", targetId: "unsafe" },
      ]),
    RoleValidationError,
  );
});

test("all structured scope variants normalize with exact required fields", () => {
  const grants = normalizeRoleAssignmentScopeGrants([
    { scopeType: "self" },
    { scopeType: "global" },
    { scopeType: "managedTalentGroup", targetId: "group-a" },
    { scopeType: "managedOrgUnit", targetId: "org-a" },
    { scopeType: "assignedPlatformAccount", targetId: "platform-a" },
    { scopeType: "financeGlobal" },
    { scopeType: "financePeriod", periodKey: "2026-06" },
    { scopeType: "contractPortfolio", targetKey: "portfolio-a" },
    { scopeType: "assignedEvent", targetId: "event-a" },
    { scopeType: "assignedStudioResource", targetId: "studio-a" },
    { scopeType: "payrollPeriod", periodKey: "2026-06" },
    {
      scopeType: "attendancePeriodOrg",
      targetId: "org-a",
      periodKey: "2026-06",
    },
  ]);

  assert.equal(grants?.length, 12);
  assert.equal(new Set(grants?.map((grant) => grant.scopeType)).size, 12);
});

test("object and period scopes reject irrelevant unsafe fields", () => {
  const unsafe = [
    {
      scopeType: "managedTalentGroup",
      targetId: "group-a",
      periodKey: "2026-06",
    },
    { scopeType: "managedOrgUnit", targetId: "org-a", targetKey: "unsafe" },
    {
      scopeType: "assignedPlatformAccount",
      targetId: "platform-a",
      periodKey: "2026-06",
    },
    { scopeType: "financePeriod", periodKey: "2026-06", targetId: "unsafe" },
    {
      scopeType: "contractPortfolio",
      targetKey: "portfolio-a",
      targetId: "unsafe",
    },
    { scopeType: "assignedEvent", targetId: "event-a", targetKey: "unsafe" },
    {
      scopeType: "assignedStudioResource",
      targetId: "studio-a",
      periodKey: "2026-06",
    },
    { scopeType: "payrollPeriod", periodKey: "2026-06", targetKey: "unsafe" },
    {
      scopeType: "attendancePeriodOrg",
      targetId: "org-a",
      periodKey: "2026-06",
      targetKey: "unsafe",
    },
  ];

  for (const grant of unsafe) {
    assert.throws(
      () => normalizeRoleAssignmentScopeGrants([grant]),
      RoleValidationError,
    );
  }
});

test("every object or period-bound scope rejects missing required target fields", () => {
  const missingRequired = [
    { scopeType: "managedTalentGroup" },
    { scopeType: "managedOrgUnit" },
    { scopeType: "assignedPlatformAccount" },
    { scopeType: "financePeriod" },
    { scopeType: "contractPortfolio" },
    { scopeType: "assignedEvent" },
    { scopeType: "assignedStudioResource" },
    { scopeType: "payrollPeriod" },
    { scopeType: "attendancePeriodOrg", targetId: "org-a" },
    { scopeType: "attendancePeriodOrg", periodKey: "2026-06" },
  ];

  for (const grant of missingRequired) {
    assert.throws(
      () => normalizeRoleAssignmentScopeGrants([grant]),
      RoleValidationError,
    );
  }
});

test("role assignment lifecycle predicate excludes future, expired, and revoked grants", () => {
  const now = 1_000;
  assert.equal(
    isRoleAssignmentCurrentlyEffective(
      { state: "ACTIVE", effectiveAt: 1, expiresAt: 2_000 },
      now,
    ),
    true,
  );
  assert.equal(
    isRoleAssignmentCurrentlyEffective(
      { state: "ACTIVE", effectiveAt: 1_001, expiresAt: null },
      now,
    ),
    false,
  );
  assert.equal(
    isRoleAssignmentCurrentlyEffective(
      { state: "ACTIVE", effectiveAt: 1, expiresAt: 1_000 },
      now,
    ),
    false,
  );
  assert.equal(
    isRoleAssignmentCurrentlyEffective(
      { state: "REVOKED", effectiveAt: 1, expiresAt: null },
      now,
    ),
    false,
  );
  assert.equal(
    isRoleAssignmentCurrentlyEffective({ state: "ACTIVE" }, now),
    true,
  );
});

test("scheduled successor cuts over exactly at effectiveAt with no authority gap or overlap", () => {
  const cutover = 2_000;
  const predecessor = {
    state: "ACTIVE",
    effectiveAt: 1_000,
    expiresAt: 3_000,
    lifecycle: {
      riskTier: "LOW",
      reviewDeadline: 10_000,
      successorAssignmentId: "successor",
      successorEffectiveAt: cutover,
    },
  } as const;
  const successor = {
    state: "SCHEDULED",
    effectiveAt: cutover,
    expiresAt: 3_000,
  } as const;

  assert.deepEqual(
    [
      isRoleAssignmentCurrentlyEffective(predecessor, cutover - 1),
      isRoleAssignmentCurrentlyEffective(successor, cutover - 1),
    ],
    [true, false],
  );
  assert.deepEqual(
    [
      isRoleAssignmentCurrentlyEffective(predecessor, cutover),
      isRoleAssignmentCurrentlyEffective(successor, cutover),
    ],
    [false, true],
  );
  assert.deepEqual(
    [
      isRoleAssignmentCurrentlyEffective(predecessor, cutover + 1),
      isRoleAssignmentCurrentlyEffective(successor, cutover + 1),
    ],
    [false, true],
  );
});

test("Mongo runtime assignment expression implements lifecycle boundary semantics", () => {
  assert.deepEqual(buildCurrentlyEffectiveRoleAssignmentExpression(1_000), {
    $and: [
      { $in: ["$state", ["ACTIVE", "SCHEDULED"]] },
      buildRoleAssignmentSuccessorCutoverEligibilityExpression(1_000),
      {
        $or: [
          { $eq: ["$state", "ACTIVE"] },
          {
            $and: [
              { $eq: ["$state", "SCHEDULED"] },
              { $isNumber: "$effectiveAt" },
              { $lte: ["$effectiveAt", 1_000] },
            ],
          },
        ],
      },
      {
        $or: [
          { $eq: [{ $ifNull: ["$effectiveAt", null] }, null] },
          { $lte: ["$effectiveAt", 1_000] },
        ],
      },
      {
        $or: [
          { $eq: [{ $ifNull: ["$expiresAt", null] }, null] },
          { $gt: ["$expiresAt", 1_000] },
        ],
      },
      {
        $let: {
          vars: {
            reviewEnd: buildRoleAssignmentReviewAuthorityEndExpression(
              buildCurrentRoleRiskTierExpression(),
              buildCurrentRoleReviewDeadlineExpression(),
            ),
          },
          in: {
            $or: [
              { $eq: ["$$reviewEnd", null] },
              {
                $and: [
                  { $isNumber: "$$reviewEnd" },
                  { $gt: ["$$reviewEnd", 1_000] },
                ],
              },
            ],
          },
        },
      },
    ],
  });
});

test("chained successor JS and Mongo authority agree at every cutover boundary", () => {
  const t1 = 1_000;
  const t2 = 2_000;
  const lifecycle = {
    riskTier: "LOW" as const,
    reviewDeadline: 10_000,
    successorAssignmentId: "assignment-c",
    successorEffectiveAt: t2,
  };
  const cases = [
    {
      name: "ACTIVE predecessor before cutover",
      now: t2 - 1,
      assignment: {
        state: "ACTIVE",
        effectiveAt: 1,
        expiresAt: 9_000,
        lifecycle,
      },
      expected: true,
    },
    {
      name: "ACTIVE predecessor at cutover",
      now: t2,
      assignment: {
        state: "ACTIVE",
        effectiveAt: 1,
        expiresAt: 9_000,
        lifecycle,
      },
      expected: false,
    },
    {
      name: "ACTIVE predecessor after cutover",
      now: t2 + 1,
      assignment: {
        state: "ACTIVE",
        effectiveAt: 1,
        expiresAt: 9_000,
        lifecycle,
      },
      expected: false,
    },
    {
      name: "effective SCHEDULED predecessor before chained cutover",
      now: t2 - 1,
      assignment: {
        state: "SCHEDULED",
        effectiveAt: t1,
        expiresAt: 9_000,
        lifecycle,
      },
      expected: true,
    },
    {
      name: "effective SCHEDULED predecessor at chained cutover",
      now: t2,
      assignment: {
        state: "SCHEDULED",
        effectiveAt: t1,
        expiresAt: 9_000,
        lifecycle,
      },
      expected: false,
    },
    {
      name: "effective SCHEDULED predecessor after chained cutover",
      now: t2 + 1,
      assignment: {
        state: "SCHEDULED",
        effectiveAt: t1,
        expiresAt: 9_000,
        lifecycle,
      },
      expected: false,
    },
    {
      name: "future SCHEDULED predecessor",
      now: t1 - 1,
      assignment: {
        state: "SCHEDULED",
        effectiveAt: t1,
        expiresAt: 9_000,
        lifecycle,
      },
      expected: false,
    },
    {
      name: "successor missing cutover",
      now: t1,
      assignment: {
        state: "SCHEDULED",
        effectiveAt: t1,
        expiresAt: 9_000,
        lifecycle: { ...lifecycle, successorEffectiveAt: null },
      },
      expected: false,
    },
    {
      name: "successor malformed cutover",
      now: t1,
      assignment: {
        state: "SCHEDULED",
        effectiveAt: t1,
        expiresAt: 9_000,
        lifecycle: { ...lifecycle, successorEffectiveAt: "invalid" },
      },
      expected: false,
    },
    {
      name: "cutover without successor ID",
      now: t1,
      assignment: {
        state: "ACTIVE",
        effectiveAt: 1,
        expiresAt: 9_000,
        lifecycle: {
          ...lifecycle,
          successorAssignmentId: null,
          successorEffectiveAt: t2,
        },
      },
      expected: false,
    },
    ...["", "   ", 42].map((successorAssignmentId) => ({
      name: `invalid successor ID ${JSON.stringify(successorAssignmentId)}`,
      now: t1,
      assignment: {
        state: "ACTIVE" as const,
        effectiveAt: 1,
        expiresAt: 9_000,
        lifecycle: {
          ...lifecycle,
          successorAssignmentId,
          successorEffectiveAt: t2,
        },
      },
      expected: false,
    })),
  ] as const;

  for (const item of cases) {
    const js = isRoleAssignmentCurrentlyEffective(
      item.assignment as any,
      item.now,
    );
    const mongo = Boolean(
      evaluateMongoExpression(
        buildCurrentlyEffectiveRoleAssignmentExpression(item.now),
        {
          ...item.assignment,
          currentRole: {
            code: "STAFF_CONSOLE_USER",
            templateCode: "STAFF_CONSOLE_USER",
            permissions: [],
          },
          structuredScopeGrants: [{ scopeType: "self" }],
        },
      ),
    );
    assert.equal(js, item.expected, `${item.name}: JS`);
    assert.equal(mongo, item.expected, `${item.name}: Mongo`);
    assert.equal(mongo, js, `${item.name}: parity`);
  }
});

test("successor paired-field classifier has exact JS-equivalent Mongo semantics", () => {
  const expression = buildRoleAssignmentSuccessorPairClassificationExpression();
  const cases = [
    [{}, "NO_SUCCESSOR"],
    [
      { successorAssignmentId: null, successorEffectiveAt: null },
      "NO_SUCCESSOR",
    ],
    [
      { successorAssignmentId: "assignment-c", successorEffectiveAt: 2_000 },
      "VALID_SUCCESSOR",
    ],
    [{ successorAssignmentId: "assignment-c" }, "MALFORMED_SUCCESSOR"],
    [
      { successorAssignmentId: "assignment-c", successorEffectiveAt: null },
      "MALFORMED_SUCCESSOR",
    ],
    [{ successorEffectiveAt: 2_000 }, "MALFORMED_SUCCESSOR"],
    [
      { successorAssignmentId: "", successorEffectiveAt: 2_000 },
      "MALFORMED_SUCCESSOR",
    ],
    [
      { successorAssignmentId: "   ", successorEffectiveAt: 2_000 },
      "MALFORMED_SUCCESSOR",
    ],
    [
      { successorAssignmentId: 42, successorEffectiveAt: 2_000 },
      "MALFORMED_SUCCESSOR",
    ],
    [
      {
        successorAssignmentId: "assignment-c",
        successorEffectiveAt: "invalid",
      },
      "MALFORMED_SUCCESSOR",
    ],
    [
      {
        successorAssignmentId: "assignment-c",
        successorEffectiveAt: Number.NaN,
      },
      "MALFORMED_SUCCESSOR",
    ],
  ] as const;
  for (const [lifecycle, expected] of cases) {
    assert.equal(
      evaluateMongoExpression(expression, { lifecycle }),
      expected,
      JSON.stringify(lifecycle),
    );
  }
});

test("future successor transition helper emits only a present strictly future numeric cutover", () => {
  const now = 2_000;
  const expression =
    buildRoleAssignmentFutureSuccessorCutoverTransitionExpression(now);
  const evaluate = (lifecycle: Record<string, unknown>) =>
    evaluateMongoExpression(expression, { lifecycle });

  assert.equal(
    evaluate({
      successorAssignmentId: "assignment-c",
      successorEffectiveAt: now + 1,
    }),
    now + 1,
  );
  assert.equal(evaluate({ successorEffectiveAt: now + 1 }), null);
  assert.equal(evaluate({ successorAssignmentId: "assignment-c" }), null);
  assert.equal(
    evaluate({
      successorAssignmentId: "assignment-c",
      successorEffectiveAt: "invalid",
    }),
    null,
  );
  assert.equal(
    evaluate({
      successorAssignmentId: "assignment-c",
      successorEffectiveAt: now,
    }),
    null,
  );
  assert.equal(
    evaluate({
      successorAssignmentId: "assignment-c",
      successorEffectiveAt: now - 1,
    }),
    null,
  );
});

test("captured auth pipeline projects chained successor validity and the earliest global boundary", async () => {
  const t1 = 1_000;
  const t2 = 2_000;
  const later = 9_000;
  const lifecycle = {
    riskTier: "LOW",
    reviewDeadline: null,
    successorAssignmentId: "assignment-c",
    successorEffectiveAt: t2,
  };
  const lowRole = {
    code: "STAFF_CONSOLE_USER",
    templateCode: "STAFF_CONSOLE_USER",
    permissions: [],
  };
  const predecessor = {
    state: "SCHEDULED",
    effectiveAt: t1,
    expiresAt: later,
    lifecycle,
    currentRole: lowRole,
  };
  const successor = {
    state: "SCHEDULED",
    effectiveAt: t2,
    expiresAt: later,
    lifecycle: {
      riskTier: "LOW",
      reviewDeadline: null,
      successorAssignmentId: null,
      successorEffectiveAt: null,
    },
    currentRole: lowRole,
  };

  const beforeActivation = await captureAuthValidityExpressions(t1 - 1);
  const beforeActivationTransitions = evaluateTransitionCandidates(
    beforeActivation.transitionProjection,
    predecessor,
  );
  assert.equal(
    evaluateMongoExpression(
      buildCurrentlyEffectiveRoleAssignmentExpression(t1 - 1),
      predecessor,
    ),
    false,
  );
  assert.deepEqual(beforeActivationTransitions, [t1, later, t2]);
  assert.equal(
    evaluateAuthorizationValidity(
      beforeActivation.authorizationValidityProjection,
      Math.min(...beforeActivationTransitions),
    ),
    t1,
  );

  const atActivation = await captureAuthValidityExpressions(t1);
  assert.equal(
    evaluateMongoExpression(
      buildCurrentlyEffectiveRoleAssignmentExpression(t1),
      predecessor,
    ),
    true,
  );
  assert.equal(
    Math.min(
      ...evaluateTransitionCandidates(
        atActivation.transitionProjection,
        predecessor,
      ),
    ),
    t2,
  );

  const beforeCutover = await captureAuthValidityExpressions(t2 - 1);
  const scheduledTransitions = evaluateTransitionCandidates(
    beforeCutover.transitionProjection,
    predecessor,
  );
  assert.equal(
    evaluateMongoExpression(
      buildCurrentlyEffectiveRoleAssignmentExpression(t2 - 1),
      predecessor,
    ),
    true,
  );
  assert.equal(scheduledTransitions.includes(t2), true);
  assert.equal(
    evaluateAuthorizationValidity(
      beforeCutover.authorizationValidityProjection,
      Math.min(...scheduledTransitions),
    ),
    t2,
  );

  const activeTransitions = evaluateTransitionCandidates(
    beforeCutover.transitionProjection,
    { ...predecessor, state: "ACTIVE" },
  );
  assert.equal(activeTransitions.includes(t2), true);
  assert.equal(
    evaluateAuthorizationValidity(
      beforeCutover.authorizationValidityProjection,
      Math.min(...activeTransitions),
    ),
    t2,
  );

  for (const now of [t2, t2 + 1]) {
    const expressions = await captureAuthValidityExpressions(now);
    assert.equal(
      evaluateMongoExpression(
        buildCurrentlyEffectiveRoleAssignmentExpression(now),
        predecessor,
      ),
      false,
    );
    assert.equal(
      evaluateMongoExpression(
        buildCurrentlyEffectiveRoleAssignmentExpression(now),
        successor,
      ),
      true,
    );
    assert.equal(
      evaluateTransitionCandidates(
        expressions.transitionProjection,
        predecessor,
      ).includes(t2),
      false,
    );
  }

  for (const successorEffectiveAt of [undefined, null, "invalid"]) {
    const malformed = {
      ...predecessor,
      lifecycle: {
        ...lifecycle,
        successorEffectiveAt,
      },
    };
    assert.equal(
      evaluateMongoExpression(
        buildCurrentlyEffectiveRoleAssignmentExpression(t1),
        malformed,
      ),
      false,
    );
    assert.equal(
      evaluateTransitionCandidates(
        atActivation.transitionProjection,
        malformed,
      ).some((value) => value === t2),
      false,
    );
  }
  for (const lifecyclePatch of [
    { successorAssignmentId: null, successorEffectiveAt: t2 },
    { successorAssignmentId: "", successorEffectiveAt: t2 },
    { successorAssignmentId: "   ", successorEffectiveAt: t2 },
    { successorAssignmentId: 42, successorEffectiveAt: t2 },
  ]) {
    const malformed = {
      ...predecessor,
      lifecycle: { ...lifecycle, ...lifecyclePatch },
    };
    assert.equal(
      evaluateMongoExpression(
        buildCurrentlyEffectiveRoleAssignmentExpression(t1),
        malformed,
      ),
      false,
    );
    assert.equal(
      evaluateTransitionCandidates(
        atActivation.transitionProjection,
        malformed,
      ).includes(t2),
      false,
    );
  }

  const earlierExpiry = evaluateTransitionCandidates(
    atActivation.transitionProjection,
    { ...predecessor, expiresAt: 1_999 },
  );
  assert.equal(Math.min(...earlierExpiry), 1_999);

  const earlierReview = evaluateTransitionCandidates(
    atActivation.transitionProjection,
    {
      ...predecessor,
      lifecycle: { ...lifecycle, riskTier: "HIGH", reviewDeadline: 1_998 },
      currentRole: {
        code: "ACCESS_ADMIN",
        templateCode: "ACCESS_ADMIN",
        permissions: [],
      },
    },
  );
  assert.equal(Math.min(...earlierReview), 1_998);

  assert.equal(
    evaluateAuthorizationValidity(
      atActivation.authorizationValidityProjection,
      t2,
      1_997,
    ),
    1_997,
  );
  const otherAssignmentTransitions = evaluateTransitionCandidates(
    atActivation.transitionProjection,
    {
      state: "ACTIVE",
      effectiveAt: 1,
      expiresAt: 1_996,
      lifecycle: {
        riskTier: "LOW",
        reviewDeadline: null,
        successorAssignmentId: null,
        successorEffectiveAt: null,
      },
      currentRole: lowRole,
    },
  );
  const earliestAcrossAssignments = Math.min(
    ...evaluateTransitionCandidates(
      atActivation.transitionProjection,
      predecessor,
    ),
    ...otherAssignmentTransitions,
  );
  assert.equal(earliestAcrossAssignments, 1_996);
  assert.equal(
    evaluateAuthorizationValidity(
      atActivation.authorizationValidityProjection,
      earliestAcrossAssignments,
    ),
    1_996,
  );

  assert.equal(
    JSON.stringify(beforeCutover.transitionProjection).includes(
      '"$eq":["$state","ACTIVE"]',
    ),
    false,
  );
  const transitionPipeline = (
    beforeCutover.transitionLookup.$lookup as {
      readonly pipeline: readonly Record<string, unknown>[];
    }
  ).pipeline;
  assert.equal(
    transitionPipeline.some((stage) => "$sort" in stage),
    true,
  );
  assert.equal(
    transitionPipeline.some((stage) => "$limit" in stage),
    true,
  );
});

test("Mongo auth resolution mapping preserves the exact projected validity boundary", async () => {
  const t2 = 2_000;
  const repository = new MongoUserAuthRepository({
    collection(name: string) {
      if (name === "users") {
        return {
          aggregate() {
            return {
              toArray: async () => [
                {
                  _id: "user-validity",
                  actorKind: "ADMIN",
                  accountStatus: "ACTIVE",
                  accountContexts: ["ADMIN_CONSOLE"],
                  assignmentRoleIds: [],
                  resolvedRoleIds: [],
                  rolePermissions: [],
                  roleMaxDelegatableBands: [],
                  assignmentScopeGrants: [],
                  authorizationValidUntil: t2,
                },
              ],
            };
          },
        };
      }
      return { findOne: async () => null };
    },
  } as never);

  const candidates = await repository.findByAuthSubject(
    "auth0|validity-mapping",
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.authorizationValidUntil, t2);
});

test("Mongo current-role deadline derives HIGH authority end without durable review evidence", () => {
  const effectiveAt = 1_000;
  const highWindow =
    PRIVILEGED_ACCESS_REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1_000;
  const highDeadline = effectiveAt + highWindow;
  const highDocument = {
    effectiveAt,
    reviewAt: null,
    lifecycle: {
      riskTier: "LOW",
      reviewDeadline: null,
      graceExceptionExpiresAt: highDeadline + 7 * 24 * 60 * 60 * 1_000,
    },
    currentRole: {
      code: "ACCESS_ADMIN",
      templateCode: "ACCESS_ADMIN",
      permissions: [],
    },
    structuredScopeGrants: [{ scopeType: "self" as const }],
  };
  const currentDeadline = evaluateMongoExpression(
    buildCurrentRoleReviewDeadlineExpression(),
    highDocument,
  );
  assert.equal(currentDeadline, highDeadline);
  const highAuthorityEnd = evaluateMongoExpression(
    buildRoleAssignmentReviewAuthorityEndExpression(
      buildCurrentRoleRiskTierExpression(),
      buildCurrentRoleReviewDeadlineExpression(),
    ),
    highDocument,
  );
  assert.equal(highAuthorityEnd, highDeadline);

  const durableLaterDocument = {
    ...highDocument,
    lifecycle: {
      ...highDocument.lifecycle,
      reviewDeadline: highDeadline + 60_000,
    },
  };
  assert.equal(
    evaluateMongoExpression(
      buildRoleAssignmentReviewAuthorityEndExpression(
        buildCurrentRoleRiskTierExpression(),
        buildCurrentRoleReviewDeadlineExpression(),
      ),
      durableLaterDocument,
    ),
    highDeadline,
  );

  const afterHighDeadline = highDeadline + 1;
  assert.equal((highAuthorityEnd as number) <= afterHighDeadline, true);
  const currentPolicy = buildCurrentRoleAssignmentPolicy({
    roleCode: highDocument.currentRole.code,
    roleTemplateCode: highDocument.currentRole.templateCode,
    permissions: highDocument.currentRole.permissions,
    structuredScopeGrants: highDocument.structuredScopeGrants,
    effectiveAt,
    durableReviewDeadline: null,
    storedPermissionFingerprint: null,
    assessedAt: afterHighDeadline,
    scopeFingerprint: "scope:v1:self",
  });
  assert.equal(
    isRoleAssignmentCurrentlyEffective(
      { state: "ACTIVE", effectiveAt, expiresAt: null },
      afterHighDeadline,
      currentPolicy,
    ),
    false,
  );
});

test("unresolvable current HIGH review timing fails closed in JS and Mongo", () => {
  const currentPolicy = { riskTier: "HIGH" as const, reviewDeadline: null };
  for (const effectiveAt of [undefined, null, "invalid"] as const) {
    const assignment = {
      state: "ACTIVE" as const,
      ...(effectiveAt === undefined ? {} : { effectiveAt }),
      expiresAt: null,
      lifecycle: {
        riskTier: "HIGH" as const,
        reviewDeadline: null as unknown as number,
      },
    };
    const js = isRoleAssignmentCurrentlyEffective(
      assignment as any,
      1_000,
      currentPolicy,
    );
    const mongo = Boolean(
      evaluateMongoExpression(
        buildCurrentlyEffectiveRoleAssignmentExpression(1_000),
        {
          ...assignment,
          currentRole: {
            code: "ACCESS_ADMIN",
            templateCode: "ACCESS_ADMIN",
            permissions: [],
          },
          structuredScopeGrants: [{ scopeType: "self" }],
        },
      ),
    );
    assert.equal(js, false, `JS effectiveAt=${String(effectiveAt)}`);
    assert.equal(mongo, false, `Mongo effectiveAt=${String(effectiveAt)}`);
  }
});

test("Mongo current-role review parity preserves LOW durable grace and null/no-review behavior", () => {
  const effectiveAt = 1_000;
  const durableDeadline = 10_000;
  const lowDocument = {
    effectiveAt,
    reviewAt: durableDeadline,
    lifecycle: {
      riskTier: "LOW",
      reviewDeadline: durableDeadline,
      graceExceptionExpiresAt: null,
    },
    currentRole: {
      code: "STAFF_CONSOLE_USER",
      templateCode: "STAFF_CONSOLE_USER",
      permissions: [],
    },
    structuredScopeGrants: [{ scopeType: "self" }],
  };
  assert.equal(
    evaluateMongoExpression(
      buildCurrentRoleRequiresReviewExpression(),
      lowDocument,
    ),
    false,
  );
  assert.equal(
    evaluateMongoExpression(
      buildCurrentRoleReviewDeadlineExpression(),
      lowDocument,
    ),
    durableDeadline,
  );
  assert.equal(
    evaluateMongoExpression(
      buildRoleAssignmentReviewAuthorityEndExpression(
        buildCurrentRoleRiskTierExpression(),
        buildCurrentRoleReviewDeadlineExpression(),
      ),
      lowDocument,
    ),
    durableDeadline + 72 * 60 * 60 * 1_000,
  );
  const noDurable = {
    ...lowDocument,
    reviewAt: null,
    lifecycle: { ...lowDocument.lifecycle, reviewDeadline: null },
  };
  assert.equal(
    evaluateMongoExpression(
      buildRoleAssignmentReviewAuthorityEndExpression(
        buildCurrentRoleRiskTierExpression(),
        buildCurrentRoleReviewDeadlineExpression(),
      ),
      noDurable,
    ),
    null,
  );
  const serialized = JSON.stringify(buildCurrentRoleReviewDeadlineExpression());
  assert.equal(serialized.includes("$lifecycle.reviewDeadline"), true);
  assert.equal(serialized.includes("$reviewAt"), true);
  assert.deepEqual(buildCurrentRoleRiskTierExpression(), {
    $cond: [buildCurrentRoleRequiresReviewExpression(), "HIGH", "LOW"],
  });
});

test("accepted recurring HIGH deadline replaces the original effectiveAt-derived boundary", () => {
  const day = 24 * 60 * 60 * 1_000;
  const effectiveAt = 1_000_000;
  const initialDeadline = effectiveAt + 30 * day;
  const acceptedNextDeadline = effectiveAt + 60 * day;
  const afterInitialDeadline = initialDeadline + 1;
  const document = {
    state: "ACTIVE" as const,
    effectiveAt,
    reviewAt: acceptedNextDeadline,
    expiresAt: effectiveAt + 365 * day,
    lifecycle: {
      riskTier: "HIGH" as const,
      reviewDeadline: acceptedNextDeadline,
      graceExceptionExpiresAt: null,
    },
    currentRole: {
      code: "ACCESS_ADMIN",
      templateCode: "ACCESS_ADMIN",
      permissions: [],
    },
    structuredScopeGrants: [{ scopeType: "global" as const }],
  };

  assert.equal(
    evaluateMongoExpression(
      buildCurrentRoleReviewDeadlineExpression(),
      document,
    ),
    acceptedNextDeadline,
  );
  assert.equal(
    evaluateMongoExpression(
      buildRoleAssignmentReviewAuthorityEndExpression(
        buildCurrentRoleRiskTierExpression(),
        buildCurrentRoleReviewDeadlineExpression(),
      ),
      document,
    ),
    acceptedNextDeadline,
  );

  const policy = buildCurrentRoleAssignmentPolicy({
    roleCode: "ACCESS_ADMIN",
    roleTemplateCode: "ACCESS_ADMIN",
    permissions: [],
    structuredScopeGrants: document.structuredScopeGrants,
    effectiveAt,
    durableReviewDeadline: acceptedNextDeadline,
    durableRiskTier: "HIGH",
    storedPermissionFingerprint: null,
    assessedAt: afterInitialDeadline,
    scopeFingerprint: "scope:v1:global",
  });
  assert.equal(policy.reviewDeadline, acceptedNextDeadline);
  assert.equal(
    isRoleAssignmentCurrentlyEffective(document, afterInitialDeadline, policy),
    true,
  );
  assert.equal(
    isRoleAssignmentCurrentlyEffective(document, acceptedNextDeadline, policy),
    false,
  );
});

test("every runtime user-auth role-assignment pipeline includes lifecycle filtering", async () => {
  const pipelines: unknown[][] = [];
  const repository = new MongoUserAuthRepository({
    collection(name: string) {
      if (name === "users") {
        return {
          aggregate(pipeline: unknown[]) {
            pipelines.push(pipeline);
            return { toArray: async () => [] };
          },
        };
      }
      return { findOne: async () => null };
    },
  } as never);
  const session = {} as never;

  await repository.findByAuthSubject("auth0|user-1");
  await repository.listActiveUserIdsByPermission(["user:view"], session);
  await repository.hasActiveRoleAssignments("user-1", session);
  await repository.listActiveAdminConsoleRoleCodesByUserId("user-1", session);
  await repository.listActiveDelegationCeilingsByUserId("user-1", session);

  assert.equal(pipelines.length, 5);
  for (const pipeline of pipelines) {
    const serialized = JSON.stringify(pipeline);
    assert.equal(serialized.includes("$effectiveAt"), true);
    assert.equal(serialized.includes("$expiresAt"), true);
    assert.equal(serialized.includes('"$lte"'), true);
    assert.equal(serialized.includes('"$gt"'), true);
  }
  assert.equal(
    JSON.stringify(pipelines[0]).includes("nextLifecycleTransitions"),
    true,
  );
});

test("Mongo user auth admin-console role signal uses target codes only", async () => {
  const pipelines: unknown[][] = [];
  const repository = new MongoUserAuthRepository({
    collection(name: string) {
      if (name === "users") {
        return {
          aggregate(pipeline: unknown[]) {
            pipelines.push(pipeline);
            return {
              toArray: async () => [
                {
                  activeAdminConsoleRoleCodes: [
                    "OWNER_ADMIN",
                    "ACCESS_ADMIN",
                    "HR_OPERATIONS",
                    "PRODUCTION_OPS",
                    "TALENT_GROUP_MANAGER",
                    "ORG_UNIT_MANAGER",
                    "STAFF_CONSOLE_USER",
                    "ADMIN_FULL",
                    "TEAM_MANAGER",
                    "COMMERCIAL_FINANCE",
                    "TALENT_STAFF_SELF",
                  ],
                },
              ],
            };
          },
        };
      }
      return { findOne: async () => null };
    },
  } as never);

  const codes = await repository.listActiveAdminConsoleRoleCodesByUserId(
    "user-1",
    {} as never,
  );

  assert.deepEqual(codes, [
    "ACCESS_ADMIN",
    "HR_OPERATIONS",
    "OWNER_ADMIN",
    "PRODUCTION_OPS",
  ]);
  assert.equal(codes.includes("ADMIN_FULL"), false);
  assert.equal(codes.includes("TEAM_MANAGER"), false);
  assert.equal(codes.includes("COMMERCIAL_FINANCE"), false);
  assert.equal(codes.includes("TALENT_STAFF_SELF"), false);
  assert.equal(codes.includes("TALENT_GROUP_MANAGER"), false);
  assert.equal(codes.includes("ORG_UNIT_MANAGER"), false);
  assert.equal(codes.includes("STAFF_CONSOLE_USER"), false);

  const serializedPipeline = JSON.stringify(pipelines[0]);
  for (const code of [
    "OWNER_ADMIN",
    "ACCESS_ADMIN",
    "REVENUE_FINANCE_OPS",
    "REVENUE_APPROVER",
    "COMMISSION_OPS",
    "COMMISSION_APPROVER",
    "VIEWER_AUDITOR",
  ]) {
    assert.equal(serializedPipeline.includes(code), true);
  }
  for (const legacyCode of [
    "ADMIN_FULL",
    "TEAM_MANAGER",
    "COMMERCIAL_FINANCE",
    "TALENT_STAFF_SELF",
  ]) {
    assert.equal(serializedPipeline.includes(legacyCode), false);
  }
});

test("nonterminal role and user lookup reserves the scope fingerprint through suspension", async () => {
  const queries: Record<string, unknown>[] = [];
  const repository = new NativeMongoUserRoleAssignmentRepository({
    collection() {
      return {
        findOne: async (query: Record<string, unknown>) => {
          queries.push(query);
          return null;
        },
      };
    },
  } as never);

  await repository.findActiveByRoleUserAndScopeFingerprint(
    "role-1",
    "user-1",
    "scope:v1:managedTalentGroup|targetId=group-a",
  );
  await repository.findActiveByRoleAndUser("role-1", "user-1");

  assert.deepEqual(queries, [
    {
      roleId: "role-1",
      userId: "user-1",
      scopeFingerprint: "scope:v1:managedTalentGroup|targetId=group-a",
      state: { $in: ["ACTIVE", "SCHEDULED", "SUSPENDED"] },
    },
    {
      roleId: "role-1",
      userId: "user-1",
      state: { $in: ["ACTIVE", "SCHEDULED", "SUSPENDED"] },
    },
  ]);
});

test("HR manager bundle expands to target HR operations and terms approval roles", () => {
  const bundle = getRoleBundle("HR_MANAGER_BUNDLE", "2026-06-26");

  assert.ok(bundle);
  assert.deepEqual(bundle.childRoles, ["HR_OPERATIONS", "HR_TERMS_APPROVER"]);
  assert.equal(bundle.recommendedAccountContext, "ADMIN_CONSOLE");
});

test("effective access deduplicates permissions and traces child assignment scope and bundle origin", async () => {
  let writeCount = 0;
  const service = new EffectiveAccessAdminService(
    fakeDb({
      users: [
        {
          _id: "user-1",
          actorKind: "ADMIN",
          accountStatus: "ACTIVE",
          accountContexts: ["MANAGER_CONSOLE"],
          profile: { displayName: "User One" },
          reportingManagerId: "manager-1",
        },
      ],
      role_assignments: [
        {
          _id: "assignment-a",
          roleId: "role-a",
          userId: "user-1",
          state: "ACTIVE",
          effectiveAt: 1,
          structuredScopeGrants: [
            { scopeType: "managedTalentGroup", targetId: "group-a" },
          ],
          scopeFingerprint: "scope:v1:managedTalentGroup|targetId=group-a",
          origin: "BUNDLE",
          bundleOrigin: {
            bundleAssignmentId: "bundle-assignment-1",
            bundleCode: "TALENT_GROUP_MANAGER_BUNDLE",
            bundleVersion: "2026-06-18",
          },
          reason: "Manage Group A",
          createdAt: 1,
        },
        {
          _id: "assignment-b",
          roleId: "role-b",
          userId: "user-1",
          state: "ACTIVE",
          effectiveAt: 1,
          reason: "Audit",
          createdAt: 2,
        },
      ],
      roles: [
        {
          _id: "role-a",
          code: "TEAM_MANAGER",
          name: "Team Manager",
          state: "ACTIVE",
          permissions: ["kpi:read", "event:read"],
        },
        {
          _id: "role-b",
          code: "VIEWER_AUDITOR",
          name: "Viewer",
          state: "ACTIVE",
          permissions: ["event:read"],
        },
      ],
      onWrite: () => {
        writeCount += 1;
      },
    }),
  );

  const result = await service.getForUser("user-1");
  assert.deepEqual(result.permissions, ["event:read", "kpi:read"]);
  assert.deepEqual(
    (result.accountContextSignals as Record<string, unknown>).accountContexts,
    ["MANAGER_CONSOLE"],
  );
  assert.equal(
    (
      result.workspaceAvailability as {
        primaryWorkspace: string | null;
      }
    ).primaryWorkspace,
    "MANAGER_CONSOLE",
  );
  const trace = result.permissionSourceTrace as Array<{
    permission: string;
    sources: Array<Record<string, unknown>>;
  }>;
  assert.equal(
    trace.find((item) => item.permission === "event:read")?.sources.length,
    2,
  );
  assert.equal(
    trace.find((item) => item.permission === "kpi:read")?.sources[0]
      ?.bundleOrigin !== null,
    true,
  );
  assert.equal(result.readOnly, true);
  assert.equal(result.sourceTruth, false);
  assert.deepEqual(result.businessResponsibilitySupport, {
    status: "NOT_EVALUATED",
    claims: [],
    note: "Business responsibility assignments remain separate source truth and are not inferred by this read model.",
  });
  assert.equal(writeCount, 0);
});

test("effective access materializes only currently effective assignments and exposes lifecycle metadata", async () => {
  const now = Date.now();
  const result = await new EffectiveAccessAdminService(
    fakeDb({
      users: [
        {
          _id: "user-1",
          actorKind: "ADMIN",
          accountStatus: "ACTIVE",
          accountContexts: ["STAFF_CONSOLE"],
        },
      ],
      role_assignments: [
        {
          _id: "current",
          roleId: "role-current",
          userId: "user-1",
          state: "ACTIVE",
          effectiveAt: now - 1_000,
          expiresAt: now + 60_000,
          reviewAt: now + 30_000,
          assignedBy: "admin-1",
          assignedAt: now - 2_000,
          origin: "DIRECT",
          reason: "Current",
          createdAt: now - 2_000,
        },
        {
          _id: "future",
          roleId: "role-future",
          userId: "user-1",
          state: "ACTIVE",
          effectiveAt: now + 60_000,
          expiresAt: null,
          reason: "Future",
          createdAt: now,
        },
        {
          _id: "expired",
          roleId: "role-expired",
          userId: "user-1",
          state: "ACTIVE",
          effectiveAt: now - 60_000,
          expiresAt: now,
          reason: "Expired",
          createdAt: now,
        },
        {
          _id: "revoked",
          roleId: "role-revoked",
          userId: "user-1",
          state: "REVOKED",
          effectiveAt: now - 60_000,
          expiresAt: null,
          reason: "Original reason",
          revokeReason: "Removed",
          createdAt: now,
        },
      ],
      roles: [
        {
          _id: "role-current",
          code: "CURRENT",
          name: "Current",
          state: "ACTIVE",
          permissions: ["current:read"],
        },
        {
          _id: "role-future",
          code: "FUTURE",
          name: "Future",
          state: "ACTIVE",
          permissions: ["future:read"],
        },
        {
          _id: "role-expired",
          code: "EXPIRED",
          name: "Expired",
          state: "ACTIVE",
          permissions: ["expired:read"],
        },
        {
          _id: "role-revoked",
          code: "REVOKED",
          name: "Revoked",
          state: "ACTIVE",
          permissions: ["revoked:read"],
        },
      ],
    }),
  ).getForUser("user-1");

  assert.deepEqual(result.permissions, ["current:read"]);
  const assignments = result.activeRoleAssignments as Array<
    Record<string, unknown>
  >;
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0]?.assignmentId, "current");
  assert.equal(assignments[0]?.assignedBy, "admin-1");
  assert.equal(assignments[0]?.expiresAt, now + 60_000);
  assert.equal(assignments[0]?.reviewAt, now + 30_000);
  assert.equal(assignments[0]?.origin, "DIRECT");
});

test("effective access excludes an effective SCHEDULED predecessor at its chained cutover", async () => {
  const cutover = Date.now() - 1_000;
  const result = await new EffectiveAccessAdminService(
    fakeDb({
      users: [
        {
          _id: "user-chain",
          actorKind: "ADMIN",
          accountStatus: "ACTIVE",
          accountContexts: ["STAFF_CONSOLE"],
        },
      ],
      role_assignments: [
        {
          _id: "assignment-b",
          roleId: "role-b",
          userId: "user-chain",
          state: "SCHEDULED",
          effectiveAt: cutover - 10_000,
          expiresAt: cutover + 60_000,
          lifecycle: {
            riskTier: "LOW",
            reviewDeadline: cutover + 30_000,
            successorAssignmentId: "assignment-c",
            successorEffectiveAt: cutover,
          },
          reason: "predecessor",
          createdAt: cutover - 10_000,
        },
        {
          _id: "assignment-c",
          roleId: "role-c",
          userId: "user-chain",
          state: "SCHEDULED",
          effectiveAt: cutover,
          expiresAt: cutover + 60_000,
          reviewAt: cutover + 30_000,
          reason: "successor",
          createdAt: cutover,
        },
      ],
      roles: [
        {
          _id: "role-b",
          code: "CHAIN_B",
          name: "B",
          state: "ACTIVE",
          permissions: ["chain:b"],
        },
        {
          _id: "role-c",
          code: "CHAIN_C",
          name: "C",
          state: "ACTIVE",
          permissions: ["chain:c"],
        },
      ],
    }),
  ).getForUser("user-chain");

  assert.deepEqual(result.permissions, ["chain:c"]);
  assert.deepEqual(
    (result.activeRoleAssignments as Array<{ assignmentId: string }>).map(
      (assignment) => assignment.assignmentId,
    ),
    ["assignment-c"],
  );
});

test("actorKind, route labels, and reporting manager alone grant no effective permission or object scope", async () => {
  const result = await new EffectiveAccessAdminService(
    fakeDb({
      users: [
        {
          _id: "user-1",
          actorKind: "ADMIN",
          accountStatus: "ACTIVE",
          accountContexts: [],
          reportingManagerId: "manager-1",
          route: "/admin",
          workspaceLabel: "Owner",
        },
      ],
      role_assignments: [],
      roles: [],
    }),
  ).getForUser("user-1");

  assert.deepEqual(result.permissions, []);
  assert.deepEqual(result.activeRoleAssignments, []);
  assert.equal(
    (result.accountContextSignals as Record<string, unknown>)
      .grantsAuthorityByItself,
    false,
  );
  assert.deepEqual(
    (result.accountContextSignals as Record<string, unknown>)
      .compatibilityContexts,
    [],
  );
  assert.equal(
    (
      result.workspaceAvailability as {
        primaryWorkspace: string | null;
      }
    ).primaryWorkspace,
    null,
  );
});

function fakeDb(input: {
  readonly users: readonly Record<string, unknown>[];
  readonly role_assignments: readonly Record<string, unknown>[];
  readonly roles: readonly Record<string, unknown>[];
  readonly onWrite?: () => void;
}): never {
  const records = {
    users: input.users,
    role_assignments: input.role_assignments,
    roles: input.roles,
    break_glass_activations: [] as readonly Record<string, unknown>[],
  };
  return {
    collection(name: keyof typeof records) {
      return {
        findOne: async (query: Record<string, unknown>) =>
          records[name].find((item) => item._id === query._id) ?? null,
        find(query: Record<string, unknown>) {
          const filtered = records[name].filter((item) => {
            if (query.userId !== undefined && item.userId !== query.userId) {
              return false;
            }
            if (query.state !== undefined && item.state !== query.state) {
              return false;
            }
            const ids = (query._id as { $in?: readonly string[] } | undefined)
              ?.$in;
            return ids ? ids.includes(item._id as string) : true;
          });
          return {
            sort() {
              return {
                toArray: async () => [...filtered],
              };
            },
          };
        },
        insertOne: async () => input.onWrite?.(),
        updateOne: async () => input.onWrite?.(),
      };
    },
  } as never;
}

async function captureAuthValidityExpressions(now: number): Promise<{
  readonly transitionLookup: Record<string, unknown>;
  readonly transitionProjection: unknown;
  readonly authorizationValidityProjection: unknown;
}> {
  const pipelines: unknown[][] = [];
  const repository = new MongoUserAuthRepository({
    collection(name: string) {
      if (name === "users") {
        return {
          aggregate(pipeline: unknown[]) {
            pipelines.push(pipeline);
            return { toArray: async () => [] };
          },
        };
      }
      return { findOne: async () => null };
    },
  } as never);
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    await repository.findByAuthSubject("auth0|validity-test");
  } finally {
    Date.now = originalNow;
  }

  const pipeline = pipelines[0] as readonly Record<string, unknown>[];
  const transitionLookup = pipeline.find(
    (stage) =>
      (stage.$lookup as { readonly as?: unknown } | undefined)?.as ===
      "nextLifecycleTransitions",
  );
  const authorizationProject = pipeline.find(
    (stage) =>
      (stage.$project as Record<string, unknown> | undefined)
        ?.authorizationValidUntil !== undefined,
  )?.$project as Record<string, unknown> | undefined;
  assert.ok(transitionLookup);
  assert.ok(authorizationProject);

  const transitionPipeline = (
    transitionLookup.$lookup as {
      readonly pipeline: readonly Record<string, unknown>[];
    }
  ).pipeline;
  const transitionProject = transitionPipeline.find(
    (stage) =>
      (stage.$project as Record<string, unknown> | undefined)?.transitions !==
      undefined,
  )?.$project as Record<string, unknown> | undefined;
  assert.ok(transitionProject);

  return {
    transitionLookup,
    transitionProjection: transitionProject.transitions,
    authorizationValidityProjection:
      authorizationProject.authorizationValidUntil,
  };
}

function evaluateTransitionCandidates(
  expression: unknown,
  assignment: Record<string, unknown>,
): number[] {
  const result = evaluateMongoExpression(expression, assignment);
  assert.equal(Array.isArray(result), true);
  return result as number[];
}

function evaluateAuthorizationValidity(
  expression: unknown,
  lifecycleTransitionAt?: number,
  breakGlassExpiresAt?: number,
): unknown {
  return evaluateMongoExpression(expression, {
    nextLifecycleTransitions:
      lifecycleTransitionAt === undefined
        ? []
        : [{ transitionAt: lifecycleTransitionAt }],
    activeBreakGlass:
      breakGlassExpiresAt === undefined
        ? []
        : [{ expiresAt: breakGlassExpiresAt }],
  });
}

function evaluateMongoExpression(
  expression: unknown,
  document: Record<string, unknown>,
  variables: Record<string, unknown> = {},
): unknown {
  if (typeof expression === "string") {
    if (expression.startsWith("$$")) {
      return readExpressionPath(variables, expression.slice(2));
    }
    if (expression.startsWith("$")) {
      return readExpressionPath(document, expression.slice(1));
    }
    return expression;
  }
  if (expression === null || typeof expression !== "object") return expression;
  if (Array.isArray(expression)) {
    return expression.map((item) =>
      evaluateMongoExpression(item, document, variables),
    );
  }
  const object = expression as Record<string, unknown>;
  const operands = (name: string): readonly unknown[] =>
    object[name] as readonly unknown[];
  if ("$ifNull" in object) {
    const [value, fallback] = operands("$ifNull");
    return (
      evaluateMongoExpression(value, document, variables) ??
      evaluateMongoExpression(fallback, document, variables)
    );
  }
  if ("$isNumber" in object) {
    const value = evaluateMongoExpression(
      object.$isNumber,
      document,
      variables,
    );
    return typeof value === "number" && Number.isFinite(value);
  }
  if ("$type" in object) {
    const value = evaluateMongoExpression(object.$type, document, variables);
    if (value === undefined) return "missing";
    if (value === null) return "null";
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "double";
    return typeof value;
  }
  if ("$trim" in object) {
    const trim = object.$trim as { readonly input: unknown };
    const value = evaluateMongoExpression(trim.input, document, variables);
    return typeof value === "string" ? value.trim() : value;
  }
  if ("$strLenCP" in object) {
    const value = evaluateMongoExpression(
      object.$strLenCP,
      document,
      variables,
    );
    return typeof value === "string" ? [...value].length : 0;
  }
  if ("$and" in object) {
    return operands("$and").every((item) =>
      Boolean(evaluateMongoExpression(item, document, variables)),
    );
  }
  if ("$or" in object) {
    return operands("$or").some((item) =>
      Boolean(evaluateMongoExpression(item, document, variables)),
    );
  }
  if ("$let" in object) {
    const letExpression = object.$let as {
      readonly vars: Record<string, unknown>;
      readonly in: unknown;
    };
    const localVariables = Object.fromEntries(
      Object.entries(letExpression.vars).map(([name, value]) => [
        name,
        evaluateMongoExpression(value, document, variables),
      ]),
    );
    return evaluateMongoExpression(letExpression.in, document, {
      ...variables,
      ...localVariables,
    });
  }
  if ("$cond" in object) {
    const [condition, truthy, falsy] = operands("$cond");
    return evaluateMongoExpression(
      Boolean(evaluateMongoExpression(condition, document, variables))
        ? truthy
        : falsy,
      document,
      variables,
    );
  }
  for (const [operator, predicate] of [
    ["$eq", (left: unknown, right: unknown) => left === right],
    ["$ne", (left: unknown, right: unknown) => left !== right],
    ["$gt", (left: unknown, right: unknown) => Number(left) > Number(right)],
    ["$gte", (left: unknown, right: unknown) => Number(left) >= Number(right)],
    ["$lt", (left: unknown, right: unknown) => Number(left) < Number(right)],
    ["$lte", (left: unknown, right: unknown) => Number(left) <= Number(right)],
    [
      "$in",
      (left: unknown, right: unknown) =>
        Array.isArray(right) && right.includes(left),
    ],
  ] as const) {
    if (operator in object) {
      const [left, right] = operands(operator).map((item) =>
        evaluateMongoExpression(item, document, variables),
      );
      return predicate(left, right);
    }
  }
  if ("$size" in object) {
    const value = evaluateMongoExpression(object.$size, document, variables);
    return Array.isArray(value) ? value.length : 0;
  }
  if ("$setIntersection" in object) {
    const [left, right] = operands("$setIntersection").map((item) =>
      evaluateMongoExpression(item, document, variables),
    );
    return Array.isArray(left) && Array.isArray(right)
      ? left.filter((item) => right.includes(item))
      : [];
  }
  if ("$filter" in object) {
    const filter = object.$filter as Record<string, unknown>;
    const input = evaluateMongoExpression(filter.input, document, variables);
    const variableName = String(filter.as);
    return Array.isArray(input)
      ? input.filter((item) =>
          Boolean(
            evaluateMongoExpression(filter.cond, document, {
              ...variables,
              [variableName]: item,
            }),
          ),
        )
      : [];
  }
  if ("$concatArrays" in object) {
    return operands("$concatArrays").flatMap((item) => {
      const value = evaluateMongoExpression(item, document, variables);
      return Array.isArray(value) ? value : [];
    });
  }
  if ("$add" in object || "$multiply" in object || "$min" in object) {
    const operator =
      "$add" in object ? "$add" : "$multiply" in object ? "$multiply" : "$min";
    const rawOperand = object[operator];
    const evaluated = Array.isArray(rawOperand)
      ? rawOperand.map((item) =>
          evaluateMongoExpression(item, document, variables),
        )
      : evaluateMongoExpression(rawOperand, document, variables);
    const values = (Array.isArray(evaluated) ? evaluated : [evaluated]).map(
      Number,
    );
    if (operator === "$add")
      return values.reduce((sum, value) => sum + value, 0);
    if (operator === "$multiply")
      return values.reduce((total, value) => total * value, 1);
    return Math.min(...values);
  }
  throw new Error(
    `Unsupported Mongo test expression: ${JSON.stringify(object)}`,
  );
}

function readExpressionPath(
  source: Record<string, unknown>,
  path: string,
): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, part) =>
        Array.isArray(current)
          ? current.map((item) =>
              item && typeof item === "object"
                ? (item as Record<string, unknown>)[part]
                : undefined,
            )
          : current && typeof current === "object"
            ? (current as Record<string, unknown>)[part]
            : undefined,
      source,
    );
}
