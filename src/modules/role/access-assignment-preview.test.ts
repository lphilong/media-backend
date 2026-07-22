import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { NextFunction, Request, Response } from "express";
import { Db } from "mongodb";
import { bindActor } from "@core/actor/actor-context";
import { Actor } from "@core/actor/actor";
import { contextMiddleware } from "@core/context/context.middleware.adapter";
import { mapToHttpError } from "@app/http/http-error.map";
import { Permission } from "@core/permission/permission.enum";
import { AccessAssignmentPreviewAdminService } from "@modules/role/admin/admin.access-assignment-preview.service";
import { AdminAccessAssignmentPreviewController } from "@modules/role/admin/admin.access-assignment-preview.controller";
import { adminAccessAssignmentPreviewRoutes } from "@modules/role/admin/admin.access-assignment-preview.routes";
import { getRoleTemplate } from "@modules/role/domain/role-template.catalog";
import { buildAuthoritySlotIdentity } from "@modules/role/domain/authority-slot";

const CANONICAL_ASSIGNMENT_TARGET_CODES = [
  "OWNER_ADMIN",
  "ACCESS_ADMIN",
  "HR_OPERATIONS",
  "HR_TERMS_APPROVER",
  "PRODUCTION_OPS",
  "PLATFORM_CHANNEL_OPS",
  "TALENT_GROUP_MANAGER",
  "ORG_UNIT_MANAGER",
  "KPI_OPERATIONS",
  "REVENUE_FINANCE_OPS",
  "REVENUE_APPROVER",
  "REVENUE_RECONCILER",
  "COMMISSION_OPS",
  "COMMISSION_APPROVER",
  "VIEWER_AUDITOR",
  "STAFF_CONSOLE_USER",
] as const;

const TRUE_LEGACY_ASSIGNMENT_TARGET_CODES = [
  "ADMIN_FULL",
  "TEAM_MANAGER",
  "COMMERCIAL_FINANCE",
  "TALENT_STAFF_SELF",
] as const;

const EFFECTIVE_AT = Date.UTC(2026, 0, 1);
const REVIEW_AT_30_DAYS = Date.UTC(2026, 0, 31);
const REVIEW_AT_120_DAYS = Date.UTC(2026, 3, 30);
const EXPIRES_AT_7_DAYS = Date.UTC(2026, 0, 8);

