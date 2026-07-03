import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { NextFunction, Request, Response } from "express";
import { ClientSession, Db } from "mongodb";
import { bindActor } from "@core/actor/actor-context";
import { Actor } from "@core/actor/actor";
import { contextMiddleware } from "@core/context/context.middleware.adapter";
import { mapToHttpError } from "@app/http/http-error.map";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { runWithDomainEventCollector } from "@system/event-bridge/domain-event.types";
import { AccessAssignmentPreviewAdminService } from "@modules/role/admin/admin.access-assignment-preview.service";
import { AccessAssignmentApplyAdminService } from "@modules/role/admin/admin.access-assignment-apply.service";
import { AccessAssignmentLifecycleAdminService } from "@modules/role/admin/admin.access-assignment-lifecycle.service";
import { AdminAccessAssignmentPreviewController } from "@modules/role/admin/admin.access-assignment-preview.controller";
import { adminAccessAssignmentPreviewRoutes } from "@modules/role/admin/admin.access-assignment-preview.routes";
import { AdminRoleController } from "@modules/role/admin/admin.role.controller";
import { adminRoleRoutes } from "@modules/role/admin/admin.role.routes";
import { AdminRoleBundleController } from "@modules/role/admin/admin.role-bundle.controller";
import { adminRoleBundleRoutes } from "@modules/role/admin/admin.role-bundle.routes";

const CANONICAL_ASSIGNMENT_TARGET_CODES = [
  "HR_OPERATIONS",
  "PRODUCTION_OPS",
  "VIEWER_AUDITOR",
] as const;

const TRUE_LEGACY_ASSIGNMENT_TARGET_CODES = [
  "ADMIN_FULL",
  "TEAM_MANAGER",
  "COMMERCIAL_FINANCE",
  "TALENT_STAFF_SELF",
] as const;

const EFFECTIVE_AT = Date.UTC(2026, 0, 1);
const REVIEW_AT_30_DAYS = Date.UTC(2026, 0, 31);

test("access assignment apply creates role assignment with audit trace and effective access", async () => {
  const audit = fakeAudit();
  const invalidator = fakeInvalidator();
  const db = fakeDb({
    users: [
      activeUser("access-admin", ["ADMIN_CONSOLE"]),
      activeUser("target-user", ["STAFF_CONSOLE"]),
    ],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-access", "ACCESS_ADMIN", [Permission.ROLE_ASSIGN_TO_USER], {
        maxDelegatableBand: "PRIVILEGED",
      }),
      role("role-staff", "STAFF_CONSOLE_USER", [
        Permission.WORK_SCHEDULE_READ,
      ]),
    ],
    role_assignments: [actorDelegationAssignment("assignment-actor", "role-access")],
    role_assignment_rules: [],
    responsibility_assignments: [],
  });

  const result = await withTrace(() =>
    new AccessAssignmentApplyAdminService(
      db,
      audit.guard,
      fakeBridge(),
      invalidator.service,
    ).apply(actor(), {
      targetUserId: "target-user",
      assignmentTargetType: "ROLE_TEMPLATE",
      assignmentTargetCode: "STAFF_CONSOLE_USER",
      structuredScopeGrants: [{ scopeType: "self" }],
      reason: "Staff console access requested by owner",
    }),
  );

  assert.equal(result.applied, true);
  assert.equal(result.applyStatus, "APPLIED");
  assert.equal(db.rows("role_assignments").length, 2);
  const inserted = db.rows("role_assignments").find((row) => row.userId === "target-user");
  assert.equal(inserted?.roleId, "role-staff");
  assert.equal(inserted?.reason, "Staff console access requested by owner");
  assert.equal(inserted?.scopeFingerprint, "scope:v1:self");
  assert.equal(inserted?.assignedBy, "access-admin");
  assert.equal(audit.records.length, 1);
  assert.equal(readPath(result, ["auditTrace", "written"]), true);
  assert.deepEqual(readPath(result, ["effectiveAccessAfterApply", "permissions"]), [
    Permission.WORK_SCHEDULE_READ,
  ]);
  assert.equal(invalidator.calls.length, 1);
});

