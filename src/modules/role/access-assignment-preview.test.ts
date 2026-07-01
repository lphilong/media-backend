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

test("access assignment preview normalizes scope and computes proposed manager access without mutation", async () => {
  const db = fakeDb({
    users: [activeUser("target-user", ["MANAGER_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-tgm", "TALENT_GROUP_MANAGER", [
        Permission.TALENT_GROUP_READ,
      ]),
    ],
    role_assignments: [],
    responsibility_assignments: [
      responsibility("resp-1", "profile-1", "TALENT_GROUP", "group-a", "TALENT_GROUP_MANAGER"),
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
  });

  assert.equal(result.canApply, true);
  assert.equal(
    result.scopeFingerprint,
    "scope:v1:managedTalentGroup|targetId=group-a",
  );
  assert.deepEqual(
    readPath(result, ["effectiveAccessDelta", "addedPermissions"]),
    [Permission.TALENT_GROUP_READ],
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

test("access assignment preview blocks missing required AccountContext without mutating it", async () => {
  const db = fakeDb({
    users: [activeUser("target-user", ["STAFF_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-tgm", "TALENT_GROUP_MANAGER", [
        Permission.TALENT_GROUP_READ,
      ]),
    ],
    role_assignments: [],
    responsibility_assignments: [
      responsibility("resp-1", "profile-1", "TALENT_GROUP", "group-a", "TALENT_GROUP_MANAGER"),
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
  });

  assert.equal(result.canApply, false);
  assert.equal(
    readPath(result, ["accountContextRequirement", "status"]),
    "MISSING_REQUIRED_CONTEXT",
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
    false,
  );
  assert.deepEqual(readCodes(result.blockers), [
    "REQUIRED_ACCOUNT_CONTEXT_MISSING",
  ]);
  const managerConsole = findConsole(result, "MANAGER_CONSOLE");
  assert.equal(managerConsole?.proposedEligible, false);
  assert.deepEqual(managerConsole?.blockers, [
    "REQUIRED_ACCOUNT_CONTEXT_MISSING",
  ]);
  assert.equal(
    readPath(result, ["previewCompleteness", "status"]),
    "PARTIAL",
  );
  assert.equal(
    readPath(result, [
      "proposedEffectiveAccess",
      "workspaceAvailability",
      "primaryWorkspace",
    ]),
    "STAFF_CONSOLE",
  );
  assert.equal(db.writeCount, 0);
});

test("access assignment preview blocks missing responsibility and duplicate exact scope", async () => {
  const db = fakeDb({
    users: [activeUser("target-user", ["MANAGER_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-tgm", "TALENT_GROUP_MANAGER", [
        Permission.TALENT_GROUP_READ,
      ]),
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
        effectiveAt: 1,
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
  });

  assert.equal(result.canApply, false);
  assert.deepEqual(
    readCodes(result.blockers),
    ["DUPLICATE_ACTIVE_ASSIGNMENT", "RESPONSIBILITY_REQUIRED"],
  );
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
  };

  const satisfied = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      users: [activeUser("target-user", ["MANAGER_CONSOLE"])],
      employment_profiles: [activeProfile("profile-1", "target-user")],
      roles: [
        role("role-ou", "ORG_UNIT_MANAGER", [
          Permission.ORG_UNIT_READ,
        ]),
      ],
      role_assignments: [],
      responsibility_assignments: [
        responsibility("resp-1", "profile-1", "ORG_UNIT", "org-a", "ORG_UNIT_MANAGER"),
      ],
    }),
  ).preview(command);

  assert.equal(satisfied.canApply, true);
  assert.deepEqual(readCodes(satisfied.blockers), []);

  const missing = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      users: [activeUser("target-user", ["MANAGER_CONSOLE"])],
      employment_profiles: [activeProfile("profile-1", "target-user")],
      roles: [
        role("role-ou", "ORG_UNIT_MANAGER", [
          Permission.ORG_UNIT_READ,
        ]),
      ],
      role_assignments: [],
      responsibility_assignments: [],
      org_unit_memberships: [
        { _id: "membership-1", employmentProfileId: "profile-1", orgUnitId: "org-a" },
      ],
    }),
  ).preview(command);

  assert.equal(missing.canApply, false);
  assert.deepEqual(readCodes(missing.blockers), ["RESPONSIBILITY_REQUIRED"]);
  assert.equal(
    readPath(missing, ["responsibilityRequirements", 0, "status"]),
    "MISSING_RESPONSIBILITY",
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
  });

  assert.equal(result.canApply, true);
  assert.deepEqual(readCodes(result.blockers), []);
  assert.equal(
    readPath(result, ["bundleExpansion", "persistedParentBundleAssignment"]),
    false,
  );
  assert.deepEqual(
    readPath(result, ["bundleExpansion", "childRoleCodes"]),
    ["VIEWER_AUDITOR"],
  );
  assert.deepEqual(
    readPath(result, ["legacyRoleStatus", "blockedCodes"]),
    [],
  );
  assert.equal(readPath(result, ["proposedAssignments", 0, "roleCode"]), "VIEWER_AUDITOR");
  assert.equal(db.writeCount, 0);
});

test("access assignment preview treats canonical target roles as assignable", async () => {
  const permissionsByCode = {
    HR_OPERATIONS: Permission.EMPLOYMENT_PROFILE_READ,
    PRODUCTION_OPS: Permission.EVENT_READ,
    VIEWER_AUDITOR: Permission.KPI_READ,
  } as const;

  for (const code of CANONICAL_ASSIGNMENT_TARGET_CODES) {
    const db = fakeDb({
      users: [activeUser("target-user", ["ADMIN_CONSOLE"])],
      employment_profiles: [activeProfile("profile-1", "target-user")],
      roles: [role(`role-${code}`, code, [permissionsByCode[code]])],
      role_assignments: [],
      responsibility_assignments: [],
    });

    const result = await new AccessAssignmentPreviewAdminService(db).preview({
      targetUserId: "target-user",
      assignmentTargetType: "ROLE_TEMPLATE",
      assignmentTargetCode: code,
      structuredScopeGrants: [{ scopeType: "global" }],
      reason: `canonical assignment for ${code}`,
    });

    assert.equal(result.canApply, true);
    assert.deepEqual(readCodes(result.blockers), []);
    assert.equal(readPath(result, ["proposedAssignments", 0, "roleCode"]), code);
    assert.deepEqual(readPath(result, ["legacyRoleStatus", "blockedCodes"]), []);
    assert.equal(db.writeCount, 0);
  }
});

test("access assignment preview expands non-legacy bundles in memory without persistence", async () => {
  const db = fakeDb({
    users: [activeUser("target-user", ["STAFF_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "target-user")],
    roles: [
      role("role-staff", "STAFF_CONSOLE_USER", [
        Permission.WORK_SCHEDULE_READ,
      ]),
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
  assert.deepEqual(
    readPath(result, ["bundleExpansion", "childRoleCodes"]),
    ["STAFF_CONSOLE_USER"],
  );
  assert.equal(readPath(result, ["proposedAssignments", 0, "origin"]), "BUNDLE");
  assert.equal(
    readPath(result, ["proposedAssignments", 0, "bundleOrigin", "bundleCode"]),
    "STAFF_CONSOLE_BUNDLE",
  );
  assert.equal(readPath(result, ["sourceTrace", "bundleSource"]), "role-bundle.catalog");
  assert.equal(db.writeCount, 0);
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
    });

    assert.equal(result.canApply, false);
    assert.deepEqual(readCodes(result.blockers), ["LEGACY_ROLE_BLOCKED"]);
    assert.deepEqual(readPath(result, ["legacyRoleStatus", "blockedCodes"]), [
      code,
      code,
    ]);
  }
});

test("access assignment preview blocks sensitive global access without reason and self-assignment", async () => {
  const db = fakeDb({
    users: [activeUser("actor-user", ["ADMIN_CONSOLE"])],
    employment_profiles: [activeProfile("profile-1", "actor-user")],
    roles: [
      role("role-owner", "OWNER_ADMIN", [Permission.ROLE_ASSIGN_TO_USER]),
    ],
    role_assignments: [],
    responsibility_assignments: [],
  });

  const result = await new AccessAssignmentPreviewAdminService(db).preview({
    targetUserId: "actor-user",
    assignmentTargetType: "ROLE_TEMPLATE",
    assignmentTargetCode: "OWNER_ADMIN",
    structuredScopeGrants: [{ scopeType: "global" }],
    actorUserId: "actor-user",
  } as Parameters<AccessAssignmentPreviewAdminService["preview"]>[0]);

  assert.equal(result.canApply, false);
  assert.deepEqual(readCodes(result.blockers), [
    "REASON_REQUIRED",
    "SELF_ASSIGNMENT_BLOCKED",
  ]);
  assert.equal(db.writeCount, 0);
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
      role("role-staff", "STAFF_CONSOLE_USER", [
        Permission.WORK_SCHEDULE_READ,
      ]),
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
    effectiveAt: 1,
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
      role_assignments: [{ ...activeDuplicate, _id: "revoked", state: "REVOKED" }],
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
  assert.equal(expired.canApply, false);
  assert.deepEqual(readCodes(expired.blockers), ["DUPLICATE_ACTIVE_ASSIGNMENT"]);

  const future = await new AccessAssignmentPreviewAdminService(
    fakeDb({
      ...baseRows,
      role_assignments: [{ ...activeDuplicate, _id: "future", effectiveAt: Date.now() + 60_000 }],
    }),
  ).preview(command);
  assert.equal(future.canApply, false);
  assert.deepEqual(readCodes(future.blockers), ["DUPLICATE_ACTIVE_ASSIGNMENT"]);
});

test("access assignment targets endpoint is metadata-only and does not expose user pickers", async () => {
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
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const mapped = mapToHttpError(error);
    res.status(mapped.status).json({
      error: { code: mapped.code, message: mapped.message },
    });
  });

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
    assert.equal(
      targets.find((item) => item.code === "AUDITOR_BUNDLE")?.legacyAssignable,
      true,
    );
    for (const code of TRUE_LEGACY_ASSIGNMENT_TARGET_CODES) {
      assert.equal(targets.some((item) => item.code === code), false);
    }
  } finally {
    await close(server);
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
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const mapped = mapToHttpError(error);
    res.status(mapped.status).json({
      error: { code: mapped.code, message: mapped.message },
    });
  });

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
            [field]: field === "accountContexts" ? ["ADMIN_CONSOLE"] : "ADMIN_CONSOLE",
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
): Record<string, unknown> {
  return {
    _id: id,
    code,
    name: code,
    state: "ACTIVE",
    permissions,
    templateCode: code,
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
      if (!Array.isArray(expected) || !expected.some((entry) => matches(row, entry))) {
        return false;
      }
      continue;
    }
    if (key === "$and") {
      if (!Array.isArray(expected) || !expected.every((entry) => matches(row, entry))) {
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
  const consoles = readPath(value, [
    "consoleEntitlementPreview",
    "consoles",
  ]);
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