test("access assignment preview normalizes scope and computes proposed manager access without mutation", async () => {
  const db = fakeDb({
    users: [activeUser("target-user", ["MANAGER_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-tgm", "TALENT_GROUP_MANAGER", [Permission.TALENT_GROUP_READ]),
    ],
    role_assignments: [],
    responsibility_assignments: [
      responsibility(
        "resp-1",
        "profile-1",
        "TALENT_GROUP",
        "group-a",
        "TALENT_GROUP_MANAGER",
      ),
    ],
  });

  const result = await new AccessAssignmentPreviewAdminService(db).preview({
    targetUserId: "target-user",
    assignmentTargetType: "ROLE_TEMPLATE",
    assignmentTargetCode: "TALENT_GROUP_MANAGER",
    structuredScopeGrants: [
      { scopeType: "managedTalentGroup", targetId: "group-a" },
    ],
    reason: "Assigned by owner request",
    effectiveAt: EFFECTIVE_AT,
    reviewAt: REVIEW_AT_30_DAYS,
  });

  assert.equal(result.canApply, true);
  assert.equal(
    result.scopeFingerprint,
    "scope:v1:managedTalentGroup|targetId=group-a",
  );
  assert.equal(
    (readPath(result, ["effectiveAccessDelta", "addedPermissions"]) as readonly string[])
      .includes(Permission.TALENT_GROUP_READ),
    true,
  );
  assert.equal(
    readPath(result, [
      "consoleEntitlementPreview",
      "consoles",
      1,
      "proposedEligible",
    ]),
    true,
  );
  assert.equal(db.writeCount, 0);
});

test("access assignment preview blocks a template-backed Role whose equal version hides permission drift", async () => {
  const template = getRoleTemplate("TALENT_GROUP_MANAGER");
  assert.notEqual(template, null);
  const db = fakeDb({
    users: [activeUser("target-user", ["MANAGER_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      {
        ...role(
          "role-tgm",
          "TALENT_GROUP_MANAGER",
          [Permission.TALENT_GROUP_READ],
          { canonical: false },
        ),
        templateCode: "TALENT_GROUP_MANAGER",
        templateVersion: template?.version,
      },
    ],
    role_assignments: [],
    responsibility_assignments: [
      responsibility(
        "resp-1",
        "profile-1",
        "TALENT_GROUP",
        "group-a",
        "TALENT_GROUP_MANAGER",
      ),
    ],
  });

  const result = await new AccessAssignmentPreviewAdminService(db).preview({
    targetUserId: "target-user",
    assignmentTargetType: "ROLE_TEMPLATE",
    assignmentTargetCode: "TALENT_GROUP_MANAGER",
    structuredScopeGrants: [
      { scopeType: "managedTalentGroup", targetId: "group-a" },
    ],
    reason: "Attempt stale assignment",
  });

  assert.equal(result.canApply, false);
  assert.equal(
    (result.blockers as readonly { code: string }[]).some(
      (item) => item.code === "ROLE_TEMPLATE_DRIFT_STALE",
    ),
    true,
  );
  assert.equal(db.writeCount, 0);
});

test("canonical template preview blocks metadata-less missing, extra, mixed, and exact Role states", async () => {
  const template = getRoleTemplate("STAFF_CONSOLE_USER");
  assert.ok(template);
  const cases = [
    {
      expected: "STALE_MISSING_PERMISSIONS",
      permissions: template.permissions.slice(1),
    },
    {
      expected: "STALE_EXTRA_PERMISSIONS",
      permissions: [...template.permissions, "legacy.extra"],
    },
    {
      expected: "STALE_MIXED",
      permissions: [...template.permissions.slice(1), "legacy.extra"],
    },
    { expected: "UNKNOWN_ORPHAN", permissions: template.permissions },
  ] as const;

  for (const fixture of cases) {
    const db = fakeDb({
      users: [activeUser("target-user", ["STAFF_CONSOLE"])],
      employment_profiles: [activeProfile("profile-1", "target-user")],
      roles: [
        role("role-staff", template.code, fixture.permissions, {
          canonical: false,
        }),
      ],
      role_assignments: [],
      responsibility_assignments: [],
    });
    const result = await new AccessAssignmentPreviewAdminService(db).preview({
      targetUserId: "target-user",
      assignmentTargetType: "ROLE_TEMPLATE",
      assignmentTargetCode: template.code,
      structuredScopeGrants: [{ scopeType: "self" }],
      reason: "canonical provenance verification",
    });

    assert.equal(result.canApply, false, fixture.expected);
    assert.equal(
      readPath(result, ["assignmentTarget", "roleDrift", "classification"]),
      fixture.expected,
    );
    assert.equal(readCodes(result.blockers).includes("ROLE_TEMPLATE_DRIFT_STALE"), true);
    assert.equal(db.writeCount, 0);
  }
});

test("canonical bundle children block metadata-less permission drift and unknown provenance", async () => {
  const template = getRoleTemplate("STAFF_CONSOLE_USER");
  assert.ok(template);
  const cases = [
    {
      expected: "STALE_MISSING_PERMISSIONS",
      permissions: template.permissions.slice(1),
    },
    {
      expected: "STALE_EXTRA_PERMISSIONS",
      permissions: [...template.permissions, "legacy.extra"],
    },
    {
      expected: "STALE_MIXED",
      permissions: [...template.permissions.slice(1), "legacy.extra"],
    },
    { expected: "UNKNOWN_ORPHAN", permissions: template.permissions },
  ] as const;

  for (const fixture of cases) {
    const db = fakeDb({
      users: [activeUser("target-user", ["STAFF_CONSOLE"])],
      employment_profiles: [activeProfile("profile-1", "target-user")],
      roles: [
        role("role-staff", template.code, fixture.permissions, {
          canonical: false,
        }),
      ],
      role_assignments: [],
      responsibility_assignments: [],
    });
    const result = await new AccessAssignmentPreviewAdminService(db).preview({
      targetUserId: "target-user",
      assignmentTargetType: "BUNDLE",
      assignmentTargetCode: "STAFF_CONSOLE_BUNDLE",
      bundleVersion: "2026-06-26",
      structuredScopeGrants: [{ scopeType: "self" }],
      reason: "bundle child provenance verification",
    });
    const driftBlocker = (result.blockers as readonly Record<string, unknown>[]).find(
      (item) => item.code === "ROLE_TEMPLATE_DRIFT_STALE",
    );

    assert.equal(result.canApply, false, fixture.expected);
    assert.equal(
      readPath(driftBlocker, ["roleDrift", "classification"]),
      fixture.expected,
    );
    assert.deepEqual(readPath(result, ["proposedAssignments"]), []);
    assert.equal(db.writeCount, 0);
  }
});

test("manual direct Role keeps unknown provenance distinct and performs no template synchronization", async () => {
  const template = getRoleTemplate("STAFF_CONSOLE_USER");
  assert.ok(template);
  const db = fakeDb({
    users: [activeUser("target-user", ["STAFF_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-staff", template.code, template.permissions, {
        canonical: false,
      }),
    ],
    role_assignments: [],
    responsibility_assignments: [],
  });
  const result = await new AccessAssignmentPreviewAdminService(db).preview({
    targetUserId: "target-user",
    assignmentTargetType: "ROLE",
    assignmentTargetId: "role-staff",
    structuredScopeGrants: [{ scopeType: "self" }],
    reason: "explicit manual Role assignment",
  });

  assert.equal(result.canApply, true);
  assert.equal(
    readPath(result, ["assignmentTarget", "roleDrift", "classification"]),
    "UNKNOWN_ORPHAN",
  );
  assert.equal(readPath(result, ["assignmentTarget", "templateCode"]), null);
  assert.equal(db.writeCount, 0);
});

test("access assignment preview proposes missing required AccountContext without mutating it", async () => {
  const db = fakeDb({
    users: [activeUser("target-user", ["STAFF_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-tgm", "TALENT_GROUP_MANAGER", [Permission.TALENT_GROUP_READ]),
    ],
    role_assignments: [],
    responsibility_assignments: [
      responsibility(
        "resp-1",
        "profile-1",
        "TALENT_GROUP",
        "group-a",
        "TALENT_GROUP_MANAGER",
      ),
    ],
  });

  const result = await new AccessAssignmentPreviewAdminService(db).preview({
    targetUserId: "target-user",
    assignmentTargetType: "ROLE_TEMPLATE",
    assignmentTargetCode: "TALENT_GROUP_MANAGER",
    structuredScopeGrants: [
      { scopeType: "managedTalentGroup", targetId: "group-a" },
    ],
    reason: "manager scope setup",
    effectiveAt: EFFECTIVE_AT,
    reviewAt: REVIEW_AT_30_DAYS,
  });

  assert.equal(result.canApply, true);
  assert.equal(
    readPath(result, ["accountContextRequirement", "status"]),
    "PROPOSED_FOR_APPLICATION",
  );
  assert.deepEqual(
    readPath(result, ["accountContextRequirement", "requiredAccountContexts"]),
    ["MANAGER_CONSOLE"],
  );
  assert.deepEqual(
    readPath(result, ["accountContextRequirement", "currentAccountContexts"]),
    ["STAFF_CONSOLE"],
  );
  assert.deepEqual(
    readPath(result, ["accountContextRequirement", "missingAccountContexts"]),
    ["MANAGER_CONSOLE"],
  );
  assert.equal(
    readPath(result, ["accountContextRequirement", "materializationInScope"]),
    true,
  );
  assert.deepEqual(readCodes(result.blockers), []);
  assert.deepEqual(
    readPath(result, ["accountContextRequirement", "proposedAccountContexts"]),
    ["MANAGER_CONSOLE"],
  );
  const managerConsole = findConsole(result, "MANAGER_CONSOLE");
  assert.equal(managerConsole?.proposedEligible, true);
  assert.deepEqual(managerConsole?.blockers, []);
  assert.equal(readPath(result, ["previewCompleteness", "status"]), "COMPLETE");
  assert.equal(
    readPath(result, [
      "proposedEffectiveAccess",
      "workspaceAvailability",
      "primaryWorkspace",
    ]),
    "MANAGER_CONSOLE",
  );
  assert.equal(db.writeCount, 0);
});

test("access assignment preview blocks missing AccountContext when actor is not authorized to materialize it", async () => {
  const db = fakeDb({
    users: [activeUser("target-user", ["STAFF_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-tgm", "TALENT_GROUP_MANAGER", [Permission.TALENT_GROUP_READ]),
    ],
    role_assignments: [],
    responsibility_assignments: [
      responsibility(
        "resp-1",
        "profile-1",
        "TALENT_GROUP",
        "group-a",
        "TALENT_GROUP_MANAGER",
      ),
    ],
  });

  const result = await new AccessAssignmentPreviewAdminService(db).preview(
    {
      targetUserId: "target-user",
      assignmentTargetType: "ROLE_TEMPLATE",
      assignmentTargetCode: "TALENT_GROUP_MANAGER",
      structuredScopeGrants: [
        { scopeType: "managedTalentGroup", targetId: "group-a" },
      ],
      reason: "manager scope setup",
      effectiveAt: EFFECTIVE_AT,
      reviewAt: REVIEW_AT_30_DAYS,
    },
    { actor: previewActor([]) },
  );

  assert.equal(result.canApply, false);
  assert.equal(
    readPath(result, ["accountContextRequirement", "status"]),
    "BLOCKED_UNAUTHORIZED",
  );
  assert.deepEqual(readCodes(result.blockers), [
    "ACCOUNT_CONTEXT_MATERIALIZATION_NOT_AUTHORIZED",
  ]);
  assert.equal(db.writeCount, 0);
});

test("access assignment preview blocks missing responsibility and duplicate exact scope", async () => {
  const db = fakeDb({
    users: [activeUser("target-user", ["MANAGER_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-tgm", "TALENT_GROUP_MANAGER", [Permission.TALENT_GROUP_READ]),
    ],
    role_assignments: [
      {
        _id: "assignment-existing",
        roleId: "role-tgm",
        userId: "target-user",
        structuredScopeGrants: [
          { scopeType: "managedTalentGroup", targetId: "group-a" },
        ],
        scopeFingerprint: "scope:v1:managedTalentGroup|targetId=group-a",
        state: "ACTIVE",
        effectiveAt: Date.now(),
        expiresAt: null,
        reason: "existing",
        createdAt: 1,
      },
    ],
    responsibility_assignments: [],
  });

  const result = await new AccessAssignmentPreviewAdminService(db).preview({
    targetUserId: "target-user",
    assignmentTargetType: "ROLE_TEMPLATE",
    assignmentTargetCode: "TALENT_GROUP_MANAGER",
    structuredScopeGrants: [
      { scopeType: "managedTalentGroup", targetId: "group-a" },
    ],
    reason: "review",
    effectiveAt: EFFECTIVE_AT,
    reviewAt: REVIEW_AT_30_DAYS,
  });

  assert.equal(result.canApply, false);
  assert.deepEqual(readCodes(result.blockers), [
    "DUPLICATE_ACTIVE_ASSIGNMENT",
    "RESPONSIBILITY_MATERIALIZATION_NOT_AUTHORIZED",
  ]);
  assert.equal(db.writeCount, 0);
});

test("access assignment preview accepts OrgUnit manager only with central active responsibility", async () => {
  const command = {
    targetUserId: "target-user",
    assignmentTargetType: "ROLE_TEMPLATE" as const,
    assignmentTargetCode: "ORG_UNIT_MANAGER",
    structuredScopeGrants: [
      { scopeType: "managedOrgUnit" as const, targetId: "org-a" },
    ],
    reason: "org manager access",
    effectiveAt: EFFECTIVE_AT,
    reviewAt: REVIEW_AT_30_DAYS,
  };

  const satisfied = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      users: [activeUser("target-user", ["MANAGER_CONSOLE"])],
      employment_profiles: [activeProfile("profile-1", "target-user")],
      roles: [role("role-ou", "ORG_UNIT_MANAGER", [Permission.ORG_UNIT_READ])],
      role_assignments: [],
      responsibility_assignments: [
        responsibility(
          "resp-1",
          "profile-1",
          "ORG_UNIT",
          "org-a",
          "ORG_UNIT_MANAGER",
        ),
      ],
    }),
  ).preview(command);

  assert.equal(satisfied.canApply, true);
  assert.deepEqual(readCodes(satisfied.blockers), []);

  const missing = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      users: [activeUser("target-user", ["MANAGER_CONSOLE"])],
      employment_profiles: [activeProfile("profile-1", "target-user")],
      roles: [role("role-ou", "ORG_UNIT_MANAGER", [Permission.ORG_UNIT_READ])],
      role_assignments: [],
      responsibility_assignments: [],
      org_unit_memberships: [
        {
          _id: "membership-1",
          employmentProfileId: "profile-1",
          orgUnitId: "org-a",
        },
      ],
    }),
  ).preview(command);

  assert.equal(missing.canApply, false);
  assert.deepEqual(readCodes(missing.blockers), [
    "RESPONSIBILITY_MATERIALIZATION_NOT_AUTHORIZED",
  ]);
  assert.equal(
    readPath(missing, ["responsibilityRequirements", 0, "status"]),
    "MISSING_RESPONSIBILITY_UNAUTHORIZED",
  );
});

