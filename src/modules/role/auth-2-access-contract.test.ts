import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { RoleAssignmentConflictError, RoleValidationError } from "@modules/role/domain/role.errors";
import {
  buildRoleAssignmentScopeFingerprint,
  normalizeRoleAssignmentScopeGrants,
} from "@modules/role/domain/role-assignment-scope";
import { isRoleAssignmentCurrentlyEffective } from "@modules/role/domain/role-assignment-lifecycle";
import { getRoleBundle } from "@modules/role/domain/role-bundle.catalog";
import { RoleBundleAdminService } from "@modules/role/admin/admin.role-bundle.service";
import { EffectiveAccessAdminService } from "@modules/role/admin/admin.effective-access.service";
import { NativeMongoUserRoleAssignmentRepository } from "@infra/mongo/role/role.repository";
import {
  buildCurrentlyEffectiveRoleAssignmentExpression,
  MongoUserAuthRepository,
} from "@infra/mongo/user/user.auth.repository";
import { RoleBundleTemplate } from "@modules/role/domain/role-bundle.catalog";

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
    () =>
      normalizeRoleAssignmentScopeGrants([
        { scopeType: "managedOrgUnit" },
      ]),
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
  assert.equal(
    new Set(grants?.map((grant) => grant.scopeType)).size,
    12,
  );
});

