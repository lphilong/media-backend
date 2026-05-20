import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
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

test("dry-run plans missing records without writes", async () => {
  const fake = createFakeCollections();
  const plan = await runSmokeSeed(
    fake.collections,
    baseInput(),
    { mode: "dry-run", now: NOW, randomUUID: ids() },
  );

  assert.deepEqual(plan.actions, {
    user: "create",
    role: "create",
    assignment: "create",
  });
  assert.equal(fake.users.inserted.length, 0);
  assert.equal(fake.roles.inserted.length, 0);
  assert.equal(fake.assignments.inserted.length, 0);
});

test("write mode creates missing user, role, and role assignment", async () => {
  const fake = createFakeCollections();
  const plan = await runSmokeSeed(
    fake.collections,
    baseInput(),
    { mode: "write", now: NOW, randomUUID: ids() },
  );

  const expected = exactSeedDocuments();
  assert.deepEqual(plan.actions, {
    user: "create",
    role: "create",
    assignment: "create",
  });
  assert.deepEqual(fake.users.inserted, [expected.user]);
  assert.deepEqual(fake.roles.inserted, [expected.role]);
  assert.deepEqual(fake.assignments.inserted, [
    expected.assignment,
  ]);
});

test("exact existing seed data is no-op", async () => {
  const expected = exactSeedDocuments();
  const fake = createFakeCollections({
    users: [expected.user],
    roles: [expected.role],
    assignments: [expected.assignment],
  });

  const plan = await runSmokeSeed(
    fake.collections,
    baseInput(),
    { mode: "write", now: NOW, randomUUID: ids() },
  );

  assert.deepEqual(plan.actions, {
    user: "no-op",
    role: "no-op",
    assignment: "no-op",
  });
  assert.equal(fake.users.inserted.length, 0);
  assert.equal(fake.roles.inserted.length, 0);
  assert.equal(fake.assignments.inserted.length, 0);
});

test("divergent existing linked user fails closed", async () => {
  const expected = exactSeedDocuments();
  const divergentUser = {
    ...expected.user,
    accountStatus: "DISABLED",
  } as UserSeedDocument;
  const fake = createFakeCollections({
    users: [divergentUser],
  });

  await assert.rejects(
    runSmokeSeed(fake.collections, baseInput(), {
      mode: "dry-run",
      now: NOW,
      randomUUID: ids(),
    }),
    /Linked Auth0 user exists but does not match/u,
  );
});

test("divergent existing smoke role code fails closed", async () => {
  const expected = exactSeedDocuments();
  const divergentRole = {
    ...expected.role,
    permissions: [Permission.USER_VIEW],
  };
  const fake = createFakeCollections({
    roles: [divergentRole],
  });

  await assert.rejects(
    runSmokeSeed(fake.collections, baseInput(), {
      mode: "dry-run",
      now: NOW,
      randomUUID: ids(),
    }),
    /Smoke role code exists but does not match/u,
  );
});

test("active assignment to missing role fails closed", async () => {
  const expected = exactSeedDocuments();
  const fake = createFakeCollections({
    users: [expected.user],
    assignments: [
      {
        ...expected.assignment,
        roleId: "missing-role-id",
      },
    ],
  });

  await assert.rejects(
    runSmokeSeed(fake.collections, baseInput(), {
      mode: "dry-run",
      now: NOW,
      randomUUID: ids(),
    }),
    /Active role assignment points to a missing or inactive role/u,
  );
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

  await runSmokeSeed(
    createMongoSeedCollections(db as never),
    baseInput(),
    { mode: "dry-run", now: NOW, randomUUID: ids() },
  );

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