test("access assignment preview proposes manager responsibility create when actor is authorized", async () => {
  const result = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      users: [activeUser("target-user", ["MANAGER_CONSOLE"])],
      employment_profiles: [activeProfile("profile-1", "target-user")],
      roles: [
        role("role-tgm", "TALENT_GROUP_MANAGER", [
          Permission.TALENT_GROUP_READ,
        ]),
      ],
      role_assignments: [],
      responsibility_assignments: [],
      talent_groups: [{ _id: "group-a", status: "ACTIVE" }],
    }),
  ).preview(
    {
      targetUserId: "target-user",
      assignmentTargetType: "ROLE_TEMPLATE",
      assignmentTargetCode: "TALENT_GROUP_MANAGER",
      structuredScopeGrants: [
        { scopeType: "managedTalentGroup", targetId: "group-a" },
      ],
      reason: "manager scope setup",
      effectiveAt: EFFECTIVE_AT,
      reviewAt: REVIEW_AT_30_DAYS,
    },
    {
      actor: previewActor([
        Permission.ROLE_ASSIGN_TO_USER,
        Permission.TALENT_GROUP_UPDATE,
      ]),
    },
  );

  assert.equal(result.canApply, true);
  assert.deepEqual(readCodes(result.blockers), []);
  assert.equal(
    readPath(result, ["responsibilityRequirements", 0, "status"]),
    "CREATE_PROPOSED",
  );
  assert.equal(
    readPath(result, [
      "responsibilityRequirements",
      0,
      "proposedResponsibility",
      "subjectId",
    ]),
    "group-a",
  );
});