test("access assignment apply permits canonical target roles through preview classification", async () => {
  const permissionsByCode = {
    HR_OPERATIONS: Permission.EMPLOYMENT_PROFILE_READ,
    PRODUCTION_OPS: Permission.EVENT_READ,
    VIEWER_AUDITOR: Permission.KPI_READ,
  } as const;

  for (const code of CANONICAL_ASSIGNMENT_TARGET_CODES) {
    const db = baseApplyDb({
      targetContexts: ["ADMIN_CONSOLE"],
      targetRoleCode: code,
      targetRolePermissions: [permissionsByCode[code]],
    });

    const result = await withTrace(() =>
      applyWithFakes(db, {
        targetUserId: "target-user",
        assignmentTargetType: "ROLE_TEMPLATE",
        assignmentTargetCode: code,
        structuredScopeGrants: [{ scopeType: "global" }],
        reason: `canonical assignment for ${code}`,
        effectiveAt: EFFECTIVE_AT,
        reviewAt: REVIEW_AT_30_DAYS,
      }),
    );

    const inserted = db.rows("role_assignments").find((row) => row.userId === "target-user");
    assert.equal(result.applied, true);
    assert.equal(result.applyStatus, "APPLIED");
    assert.deepEqual(readCodes(result.blockers), []);
    assert.equal(inserted?.roleId, `role-${code}`);
    assert.equal(inserted?.reviewAt, REVIEW_AT_30_DAYS);
    assert.equal(readPath(result, ["sensitiveAccess", "isGlobalLike"]), true);
    assert.equal(readPath(result, ["sensitiveAccess", "requiresReview"]), true);
    assert.equal(
      readPath(result, ["effectiveAccessAfterApply", "activeRoleAssignments", 0, "isGlobalLike"]),
      true,
    );
    assert.equal(
      readPath(result, ["effectiveAccessAfterApply", "activeRoleAssignments", 0, "requiresReview"]),
      true,
    );
  }
});

test("access assignment apply returns review policy blockers for global grants", async () => {
  const db = baseApplyDb({
    targetContexts: ["ADMIN_CONSOLE"],
    targetRoleCode: "VIEWER_AUDITOR",
    targetRolePermissions: [Permission.KPI_READ],
  });

  const result = await withTrace(() =>
    applyWithFakes(db, {
      targetUserId: "target-user",
      assignmentTargetType: "ROLE_TEMPLATE",
      assignmentTargetCode: "VIEWER_AUDITOR",
      structuredScopeGrants: [{ scopeType: "global" }],
      reason: "global audit access",
      effectiveAt: EFFECTIVE_AT,
    }),
  );

  assert.equal(result.applied, false);
  assert.deepEqual(readCodes(result.blockers), ["REVIEW_AT_REQUIRED"]);
  assert.equal(readPath(result, ["sensitiveAccess", "isGlobalLike"]), true);
  assert.equal(readPath(result, ["sensitiveAccess", "requiresReview"]), true);
  assert.equal(db.rows("role_assignments").filter((row) => row.userId === "target-user").length, 0);
});

test("access assignment apply materializes missing AccountContext before child assignment", async () => {
  const db = baseApplyDb({
    targetContexts: ["STAFF_CONSOLE"],
    targetRoleCode: "TALENT_GROUP_MANAGER",
    targetRolePermissions: [Permission.TALENT_GROUP_READ],
    responsibilities: [
      responsibility("resp-1", "profile-1", "TALENT_GROUP", "group-a", "TALENT_GROUP_MANAGER"),
    ],
  });

  const result = await withTrace(() =>
    applyWithFakes(db, {
      targetUserId: "target-user",
      assignmentTargetType: "ROLE_TEMPLATE",
      assignmentTargetCode: "TALENT_GROUP_MANAGER",
      structuredScopeGrants: [
        { scopeType: "managedTalentGroup", targetId: "group-a" },
      ],
      reason: "manager setup",
    }),
  );

  assert.equal(result.applied, true);
  assert.deepEqual(readCodes(result.blockers), []);
  assert.equal(db.rows("role_assignments").filter((row) => row.userId === "target-user").length, 1);
  assert.deepEqual(
    db.rows("users").find((row) => row._id === "target-user")?.accountContexts,
    ["STAFF_CONSOLE", "MANAGER_CONSOLE"],
  );
  assert.equal(readPath(result, ["accountContextResult", "materialized"]), true);
  assert.deepEqual(
    readPath(result, ["accountContextResult", "appliedAccountContexts"]),
    ["MANAGER_CONSOLE"],
  );
  assert.equal(
    readPath(result, [
      "effectiveAccessAfterApply",
      "workspaceAvailability",
      "primaryWorkspace",
    ]),
    "MANAGER_CONSOLE",
  );
  assert.equal(readPath(result, ["auditTrace", "written"]), true);
});

