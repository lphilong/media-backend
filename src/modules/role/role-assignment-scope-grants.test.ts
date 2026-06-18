import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { MongoUserAuthRepository } from "@infra/mongo/user/user.auth.repository";
import { NativeMongoUserRoleAssignmentRepository } from "@infra/mongo/role/role.repository";
import {
  assertActorCanGrantAssignmentScopeGrants,
  normalizeAssignmentScopeGrants,
} from "@modules/role/domain/role-assignment-scope-grants";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import { RoleAdminAssignmentExposure } from "@modules/role/shared/role.exposure";

function createActor(params?: {
  readonly permissions?: readonly Permission[];
  readonly scopeGrants?: ConstructorParameters<typeof Actor>[0]["scopeGrants"];
}): Actor {
  return new Actor({
    id: "actor-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: params?.permissions ?? [
      Permission.ROLE_ASSIGN_TO_USER,
    ],
    scopeGrants: params?.scopeGrants,
    isActive: true,
  });
}

test("assignment scope grants normalize missing and empty payloads away", () => {
  assert.equal(
    normalizeAssignmentScopeGrants(undefined),
    undefined,
  );
  assert.equal(
    normalizeAssignmentScopeGrants({
      workSchedule: [],
    }),
    undefined,
  );
});

test("assignment scope grants accept valid modules and de-duplicate in deterministic order", () => {
  assert.deepEqual(
    normalizeAssignmentScopeGrants({
      workSchedule: [
        "global",
        "team",
        "self",
        "team",
      ],
      eventAssignment: ["managedGroup", "global", "global"],
      kpi: ["self", "managedGroup", "self"],
      dashboardLite: ["global"],
    }),
    {
      workSchedule: ["self", "team", "global"],
      eventAssignment: ["global", "managedGroup"],
      kpi: ["managedGroup", "self"],
      dashboardLite: ["global"],
    },
  );
});

test("assignment scope grants reject unsupported modules, values, and shapes", () => {
  assert.throws(
    () =>
      normalizeAssignmentScopeGrants({
        role: ["global"],
      }),
    RoleValidationError,
  );
  assert.throws(
    () =>
      normalizeAssignmentScopeGrants({
        eventAssignment: ["team"],
      }),
    RoleValidationError,
  );
  assert.throws(
    () =>
      normalizeAssignmentScopeGrants({
        workSchedule: "global",
      }),
    RoleValidationError,
  );
  assert.throws(
    () =>
      normalizeAssignmentScopeGrants({
        kpi: ["team"],
      }),
    RoleValidationError,
  );
});

test("scope grant authoring requires an actor to already hold the requested grant", () => {
  const requested = normalizeAssignmentScopeGrants({
    workSchedule: ["department"],
    eventAssignment: ["managedGroup"],
  });

  assertActorCanGrantAssignmentScopeGrants(
    createActor({
      scopeGrants: {
        workSchedule: ["global"],
        eventAssignment: ["managedGroup"],
      },
    }),
    requested,
  );

  assert.throws(
    () =>
      assertActorCanGrantAssignmentScopeGrants(
        createActor({
          scopeGrants: {
            workSchedule: ["team"],
          },
        }),
        requested,
      ),
    RoleValidationError,
  );
});

test("admin actor type and role assignment permission do not override scope grant authoring", () => {
  const requested = normalizeAssignmentScopeGrants({
    dashboardLite: ["global"],
  });

  assert.throws(
    () =>
      assertActorCanGrantAssignmentScopeGrants(
        createActor({
          permissions: [
            Permission.ROLE_ASSIGN_TO_USER,
            Permission.DASHBOARD_LITE_READ,
          ],
          scopeGrants: {},
        }),
        requested,
      ),
    RoleValidationError,
  );
});

test("KPI assignment scope grants require existing KPI grant or global grant ceiling", () => {
  const requested = normalizeAssignmentScopeGrants({
    kpi: ["managedGroup", "self"],
  });

  assertActorCanGrantAssignmentScopeGrants(
    createActor({
      scopeGrants: {
        kpi: ["global"],
      },
    }),
    requested,
  );

  assert.throws(
    () =>
      assertActorCanGrantAssignmentScopeGrants(
        createActor({
          scopeGrants: {
            kpi: ["self"],
          },
        }),
        requested,
      ),
    RoleValidationError,
  );
});