test("access assignment preview expands canonical auditor bundle in memory without legacy blocking", async () => {
  const db = fakeDb({
    users: [activeUser("target-user", ["ADMIN_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [role("role-auditor", "VIEWER_AUDITOR", [Permission.KPI_READ])],
    role_assignments: [],
    responsibility_assignments: [],
  });

  const result = await new AccessAssignmentPreviewAdminService(db).preview({
    targetUserId: "target-user",
    assignmentTargetType: "BUNDLE",
    assignmentTargetCode: "AUDITOR_BUNDLE",
    bundleVersion: "2026-06-26",
    structuredScopeGrants: [{ scopeType: "global" }],
    reason: "audit coverage",
    effectiveAt: EFFECTIVE_AT,
    reviewAt: REVIEW_AT_30_DAYS,
  });

  assert.equal(result.canApply, true);
  assert.deepEqual(readCodes(result.blockers), []);
  assert.equal(
    readPath(result, ["bundleExpansion", "persistedParentBundleAssignment"]),
    false,
  );
  assert.deepEqual(readPath(result, ["bundleExpansion", "childRoleCodes"]), [
    "VIEWER_AUDITOR",
  ]);
  assert.deepEqual(readPath(result, ["legacyRoleStatus", "blockedCodes"]), []);
  assert.equal(
    readPath(result, ["proposedAssignments", 0, "roleCode"]),
    "VIEWER_AUDITOR",
  );
  assert.equal(db.writeCount, 0);
});

test("access assignment preview treats canonical targets except environment-bounded OWNER_ADMIN as generally assignable", async () => {
  const permissionsByCode = {
    HR_OPERATIONS: Permission.EMPLOYMENT_PROFILE_READ,
    HR_TERMS_APPROVER: Permission.EMPLOYMENT_TERMS_APPROVE,
    PRODUCTION_OPS: Permission.EVENT_READ,
    PLATFORM_CHANNEL_OPS: Permission.PLATFORM_ACCOUNT_READ,
    TALENT_GROUP_MANAGER: Permission.TALENT_GROUP_READ,
    ORG_UNIT_MANAGER: Permission.ORG_UNIT_READ,
    KPI_OPERATIONS: Permission.KPI_READ,
    REVENUE_FINANCE_OPS: Permission.REVENUE_LEDGER_READ,
    REVENUE_APPROVER: Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
    REVENUE_RECONCILER: Permission.REVENUE_LEDGER_RECONCILE,
    COMMISSION_OPS: Permission.COMMISSION_SETTLEMENT_READ,
    COMMISSION_APPROVER: Permission.COMMISSION_SETTLEMENT_MANAGE_LIFECYCLE,
    VIEWER_AUDITOR: Permission.KPI_READ,
    STAFF_CONSOLE_USER: Permission.WORK_SCHEDULE_READ,
    OWNER_ADMIN: Permission.ROLE_ASSIGN_TO_USER,
    ACCESS_ADMIN: Permission.ROLE_ASSIGN_TO_USER,
  } as const;

  for (const code of CANONICAL_ASSIGNMENT_TARGET_CODES) {
    if (code === "OWNER_ADMIN") continue;
    const isTalentGroupManager = code === "TALENT_GROUP_MANAGER";
    const isOrgUnitManager = code === "ORG_UNIT_MANAGER";
    const isManager = isTalentGroupManager || isOrgUnitManager;
    const scope = isTalentGroupManager
      ? [{ scopeType: "managedTalentGroup" as const, targetId: "group-a" }]
      : isOrgUnitManager
        ? [{ scopeType: "managedOrgUnit" as const, targetId: "org-a" }]
        : [{ scopeType: "global" as const }];
    const db = fakeDb({
      users: [
        activeUser("target-user", [
          "ADMIN_CONSOLE",
          ...(isManager ? ["MANAGER_CONSOLE"] : []),
        ]),
      ],
      employment_profiles: [activeProfile("profile-1", "target-user")],
      roles: [role(`role-${code}`, code, [permissionsByCode[code]])],
      role_assignments: [],
      responsibility_assignments: isTalentGroupManager
        ? [
            responsibility(
              "resp-tgm",
              "profile-1",
              "TALENT_GROUP",
              "group-a",
              "TALENT_GROUP_MANAGER",
            ),
          ]
        : isOrgUnitManager
          ? [
              responsibility(
                "resp-ou",
                "profile-1",
                "ORG_UNIT",
                "org-a",
                "ORG_UNIT_MANAGER",
              ),
            ]
          : [],
    });

    const result = await new AccessAssignmentPreviewAdminService(db).preview({
      targetUserId: "target-user",
      assignmentTargetType: "ROLE_TEMPLATE",
      assignmentTargetCode: code,
      structuredScopeGrants: scope,
      reason: `canonical assignment for ${code}`,
      effectiveAt: EFFECTIVE_AT,
      reviewAt: code === "ACCESS_ADMIN" ? EXPIRES_AT_7_DAYS : REVIEW_AT_30_DAYS,
      ...(code === "ACCESS_ADMIN"
        ? { expiresAt: EXPIRES_AT_7_DAYS }
        : {}),
    });

    assert.equal(
      result.canApply,
      true,
      `${code}: ${readCodes(result.blockers).join(",")}`,
    );
    assert.deepEqual(readCodes(result.blockers), []);
    assert.equal(
      readPath(result, ["proposedAssignments", 0, "roleCode"]),
      code,
    );
    assert.deepEqual(
      readPath(result, ["legacyRoleStatus", "blockedCodes"]),
      [],
    );
    assert.equal(db.writeCount, 0);
  }
});

test("access assignment preview blocks future and unsupported catalog targets before proposing assignments", async () => {
  const directDb = fakeDb({
    users: [activeUser("target-user", ["ADMIN_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-commercial", "COMMERCIAL_CONTRACT_OPS", [
        Permission.CONTRACT_REGISTRY_READ,
      ]),
    ],
    role_assignments: [],
    responsibility_assignments: [],
  });

  const direct = await new AccessAssignmentPreviewAdminService(
    directDb,
  ).preview({
    targetUserId: "target-user",
    assignmentTargetType: "ROLE_TEMPLATE",
    assignmentTargetCode: "COMMERCIAL_CONTRACT_OPS",
    structuredScopeGrants: [{ scopeType: "global" }],
    reason: "unsupported selector must not be faked with global scope",
    effectiveAt: EFFECTIVE_AT,
    reviewAt: REVIEW_AT_30_DAYS,
  });

  assert.equal(direct.canApply, false);
  assert.equal(
    readCodes(direct.blockers).includes(
      "ROLE_TEMPLATE_UNSUPPORTED_SCOPE_SELECTOR",
    ),
    true,
  );
  assert.deepEqual(readPath(direct, ["proposedAssignments"]), []);
  assert.equal(directDb.writeCount, 0);

  const bundleDb = fakeDb({
    users: [activeUser("target-user", ["ADMIN_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-attendance", "ATTENDANCE_OPS", [
        Permission.WORK_SCHEDULE_READ,
      ]),
      role("role-leave", "LEAVE_REVIEWER", [Permission.WORK_SCHEDULE_READ]),
    ],
    role_assignments: [],
    responsibility_assignments: [],
  });

  const bundle = await new AccessAssignmentPreviewAdminService(
    bundleDb,
  ).preview({
    targetUserId: "target-user",
    assignmentTargetType: "BUNDLE",
    assignmentTargetCode: "ATTENDANCE_OPERATOR_BUNDLE",
    bundleVersion: "2026-06-26",
    structuredScopeGrants: [{ scopeType: "global" }],
    reason: "future bundle must not expand",
    effectiveAt: EFFECTIVE_AT,
    reviewAt: REVIEW_AT_30_DAYS,
  });

  assert.equal(bundle.canApply, false);
  assert.equal(
    readCodes(bundle.blockers).includes(
      "ROLE_BUNDLE_CHILD_ROLE_NOT_ASSIGNABLE",
    ),
    true,
  );
  assert.deepEqual(readPath(bundle, ["proposedAssignments"]), []);
  assert.equal(bundleDb.writeCount, 0);
});

test("access assignment preview expands non-legacy bundles in memory without persistence", async () => {
  const db = fakeDb({
    users: [activeUser("target-user", ["STAFF_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-staff", "STAFF_CONSOLE_USER", [Permission.WORK_SCHEDULE_READ]),
    ],
    role_assignments: [],
    responsibility_assignments: [],
  });

  const result = await new AccessAssignmentPreviewAdminService(db).preview({
    targetUserId: "target-user",
    assignmentTargetType: "BUNDLE",
    assignmentTargetCode: "STAFF_CONSOLE_BUNDLE",
    bundleVersion: "2026-06-26",
    structuredScopeGrants: [{ scopeType: "self" }],
    reason: "staff access",
  });

  assert.equal(result.canApply, true);
  assert.equal(
    readPath(result, ["bundleExpansion", "persistedParentBundleAssignment"]),
    false,
  );
  assert.deepEqual(readPath(result, ["bundleExpansion", "childRoleCodes"]), [
    "STAFF_CONSOLE_USER",
  ]);
  assert.equal(
    readPath(result, ["proposedAssignments", 0, "origin"]),
    "BUNDLE",
  );
  assert.equal(
    readPath(result, ["proposedAssignments", 0, "bundleOrigin", "bundleCode"]),
    "STAFF_CONSOLE_BUNDLE",
  );
  assert.equal(
    readPath(result, ["sourceTrace", "bundleSource"]),
    "role-bundle.catalog",
  );
  assert.equal(db.writeCount, 0);
});

test("access assignment preview blocks staff bundle when child runtime role is missing or inactive without side effects", async () => {
  for (const roles of [
    [],
    [
      role(
        "role-staff",
        "STAFF_CONSOLE_USER",
        [Permission.WORK_SCHEDULE_READ],
        {
          state: "INACTIVE",
        },
      ),
    ],
  ]) {
    const db = fakeDb({
      users: [activeUser("target-user", ["STAFF_CONSOLE"])],
      employment_profiles: [activeProfile("profile-1", "target-user")],
      roles,
      role_assignments: [],
      responsibility_assignments: [],
    });

    const result = await new AccessAssignmentPreviewAdminService(db).preview({
      targetUserId: "target-user",
      assignmentTargetType: "BUNDLE",
      assignmentTargetCode: "STAFF_CONSOLE_BUNDLE",
      bundleVersion: "2026-06-26",
      structuredScopeGrants: [{ scopeType: "self" }],
      reason: "staff access",
    });

    assert.equal(result.canApply, false);
    assert.deepEqual(readCodes(result.blockers), [
      "BUNDLE_CHILD_ROLE_NOT_ACTIVE",
    ]);
    assert.deepEqual(readPath(result, ["proposedAssignments"]), []);
    assert.equal(
      readPath(result, ["bundleExpansion", "proposedChildCount"]),
      0,
    );
    assert.equal(db.writeCount, 0);
  }
});

test("access assignment preview blocks direct true legacy ROLE targets", async () => {
  for (const code of TRUE_LEGACY_ASSIGNMENT_TARGET_CODES) {
    const db = fakeDb({
      users: [activeUser("target-user", ["ADMIN_CONSOLE", "STAFF_CONSOLE"])],
      employment_profiles: [activeProfile("profile-1", "target-user")],
      roles: [role(`legacy-${code}`, code, [Permission.ROLE_ASSIGN_TO_USER])],
      role_assignments: [],
      responsibility_assignments: [],
    });

    const result = await new AccessAssignmentPreviewAdminService(db).preview({
      targetUserId: "target-user",
      assignmentTargetType: "ROLE",
      assignmentTargetId: `legacy-${code}`,
      assignmentTargetCode: code,
      structuredScopeGrants: [{ scopeType: "global" }],
      reason: "legacy check",
      effectiveAt: EFFECTIVE_AT,
      reviewAt: REVIEW_AT_30_DAYS,
    });

    assert.equal(result.canApply, false);
    assert.equal(
      readCodes(result.blockers).includes("LEGACY_ROLE_BLOCKED"),
      true,
    );
    assert.equal(
      (
        readPath(result, ["legacyRoleStatus", "blockedCodes"]) as string[]
      ).includes(code),
      true,
    );
  }
});

test("access assignment preview blocks sensitive global access without reason and self-assignment", async () => {
  const db = fakeDb({
    users: [activeUser("actor-user", ["ADMIN_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "actor-user")],
    roles: [
      role("role-access", "ACCESS_ADMIN", [Permission.ROLE_ASSIGN_TO_USER]),
    ],
    role_assignments: [],
    responsibility_assignments: [],
  });

  const result = await new AccessAssignmentPreviewAdminService(db).preview({
    targetUserId: "actor-user",
    assignmentTargetType: "ROLE_TEMPLATE",
    assignmentTargetCode: "ACCESS_ADMIN",
    structuredScopeGrants: [{ scopeType: "global" }],
    actorUserId: "actor-user",
    effectiveAt: EFFECTIVE_AT,
    reviewAt: Date.UTC(2026, 0, 8),
    expiresAt: EXPIRES_AT_7_DAYS,
  } as Parameters<AccessAssignmentPreviewAdminService["preview"]>[0]);

  assert.equal(result.canApply, false);
  assert.deepEqual(readCodes(result.blockers), [
    "REASON_REQUIRED",
    "SELF_ASSIGNMENT_BLOCKED",
  ]);
  assert.equal(db.writeCount, 0);
});

test("access assignment preview requires review for sensitive or global grants", async () => {
  const db = fakeDb({
    users: [activeUser("target-user", ["ADMIN_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [role("role-auditor", "VIEWER_AUDITOR", [Permission.KPI_READ])],
    role_assignments: [],
    responsibility_assignments: [],
  });

  const missingReview = await new AccessAssignmentPreviewAdminService(
    db,
  ).preview({
    targetUserId: "target-user",
    assignmentTargetType: "ROLE_TEMPLATE",
    assignmentTargetCode: "VIEWER_AUDITOR",
    structuredScopeGrants: [{ scopeType: "global" }],
    reason: "global audit access",
    effectiveAt: EFFECTIVE_AT,
  });
  assert.equal(missingReview.canApply, false);
  assert.deepEqual(readCodes(missingReview.blockers), ["REVIEW_AT_REQUIRED"]);
  assert.equal(
    readPath(missingReview, ["sensitiveAccess", "isGlobalLike"]),
    true,
  );
  assert.equal(
    readPath(missingReview, ["sensitiveAccess", "requiresReview"]),
    true,
  );

  const lateReview = await new AccessAssignmentPreviewAdminService(db).preview({
    targetUserId: "target-user",
    assignmentTargetType: "ROLE_TEMPLATE",
    assignmentTargetCode: "VIEWER_AUDITOR",
    structuredScopeGrants: [{ scopeType: "global" }],
    reason: "global audit access",
    effectiveAt: EFFECTIVE_AT,
    reviewAt: REVIEW_AT_120_DAYS,
  });
  assert.equal(lateReview.canApply, false);
  assert.deepEqual(readCodes(lateReview.blockers), [
    "REVIEW_AT_EXCEEDS_MAX_WINDOW",
  ]);
});

test("access assignment preview permits OWNER_ADMIN only for the active Primary Owner in non-production with a current review deadline", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const now = Date.now();
  const db = fakeDb({
    users: [activeUser("target-user", ["ADMIN_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-owner", "OWNER_ADMIN", [Permission.ROLE_ASSIGN_TO_USER]),
    ],
    role_assignments: [],
    responsibility_assignments: [],
    governance_principals: [
      {
        _id: "principal-owner",
        userId: "target-user",
        principalType: "PRIMARY_OWNER",
        status: "ACTIVE",
        effectiveAt: now - 1_000,
        expiresAt: null,
      },
    ],
  });

  try {
    const result = await new AccessAssignmentPreviewAdminService(db).preview({
      targetUserId: "target-user",
      assignmentTargetType: "ROLE_TEMPLATE",
      assignmentTargetCode: "OWNER_ADMIN",
      structuredScopeGrants: [{ scopeType: "global" }],
      reason: "non-production owner administration",
      effectiveAt: now,
      reviewAt: now + 7 * 24 * 60 * 60 * 1_000,
    });

    assert.equal(result.canApply, true);
    assert.deepEqual(readCodes(result.blockers), []);
    assert.equal(
      readPath(result, ["sensitiveAccess", "isBreakGlassLike"]),
      false,
    );
    assert.equal(
      readPath(result, ["sensitiveAccess", "requiresExpiry"]),
      false,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("access assignment preview duplicate checks match current active-state lifecycle behavior", async () => {
  const command = {
    targetUserId: "target-user",
    assignmentTargetType: "ROLE_TEMPLATE" as const,
    assignmentTargetCode: "STAFF_CONSOLE_USER",
    structuredScopeGrants: [{ scopeType: "self" as const }],
    reason: "staff access",
  };
  const baseRows = {
    users: [activeUser("target-user", ["STAFF_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-staff", "STAFF_CONSOLE_USER", [Permission.WORK_SCHEDULE_READ]),
    ],
    responsibility_assignments: [],
  };
  const activeDuplicate = {
    _id: "assignment-active",
    roleId: "role-staff",
    userId: "target-user",
    structuredScopeGrants: [{ scopeType: "self" }],
    scopeFingerprint: "scope:v1:self",
    state: "ACTIVE",
    effectiveAt: Date.now(),
    expiresAt: null,
    reason: "existing",
    createdAt: 1,
  };

  const active = await new AccessAssignmentPreviewAdminService(
    fakeDb({ ...baseRows, role_assignments: [activeDuplicate] }),
  ).preview(command);
  assert.equal(active.canApply, false);
  assert.deepEqual(readCodes(active.blockers), ["DUPLICATE_ACTIVE_ASSIGNMENT"]);

  const revoked = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      ...baseRows,
      role_assignments: [
        { ...activeDuplicate, _id: "revoked", state: "REVOKED" },
      ],
    }),
  ).preview(command);
  assert.equal(revoked.canApply, true);
  assert.deepEqual(readCodes(revoked.blockers), []);

  const expired = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      ...baseRows,
      role_assignments: [{ ...activeDuplicate, _id: "expired", expiresAt: 1 }],
    }),
  ).preview(command);
  assert.equal(expired.canApply, true);
  assert.deepEqual(readCodes(expired.blockers), []);

  const expiredSuspended = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      ...baseRows,
      role_assignments: [{
        ...activeDuplicate,
        _id: "expired-suspended",
        state: "SUSPENDED",
        expiresAt: 1,
      }],
    }),
  ).preview(command);
  assert.equal(expiredSuspended.canApply, true);
  assert.deepEqual(readCodes(expiredSuspended.blockers), []);

  const future = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      ...baseRows,
      role_assignments: [
        {
          ...activeDuplicate,
          _id: "future",
          state: "SCHEDULED",
          effectiveAt: Date.now() + 60_000,
        },
      ],
    }),
  ).preview(command);
  assert.equal(future.canApply, false);
  assert.deepEqual(readCodes(future.blockers), ["DUPLICATE_ACTIVE_ASSIGNMENT"]);

  const timedSlotIdentity = buildAuthoritySlotIdentity({
    userId: "target-user",
    roleId: "role-staff",
    structuredScopeGrants: [{ scopeType: "self" }],
  });
  const timedReleased = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      ...baseRows,
      role_assignments: [activeDuplicate],
      role_assignment_authority_slots: [{
        _id: timedSlotIdentity.id,
        userId: timedSlotIdentity.userId,
        roleId: timedSlotIdentity.roleId,
        scopeFingerprint: timedSlotIdentity.scopeFingerprint,
        schemaVersion: 1,
        status: "RESERVED",
        lineageId: "assignment-active",
        currentAssignmentId: "assignment-active",
        scheduledSuccessorAssignmentId: null,
        successorEffectiveAt: null,
        releaseAt: Date.now() - 1,
        predecessorReleaseAt: null,
        transitionIdentity: "expired:assignment-active",
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      }],
    }),
  ).preview(command);
  assert.equal(timedReleased.canApply, true);
  assert.deepEqual(readCodes(timedReleased.blockers), []);

  const futureReserved = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      ...baseRows,
      role_assignments: [
        { ...activeDuplicate, expiresAt: 1 },
        {
          ...activeDuplicate,
          _id: "assignment-future",
          state: "SCHEDULED",
          effectiveAt: Date.now() + 30_000,
          expiresAt: Date.now() + 60_000,
        },
      ],
      role_assignment_authority_slots: [{
        _id: timedSlotIdentity.id,
        userId: timedSlotIdentity.userId,
        roleId: timedSlotIdentity.roleId,
        scopeFingerprint: timedSlotIdentity.scopeFingerprint,
        schemaVersion: 1,
        status: "RESERVED",
        lineageId: "assignment-active",
        currentAssignmentId: "assignment-active",
        scheduledSuccessorAssignmentId: "assignment-future",
        successorEffectiveAt: Date.now() + 30_000,
        releaseAt: Date.now() + 60_000,
        predecessorReleaseAt: null,
        transitionIdentity: "successor:assignment-future",
        version: 2,
        createdAt: 1,
        updatedAt: 2,
      }],
    }),
  ).preview(command);
  assert.equal(futureReserved.canApply, false);
  assert.deepEqual(readCodes(futureReserved.blockers), [
    "DUPLICATE_ACTIVE_ASSIGNMENT",
  ]);
});

