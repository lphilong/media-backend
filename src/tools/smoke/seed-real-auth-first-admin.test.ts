import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ClientSession } from "mongodb";
import { Actor, ActorScopeGrants } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import {
  ReplaceRolePermissionsInput,
  TransitionRoleStateInput,
  UpdateRoleMetadataInput,
} from "@modules/role/domain/role.repository";
import {
  RoleRecord as BootstrapRoleRecord,
  RoleState as BootstrapRoleState,
  UserRoleAssignmentRecord as BootstrapRoleAssignmentRecord,
} from "@modules/role/domain/role.types";
import {
  ROLE_TEMPLATE_CODES,
  getRoleTemplate,
} from "@modules/role/domain/role-template.catalog";
import {
  CreateUserInput,
  SetUserAuthLinkageInput,
  TransitionUserLifecycleInput,
  UpdateUserProfileInput,
} from "@modules/user/domain/user.repository";
import {
  UserRecord,
} from "@modules/user/domain/user.types";
import {
  Auth0ManagementUser,
} from "@modules/user/domain/auth0-management.port";
import {
  FirstAdminBootstrapAuth0Port,
  FirstAdminBootstrapAssignmentRepository,
  FirstAdminBootstrapError,
  FirstAdminBootstrapRoleRepository,
  FirstAdminBootstrapService,
  FirstAdminBootstrapTransactionRunner,
  FirstAdminBootstrapUserRepository,
  formatFirstAdminBootstrapSummary,
  parseCliArgs,
} from "./first-admin-bootstrap";
import {
  buildExpectedRoleAssignmentDocument,
  buildExpectedRoleDocument,
  buildExpectedUserDocument,
  createMongoSeedCollections,
  RoleAssignmentSeedDocument,
  RoleSeedDocument,
  runCli,
  runSmokeSeed,
  SmokeSeedCollections,
  SmokeSeedError,
  SMOKE_FIRST_ADMIN_PERMISSIONS,
  SMOKE_FIRST_ADMIN_SCOPE_GRANTS,
  SmokeSeedInput,
  UserSeedDocument,
  validateSeedEnv,
} from "./seed-real-auth-first-admin";

const NOW = 1_771_200_000_000;
const FAKE_MONGO_URI = [
  "mongodb://",
  "user",
  ":",
  "pass",
  "@localhost:27017/media_smoke",
].join("");
const FAKE_REDIS_URL = [
  "redis://",
  ":",
  "secret",
  "@localhost:6379",
].join("");
const FAKE_AUTH0_SECRET = [
  "auth0",
  "client",
  "secret",
  "value",
].join("-");
const FAKE_ENCRYPTION_KEY = "00112233445566778899aabbccddeeff".repeat(2);

