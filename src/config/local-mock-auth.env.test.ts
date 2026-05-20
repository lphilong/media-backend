import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnvForTests } from "./env";

function baseEnv(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    APP_RUNTIME: "http",
    NODE_ENV: "development",
    AUTH0_ISSUER_BASE_URL: "https://auth.example.test/",
    AUTH0_AUDIENCE: "media-admin-api",
    MONGO_URI: "mongodb://localhost:27017/media_local",
    MONGO_DB_NAME: "media_local",
    REDIS_URL: "redis://localhost:6379",
    STORAGE_PROVIDER: "local",
    STORAGE_BASE_URL: "http://localhost:10000",
    ...overrides,
  };
}

function enabledLocalMockEnv(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return baseEnv({
    LOCAL_MOCK_AUTH_ENABLED: "true",
    LOCAL_MOCK_AUTH_ACTOR_ID: "local-smoke-admin",
    LOCAL_MOCK_AUTH_EMAIL: "local-admin@example.test",
    LOCAL_MOCK_AUTH_PERMISSIONS:
      "role:list,role:view,role:assignment:view",
    LOCAL_MOCK_AUTH_SCOPE_GRANTS:
      '{"workSchedule":["self","team","department"],"eventAssignment":["global"],"dashboardLite":["global"]}',
    ...overrides,
  });
}

test("local mock auth is disabled by default in env config", () => {
  const parsed = parseEnvForTests(baseEnv());

  assert.equal(parsed.LOCAL_MOCK_AUTH_ENABLED, false);
  assert.equal(
    parsed.LOCAL_MOCK_AUTH_ACTOR_ID,
    "local-mock-admin-actor",
  );
  assert.deepEqual(parsed.LOCAL_MOCK_AUTH_PERMISSIONS, []);
  assert.deepEqual(parsed.LOCAL_MOCK_AUTH_SCOPE_GRANTS, {});
});

test("enabled local mock auth parses configured actor, permissions, and scope grants", () => {
  const parsed = parseEnvForTests(enabledLocalMockEnv());

  assert.equal(parsed.LOCAL_MOCK_AUTH_ENABLED, true);
  assert.equal(
    parsed.LOCAL_MOCK_AUTH_ACTOR_ID,
    "local-smoke-admin",
  );
  assert.equal(
    parsed.LOCAL_MOCK_AUTH_EMAIL,
    "local-admin@example.test",
  );
  assert.deepEqual(parsed.LOCAL_MOCK_AUTH_PERMISSIONS, [
    "role:list",
    "role:view",
    "role:assignment:view",
  ]);
  assert.deepEqual(parsed.LOCAL_MOCK_AUTH_SCOPE_GRANTS, {
    workSchedule: ["self", "team", "department"],
    eventAssignment: ["global"],
    dashboardLite: ["global"],
  });
});

test("enabled local mock auth fails closed in production", () => {
  assert.throws(
    () =>
      parseEnvForTests(
        enabledLocalMockEnv({
          NODE_ENV: "production",
          STORAGE_PROVIDER: "s3",
          STORAGE_BUCKET: "media-test",
          STORAGE_REGION: "us-east-1",
        }),
      ),
    /LOCAL_MOCK_AUTH_ENABLED is forbidden when NODE_ENV=production/u,
  );
});

test("enabled local mock auth fails closed with deployed runtime markers", () => {
  assert.throws(
    () =>
      parseEnvForTests(
        enabledLocalMockEnv({
          RENDER: "true",
        }),
      ),
    /LOCAL_MOCK_AUTH_ENABLED is forbidden in deployed or staging runtimes/u,
  );

  assert.throws(
    () =>
      parseEnvForTests(
        enabledLocalMockEnv({
          DEPLOY_ENV: "staging",
        }),
      ),
    /LOCAL_MOCK_AUTH_ENABLED is forbidden in deployed or staging runtimes/u,
  );
});

test("enabled local mock auth requires explicit valid permissions", () => {
  assert.throws(
    () =>
      parseEnvForTests(
        enabledLocalMockEnv({
          LOCAL_MOCK_AUTH_PERMISSIONS: "",
        }),
      ),
    /LOCAL_MOCK_AUTH_PERMISSIONS is required/u,
  );

  assert.throws(
    () =>
      parseEnvForTests(
        enabledLocalMockEnv({
          LOCAL_MOCK_AUTH_PERMISSIONS:
            "role:list,role:delete-everything",
        }),
      ),
    /LOCAL_MOCK_AUTH_PERMISSIONS contains unknown permission/u,
  );
});

test("enabled local mock auth fails closed on malformed or invalid scope grants", () => {
  assert.throws(
    () =>
      parseEnvForTests(
        enabledLocalMockEnv({
          LOCAL_MOCK_AUTH_SCOPE_GRANTS: "{not-json",
        }),
      ),
    /LOCAL_MOCK_AUTH_SCOPE_GRANTS must be valid JSON/u,
  );

  assert.throws(
    () =>
      parseEnvForTests(
        enabledLocalMockEnv({
          LOCAL_MOCK_AUTH_SCOPE_GRANTS:
            '{"eventAssignment":["team"]}',
        }),
      ),
    /LOCAL_MOCK_AUTH_SCOPE_GRANTS.eventAssignment contains unsupported scope/u,
  );
});

test("local mock auth does not disable required Auth0 HTTP config", () => {
  assert.throws(
    () =>
      parseEnvForTests(
        enabledLocalMockEnv({
          AUTH0_ISSUER_BASE_URL: undefined,
        }),
      ),
    /AUTH0_ISSUER_BASE_URL is required when APP_RUNTIME=http/u,
  );
});