test("access assignment targets endpoint is metadata-only and does not expose user pickers", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const app = express();
  app.use(express.json());
  app.use(contextMiddleware("ADMIN"));
  app.use((req, _res, next) => {
    bindActor(
      req,
      new Actor({
        id: "access-admin",
        type: "admin",
        context: "ADMIN",
        roles: [],
        permissions: [Permission.ROLE_ASSIGNMENT_VIEW],
        accountContexts: ["ADMIN_CONSOLE"],
        isActive: true,
      }),
    );
    next();
  });
  app.use(
    "/admin/access-assignments",
    adminAccessAssignmentPreviewRoutes(
      new AdminAccessAssignmentPreviewController(
        new AccessAssignmentPreviewAdminService(
          fakeDb({
            users: [],
            employment_profiles: [],
            roles: [],
            role_assignments: [],
            responsibility_assignments: [],
          }),
        ),
      ),
    ),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const mapped = mapToHttpError(error);
      res.status(mapped.status).json({
        error: { code: mapped.code, message: mapped.message },
      });
    },
  );

  const server = await listen(app);
  try {
    const response = await fetch(
      `${toBaseUrl(server)}/admin/access-assignments/targets`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    const data = body.data;
    assert.equal(data.readOnly, true);
    assert.equal(data.unrestrictedUserListReturned, false);
    assert.equal(data.userListReturned, false);
    assert.equal(data.eligibleUsersReturned, false);
    assert.equal("users" in data, false);
    assert.equal("eligibleUsers" in data, false);
    assert.equal("accountContext" in data, false);
    assert.deepEqual(data.frontendSettableAuthorityFields, []);
    assert.equal(data.frontendSettableFields.includes("accountContext"), false);
    assert.equal(data.frontendSettableFields.includes("consoleCode"), false);
    const targets = data.assignmentTargets as Array<Record<string, unknown>>;
    assert.equal(targets.length > 0, true);
    for (const code of CANONICAL_ASSIGNMENT_TARGET_CODES) {
      const target = targets.find((item) => item.code === code);
      assert.equal(target?.legacyAssignable, true);
    }
    const talentGroupManagerTarget = targets.find(
      (item) => item.code === "TALENT_GROUP_MANAGER",
    );
    assert.equal(
      talentGroupManagerTarget?.assignabilityStatus,
      "REQUIRES_SCOPE_SELECTION",
    );
    assert.deepEqual(talentGroupManagerTarget?.requiredScopeTypes, [
      "managedTalentGroup",
    ]);
    const orgUnitManagerTarget = targets.find(
      (item) => item.code === "ORG_UNIT_MANAGER",
    );
    assert.equal(
      orgUnitManagerTarget?.assignabilityStatus,
      "REQUIRES_SCOPE_SELECTION",
    );
    assert.deepEqual(orgUnitManagerTarget?.requiredScopeTypes, [
      "managedOrgUnit",
    ]);
    const ownerTarget = targets.find((item) => item.code === "OWNER_ADMIN");
    assert.equal(ownerTarget?.assignabilityStatus, "RESTRICTED_SENSITIVE");
    assert.equal(ownerTarget?.operatorFlowGroup, "RESTRICTED_SENSITIVE");

    const auditorTarget = targets.find(
      (item) => item.code === "VIEWER_AUDITOR",
    );
    assert.equal(auditorTarget?.assignabilityStatus, "READ_ONLY_AUDIT");
    assert.deepEqual(auditorTarget?.requiredScopeTypes, ["global"]);

    assert.equal(
      targets.some((item) => item.code === "ATTENDANCE_OPS"),
      false,
    );
    assert.equal(
      targets.some(
        (item) => item.assignabilityStatus === "FUTURE_READY_CONDITION",
      ),
      false,
    );
    assert.equal(
      targets.some((item) => item.assignabilityStatus === "SYSTEM_CONTROLLED"),
      false,
    );

    const auditorBundle = targets.find(
      (item) => item.code === "AUDITOR_BUNDLE",
    );
    assert.equal(auditorBundle?.legacyAssignable, true);
    assert.equal(auditorBundle?.assignabilityStatus, "READ_ONLY_AUDIT");
    for (const code of TRUE_LEGACY_ASSIGNMENT_TARGET_CODES) {
      assert.equal(
        targets.some((item) => item.code === code),
        false,
      );
    }
  } finally {
    await close(server);
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("access assignment preview controller rejects frontend-owned authority inputs", async () => {
  const app = express();
  app.use(express.json());
  app.use(contextMiddleware("ADMIN"));
  app.use((req, _res, next) => {
    bindActor(
      req,
      new Actor({
        id: "access-admin",
        type: "admin",
        context: "ADMIN",
        roles: [],
        permissions: [Permission.ROLE_ASSIGN_TO_USER],
        accountContexts: ["ADMIN_CONSOLE"],
        isActive: true,
      }),
    );
    next();
  });

  let previewReached = false;
  const service = {
    async preview(): Promise<unknown> {
      previewReached = true;
      throw new Error("preview should not be reached");
    },
    listTargetOptions(): unknown {
      return {};
    },
  } as unknown as AccessAssignmentPreviewAdminService;

  app.use(
    "/admin/access-assignments",
    adminAccessAssignmentPreviewRoutes(
      new AdminAccessAssignmentPreviewController(service),
    ),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const mapped = mapToHttpError(error);
      res.status(mapped.status).json({
        error: { code: mapped.code, message: mapped.message },
      });
    },
  );

  const server = await listen(app);
  try {
    const forbiddenFields = [
      "accountContext",
      "accountContexts",
      "consoleCode",
      "workspaceAvailability",
      "primaryWorkspace",
      "manualEntitlement",
      "manualConsoleEntitlement",
      "consoleEntitlement",
      "entitlements",
      "actorKind",
    ];

    for (const field of forbiddenFields) {
      const response = await fetch(
        `${toBaseUrl(server)}/admin/access-assignments/preview`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targetUserId: "target-user",
            assignmentTargetType: "ROLE_TEMPLATE",
            assignmentTargetCode: "STAFF_CONSOLE_USER",
            structuredScopeGrants: [{ scopeType: "self" }],
            [field]:
              field === "accountContexts" ? ["ADMIN_CONSOLE"] : "ADMIN_CONSOLE",
          }),
        },
      );

      assert.equal(response.status, 400, field);
      await response.json();
    }
    assert.equal(previewReached, false);
  } finally {
    await close(server);
  }
});

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