test("access assignment apply creates bundle parent and traces child assignments to it", async () => {
  const db = baseApplyDb({
    targetContexts: ["STAFF_CONSOLE"],
    targetRoleCode: "STAFF_CONSOLE_USER",
    targetRolePermissions: [Permission.WORK_SCHEDULE_READ],
  });

  const result = await withTrace(() =>
    applyWithFakes(db, {
      targetUserId: "target-user",
      assignmentTargetType: "BUNDLE",
      assignmentTargetCode: "STAFF_CONSOLE_BUNDLE",
      bundleVersion: "2026-06-26",
      structuredScopeGrants: [{ scopeType: "self" }],
      reason: "staff bundle setup",
    }),
  );

  const inserted = db.rows("role_assignments").find((row) => row.userId === "target-user");
  assert.equal(result.applied, true);
  assert.equal(inserted?.origin, "BUNDLE");
  assert.equal(readPath(inserted, ["bundleOrigin", "bundleCode"]), "STAFF_CONSOLE_BUNDLE");
  assert.equal(db.rows("bundle_assignments").length, 1);
  const parent = db.rows("bundle_assignments")[0];
  assert.equal(parent?.targetUserId, "target-user");
  assert.equal(parent?.bundleCode, "STAFF_CONSOLE_BUNDLE");
  assert.equal(readPath(inserted, ["bundleOrigin", "bundleAssignmentId"]), parent?._id);
  assert.equal(readPath(result, ["bundleExpansion", "persistedParentBundleAssignment"]), true);
  assert.equal(
    readPath(result, ["bundleExpansion", "parentBundleAssignment", "bundleAssignmentId"]),
    parent?._id,
  );
  assert.equal(readPath(result, ["bundleExpansion", "appliedChildCount"]), 1);
});

test("access assignment apply creates required responsibility only when actor is authorized", async () => {
  const db = baseApplyDb({
    targetContexts: ["MANAGER_CONSOLE"],
    targetRoleCode: "TALENT_GROUP_MANAGER",
    targetRolePermissions: [Permission.TALENT_GROUP_READ],
    talentGroups: [{ _id: "group-a", status: "ACTIVE" }],
  });

  const result = await withTrace(() =>
    applyWithFakes(
      db,
      {
        targetUserId: "target-user",
        assignmentTargetType: "ROLE_TEMPLATE",
        assignmentTargetCode: "TALENT_GROUP_MANAGER",
        structuredScopeGrants: [
          { scopeType: "managedTalentGroup", targetId: "group-a" },
        ],
        reason: "manager setup",
      },
      actor([Permission.TALENT_GROUP_UPDATE]),
    ),
  );

  const created = db.rows("responsibility_assignments")[0];
  assert.equal(result.applied, true);
  assert.equal(created?.subjectType, "TALENT_GROUP");
  assert.equal(created?.subjectId, "group-a");
  assert.equal(created?.responsibleEmploymentProfileId, "profile-1");
  assert.equal(created?.responsibilityType, "TALENT_GROUP_MANAGER");
  assert.equal(readPath(result, ["responsibilityOperationResult", "materialized"]), true);
  assert.equal(
    readPath(result, [
      "responsibilityOperationResult",
      "items",
      0,
      "responsibilityAssignmentId",
    ]),
    created?._id,
  );
});

test("access assignment apply blocks missing responsibility and requires reason for all changes", async () => {
  const db = baseApplyDb({
    targetContexts: ["MANAGER_CONSOLE"],
    targetRoleCode: "TALENT_GROUP_MANAGER",
    targetRolePermissions: [Permission.TALENT_GROUP_READ],
  });

  const missingResponsibility = await withTrace(() =>
    applyWithFakes(db, {
      targetUserId: "target-user",
      assignmentTargetType: "ROLE_TEMPLATE",
      assignmentTargetCode: "TALENT_GROUP_MANAGER",
      structuredScopeGrants: [
        { scopeType: "managedTalentGroup", targetId: "group-a" },
      ],
      reason: "manager setup",
    }),
  );
  assert.equal(missingResponsibility.applied, false);
  assert.deepEqual(readCodes(missingResponsibility.blockers), ["RESPONSIBILITY_MATERIALIZATION_NOT_AUTHORIZED"]);

  const missingReason = await withTrace(() =>
    applyWithFakes(
      baseApplyDb({
        targetContexts: ["STAFF_CONSOLE"],
        targetRoleCode: "STAFF_CONSOLE_USER",
        targetRolePermissions: [Permission.WORK_SCHEDULE_READ],
      }),
      {
        targetUserId: "target-user",
        assignmentTargetType: "ROLE_TEMPLATE",
        assignmentTargetCode: "STAFF_CONSOLE_USER",
        structuredScopeGrants: [{ scopeType: "self" }],
      },
    ),
  );
  assert.equal(missingReason.applied, false);
  assert.deepEqual(readCodes(missingReason.blockers), ["REASON_REQUIRED"]);
});