function baseEnv(
  overrides: Record<string, string | undefined> = {},
) {
  return {
    DOTENV_CONFIG_PATH: ".env.dev",
    ALLOW_SMOKE_SEED: "true",
    AUTH0_SUB: "auth0|smoke-admin",
    LOCAL_MOCK_AUTH_ENABLED: "false",
    NODE_ENV: "development",
    APP_RUNTIME: "http",
    MONGO_URI: FAKE_MONGO_URI,
    MONGO_DB_NAME: "media_smoke",
    REDIS_URL: FAKE_REDIS_URL,
    AUTH0_CLIENT_SECRET: FAKE_AUTH0_SECRET,
    ENCRYPTION_KEY: FAKE_ENCRYPTION_KEY,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<SmokeSeedInput> = {},
): SmokeSeedInput {
  return {
    auth0Sub: "auth0|smoke-admin",
    displayName: "Smoke Real Auth Admin",
    email: "smoke-admin@example.test",
    roleCode: "SMOKE_REAL_AUTH_ADMIN",
    roleName: "Smoke Real Auth Admin",
    dbNameClass: "smoke-like",
    mongoUri: FAKE_MONGO_URI,
    mongoDbName: "media_smoke",
    ...overrides,
  };
}

class FakeCollection<TDocument extends { readonly _id: string }> {
  readonly inserted: TDocument[] = [];

  constructor(readonly documents: TDocument[] = []) {}

  async findOne(
    filter: Record<string, unknown>,
  ): Promise<TDocument | null> {
    return (
      this.documents.find((document) =>
        matchesFilter(document, filter),
      ) ?? null
    );
  }

  find(filter: Record<string, unknown>) {
    return {
      toArray: async () =>
        this.documents.filter((document) =>
          matchesFilter(document, filter),
        ),
    };
  }

  async insertOne(document: TDocument): Promise<void> {
    this.inserted.push(document);
    this.documents.push(document);
  }
}

function createFakeCollections(params: {
  readonly users?: UserSeedDocument[];
  readonly roles?: RoleSeedDocument[];
  readonly assignments?: RoleAssignmentSeedDocument[];
} = {}): {
  readonly collections: SmokeSeedCollections;
  readonly users: FakeCollection<UserSeedDocument>;
  readonly roles: FakeCollection<RoleSeedDocument>;
  readonly assignments: FakeCollection<RoleAssignmentSeedDocument>;
} {
  const users = new FakeCollection(params.users ?? []);
  const roles = new FakeCollection(params.roles ?? []);
  const assignments = new FakeCollection(
    params.assignments ?? [],
  );

  return {
    collections: {
      users,
      roles,
      roleAssignments: assignments,
    },
    users,
    roles,
    assignments,
  };
}

function ids() {
  const values = ["user-id", "role-id", "assignment-id"];

  return () => {
    const next = values.shift();
    assert.ok(next);
    return next;
  };
}

function exactSeedDocuments(input = baseInput()) {
  const user = buildExpectedUserDocument(
    input,
    "user-id",
    NOW,
  );
  const role = buildExpectedRoleDocument(
    input,
    "role-id",
    NOW,
  );
  const assignment =
    buildExpectedRoleAssignmentDocument(
      {
        assignmentId: "assignment-id",
        roleId: "role-id",
        userId: "user-id",
      },
      NOW,
    );

  return { user, role, assignment };
}

test("seed env rejects missing AUTH0_SUB", () => {
  assert.throws(
    () => validateSeedEnv(baseEnv({ AUTH0_SUB: undefined })),
    /AUTH0_SUB is required/u,
  );
});

test("seed env rejects blank AUTH0_SUB", () => {
  assert.throws(
    () => validateSeedEnv(baseEnv({ AUTH0_SUB: "   " })),
    /AUTH0_SUB is required/u,
  );
});

test("seed env rejects missing or non-.env.dev DOTENV_CONFIG_PATH", () => {
  assert.throws(
    () =>
      validateSeedEnv(
        baseEnv({ DOTENV_CONFIG_PATH: undefined }),
      ),
    /DOTENV_CONFIG_PATH is required/u,
  );
  assert.throws(
    () =>
      validateSeedEnv({
        ...baseEnv(),
        DOTENV_CONFIG_PATH: ".env.local",
      }),
    /DOTENV_CONFIG_PATH must resolve to \.env\.dev/u,
  );
});

test("seed env rejects missing ALLOW_SMOKE_SEED=true", () => {
  assert.throws(
    () =>
      validateSeedEnv({
        ...baseEnv(),
        ALLOW_SMOKE_SEED: undefined,
      }),
    /ALLOW_SMOKE_SEED must be true/u,
  );
});

test("seed env rejects NODE_ENV=production", () => {
  assert.throws(
    () =>
      validateSeedEnv({
        ...baseEnv(),
        NODE_ENV: "production",
      }),
    /NODE_ENV=production is forbidden/u,
  );
});

test("seed env rejects deployed runtime markers", () => {
  assert.throws(
    () => validateSeedEnv(baseEnv({ RENDER: "true" })),
    /Deployed or staging runtime markers are forbidden/u,
  );
  assert.throws(
    () => validateSeedEnv(baseEnv({ DEPLOY_ENV: "staging" })),
    /Deployed or staging runtime markers are forbidden/u,
  );
});

test("seed env rejects LOCAL_MOCK_AUTH_ENABLED=true", () => {
  assert.throws(
    () =>
      validateSeedEnv({
        ...baseEnv(),
        LOCAL_MOCK_AUTH_ENABLED: "true",
      }),
    /LOCAL_MOCK_AUTH_ENABLED must be false or unset/u,
  );
});

test("seed env rejects unsafe DB names unless explicit override is present", () => {
  assert.throws(
    () =>
      validateSeedEnv({
        ...baseEnv(),
        MONGO_DB_NAME: "media",
      }),
    /MONGO_DB_NAME must be dev\/smoke\/local\/test\/sandbox-like/u,
  );

  const parsed = validateSeedEnv({
    ...baseEnv(),
    MONGO_DB_NAME: "media",
    ALLOW_NONLOCAL_SMOKE_DB: "true",
  });
  assert.equal(parsed.dbNameClass, "nonlocal-override");
});

test("seed permission literals are canonical", () => {
  const canonical = new Set(Object.values(Permission));

  assert.deepEqual(SMOKE_FIRST_ADMIN_PERMISSIONS, [
    "user:view",
    "role:list",
    "role:view",
    "role:assignment:view",
    "orgUnit.read",
    "employmentProfile.read",
    "talent.read",
    "talentGroup.read",
    "platformAccount.read",
    "studioResource.read",
    "workSchedule.read",
    "event.read",
    "contractRegistry.read",
    "talentKpi.read",
    "revenueLedger.read",
    "commissionRule.read",
    "commissionSettlement.read",
    "dashboardLite.read",
  ]);

  for (const permission of SMOKE_FIRST_ADMIN_PERMISSIONS) {
    assert.equal(canonical.has(permission), true);
  }
});

test("seed scope grants are accepted by canonical Actor validation", () => {
  const actor = new Actor({
    id: "scope-validation",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [],
    scopeGrants: SMOKE_FIRST_ADMIN_SCOPE_GRANTS,
    isActive: true,
  });

  assert.deepEqual(actor.scopeGrants, {
    workSchedule: ["self", "team", "department", "global"],
    eventAssignment: ["global"],
    contractRegistry: ["global"],
    talentKpi: ["global"],
    revenueLedger: ["global"],
    commission: ["global"],
    dashboardLite: ["global"],
  });
});

test("seed builders construct expected stable user, role, and assignment shapes", () => {
  const { user, role, assignment } = exactSeedDocuments();

  assert.deepEqual(user, {
    _id: "user-id",
    accountStatus: "ACTIVE",
    actorKind: "ADMIN",
    authLinkage: {
      provider: "auth0",
      subject: "auth0|smoke-admin",
    },
    profile: {
      displayName: "Smoke Real Auth Admin",
      email: "smoke-admin@example.test",
    },
    searchDisplayName: "smoke real auth admin",
    searchEmail: "smoke-admin@example.test",
    contextAccess: { contexts: ["ADMIN"] },
    preferences: {},
    createdAt: NOW,
    updatedAt: NOW,
    activatedAt: NOW,
    disabledAt: null,
    archivedAt: null,
    scopeGrants: SMOKE_FIRST_ADMIN_SCOPE_GRANTS,
  });
  assert.equal(role.code, "SMOKE_REAL_AUTH_ADMIN");
  assert.equal(role.state, "ACTIVE");
  assert.equal(role.delegationBand, "LIMITED");
  assert.equal(role.maxDelegatableBand, "NONE");
  assert.deepEqual(
    role.permissions,
    SMOKE_FIRST_ADMIN_PERMISSIONS,
  );
  assert.deepEqual(assignment, {
    _id: "assignment-id",
    roleId: "role-id",
    userId: "user-id",
    state: "ACTIVE",
    effectiveAt: NOW,
    revokedAt: null,
    reason: "Smoke/dev-only Real Auth0 first admin seed.",
    createdAt: NOW,
    updatedAt: NOW,
  });
});

test("legacy smoke seed is retired before reads or writes", async () => {
  const fake = createFakeCollections();
  await assert.rejects(
    runSmokeSeed(fake.collections, baseInput(), {
      mode: "write",
      now: NOW,
      randomUUID: ids(),
    }),
    (error: unknown) => {
      assert.ok(error instanceof SmokeSeedError);
      assert.equal(error.code, "SMOKE_SEED_RETIRED_USE_FIRST_ADMIN_BOOTSTRAP");
      return true;
    },
  );
  assert.equal(fake.users.inserted.length, 0);
  assert.equal(fake.roles.inserted.length, 0);
  assert.equal(fake.assignments.inserted.length, 0);
});

test("runtime collection factory touches only allowed seed collections", async () => {
  const touched: string[] = [];
  const fake = createFakeCollections();
  const db = {
    collection(name: string) {
      touched.push(name);
      if (name === "users") {
        return fake.users;
      }
      if (name === "roles") {
        return fake.roles;
      }
      if (name === "role_assignments") {
        return fake.assignments;
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };

  createMongoSeedCollections(db as never);

  assert.deepEqual(touched, [
    "users",
    "roles",
    "role_assignments",
  ]);
});

test("seed source does not use a SYSTEM actor", () => {
  const source = readFileSync(
    __filename.replace(/\.test\.ts$/u, ".ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /type:\s*"system"/u);
  assert.doesNotMatch(source, /\bSYSTEM\b/u);
});

test("help output does not include raw secret-looking env values or service URLs", async () => {
  const lines: string[] = [];
  const errors: string[] = [];

  await runCli(["--help"], baseEnv() as never, {
    log(message?: unknown) {
      lines.push(String(message ?? ""));
    },
    error(message?: unknown) {
      errors.push(String(message ?? ""));
    },
  });

  const output = [...lines, ...errors].join("\n");
  assert.doesNotMatch(output, /mongodb:\/\//u);
  assert.doesNotMatch(output, /redis:\/\//u);
  assert.doesNotMatch(output, /auth0-client-secret-value/u);
  assert.doesNotMatch(output, /001122334455/u);
  assert.doesNotMatch(output, /user:pass/u);
});

test("first-admin bootstrap creates every active runtime role when missing", async () => {
  const fixture = createFirstAdminFixture();

  const summary = await fixture.run();

  assert.equal(summary.roles.created, ROLE_TEMPLATE_CODES.length);
  assert.equal(fixture.roles.records.size, ROLE_TEMPLATE_CODES.length);
  assert.deepEqual(
    [...fixture.roles.records.keys()].sort(),
    [...ROLE_TEMPLATE_CODES].sort(),
  );
});

test("first-admin bootstrap reuses existing runtime roles", async () => {
  const fixture = createFirstAdminFixture();
  fixture.roles.addRuntimeRoles();

  const summary = await fixture.run();

  assert.equal(summary.roles.created, 0);
  assert.equal(summary.roles.reused, ROLE_TEMPLATE_CODES.length);
});

test("first-admin bootstrap fails if Auth0 email is missing or ambiguous", async () => {
  const missing = createFirstAdminFixture();
  missing.auth0.usersByEmail.clear();
  await assert.rejects(
    () => missing.run(),
    bootstrapErrorWithCode("FIRST_ADMIN_AUTH0_USER_NOT_FOUND"),
  );

  const ambiguous = createFirstAdminFixture();
  ambiguous.auth0.usersByEmail.set("admin@gmail.com", [
    { id: "auth0|admin-a", email: "admin@gmail.com" },
    { id: "auth0|admin-b", email: "admin@gmail.com" },
  ]);
  await assert.rejects(
    () => ambiguous.run(),
    bootstrapErrorWithCode("FIRST_ADMIN_AUTH0_EMAIL_AMBIGUOUS"),
  );
});

test("first-admin bootstrap creates ACTIVE LINKED user from Auth0", async () => {
  const fixture = createFirstAdminFixture();

  await fixture.run();

  assert.equal(fixture.users.records.length, 1);
  assert.equal(fixture.users.records[0]?.accountStatus, "ACTIVE");
  assert.equal(fixture.users.records[0]?.actorKind, "ADMIN");
  assert.deepEqual(fixture.users.records[0]?.authLinkage, {
    provider: "auth0",
    subject: "auth0|admin-user",
    status: "LINKED",
  });
});

test("first-admin bootstrap repairs same-subject user missing LINKED", async () => {
  const fixture = createFirstAdminFixture();
  fixture.users.records.push(
    makeBootstrapUser({
      id: "existing-user",
      status: "UNLINKED",
      accountStatus: "PENDING",
    }),
  );

  const summary = await fixture.run();

  assert.equal(summary.adminUser.action, "updated");
  assert.equal(fixture.users.records.length, 1);
  assert.equal(fixture.users.records[0]?.accountStatus, "ACTIVE");
  assert.equal(fixture.users.records[0]?.authLinkage.status, "LINKED");
});

test("first-admin bootstrap fails closed on duplicate same-subject internal users before assignment writes", async () => {
  const fixture = createFirstAdminFixture();
  fixture.roles.addRuntimeRoles();
  fixture.users.records.push(
    makeBootstrapUser({ id: "duplicate-user-a" }),
    makeBootstrapUser({
      id: "duplicate-user-b",
      email: "other-admin@gmail.com",
    }),
  );

  await assert.rejects(
    () => fixture.run(),
    bootstrapErrorWithCode("FIRST_ADMIN_INTERNAL_SUBJECT_AMBIGUOUS"),
  );
  assert.equal(fixture.assignments.insertCalls, 0);
  assert.equal(fixture.assignments.updateScopeGrantsCalls, 0);
});

test("first-admin bootstrap fails on same-email different-subject conflict", async () => {
  const fixture = createFirstAdminFixture();
  fixture.users.records.push(
    makeBootstrapUser({
      id: "conflict-user",
      subject: "auth0|other",
      email: "admin@gmail.com",
    }),
  );

  await assert.rejects(
    () => fixture.run(),
    bootstrapErrorWithCode("FIRST_ADMIN_EMAIL_DIFFERENT_SUBJECT"),
  );
});

test("first-admin bootstrap fails closed on duplicate active OWNER_ADMIN assignments", async () => {
  const fixture = createFirstAdminFixture();
  fixture.roles.addRuntimeRoles();
  fixture.users.records.push(makeBootstrapUser({ id: "existing-user" }));
  const adminRole = fixture.roles.records.get("OWNER_ADMIN");
  assert.ok(adminRole);
  fixture.assignments.records.push(
    makeBootstrapAssignment({
      assignmentId: "assignment-a",
      roleId: adminRole.id,
      userId: "existing-user",
    }),
    makeBootstrapAssignment({
      assignmentId: "assignment-b",
      roleId: adminRole.id,
      userId: "existing-user",
    }),
  );

  await assert.rejects(
    () => fixture.run(),
    bootstrapErrorWithCode("FIRST_ADMIN_ASSIGNMENT_AMBIGUOUS"),
  );
  assert.equal(fixture.assignments.insertCalls, 0);
  assert.equal(fixture.assignments.updateScopeGrantsCalls, 0);
});

test("first-admin bootstrap assigns OWNER_ADMIN and scope grants", async () => {
  const fixture = createFirstAdminFixture();

  await fixture.run();

  const adminRole = fixture.roles.records.get("OWNER_ADMIN");
  assert.ok(adminRole);
  assert.equal(fixture.assignments.records.length, 1);
  assert.equal(fixture.assignments.records[0]?.roleId, adminRole.id);
  assert.equal(
    fixture.assignments.records[0]?.userId,
    fixture.users.records[0]?.id,
  );
  assert.deepEqual(fixture.assignments.records[0]?.scopeGrants, {
    workSchedule: ["global"],
    eventAssignment: ["global"],
    contractRegistry: ["global"],
    talentKpi: ["global"],
    kpi: ["global"],
    revenueLedger: ["global"],
    commission: ["global"],
    dashboardLite: ["global"],
  });
});

test("first-admin bootstrap fails closed instead of repairing legacy coarse OWNER_ADMIN authority", async () => {
  const fixture = createFirstAdminFixture();
  fixture.roles.addRuntimeRoles();
  fixture.users.records.push(makeBootstrapUser({ id: "existing-user" }));
  const adminRole = fixture.roles.records.get("OWNER_ADMIN");
  assert.ok(adminRole);
  fixture.assignments.records.push({
    assignmentId: "existing-assignment",
    roleId: adminRole.id,
    userId: "existing-user",
    scopeGrants: {
      workSchedule: ["self"],
      kpi: ["self"],
    },
    state: "ACTIVE",
    effectiveAt: 1,
    revokedAt: null,
    reason: null,
    createdAt: 1,
    updatedAt: 1,
  });

  await assert.rejects(
    () => fixture.run(),
    bootstrapErrorWithCode("FIRST_ADMIN_LEGACY_OWNER_AUTHORITY_BLOCKED"),
  );
  assert.equal(fixture.assignments.updateScopeGrantsCalls, 0);
});

test("first-admin bootstrap rerun is idempotent and creates no six-account set", async () => {
  const fixture = createFirstAdminFixture();

  await fixture.run();
  const second = await fixture.run();

  assert.equal(second.roles.created, 0);
  assert.equal(second.roles.reused, ROLE_TEMPLATE_CODES.length);
  assert.equal(second.adminUser.action, "reused");
  assert.equal(second.assignment.action, "reused");
  assert.equal(fixture.users.records.length, 1);
  assert.equal(fixture.assignments.records.length, 1);
  assert.equal(fixture.roles.records.size, ROLE_TEMPLATE_CODES.length);
});

test("first-admin bootstrap repairs safely missing runtime role provenance in write mode", async () => {
  const fixture = createFirstAdminFixture();
  fixture.roles.addRuntimeRoles();
  const role = fixture.roles.records.get("VIEWER_AUDITOR");
  assert.ok(role);
  fixture.roles.records.set("VIEWER_AUDITOR", {
    ...role,
    templateCode: undefined,
    templateVersion: undefined,
    templateAppliedAt: undefined,
  });

  const summary = await fixture.run();

  assert.equal(summary.roles.updated, 1);
  assert.equal(
    fixture.roles.records.get("VIEWER_AUDITOR")?.templateCode,
    "VIEWER_AUDITOR",
  );
});

test("first-admin bootstrap reports missing runtime role provenance in dry-run without writes", async () => {
  const fixture = createFirstAdminFixture();
  fixture.roles.addRuntimeRoles();
  const role = fixture.roles.records.get("HR_OPERATIONS");
  assert.ok(role);
  fixture.roles.records.set("HR_OPERATIONS", {
    ...role,
    templateCode: undefined,
    templateVersion: undefined,
    templateAppliedAt: undefined,
  });

  const summary = await fixture.run("dry-run");

  assert.equal(summary.roles.wouldUpdate, 1);
  assert.equal(fixture.roles.templateMetadataUpdateCalls, 0);
});

test("first-admin bootstrap fails on conflicting runtime role provenance", async () => {
  const fixture = createFirstAdminFixture();
  fixture.roles.addRuntimeRoles();
  const role = fixture.roles.records.get("HR_OPERATIONS");
  assert.ok(role);
  fixture.roles.records.set("HR_OPERATIONS", {
    ...role,
    templateCode: "ACCESS_ADMIN",
  });

  await assert.rejects(
    () => fixture.run(),
    bootstrapErrorWithCode("FIRST_ADMIN_ROLE_TEMPLATE_CONFLICT"),
  );
});

test("first-admin bootstrap fails on unsafe non-admin delegation metadata", async () => {
  const fixture = createFirstAdminFixture();
  fixture.roles.addRuntimeRoles();
  const role = fixture.roles.records.get("TALENT_GROUP_MANAGER");
  assert.ok(role);
  fixture.roles.records.set("TALENT_GROUP_MANAGER", {
    ...role,
    maxDelegatableBand: "PRIVILEGED",
  });

  await assert.rejects(
    () => fixture.run(),
    bootstrapErrorWithCode("FIRST_ADMIN_ROLE_DELEGATION_CONFLICT"),
  );
});

test("first-admin bootstrap fails on runtime role permission mismatch", async () => {
  const fixture = createFirstAdminFixture();
  fixture.roles.addRuntimeRoles();
  const role = fixture.roles.records.get("VIEWER_AUDITOR");
  assert.ok(role);
  fixture.roles.records.set("VIEWER_AUDITOR", {
    ...role,
    permissions: [],
  });

  await assert.rejects(
    () => fixture.run(),
    bootstrapErrorWithCode("FIRST_ADMIN_ROLE_PERMISSION_CONFLICT"),
  );
});

test("first-admin bootstrap does not delete existing SMOKE_REAL_AUTH_ADMIN role", async () => {
  const fixture = createFirstAdminFixture();
  fixture.roles.records.set("SMOKE_REAL_AUTH_ADMIN", {
    id: "legacy-smoke-role",
    code: "SMOKE_REAL_AUTH_ADMIN",
    name: "Smoke Real Auth Admin",
    description: "legacy",
    state: "ACTIVE",
    permissions: [],
    delegationBand: "LIMITED",
    maxDelegatableBand: "NONE",
    createdAt: 1,
    updatedAt: 1,
    activatedAt: 1,
    archivedAt: null,
  });

  await fixture.run();

  assert.ok(fixture.roles.records.get("SMOKE_REAL_AUTH_ADMIN"));
  assert.equal(fixture.roles.records.size, ROLE_TEMPLATE_CODES.length + 1);
});

test("first-admin bootstrap safe output omits subject and secret terms", async () => {
  const fixture = createFirstAdminFixture();

  const summary = await fixture.run();
  const output = formatFirstAdminBootstrapSummary(summary);

  assert.doesNotMatch(output, /auth0\|admin-user/u);
  assert.doesNotMatch(output, /admin@gmail\.com/u);
  assert.match(output, /a\*\*\*@g\*\*\*\.com/u);
  assert.doesNotMatch(output, /secret|token|ticket/iu);
});

test("first-admin bootstrap CLI defaults to dry-run and confirm switches to write", () => {
  assert.equal(parseCliArgs([]).mode, "dry-run");
  assert.equal(parseCliArgs(["--dry-run"]).mode, "dry-run");
  assert.equal(
    parseCliArgs(["--confirm-bootstrap-first-admin"]).mode,
    "write",
  );
  assert.throws(
    () =>
      parseCliArgs([
        "--dry-run",
        "--confirm-bootstrap-first-admin",
      ]),
    bootstrapErrorWithCode("FIRST_ADMIN_CLI_MODE_CONFLICT"),
  );
});

test("first-admin bootstrap package script does not embed confirm flag", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    readonly scripts?: Record<string, string>;
  };

  assert.equal(
    packageJson.scripts?.["smoke:bootstrap:first-admin"],
    "ts-node -r tsconfig-paths/register src/tools/smoke/first-admin-bootstrap.ts",
  );
  assert.doesNotMatch(
    packageJson.scripts?.["smoke:bootstrap:first-admin"] ?? "",
    /confirm-bootstrap-first-admin/u,
  );
});

test("first-admin bootstrap dry-run does not call write repository methods", async () => {
  const fixture = createFirstAdminFixture();

  const summary = await fixture.run("dry-run");

  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.roles.wouldCreate, ROLE_TEMPLATE_CODES.length);
  assert.equal(fixture.roles.insertCalls, 0);
  assert.equal(fixture.roles.templateMetadataUpdateCalls, 0);
  assert.equal(fixture.users.insertCalls, 0);
  assert.equal(fixture.users.updateProfileCalls, 0);
  assert.equal(fixture.users.setAuthLinkageCalls, 0);
  assert.equal(fixture.assignments.insertCalls, 0);
  assert.equal(fixture.assignments.updateScopeGrantsCalls, 0);
});

function matchesFilter(
  document: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(filter).every(
    ([path, expected]) =>
      readPath(document, path) === expected,
  );
}

function readPath(
  document: Record<string, unknown>,
  dottedPath: string,
): unknown {
  return dottedPath
    .split(".")
    .reduce<unknown>((current, part) => {
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current)
      ) {
        return undefined;
      }

      return (current as Record<string, unknown>)[part];
    }, document);
}

function createFirstAdminFixture() {
  const auth0 = new BootstrapFakeAuth0();
  const roles = new BootstrapFakeRoleRepository();
  const users = new BootstrapFakeUserRepository();
  const assignments = new BootstrapFakeAssignmentRepository();
  let nextId = 1;
  const service = new FirstAdminBootstrapService({
    auth0Management: auth0,
    roleRepository: roles,
    userRepository: users,
    assignmentRepository: assignments,
    lifecycleRepository: {
      insertReviewCycle: async (record) => record,
    },
    isActivePrimaryOwner: async () => true,
    transactionRunner: new BootstrapFakeTransactionRunner(),
    now: () => NOW,
    idFactory: () => `first-admin-id-${nextId++}`,
  });

  return {
    auth0,
    roles,
    users,
    assignments,
    run: (mode: "dry-run" | "write" = "write") =>
      service.run({
        email: "admin@gmail.com",
        displayName: "Admin",
        mode,
        mongoDbName: "media-dev",
        auth0ManagementConfigured: true,
      }),
  };
}

function bootstrapErrorWithCode(code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof FirstAdminBootstrapError);
    assert.equal(error.code, code);
    return true;
  };
}