function activeProfile(
  id: string,
  linkedUserId: string,
): Record<string, unknown> {
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
  options?: { readonly state?: string; readonly canonical?: boolean },
): Record<string, unknown> {
  const template = options?.canonical === false ? null : getRoleTemplate(code);
  return {
    _id: id,
    code,
    name: code,
    state: options?.state ?? "ACTIVE",
    permissions: template?.permissions ?? permissions,
    ...(template
      ? { templateCode: template.code, templateVersion: template.version }
      : {}),
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

function previewActor(permissions: readonly Permission[]): Actor {
  return new Actor({
    id: "access-admin",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
}

function fakeDb(
  collections: Record<string, readonly Record<string, unknown>[]>,
): Db & { readonly writeCount: number } {
  const state = new Map(
    Object.entries(collections).map(([name, rows]) => [name, [...rows]]),
  );
  let writeCount = 0;
  return {
    get writeCount() {
      return writeCount;
    },
    collection(name: string) {
      const rows = state.get(name) ?? [];
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
            limit() {
              return this;
            },
            async toArray() {
              return found;
            },
          };
        },
        async insertOne() {
          writeCount += 1;
          throw new Error("writes are forbidden in preview tests");
        },
        async updateOne() {
          writeCount += 1;
          throw new Error("writes are forbidden in preview tests");
        },
        async findOneAndUpdate() {
          writeCount += 1;
          throw new Error("writes are forbidden in preview tests");
        },
      };
    },
  } as unknown as Db & { readonly writeCount: number };
}

function matches(
  row: Readonly<Record<string, unknown>>,
  query: Readonly<Record<string, unknown>>,
): boolean {
  for (const [key, expected] of Object.entries(query)) {
    if (key === "$or") {
      if (
        !Array.isArray(expected) ||
        !expected.some((entry) => matches(row, entry))
      ) {
        return false;
      }
      continue;
    }
    if (key === "$and") {
      if (
        !Array.isArray(expected) ||
        !expected.every((entry) => matches(row, entry))
      ) {
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
      const values = expected.$in;
      return Array.isArray(values) && values.includes(actual);
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCodes(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value
        .map((item) =>
          isPlainObject(item) && typeof item.code === "string"
            ? item.code
            : null,
        )
        .filter((item): item is string => item !== null)
        .sort()
    : [];
}

function readPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      current = Array.isArray(current) ? current[segment] : undefined;
      continue;
    }
    current =
      isPlainObject(current) || Array.isArray(current)
        ? (current as Record<string, unknown>)[segment]
        : undefined;
  }
  return current;
}

function findConsole(
  value: unknown,
  consoleCode: string,
): Record<string, unknown> | undefined {
  const consoles = readPath(value, ["consoleEntitlementPreview", "consoles"]);
  return Array.isArray(consoles)
    ? consoles.find(
        (item): item is Record<string, unknown> =>
          isPlainObject(item) && item.console === consoleCode,
      )
    : undefined;
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