test("access assignment apply blocks true legacy targets and self-assignment", async () => {
  for (const code of TRUE_LEGACY_ASSIGNMENT_TARGET_CODES) {
    const db = baseApplyDb({
      targetContexts: ["ADMIN_CONSOLE", "STAFF_CONSOLE"],
      targetRoleCode: code,
      targetRolePermissions: [Permission.ROLE_ASSIGN_TO_USER],
    });
    const legacy = await withTrace(() =>
      applyWithFakes(db, {
        targetUserId: "target-user",
        assignmentTargetType: "ROLE_TEMPLATE",
        assignmentTargetCode: code,
        structuredScopeGrants: [{ scopeType: "global" }],
        reason: "legacy check",
        effectiveAt: EFFECTIVE_AT,
        reviewAt: REVIEW_AT_30_DAYS,
      }),
    );
    assert.equal(legacy.applied, false);
    assert.deepEqual(readCodes(legacy.blockers), ["LEGACY_ROLE_BLOCKED"]);
    assert.equal(db.rows("role_assignments").filter((row) => row.userId === "target-user").length, 0);
  }

  const self = await withTrace(() =>
    applyWithFakes(
      baseApplyDb({
        targetUserId: "access-admin",
        targetContexts: ["STAFF_CONSOLE"],
        targetRoleCode: "STAFF_CONSOLE_USER",
        targetRolePermissions: [Permission.WORK_SCHEDULE_READ],
      }),
      {
        targetUserId: "access-admin",
        assignmentTargetType: "ROLE_TEMPLATE",
        assignmentTargetCode: "STAFF_CONSOLE_USER",
        structuredScopeGrants: [{ scopeType: "self" }],
        reason: "self check",
      },
    ),
  );
  assert.equal(self.applied, false);
  assert.deepEqual(readCodes(self.blockers), ["SELF_ASSIGNMENT_BLOCKED"]);
});