class BootstrapFakeAuth0 implements FirstAdminBootstrapAuth0Port {
  readonly usersByEmail = new Map<
    string,
    Auth0ManagementUser | readonly Auth0ManagementUser[]
  >([
    [
      "admin@gmail.com",
      { id: "auth0|admin-user", email: "admin@gmail.com" },
    ],
  ]);

  async findUserByEmail(
    email: string,
  ): Promise<Auth0ManagementUser | readonly Auth0ManagementUser[] | null> {
    return this.usersByEmail.get(email.trim().toLowerCase()) ?? null;
  }
}

class BootstrapFakeTransactionRunner
  implements FirstAdminBootstrapTransactionRunner
{
  async run<T>(
    operation: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    return operation({} as ClientSession);
  }
}

class BootstrapFakeRoleRepository implements FirstAdminBootstrapRoleRepository {
  readonly records = new Map<string, BootstrapRoleRecord>();
  insertCalls = 0;
  templateMetadataUpdateCalls = 0;

  addRuntimeRoles(): void {
    for (const code of ROLE_TEMPLATE_CODES) {
      const template = getRoleTemplate(code);
      assert.ok(template);
      this.records.set(code, {
        id: `role-${code}`,
        code,
        name: template.name,
        description: template.description,
        state: "ACTIVE",
        permissions: [...template.permissions],
        delegationBand: code === "OWNER_ADMIN" ? "PRIVILEGED" : "LIMITED",
        maxDelegatableBand: code === "OWNER_ADMIN" ? "PRIVILEGED" : "NONE",
        templateCode: template.code,
        templateVersion: template.version,
        templateAppliedAt: 1,
        createdAt: 1,
        updatedAt: 1,
        activatedAt: 1,
        archivedAt: null,
      });
    }
  }