test("object and period scopes reject irrelevant unsafe fields", () => {
  const unsafe = [
    { scopeType: "managedTalentGroup", targetId: "group-a", periodKey: "2026-06" },
    { scopeType: "managedOrgUnit", targetId: "org-a", targetKey: "unsafe" },
    { scopeType: "assignedPlatformAccount", targetId: "platform-a", periodKey: "2026-06" },
    { scopeType: "financePeriod", periodKey: "2026-06", targetId: "unsafe" },
    { scopeType: "contractPortfolio", targetKey: "portfolio-a", targetId: "unsafe" },
    { scopeType: "assignedEvent", targetId: "event-a", targetKey: "unsafe" },
    { scopeType: "assignedStudioResource", targetId: "studio-a", periodKey: "2026-06" },
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

test("Mongo runtime assignment expression implements lifecycle boundary semantics", () => {
  assert.deepEqual(buildCurrentlyEffectiveRoleAssignmentExpression(1_000), {
    $and: [
      { $eq: ["$state", "ACTIVE"] },
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
    ],
  });
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
    assert.equal(serialized.includes("\"$lte\""), true);
    assert.equal(serialized.includes("\"$gt\""), true);
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

test("same role and user lookup is fingerprint-specific while legacy lookup remains compatible", async () => {
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
      scopeFingerprint:
        "scope:v1:managedTalentGroup|targetId=group-a",
      state: "ACTIVE",
    },
    {
      roleId: "role-1",
      userId: "user-1",
      state: "ACTIVE",
    },
  ]);
});

test("HR manager bundle expands to target HR operations and terms approval roles", () => {
  const bundle = getRoleBundle("HR_MANAGER_BUNDLE", "2026-06-26");

  assert.ok(bundle);
  assert.deepEqual(bundle.childRoles, [
    "HR_OPERATIONS",
    "HR_TERMS_APPROVER",
  ]);
  assert.equal(bundle.recommendedAccountContext, "ADMIN_CONSOLE");
});

test("bundle assignment expands to child assignments and records immutable origin", async () => {
  const bundle = getRoleBundle("TALENT_GROUP_MANAGER_BUNDLE", "2026-06-26");
  assert.ok(bundle);
  const calls: Array<Record<string, unknown>> = [];
  const service = new RoleBundleAdminService(
    {
      findByCode: async () => ({
        id: "role-talent-group-manager",
        code: "TALENT_GROUP_MANAGER",
        name: "Talent Group Manager",
        description: null,
        state: "ACTIVE",
        permissions: ["kpi:read"],
        delegationBand: "LIMITED",
        maxDelegatableBand: "NONE",
        createdAt: 1,
        updatedAt: 1,
        activatedAt: 1,
        archivedAt: null,
      }),
    } as never,
    {
      assignRoleToUser: async (_actor: Actor, command: Record<string, unknown>) => {
        calls.push(command);
        return {
          assignmentId: "assignment-1",
          roleId: "role-talent-group-manager",
          userId: "user-1",
        };
      },
    } as never,
  );

  const result = await service.assignBundle(actor(), {
    bundleCode: bundle.code,
    bundleVersion: bundle.version,
    userId: "user-1",
    reason: "Manage Group A",
    structuredScopeGrants: [
      { scopeType: "managedTalentGroup", targetId: "group-a" },
    ],
  });

  assert.equal(result.childAssignments[0]?.status, "CREATED");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.bundleOrigin, {
    bundleAssignmentId: result.bundleAssignmentId,
    bundleCode: bundle.code,
    bundleVersion: bundle.version,
  });
  assert.equal(Object.isFrozen(bundle), true);
});

test("bundle duplicate child assignment is idempotently reported as existing", async () => {
  const service = new RoleBundleAdminService(
    {
      findByCode: async () => ({
        id: "role-self",
        code: "STAFF_CONSOLE_USER",
        state: "ACTIVE",
      }),
    } as never,
    {
      assignRoleToUser: async () => {
        throw new RoleAssignmentConflictError("duplicate");
      },
    } as never,
  );

  const result = await service.assignBundle(actor(), {
    bundleCode: "STAFF_CONSOLE_BUNDLE",
    bundleVersion: "2026-06-26",
    userId: "user-1",
    reason: "Staff access",
    structuredScopeGrants: [{ scopeType: "self" }],
  });

  assert.deepEqual(result.childAssignments, [
    {
      roleId: "role-self",
      roleCode: "STAFF_CONSOLE_USER",
      status: "EXISTING",
      assignmentId: null,
    },
  ]);
});

test("bundle preflight rejects missing or inactive children before creating any assignment", async () => {
  for (const secondChild of [null, { id: "role-b", code: "ROLE_B", state: "INACTIVE" }]) {
    let assignmentCalls = 0;
    const bundle = multiChildBundle();
    const service = new RoleBundleAdminService(
      {
        findByCode: async (code: string) =>
          code === "ROLE_A"
            ? {
                id: "role-a",
                code: "ROLE_A",
                state: "ACTIVE",
              }
            : secondChild,
      } as never,
      {
        assignRoleToUser: async () => {
          assignmentCalls += 1;
          return { assignmentId: "unexpected" };
        },
      } as never,
      () => bundle,
    );

    await assert.rejects(
      () =>
        service.assignBundle(actor(), {
          bundleCode: bundle.code,
          bundleVersion: bundle.version,
          userId: "user-1",
          reason: "Multi-child preflight",
          structuredScopeGrants: [{ scopeType: "self" }],
        }),
      /must exist and be ACTIVE/u,
    );
    assert.equal(assignmentCalls, 0);
  }
});

test("bundle passes submitted structured scope to every prevalidated child", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const bundle = multiChildBundle();
  const service = new RoleBundleAdminService(
    {
      findByCode: async (code: string) => ({
        id: `id-${code}`,
        code,
        state: "ACTIVE",
      }),
    } as never,
    {
      assignRoleToUser: async (_actor: Actor, command: Record<string, unknown>) => {
        calls.push(command);
        return { assignmentId: `assignment-${calls.length}` };
      },
    } as never,
    () => bundle,
  );

  const result = await service.assignBundle(actor(), {
    bundleCode: bundle.code,
    bundleVersion: bundle.version,
    userId: "user-1",
    reason: "Scoped bundle",
    structuredScopeGrants: [
      { scopeType: "managedOrgUnit", targetId: "org-a" },
    ],
  });

  assert.equal(result.childAssignments.length, 2);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.structuredScopeGrants, [
      { scopeType: "managedOrgUnit", targetId: "org-a" },
    ]);
  }
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
          scopeFingerprint:
            "scope:v1:managedTalentGroup|targetId=group-a",
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
  const assignments = result.activeRoleAssignments as Array<Record<string, unknown>>;
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0]?.assignmentId, "current");
  assert.equal(assignments[0]?.assignedBy, "admin-1");
  assert.equal(assignments[0]?.expiresAt, now + 60_000);
  assert.equal(assignments[0]?.reviewAt, now + 30_000);
  assert.equal(assignments[0]?.origin, "DIRECT");
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

function actor(): Actor {
  return new Actor({
    id: "admin-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [],
    scopeGrants: {},
    isActive: true,
  });
}

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

function multiChildBundle(): RoleBundleTemplate {
  return {
    code: "HR_STAFF_BUNDLE",
    name: "Test multi-child bundle",
    description: "Test only",
    businessPurpose: "Verify preflight behavior",
    status: "ACTIVE",
    version: "test-v1",
    childRoles: ["ROLE_A", "ROLE_B"],
    recommendedAccountContext: "ADMIN_CONSOLE",
    recommendedScopes: ["self"],
    sensitiveWarning: null,
    sensitive: false,
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
  };
}
