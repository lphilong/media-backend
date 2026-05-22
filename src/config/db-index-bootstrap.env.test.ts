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

test("DB index bootstrap runs by default", () => {
  const parsed = parseEnvForTests(baseEnv());

  assert.equal(parsed.SKIP_DB_INDEX_BOOTSTRAP, false);
});

test("explicit DB index bootstrap skip parses in development", () => {
  const parsed = parseEnvForTests(
    baseEnv({
      SKIP_DB_INDEX_BOOTSTRAP: "true",
    }),
  );

  assert.equal(parsed.SKIP_DB_INDEX_BOOTSTRAP, true);
});

test("DB index bootstrap skip rejects non-boolean values", () => {
  assert.throws(
    () =>
      parseEnvForTests(
        baseEnv({
          SKIP_DB_INDEX_BOOTSTRAP: "yes",
        }),
      ),
    /Received: yes/u,
  );
});

test("DB index bootstrap skip fails closed in production", () => {
  assert.throws(
    () =>
      parseEnvForTests(
        baseEnv({
          NODE_ENV: "production",
          STORAGE_PROVIDER: "s3",
          STORAGE_BUCKET: "media-test",
          STORAGE_REGION: "us-east-1",
          SKIP_DB_INDEX_BOOTSTRAP: "true",
        }),
      ),
    /SKIP_DB_INDEX_BOOTSTRAP is forbidden when NODE_ENV=production/u,
  );
});

test("DB index bootstrap skip fails closed with deployed markers", () => {
  assert.throws(
    () =>
      parseEnvForTests(
        baseEnv({
          SKIP_DB_INDEX_BOOTSTRAP: "true",
          DEPLOY_ENV: "staging",
        }),
      ),
    /SKIP_DB_INDEX_BOOTSTRAP is forbidden in deployed or staging runtimes/u,
  );
});