test("permission guard still requires exact permission", () => {
  assert.throws(
    () =>
      PermissionGuard.assert(
        createActor({
          permissions: [Permission.ROLE_ASSIGN_TO_USER],
        }),
        PermissionResolver.resolve(Permission.ROLE_CREATE),
      ),
    /Missing permission role:create/u,
  );
});

test("role assignment persistence stores explicit scopes and reads old records without scopes", async () => {
  const inserted: unknown[] = [];
  const scopedAssignment = {
    assignmentId: "assignment-scoped",
    roleId: "role-1",
    userId: "user-1",
    scopeGrants: {
      workSchedule: ["team"] as const,
    },
    state: "ACTIVE" as const,
    effectiveAt: 1,
    revokedAt: null,
    reason: "coverage",
    createdAt: 1,
    updatedAt: 1,
  };

  const repository = new NativeMongoUserRoleAssignmentRepository({
    collection() {
      return {
        insertOne: async (doc: unknown) => {
          inserted.push(doc);
        },
        findOne: async () => ({
          _id: "assignment-old",
          roleId: "role-1",
          userId: "user-1",
          state: "ACTIVE",
          effectiveAt: 1,
          revokedAt: null,
          reason: null,
          createdAt: 1,
          updatedAt: 1,
        }),
      };
    },
  } as never);

  await repository.insert(scopedAssignment, {} as never);
  const oldAssignment = await repository.findById(
    "assignment-old",
  );

  assert.deepEqual(inserted[0], {
    _id: "assignment-scoped",
    roleId: "role-1",
    userId: "user-1",
    scopeGrants: {
      workSchedule: ["team"],
    },
    state: "ACTIVE",
    effectiveAt: 1,
    expiresAt: null,
    reviewAt: null,
    assignedBy: null,
    assignedAt: 1,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    origin: "LEGACY",
    bundleOrigin: null,
    reason: "coverage",
    createdAt: 1,
    updatedAt: 1,
  });
  assert.equal(oldAssignment?.scopeGrants, undefined);
});

test("role assignment exposure includes assignment scopes for auditability", () => {
  assert.deepEqual(
    RoleAdminAssignmentExposure.expose({
      assignmentId: "assignment-1",
      roleId: "role-1",
      userId: "user-1",
      userRef: null,
      scopeGrants: {
        contractRegistry: ["global"],
      },
      state: "ACTIVE",
      effectiveAt: 1,
      revokedAt: null,
      reason: null,
    }).scopeGrants,
    {
      contractRegistry: ["global"],
    },
  );
});

test("role assignment persistence and exposure preserve AUTH-2 lifecycle and audit metadata", async () => {
  const inserted: Array<Record<string, unknown>> = [];
  const repository = new NativeMongoUserRoleAssignmentRepository({
    collection() {
      return {
        insertOne: async (document: Record<string, unknown>) => {
          inserted.push(document);
        },
      };
    },
  } as never);
  const assignment = {
    assignmentId: "assignment-auth-2",
    roleId: "role-1",
    userId: "user-1",
    structuredScopeGrants: [
      { scopeType: "managedOrgUnit" as const, targetId: "org-a" },
    ],
    scopeFingerprint: "scope:v1:managedOrgUnit|targetId=org-a",
    state: "REVOKED" as const,
    effectiveAt: 10,
    expiresAt: 100,
    reviewAt: 50,
    assignedBy: "admin-1",
    assignedAt: 5,
    revokedAt: 60,
    revokedBy: "admin-2",
    revokeReason: "No longer required",
    origin: "BUNDLE" as const,
    bundleOrigin: {
      bundleAssignmentId: "bundle-assignment-1",
      bundleCode: "HR_OPERATIONS_BUNDLE",
      bundleVersion: "2026-06-18",
    },
    reason: "Original assignment reason",
    createdAt: 5,
    updatedAt: 60,
  };

  await repository.insert(assignment, {} as never);
  const exposed = RoleAdminAssignmentExposure.expose({
    ...assignment,
    userRef: null,
  });

  assert.equal(inserted[0]?.scopeFingerprint, assignment.scopeFingerprint);
  assert.deepEqual(
    inserted[0]?.structuredScopeGrants,
    assignment.structuredScopeGrants,
  );
  for (const field of [
    "assignedBy",
    "assignedAt",
    "effectiveAt",
    "expiresAt",
    "reviewAt",
    "revokedBy",
    "revokeReason",
    "origin",
    "bundleOrigin",
  ]) {
    assert.deepEqual(
      inserted[0]?.[field],
      assignment[field as keyof typeof assignment],
    );
    assert.deepEqual(
      exposed[field],
      assignment[field as keyof typeof assignment],
    );
  }
  assert.equal(exposed.reason, "Original assignment reason");
});