  async insert(role: BootstrapRoleRecord): Promise<BootstrapRoleRecord> {
    this.insertCalls += 1;
    this.records.set(role.code, role);
    return role;
  }

  async findById(roleId: string): Promise<BootstrapRoleRecord | null> {
    return (
      [...this.records.values()].find((role) => role.id === roleId) ?? null
    );
  }

  async findByCode(code: string): Promise<BootstrapRoleRecord | null> {
    return this.records.get(code) ?? null;
  }

  async findRawByCode(code: string): Promise<BootstrapRoleRecord | null> {
    return this.findByCode(code);
  }

  async findMaxGeneratedCodeSequence(): Promise<number> {
    return 0;
  }

  async updateMetadata(
    input: UpdateRoleMetadataInput,
  ): Promise<BootstrapRoleRecord | null> {
    const role = await this.findById(input.roleId);
    if (!role) {
      return null;
    }

    const updated = {
      ...role,
      updatedAt: input.updatedAt,
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
    };
    this.records.set(updated.code, updated);
    return updated;
  }

  async updateTemplateMetadata(input: {
    readonly roleId: string;
    readonly templateCode: BootstrapRoleRecord["templateCode"];
    readonly templateVersion: string;
    readonly templateAppliedAt: number;
    readonly updatedAt: number;
  }): Promise<BootstrapRoleRecord | null> {
    this.templateMetadataUpdateCalls += 1;
    const role = await this.findById(input.roleId);
    if (!role || !input.templateCode) {
      return null;
    }

    const updated = {
      ...role,
      templateCode: input.templateCode,
      templateVersion: input.templateVersion,
      templateAppliedAt: input.templateAppliedAt,
      updatedAt: input.updatedAt,
    };
    this.records.set(updated.code, updated);
    return updated;
  }