test("access assignment apply controller rejects frontend-owned authority fields", async () => {
  let applyReached = false;
  const app = express();
  app.use(express.json());
  app.use(contextMiddleware("ADMIN"));
  app.use((req, _res, next) => {
    bindActor(req, actor());
    next();
  });
  app.use(
    "/admin/access-assignments",
    adminAccessAssignmentPreviewRoutes(
      new AdminAccessAssignmentPreviewController(
        new AccessAssignmentPreviewAdminService(fakeDb({})),
        {
          async apply(): Promise<unknown> {
            applyReached = true;
            return {};
          },
        } as unknown as AccessAssignmentApplyAdminService,
      ),
    ),
  );
  app.use(errorHandler);

  const server = await listen(app);
  try {
    const response = await fetch(`${toBaseUrl(server)}/admin/access-assignments/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: "target-user",
        assignmentTargetType: "ROLE_TEMPLATE",
        assignmentTargetCode: "STAFF_CONSOLE_USER",
        structuredScopeGrants: [{ scopeType: "self" }],
        reason: "attempt",
        actorKind: "ADMIN",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(applyReached, false);
  } finally {
    await close(server);
  }
});

test("access assignment lifecycle lists target-user assignments with audit summary", async () => {
  const db = fakeDb({
    users: [
      activeUser("access-admin", ["ADMIN_CONSOLE"]),
      activeUser("target-user", ["STAFF_CONSOLE"]),
    ],
    roles: [
      role("role-staff", "STAFF_CONSOLE_USER", [
        Permission.WORK_SCHEDULE_READ,
      ]),
    ],
    role_assignments: [
      targetAssignment("assignment-target", "role-staff", {
        bundleOrigin: {
          bundleAssignmentId: "bundle-assignment-1",
          bundleCode: "STAFF_CONSOLE_BUNDLE",
          bundleVersion: "2026-06-26",
        },
        origin: "BUNDLE",
      }),
    ],
  });

  const result = await new AccessAssignmentLifecycleAdminService(
    db,
    fakeAudit().guard,
    fakeBridge(),
    fakeInvalidator().service,
  ).listForTargetUser("target-user");

  assert.equal(readPath(result, ["targetUser", "id"]), "target-user");
  assert.deepEqual(result.supportedLifecycleActions, ["REVOKE"]);
  assert.equal(readPath(result, ["items", 0, "assignmentId"]), "assignment-target");
  assert.equal(readPath(result, ["items", 0, "roleCode"]), "STAFF_CONSOLE_USER");
  assert.equal(readPath(result, ["items", 0, "status"]), "ACTIVE");
  assert.equal(readPath(result, ["items", 0, "isSensitive"]), false);
  assert.equal(readPath(result, ["items", 0, "isGlobalLike"]), false);
  assert.equal(readPath(result, ["items", 0, "requiresReview"]), false);
  assert.equal(readPath(result, ["items", 0, "bundleOrigin", "bundleCode"]), "STAFF_CONSOLE_BUNDLE");
  assert.equal(readPath(result, ["items", 0, "auditSummary", "action"]), "ASSIGN");
});

test("access assignment lifecycle lists sensitive and global classification", async () => {
  const db = fakeDb({
    users: [
      activeUser("access-admin", ["ADMIN_CONSOLE"]),
      activeUser("target-user", ["ADMIN_CONSOLE"]),
    ],
    roles: [
      role("role-owner", "OWNER_ADMIN", [
        Permission.ROLE_ASSIGN_TO_USER,
      ]),
    ],
    role_assignments: [
      {
        ...targetAssignment("assignment-owner", "role-owner"),
        structuredScopeGrants: [{ scopeType: "global" }],
        scopeFingerprint: "scope:v1:global",
        reviewAt: REVIEW_AT_30_DAYS,
      },
    ],
  });

  const result = await new AccessAssignmentLifecycleAdminService(
    db,
    fakeAudit().guard,
    fakeBridge(),
    fakeInvalidator().service,
  ).listForTargetUser("target-user");

  assert.equal(readPath(result, ["items", 0, "isSensitive"]), true);
  assert.equal(readPath(result, ["items", 0, "isGlobalLike"]), true);
  assert.equal(readPath(result, ["items", 0, "isHighRisk"]), true);
  assert.equal(readPath(result, ["items", 0, "requiresReview"]), true);
  assert.equal(readPath(result, ["items", 0, "isBreakGlassLike"]), true);
});

test("access assignment lifecycle revoke requires reason, writes audit, invalidates cache, and returns effective access", async () => {
  const audit = fakeAudit();
  const invalidator = fakeInvalidator();
  const db = fakeDb({
    users: [
      activeUser("access-admin", ["ADMIN_CONSOLE"]),
      activeUser("target-user", ["STAFF_CONSOLE"]),
    ],
    roles: [
      role("role-staff", "STAFF_CONSOLE_USER", [
        Permission.WORK_SCHEDULE_READ,
      ]),
    ],
    role_assignments: [targetAssignment("assignment-target", "role-staff")],
  });

  const result = await withTrace(() =>
    new AccessAssignmentLifecycleAdminService(
      db,
      audit.guard,
      fakeBridge(),
      invalidator.service,
    ).revoke(actor(), {
      assignmentId: "assignment-target",
      reason: "No longer needs staff console access",
    }),
  );

  const assignment = db.rows("role_assignments")[0];
  assert.equal(result.revoked, true);
  assert.equal(result.lifecycleStatus, "REVOKED");
  assert.equal(assignment.state, "REVOKED");
  assert.equal(assignment.revokedBy, "access-admin");
  assert.equal(assignment.revokeReason, "No longer needs staff console access");
  assert.equal(audit.records.length, 1);
  assert.equal(readPath(result, ["auditTrace", "written"]), true);
  assert.deepEqual(readPath(result, ["effectiveAccessAfterLifecycle", "permissions"]), []);
  assert.equal(invalidator.calls.length, 1);
});

test("access assignment lifecycle revoke blocks missing reason, self revoke, and already inactive assignments", async () => {
  const missingReason = await withTrace(() =>
    new AccessAssignmentLifecycleAdminService(
      fakeDb({
        users: [
          activeUser("access-admin", ["ADMIN_CONSOLE"]),
          activeUser("target-user", ["STAFF_CONSOLE"]),
        ],
        roles: [role("role-staff", "STAFF_CONSOLE_USER", [])],
        role_assignments: [targetAssignment("assignment-target", "role-staff")],
      }),
      fakeAudit().guard,
      fakeBridge(),
      fakeInvalidator().service,
    ).revoke(actor(), {
      assignmentId: "assignment-target",
      reason: " ",
    }),
  ).catch((error) => error);
  assert.match(String(missingReason.message), /reason is required/u);

  const selfRevoke = await withTrace(() =>
    new AccessAssignmentLifecycleAdminService(
      fakeDb({
        users: [activeUser("access-admin", ["ADMIN_CONSOLE"])],
        roles: [role("role-access", "ACCESS_ADMIN", [Permission.ROLE_REVOKE_FROM_USER])],
        role_assignments: [
          {
            ...targetAssignment("assignment-self", "role-access"),
            userId: "access-admin",
          },
        ],
      }),
      fakeAudit().guard,
      fakeBridge(),
      fakeInvalidator().service,
    ).revoke(actor(), {
      assignmentId: "assignment-self",
      reason: "self revoke attempt",
    }),
  );
  assert.equal(selfRevoke.revoked, false);
  assert.deepEqual(readCodes(selfRevoke.blockers), ["SELF_LIFECYCLE_BLOCKED"]);

  const inactive = await withTrace(() =>
    new AccessAssignmentLifecycleAdminService(
      fakeDb({
        users: [
          activeUser("access-admin", ["ADMIN_CONSOLE"]),
          activeUser("target-user", ["STAFF_CONSOLE"]),
        ],
        roles: [role("role-staff", "STAFF_CONSOLE_USER", [])],
        role_assignments: [
          {
            ...targetAssignment("assignment-revoked", "role-staff"),
            state: "REVOKED",
            revokedAt: 2,
          },
        ],
      }),
      fakeAudit().guard,
      fakeBridge(),
      fakeInvalidator().service,
    ).revoke(actor(), {
      assignmentId: "assignment-revoked",
      reason: "repeat revoke",
    }),
  );
  assert.equal(inactive.revoked, false);
  assert.deepEqual(readCodes(inactive.blockers), ["ASSIGNMENT_ALREADY_INACTIVE"]);
});

test("access assignment lifecycle controller rejects frontend-owned authority fields", async () => {
  let lifecycleReached = false;
  const app = express();
  app.use(express.json());
  app.use(contextMiddleware("ADMIN"));
  app.use((req, _res, next) => {
    bindActor(req, actor());
    next();
  });
  app.use(
    "/admin/access-assignments",
    adminAccessAssignmentPreviewRoutes(
      new AdminAccessAssignmentPreviewController(
        new AccessAssignmentPreviewAdminService(fakeDb({})),
        undefined,
        {
          async revoke(): Promise<unknown> {
            lifecycleReached = true;
            return {};
          },
        } as unknown as AccessAssignmentLifecycleAdminService,
      ),
    ),
  );
  app.use(errorHandler);

  const server = await listen(app);
  try {
    const response = await fetch(
      `${toBaseUrl(server)}/admin/access-assignments/assignment-1/revoke`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "attempt",
          actorKind: "ADMIN",
        }),
      },
    );
    assert.equal(response.status, 400);
    assert.equal(lifecycleReached, false);
  } finally {
    await close(server);
  }
});

test("old direct role and bundle assignment routes are removed", async () => {
  const app = express();
  app.use(express.json());
  app.use(contextMiddleware("ADMIN"));
  app.use((req, _res, next) => {
    bindActor(req, actor());
    next();
  });
  app.use(
    "/admin/roles",
    adminRoleRoutes(
      new AdminRoleController({} as never),
      {
        execute: (_req: Request, res: Response) => res.status(501).end(),
      } as never,
    ),
  );
  app.use(
    "/admin/role-bundles",
    adminRoleBundleRoutes(
      new AdminRoleBundleController({ listBundles: () => [] } as never),
    ),
  );
  app.use(errorHandler);

  const server = await listen(app);
  try {
    const direct = await fetch(`${toBaseUrl(server)}/admin/roles/role-staff/assignments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "target-user",
        structuredScopeGrants: [{ scopeType: "self" }],
        reason: "old path",
      }),
    });
    assert.equal(direct.status, 404);

    const list = await fetch(`${toBaseUrl(server)}/admin/roles/role-staff/assignments`);
    assert.equal(list.status, 404);

    const bundle = await fetch(
      `${toBaseUrl(server)}/admin/role-bundles/STAFF_CONSOLE_BUNDLE/versions/2026-06-26/assignments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "target-user",
          structuredScopeGrants: [{ scopeType: "self" }],
          reason: "old path",
        }),
      },
    );
    assert.equal(bundle.status, 404);

    const revoke = await fetch(
      `${toBaseUrl(server)}/admin/roles/role-staff/assignments/assignment-1/revoke`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "old revoke path",
        }),
      },
    );
    assert.equal(revoke.status, 404);
  } finally {
    await close(server);
  }
});

function baseApplyDb(params: {
  readonly targetUserId?: string;
  readonly targetContexts: readonly string[];
  readonly targetRoleCode: string;
  readonly targetRolePermissions: readonly string[];
  readonly responsibilities?: readonly Record<string, unknown>[];
  readonly talentGroups?: readonly Record<string, unknown>[];
  readonly orgUnits?: readonly Record<string, unknown>[];
}): FakeDb {
  const targetUserId = params.targetUserId ?? "target-user";
  return fakeDb({
    users: [
      activeUser("access-admin", ["ADMIN_CONSOLE"]),
      activeUser(targetUserId, params.targetContexts),
    ],
    employment_profiles: [activeProfile("profile-1", targetUserId)],
    roles: [
      role("role-access", "ACCESS_ADMIN", [Permission.ROLE_ASSIGN_TO_USER], {
        maxDelegatableBand: "PRIVILEGED",
      }),
      role(`role-${params.targetRoleCode}`, params.targetRoleCode, params.targetRolePermissions),
    ],
    role_assignments: [actorDelegationAssignment("assignment-actor", "role-access")],
    role_assignment_rules: [],
    responsibility_assignments: params.responsibilities ?? [],
    talent_groups: params.talentGroups ?? [],
    org_units: params.orgUnits ?? [],
    bundle_assignments: [],
  });
}

async function applyWithFakes(
  db: FakeDb,
  command: Parameters<AccessAssignmentApplyAdminService["apply"]>[1],
  applyActor = actor(),
): Promise<Record<string, unknown>> {
  return new AccessAssignmentApplyAdminService(
    db,
    fakeAudit().guard,
    fakeBridge(),
    fakeInvalidator().service,
  ).apply(applyActor, command);
}

function actor(extraPermissions: readonly Permission[] = []): Actor {
  return new Actor({
    id: "access-admin",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.ROLE_ASSIGN_TO_USER,
      Permission.ROLE_ASSIGNMENT_VIEW,
      Permission.ROLE_REVOKE_FROM_USER,
      ...extraPermissions,
    ],
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
}

function fakeBridge(): AuthoritativeAdminMutationBridge {
  return {
    async execute<T>(
      _params: unknown,
      mutate: (
        session: ClientSession,
        controls: AuthoritativeMutationControls,
      ) => Promise<T>,
    ): Promise<T> {
      return runWithDomainEventCollector(async () => {
        const result = await mutate({} as ClientSession, {
          markAuthSecurityTruthChanged() {},
          markExplicitNoOpSuccess() {},
        });
        return result;
      });
    },
  };
}

function fakeAudit() {
  const records: unknown[] = [];
  return {
    records,
    guard: {
      async record(...args: unknown[]) {
        records.push(args);
      },
    } as never,
  };
}

function fakeInvalidator() {
  const calls: unknown[] = [];
  return {
    calls,
    service: {
      async invalidateAll(input: unknown) {
        calls.push(input);
      },
    } as never,
  };
}

function activeUser(
  id: string,
  accountContexts: readonly string[],
): Record<string, unknown> {
  return {
    _id: id,
    actorKind: "ADMIN",
    accountStatus: "ACTIVE",
    accountContexts,
    disabledAt: null,
    archivedAt: null,
    profile: { displayName: id, email: `${id}@example.test` },
  };
}

function activeProfile(id: string, linkedUserId: string): Record<string, unknown> {
  return {
    _id: id,
    employeeCode: id,
    displayName: id,
    employmentStatus: "ACTIVE",
    linkedUserId,
  };
}

function role(
  id: string,
  code: string,
  permissions: readonly string[],
  options?: { readonly maxDelegatableBand?: string },
): Record<string, unknown> {
  return {
    _id: id,
    id,
    code,
    name: code,
    state: "ACTIVE",
    permissions,
    templateCode: code,
    delegationBand: "LIMITED",
    maxDelegatableBand: options?.maxDelegatableBand ?? "NONE",
    createdAt: 1,
    updatedAt: 1,
    activatedAt: 1,
    archivedAt: null,
  };
}

function actorDelegationAssignment(id: string, roleId: string): Record<string, unknown> {
  return {
    _id: id,
    roleId,
    userId: "access-admin",
    structuredScopeGrants: [{ scopeType: "global" }],
    scopeFingerprint: "scope:v1:global",
    state: "ACTIVE",
    effectiveAt: 1,
    expiresAt: null,
    reviewAt: null,
    assignedBy: "system",
    assignedAt: 1,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    origin: "DIRECT",
    bundleOrigin: null,
    reason: "delegation setup",
    createdAt: 1,
    updatedAt: 1,
  };
}

function targetAssignment(
  id: string,
  roleId: string,
  options?: {
    readonly origin?: string;
    readonly bundleOrigin?: Record<string, unknown> | null;
  },
): Record<string, unknown> {
  return {
    _id: id,
    roleId,
    userId: "target-user",
    structuredScopeGrants: [{ scopeType: "self" }],
    scopeFingerprint: "scope:v1:self",
    state: "ACTIVE",
    effectiveAt: 1,
    expiresAt: null,
    reviewAt: null,
    assignedBy: "access-admin",
    assignedAt: 1,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    origin: options?.origin ?? "DIRECT",
    bundleOrigin: options?.bundleOrigin ?? null,
    reason: "initial grant",
    createdAt: 1,
    updatedAt: 1,
  };
}

function responsibility(
  id: string,
  profileId: string,
  subjectType: string,
  subjectId: string,
  responsibilityType: string,
): Record<string, unknown> {
  return {
    _id: id,
    responsibleEmploymentProfileId: profileId,
    subjectType,
    subjectId,
    responsibilityType,
    status: "ACTIVE",
    effectiveAt: 1,
    expiresAt: null,
  };
}

type FakeDb = Db & {
  readonly rows: (name: string) => Record<string, unknown>[];
};

function fakeDb(
  collections: Record<string, readonly Record<string, unknown>[]> = {},
): FakeDb {
  const state = new Map(
    Object.entries(collections).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
  );
  return {
    rows(name: string) {
      return state.get(name) ?? [];
    },
    collection(name: string) {
      const rows = state.get(name) ?? [];
      if (!state.has(name)) {
        state.set(name, rows);
      }
      return {
        async findOne(query: Record<string, unknown>) {
          return rows.find((row) => matches(row, query)) ?? null;
        },
        find(query: Record<string, unknown>) {
          const found = rows.filter((row) => matches(row, query));
          return {
            sort() {
              return this;
            },
            async toArray() {
              return found;
            },
          };
        },
        async insertMany(docs: readonly Record<string, unknown>[]) {
          rows.push(...docs.map((doc) => ({ ...doc })));
          return { insertedCount: docs.length };
        },
        async insertOne(doc: Record<string, unknown>) {
          rows.push({ ...doc });
          return { insertedId: doc._id, acknowledged: true };
        },
        async updateOne(query: Record<string, unknown>, update: Record<string, unknown>) {
          const row = rows.find((item) => matches(item, query));
          if (row && isPlainObject(update.$set)) {
            Object.assign(row, update.$set);
          }
          return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
        },
        async findOneAndUpdate(query: Record<string, unknown>, update: Record<string, unknown>) {
          const row = rows.find((item) => matches(item, query));
          if (row && isPlainObject(update.$set)) {
            Object.assign(row, update.$set);
            return row;
          }
          return null;
        },
      };
    },
  } as unknown as FakeDb;
}

function matches(
  row: Readonly<Record<string, unknown>>,
  query: Readonly<Record<string, unknown>>,
): boolean {
  for (const [key, expected] of Object.entries(query)) {
    if (key === "$or") {
      if (!Array.isArray(expected) || !expected.some((entry) => matches(row, entry))) {
        return false;
      }
      continue;
    }
    if (!valueMatches(row[key], expected)) {
      return false;
    }
  }
  return true;
}

function valueMatches(actual: unknown, expected: unknown): boolean {
  if (isPlainObject(expected)) {
    if ("$in" in expected) {
      return Array.isArray(expected.$in) && expected.$in.includes(actual);
    }
    if ("$lte" in expected) {
      return typeof actual === "number" && actual <= Number(expected.$lte);
    }
    if ("$gte" in expected) {
      return typeof actual === "number" && actual >= Number(expected.$gte);
    }
  }
  return Object.is(actual, expected);
}

function readCodes(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value
        .map((item) =>
          isPlainObject(item) && typeof item.code === "string" ? item.code : null,
        )
        .filter((item): item is string => item !== null)
        .sort()
    : [];
}

function readPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;
  for (const segment of path) {
    current =
      typeof segment === "number"
        ? Array.isArray(current)
          ? current[segment]
          : undefined
        : isPlainObject(current) || Array.isArray(current)
          ? (current as Record<string, unknown>)[segment]
          : undefined;
  }
  return current;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId(`test-trace-${Math.random()}`, fn);
}

function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const mapped = mapToHttpError(error);
  res.status(mapped.status).json({
    error: { code: mapped.code, message: mapped.message },
  });
}

async function listen(app: express.Express): Promise<Server> {
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function toBaseUrl(server: Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