test("auth materialization unions user-level and assignment-level scope grants deterministically", async () => {
  const repository = new MongoUserAuthRepository({
    collection(name: string) {
      if (name === "users") {
        return {
          aggregate: () => ({
            toArray: async () => [
              {
                _id: "user-1",
                actorKind: "ADMIN",
                accountStatus: "ACTIVE",
                assignmentRoleIds: ["role-a", "role-b"],
                resolvedRoleIds: ["role-a", "role-b"],
                rolePermissions: [
                  [Permission.ROLE_LIST],
                  [Permission.ROLE_ASSIGN_TO_USER],
                ],
                roleMaxDelegatableBands: [
                  "LIMITED",
                  "PRIVILEGED",
                ],
                scopeGrants: {
                  workSchedule: ["self"],
                  kpi: ["self"],
                  commission: ["global"],
                },
                assignmentScopeGrants: [
                  {
                    workSchedule: [
                      "global",
                      "team",
                      "team",
                    ],
                    kpi: ["managedGroup"],
                    eventAssignment: ["managedGroup", "global"],
                  },
                  null,
                  {
                    dashboardLite: ["global"],
                    kpi: ["self"],
                  },
                ],
              },
            ],
          }),
        };
      }

      return {
        findOne: async () => null,
      };
    },
  } as never);

  const candidates =
    await repository.findByAuthSubject("auth0|user-1");

  assert.deepEqual(candidates[0]?.permissions, [
    Permission.ROLE_ASSIGN_TO_USER,
    Permission.ROLE_LIST,
  ]);
  assert.deepEqual(candidates[0]?.scopeGrants, {
    workSchedule: ["self", "team", "global"],
    eventAssignment: ["global", "managedGroup"],
    kpi: ["managedGroup", "self"],
    commission: ["global"],
    dashboardLite: ["global"],
  });
});

test("auth materialization rejects unsupported event assignment scopes", async () => {
  const repository = new MongoUserAuthRepository({
    collection(name: string) {
      if (name === "users") {
        return {
          aggregate: () => ({
            toArray: async () => [
              {
                _id: "user-1",
                actorKind: "ADMIN",
                accountStatus: "ACTIVE",
                assignmentRoleIds: ["role-a"],
                resolvedRoleIds: ["role-a"],
                rolePermissions: [[Permission.EVENT_READ]],
                roleMaxDelegatableBands: ["LIMITED"],
                assignmentScopeGrants: [
                  {
                    eventAssignment: ["team"],
                  },
                ],
              },
            ],
          }),
        };
      }

      return {
        findOne: async () => null,
      };
    },
  } as never);

  await assert.rejects(
    () => repository.findByAuthSubject("auth0|user-1"),
    /Invalid actor eventAssignment scope grant value/u,
  );
});

test("auth materialization preserves missing or inactive role integrity semantics", async () => {
  const repository = new MongoUserAuthRepository({
    collection(name: string) {
      if (name === "users") {
        return {
          aggregate: () => ({
            toArray: async () => [
              {
                _id: "user-1",
                actorKind: "ADMIN",
                accountStatus: "ACTIVE",
                assignmentRoleIds: ["missing-role"],
                resolvedRoleIds: [],
                rolePermissions: [],
                roleMaxDelegatableBands: [],
                assignmentScopeGrants: [
                  {
                    workSchedule: ["global"],
                  },
                ],
              },
            ],
          }),
        };
      }

      return {
        findOne: async () => null,
      };
    },
  } as never);

  await assert.rejects(
    () => repository.findByAuthSubject("auth0|user-1"),
    /missing or inactive roles/u,
  );
});