  async transitionState(
    input: TransitionRoleStateInput,
  ): Promise<BootstrapRoleRecord | null> {
    const role = await this.findById(input.roleId);
    if (!role || !input.fromStates.includes(role.state as BootstrapRoleState)) {
      return null;
    }

    const updated = {
      ...role,
      state: input.toState,
      updatedAt: input.changedAt,
    };
    this.records.set(updated.code, updated);
    return updated;
  }

  async replacePermissions(
    input: ReplaceRolePermissionsInput,
  ): Promise<BootstrapRoleRecord | null> {
    const role = await this.findById(input.roleId);
    if (!role) {
      return null;
    }

    const updated = {
      ...role,
      permissions: [...input.permissions],
      updatedAt: input.updatedAt,
    };
    this.records.set(updated.code, updated);
    return updated;
  }
}

class BootstrapFakeUserRepository
  implements FirstAdminBootstrapUserRepository
{
  readonly records: UserRecord[] = [];
  insertCalls = 0;
  updateProfileCalls = 0;
  setAuthLinkageCalls = 0;

  async insert(input: CreateUserInput): Promise<UserRecord> {
    this.insertCalls += 1;
    const user: UserRecord = {
      id: input.id,
      accountStatus: input.accountStatus,
      actorKind: input.actorKind,
      authLinkage: input.authLinkage,
      profile: input.profile,
      contextAccess: input.contextAccess,
      preferences: input.preferences,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      activatedAt: input.activatedAt,
      disabledAt: input.disabledAt,
      archivedAt: input.archivedAt,
    };
    this.records.push(user);
    return user;
  }

  async findByAuthSubject(authSubject: string): Promise<UserRecord | null> {
    return (
      this.records.find(
        (user) => user.authLinkage.subject === authSubject,
      ) ?? null
    );
  }

  async findManyByAuthSubject(
    authSubject: string,
  ): Promise<readonly UserRecord[]> {
    return this.records.filter(
      (user) =>
        user.authLinkage.provider === "auth0" &&
        user.authLinkage.subject === authSubject &&
        user.accountStatus !== "ARCHIVED",
    );
  }

  async findManyByEmail(email: string): Promise<readonly UserRecord[]> {
    const normalized = email.trim().toLowerCase();
    return this.records.filter(
      (user) => user.profile.email?.trim().toLowerCase() === normalized,
    );
  }

  async updateProfile(
    input: UpdateUserProfileInput,
  ): Promise<UserRecord | null> {
    this.updateProfileCalls += 1;
    const index = this.records.findIndex((user) => user.id === input.userId);
    const current = this.records[index];
    if (!current) {
      return null;
    }

    const updated: UserRecord = {
      ...current,
      profile: {
        ...current.profile,
        ...(input.displayName !== undefined
          ? { displayName: input.displayName }
          : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
      },
      preferences: {
        ...current.preferences,
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.timezone !== undefined
          ? { timezone: input.timezone }
          : {}),
      },
      updatedAt: input.updatedAt,
    };
    this.records[index] = updated;
    return updated;
  }

  async transitionLifecycle(
    input: TransitionUserLifecycleInput,
  ): Promise<UserRecord | null> {
    const index = this.records.findIndex((user) => user.id === input.userId);
    const current = this.records[index];
    if (!current || !input.fromStates.includes(current.accountStatus)) {
      return null;
    }

    const updated = {
      ...current,
      accountStatus: input.toState,
      updatedAt: input.changedAt,
    };
    this.records[index] = updated;
    return updated;
  }

  async setAuthLinkage(
    input: SetUserAuthLinkageInput,
  ): Promise<UserRecord | null> {
    this.setAuthLinkageCalls += 1;
    const index = this.records.findIndex((user) => user.id === input.userId);
    const current = this.records[index];
    if (!current) {
      return null;
    }

    const updated: UserRecord = {
      ...current,
      accountStatus: input.accountStatus ?? current.accountStatus,
      authLinkage: {
        provider: input.provider,
        subject: input.subject,
        status: input.status,
      },
      updatedAt: input.updatedAt,
    };
    this.records[index] = updated;
    return updated;
  }
}

class BootstrapFakeAssignmentRepository
  implements FirstAdminBootstrapAssignmentRepository
{
  readonly records: BootstrapRoleAssignmentRecord[] = [];
  insertCalls = 0;
  updateScopeGrantsCalls = 0;

  async insert(
    assignment: BootstrapRoleAssignmentRecord,
  ): Promise<BootstrapRoleAssignmentRecord> {
    this.insertCalls += 1;
    this.records.push(assignment);
    return assignment;
  }

  async findById(
    assignmentId: string,
  ): Promise<BootstrapRoleAssignmentRecord | null> {
    return (
      this.records.find(
        (assignment) => assignment.assignmentId === assignmentId,
      ) ?? null
    );
  }

  async findActiveByRoleAndUser(
    roleId: string,
    userId: string,
  ): Promise<BootstrapRoleAssignmentRecord | null> {
    return (
      this.records.find(
        (assignment) =>
          assignment.roleId === roleId &&
          assignment.userId === userId &&
          assignment.state === "ACTIVE",
      ) ?? null
    );
  }

  async findActiveManyByRoleAndUser(
    roleId: string,
    userId: string,
  ): Promise<readonly BootstrapRoleAssignmentRecord[]> {
    return this.records.filter(
      (assignment) =>
        assignment.roleId === roleId &&
        assignment.userId === userId &&
        assignment.state === "ACTIVE",
    );
  }

  async hasActiveAssignmentsForRole(roleId: string): Promise<boolean> {
    return this.records.some(
      (assignment) =>
        assignment.roleId === roleId && assignment.state === "ACTIVE",
    );
  }

  async revokeById(
    assignmentId: string,
    reason: string | null,
    revokedAt: number,
  ): Promise<BootstrapRoleAssignmentRecord | null> {
    const index = this.records.findIndex(
      (assignment) => assignment.assignmentId === assignmentId,
    );
    const current = this.records[index];
    if (!current || current.state !== "ACTIVE") {
      return null;
    }

    const updated: BootstrapRoleAssignmentRecord = {
      ...current,
      state: "REVOKED",
      reason,
      revokedAt,
      updatedAt: revokedAt,
    };
    this.records[index] = updated;
    return updated;
  }

  async updateScopeGrants(
    assignmentId: string,
    scopeGrants: ActorScopeGrants,
    updatedAt: number,
  ): Promise<BootstrapRoleAssignmentRecord | null> {
    this.updateScopeGrantsCalls += 1;
    const index = this.records.findIndex(
      (assignment) => assignment.assignmentId === assignmentId,
    );
    const current = this.records[index];
    if (!current || current.state !== "ACTIVE") {
      return null;
    }

    const updated = {
      ...current,
      scopeGrants,
      updatedAt,
    };
    this.records[index] = updated;
    return updated;
  }
}

function makeBootstrapUser(params: {
  readonly id: string;
  readonly subject?: string;
  readonly email?: string;
  readonly status?: "LINKED" | "UNLINKED";
  readonly accountStatus?: "PENDING" | "ACTIVE" | "DISABLED" | "ARCHIVED";
}): UserRecord {
  return {
    id: params.id,
    accountStatus: params.accountStatus ?? "ACTIVE",
    actorKind: "ADMIN",
    authLinkage: {
      provider: "auth0",
      subject: params.subject ?? "auth0|admin-user",
      status: params.status ?? "LINKED",
    },
    profile: {
      displayName: "Admin",
      email: params.email ?? "admin@gmail.com",
    },
    contextAccess: {
      contexts: ["ADMIN"],
    },
    preferences: {},
    createdAt: 1,
    updatedAt: 1,
    activatedAt: 1,
    disabledAt: null,
    archivedAt: null,
  };
}

function makeBootstrapAssignment(params: {
  readonly assignmentId: string;
  readonly roleId: string;
  readonly userId: string;
  readonly scopeGrants?: ActorScopeGrants;
}): BootstrapRoleAssignmentRecord {
  return {
    assignmentId: params.assignmentId,
    roleId: params.roleId,
    userId: params.userId,
    ...(params.scopeGrants ? { scopeGrants: params.scopeGrants } : {}),
    state: "ACTIVE",
    effectiveAt: 1,
    revokedAt: null,
    reason: null,
    createdAt: 1,
    updatedAt: 1,
  };
}
