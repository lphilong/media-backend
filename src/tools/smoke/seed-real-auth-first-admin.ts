import crypto from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";
import { Actor, ActorScopeGrants } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";

type SeedMode = "dry-run" | "write";
type SeedAction = "create" | "no-op";
type DbNameClass =
  | "dev-like"
  | "smoke-like"
  | "local-like"
  | "test-like"
  | "sandbox-like"
  | "nonlocal-override";

interface SeedEnvSource {
  readonly DOTENV_CONFIG_PATH?: string;
  readonly ALLOW_SMOKE_SEED?: string;
  readonly AUTH0_SUB?: string;
  readonly LOCAL_MOCK_AUTH_ENABLED?: string;
  readonly NODE_ENV?: string;
  readonly APP_RUNTIME?: string;
  readonly APP_ENV?: string;
  readonly DEPLOY_ENV?: string;
  readonly RENDER?: string;
  readonly RENDER_SERVICE_ID?: string;
  readonly RENDER_EXTERNAL_URL?: string;
  readonly VERCEL?: string;
  readonly VERCEL_ENV?: string;
  readonly RAILWAY_ENVIRONMENT?: string;
  readonly FLY_APP_NAME?: string;
  readonly HEROKU_APP_NAME?: string;
  readonly ALLOW_NONLOCAL_SMOKE_DB?: string;
  readonly MONGO_URI?: string;
  readonly MONGO_DB_NAME?: string;
  readonly MONGO_MAX_POOL_SIZE?: string;
  readonly SMOKE_ADMIN_EMAIL?: string;
  readonly SMOKE_ADMIN_DISPLAY_NAME?: string;
  readonly SMOKE_ROLE_CODE?: string;
  readonly SMOKE_ROLE_NAME?: string;
}

export interface SmokeSeedInput {
  readonly auth0Sub: string;
  readonly displayName: string;
  readonly email?: string;
  readonly roleCode: string;
  readonly roleName: string;
  readonly dbNameClass: DbNameClass;
  readonly mongoUri?: string;
  readonly mongoDbName?: string;
  readonly mongoMaxPoolSize?: number;
}

export interface UserSeedDocument {
  readonly _id: string;
  readonly accountStatus:
    | "PENDING"
    | "ACTIVE"
    | "DISABLED"
    | "ARCHIVED";
  readonly actorKind: "ADMIN" | "STAFF";
  readonly authLinkage: {
    readonly provider: "auth0";
    readonly subject: string;
  };
  readonly profile: {
    readonly displayName: string;
    readonly email?: string;
  };
  readonly searchDisplayName: string;
  readonly searchEmail: string;
  readonly contextAccess: {
    readonly contexts: readonly ["ADMIN"];
  };
  readonly preferences: Record<string, never>;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt: number;
  readonly disabledAt: null;
  readonly archivedAt: null;
  readonly scopeGrants: ActorScopeGrants;
}

export interface RoleSeedDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly searchCode: string;
  readonly searchName: string;
  readonly description: string;
  readonly state: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
  readonly permissions: readonly Permission[];
  readonly delegationBand: "LIMITED";
  readonly maxDelegatableBand: "NONE";
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt: number;
  readonly archivedAt: null;
}

export interface RoleAssignmentSeedDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly userId: string;
  readonly state: "ACTIVE" | "REVOKED";
  readonly effectiveAt: number | null;
  readonly revokedAt: number | null;
  readonly reason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface SeedCollection<TDocument> {
  findOne(
    filter: Record<string, unknown>,
  ): Promise<TDocument | null>;
  find?(
    filter: Record<string, unknown>,
  ): {
    toArray(): Promise<readonly TDocument[]>;
  };
  insertOne(document: TDocument): Promise<unknown>;
}

export interface SmokeSeedCollections {
  readonly users: SeedCollection<UserSeedDocument>;
  readonly roles: SeedCollection<RoleSeedDocument>;
  readonly roleAssignments: SeedCollection<RoleAssignmentSeedDocument>;
}

export interface SmokeSeedPlan {
  readonly mode: SeedMode;
  readonly dbNameClass: DbNameClass;
  readonly actions: {
    readonly user: SeedAction;
    readonly role: SeedAction;
    readonly assignment: SeedAction;
  };
  readonly userId: string;
  readonly roleId: string;
  readonly assignmentId: string;
}

interface CliConsole {
  log(message?: unknown): void;
  error(message?: unknown): void;
}

export class SmokeSeedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SmokeSeedError";
    this.code = code;
  }
}

const SMOKE_ROLE_DESCRIPTION =
  "Smoke/dev-only first admin role for local Real Auth0 smoke.";
const SMOKE_ASSIGNMENT_REASON =
  "Smoke/dev-only Real Auth0 first admin seed.";
const DEFAULT_ROLE_CODE = "SMOKE_REAL_AUTH_ADMIN";
const DEFAULT_ROLE_NAME = "Smoke Real Auth Admin";
const DEFAULT_DISPLAY_NAME = "Smoke Real Auth Admin";

export const SMOKE_FIRST_ADMIN_PERMISSIONS: readonly Permission[] =
  Object.freeze([
    Permission.USER_VIEW,
    Permission.ROLE_LIST,
    Permission.ROLE_VIEW,
    Permission.ROLE_ASSIGNMENT_VIEW,
    Permission.ORG_UNIT_READ,
    Permission.EMPLOYMENT_PROFILE_READ,
    Permission.TALENT_READ,
    Permission.TALENT_GROUP_READ,
    Permission.PLATFORM_ACCOUNT_READ,
    Permission.STUDIO_RESOURCE_READ,
    Permission.WORK_SCHEDULE_READ,
    Permission.EVENT_READ,
    Permission.CONTRACT_REGISTRY_READ,
    Permission.TALENT_KPI_READ,
    Permission.REVENUE_LEDGER_READ,
    Permission.COMMISSION_RULE_READ,
    Permission.COMMISSION_SETTLEMENT_READ,
    Permission.DASHBOARD_LITE_READ,
  ]);

export const SMOKE_FIRST_ADMIN_SCOPE_GRANTS: ActorScopeGrants =
  {
    workSchedule: [
      "self",
      "team",
      "department",
      "global",
    ],
    eventAssignment: ["global"],
    contractRegistry: ["global"],
    talentKpi: ["global"],
    revenueLedger: ["global"],
    commission: ["global"],
    dashboardLite: ["global"],
  };

export function parseSeedMode(argv: readonly string[]): SeedMode {
  const hasWrite = argv.includes("--write");
  const hasDryRun = argv.includes("--dry-run");
  const allowed = new Set(["--write", "--dry-run", "--help", "-h"]);
  const unknown = argv.find((arg) => !allowed.has(arg));

  if (unknown) {
    throw new SmokeSeedError(
      "SMOKE_SEED_UNKNOWN_FLAG",
      "Unsupported seed CLI flag",
    );
  }

  if (hasWrite && hasDryRun) {
    throw new SmokeSeedError(
      "SMOKE_SEED_MODE_CONFLICT",
      "Use either --dry-run or --write, not both",
    );
  }

  return hasWrite ? "write" : "dry-run";
}

export function validateSeedEnv(
  source: SeedEnvSource,
): SmokeSeedInput {
  assertDotenvDevPath(source.DOTENV_CONFIG_PATH);
  assertFlagEquals(
    source.ALLOW_SMOKE_SEED,
    "true",
    "ALLOW_SMOKE_SEED",
  );

  const auth0Sub = normalizeRequiredText(
    source.AUTH0_SUB,
    "AUTH0_SUB",
  );

  if (source.NODE_ENV === "production") {
    throw new SmokeSeedError(
      "SMOKE_SEED_PRODUCTION_FORBIDDEN",
      "NODE_ENV=production is forbidden",
    );
  }

  assertFlagEquals(source.NODE_ENV, "development", "NODE_ENV");
  assertFlagEquals(source.APP_RUNTIME, "http", "APP_RUNTIME");

  if (parseBooleanFlag(source.LOCAL_MOCK_AUTH_ENABLED, false)) {
    throw new SmokeSeedError(
      "SMOKE_SEED_LOCAL_MOCK_FORBIDDEN",
      "LOCAL_MOCK_AUTH_ENABLED must be false or unset",
    );
  }

  if (hasDeployedRuntimeMarker(source)) {
    throw new SmokeSeedError(
      "SMOKE_SEED_DEPLOYED_RUNTIME_FORBIDDEN",
      "Deployed or staging runtime markers are forbidden",
    );
  }

  const mongoDbName = normalizeRequiredText(
    source.MONGO_DB_NAME,
    "MONGO_DB_NAME",
  );
  const dbNameClass = classifyDbName(
    mongoDbName,
    parseBooleanFlag(
      source.ALLOW_NONLOCAL_SMOKE_DB,
      false,
    ),
  );

  validateCanonicalPermissions(
    SMOKE_FIRST_ADMIN_PERMISSIONS,
  );
  validateCanonicalScopeGrants(
    SMOKE_FIRST_ADMIN_SCOPE_GRANTS,
  );

  const email = normalizeOptionalEmail(
    source.SMOKE_ADMIN_EMAIL,
  );

  return {
    auth0Sub,
    displayName:
      normalizeOptionalText(
        source.SMOKE_ADMIN_DISPLAY_NAME,
      ) ?? DEFAULT_DISPLAY_NAME,
    email,
    roleCode:
      normalizeOptionalRoleCode(source.SMOKE_ROLE_CODE) ??
      DEFAULT_ROLE_CODE,
    roleName:
      normalizeOptionalText(source.SMOKE_ROLE_NAME) ??
      DEFAULT_ROLE_NAME,
    dbNameClass,
    mongoUri: source.MONGO_URI,
    mongoDbName,
    mongoMaxPoolSize: parseMongoPoolSize(
      source.MONGO_MAX_POOL_SIZE,
    ),
  };
}

export function buildExpectedUserDocument(
  input: SmokeSeedInput,
  id: string,
  now: number,
): UserSeedDocument {
  return {
    _id: id,
    accountStatus: "ACTIVE",
    actorKind: "ADMIN",
    authLinkage: {
      provider: "auth0",
      subject: input.auth0Sub,
    },
    profile: {
      displayName: input.displayName,
      ...(input.email ? { email: input.email } : {}),
    },
    searchDisplayName: toSearchField(input.displayName),
    searchEmail: toSearchField(input.email),
    contextAccess: {
      contexts: ["ADMIN"],
    },
    preferences: {},
    createdAt: now,
    updatedAt: now,
    activatedAt: now,
    disabledAt: null,
    archivedAt: null,
    scopeGrants: SMOKE_FIRST_ADMIN_SCOPE_GRANTS,
  };
}

export function buildExpectedRoleDocument(
  input: SmokeSeedInput,
  id: string,
  now: number,
): RoleSeedDocument {
  return {
    _id: id,
    code: input.roleCode,
    name: input.roleName,
    searchCode: toSearchField(input.roleCode),
    searchName: toSearchField(input.roleName),
    description: SMOKE_ROLE_DESCRIPTION,
    state: "ACTIVE",
    permissions: SMOKE_FIRST_ADMIN_PERMISSIONS,
    delegationBand: "LIMITED",
    maxDelegatableBand: "NONE",
    createdAt: now,
    updatedAt: now,
    activatedAt: now,
    archivedAt: null,
  };
}

export function buildExpectedRoleAssignmentDocument(
  ids: {
    readonly assignmentId: string;
    readonly roleId: string;
    readonly userId: string;
  },
  now: number,
): RoleAssignmentSeedDocument {
  return {
    _id: ids.assignmentId,
    roleId: ids.roleId,
    userId: ids.userId,
    state: "ACTIVE",
    effectiveAt: now,
    revokedAt: null,
    reason: SMOKE_ASSIGNMENT_REASON,
    createdAt: now,
    updatedAt: now,
  };
}

export async function runSmokeSeed(
  _collections: SmokeSeedCollections,
  _input: SmokeSeedInput,
  _options: {
    readonly mode: SeedMode;
    readonly now?: number;
    readonly randomUUID?: () => string;
  },
): Promise<SmokeSeedPlan> {
  throw new SmokeSeedError(
    "SMOKE_SEED_RETIRED_USE_FIRST_ADMIN_BOOTSTRAP",
    "This legacy coarse-authority writer is retired; use the reviewed OWNER_ADMIN first-admin bootstrap.",
  );
}

export function createMongoSeedCollections(
  db: Db,
): SmokeSeedCollections {
  return {
    users: db.collection<UserSeedDocument>("users"),
    roles: db.collection<RoleSeedDocument>("roles"),
    roleAssignments:
      db.collection<RoleAssignmentSeedDocument>(
        "role_assignments",
      ),
  };
}

export async function runCli(
  argv: readonly string[],
  envSource: SeedEnvSource,
  io: CliConsole = console,
): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.log(helpText());
    return;
  }

  const mode = parseSeedMode(argv);
  assertDotenvDevPath(envSource.DOTENV_CONFIG_PATH);
  loadDotenvDev(envSource.DOTENV_CONFIG_PATH);

  const input = validateSeedEnv(envSource);

  io.log("Real Auth0 first admin smoke seed");
  io.log(`mode=${mode}`);
  io.log(`targetDbClass=${input.dbNameClass}`);

  const mongoUri = normalizeRequiredText(
    input.mongoUri,
    "MONGO_URI",
  );
  const client = new MongoClient(mongoUri, {
    maxPoolSize: input.mongoMaxPoolSize ?? 10,
    retryReads: true,
    retryWrites: true,
  });

  try {
    await client.connect();
    const plan = await runSmokeSeed(
      createMongoSeedCollections(
        client.db(input.mongoDbName),
      ),
      input,
      { mode },
    );
    logPlan(plan, io);
  } finally {
    await client.close();
  }
}

function loadDotenvDev(dotenvConfigPath: string | undefined): void {
  const normalized = normalizeRequiredText(
    dotenvConfigPath,
    "DOTENV_CONFIG_PATH",
  );

  if (!existsSync(normalized)) {
    throw new SmokeSeedError(
      "SMOKE_SEED_DOTENV_FILE_MISSING",
      "DOTENV_CONFIG_PATH must point to an existing .env.dev file",
    );
  }

  const result = dotenv.config({
    path: normalized,
    override: false,
  });

  if (result.error) {
    throw new SmokeSeedError(
      "SMOKE_SEED_DOTENV_LOAD_FAILED",
      "Failed to load .env.dev",
    );
  }
}

function logPlan(plan: SmokeSeedPlan, io: CliConsole): void {
  io.log(`user=${plan.actions.user}`);
  io.log(`role=${plan.actions.role}`);
  io.log(`assignment=${plan.actions.assignment}`);
}

function assertDotenvDevPath(value: string | undefined): void {
  const normalized = normalizeRequiredText(
    value,
    "DOTENV_CONFIG_PATH",
  );
  const basename = path.basename(path.resolve(normalized));

  if (basename !== ".env.dev") {
    throw new SmokeSeedError(
      "SMOKE_SEED_DOTENV_PATH_FORBIDDEN",
      "DOTENV_CONFIG_PATH must resolve to .env.dev",
    );
  }
}

function assertFlagEquals(
  value: string | undefined,
  expected: string,
  name: string,
): void {
  if (value?.trim() === expected) {
    return;
  }

  throw new SmokeSeedError(
    "SMOKE_SEED_ENV_GUARD_FAILED",
    `${name} must be ${expected}`,
  );
}

function parseBooleanFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new SmokeSeedError(
    "SMOKE_SEED_BOOLEAN_GUARD_FAILED",
    "Boolean smoke seed env flags must be true or false",
  );
}

function hasDeployedRuntimeMarker(source: SeedEnvSource): boolean {
  for (const value of [
    source.APP_ENV,
    source.DEPLOY_ENV,
    source.VERCEL_ENV,
    source.RAILWAY_ENVIRONMENT,
  ]) {
    const normalized = value?.trim().toLowerCase();
    if (
      normalized === "production" ||
      normalized === "prod" ||
      normalized === "staging" ||
      normalized === "stage" ||
      normalized === "deployed"
    ) {
      return true;
    }
  }

  return [
    source.RENDER,
    source.RENDER_SERVICE_ID,
    source.RENDER_EXTERNAL_URL,
    source.VERCEL,
    source.FLY_APP_NAME,
    source.HEROKU_APP_NAME,
  ].some(isTruthyDeployMarker);
}

function isTruthyDeployMarker(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    normalized !== "false" &&
    normalized !== "0" &&
    normalized !== "local" &&
    normalized !== "development"
  );
}

function classifyDbName(
  dbName: string,
  allowNonlocal: boolean,
): DbNameClass {
  const normalized = dbName.trim().toLowerCase();
  const tokens: Array<[DbNameClass, RegExp]> = [
    ["smoke-like", /(^|[-_])smoke($|[-_])/u],
    ["local-like", /(^|[-_])local($|[-_])/u],
    ["dev-like", /(^|[-_])dev(elopment)?($|[-_])/u],
    ["test-like", /(^|[-_])test($|[-_])/u],
    ["sandbox-like", /(^|[-_])sandbox($|[-_])/u],
  ];

  for (const [classification, pattern] of tokens) {
    if (pattern.test(normalized)) {
      return classification;
    }
  }

  if (allowNonlocal) {
    return "nonlocal-override";
  }

  throw new SmokeSeedError(
    "SMOKE_SEED_DB_NAME_FORBIDDEN",
    "MONGO_DB_NAME must be dev/smoke/local/test/sandbox-like unless ALLOW_NONLOCAL_SMOKE_DB=true",
  );
}

function validateCanonicalPermissions(
  permissions: readonly Permission[],
): void {
  const canonical = new Set<string>(Object.values(Permission));

  for (const permission of permissions) {
    if (!canonical.has(permission)) {
      throw new SmokeSeedError(
        "SMOKE_SEED_PERMISSION_INVALID",
        "Smoke seed contains a non-canonical permission",
      );
    }
  }
}

function validateCanonicalScopeGrants(
  scopeGrants: ActorScopeGrants,
): void {
  new Actor({
    id: "smoke-scope-validation",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [],
    scopeGrants,
    isActive: true,
  });
}

function assertStableUserMatch(
  document: UserSeedDocument,
  input: SmokeSeedInput,
): void {
  const expected = buildExpectedUserDocument(
    input,
    document._id,
    document.createdAt,
  );

  if (
    document.accountStatus !== expected.accountStatus ||
    document.actorKind !== expected.actorKind ||
    document.authLinkage.provider !==
      expected.authLinkage.provider ||
    document.authLinkage.subject !==
      expected.authLinkage.subject ||
    document.profile.displayName !==
      expected.profile.displayName ||
    document.profile.email !== expected.profile.email ||
    document.searchDisplayName !==
      expected.searchDisplayName ||
    document.searchEmail !== expected.searchEmail ||
    !arraysEqual(
      document.contextAccess.contexts,
      expected.contextAccess.contexts,
    ) ||
    !plainObjectsEqual(
      document.preferences,
      expected.preferences,
    ) ||
    document.disabledAt !== null ||
    document.archivedAt !== null ||
    !plainObjectsEqual(
      document.scopeGrants,
      expected.scopeGrants,
    )
  ) {
    throw new SmokeSeedError(
      "SMOKE_SEED_DIVERGENT_USER",
      "Linked Auth0 user exists but does not match the expected smoke seed shape",
    );
  }
}

function assertStableRoleMatch(
  document: RoleSeedDocument,
  input: SmokeSeedInput,
): void {
  const expected = buildExpectedRoleDocument(
    input,
    document._id,
    document.createdAt,
  );

  if (
    document.code !== expected.code ||
    document.name !== expected.name ||
    document.description !== expected.description ||
    document.searchCode !== expected.searchCode ||
    document.searchName !== expected.searchName ||
    document.state !== expected.state ||
    !arraysEqual(
      document.permissions,
      expected.permissions,
    ) ||
    document.delegationBand !== expected.delegationBand ||
    document.maxDelegatableBand !==
      expected.maxDelegatableBand ||
    document.archivedAt !== null
  ) {
    throw new SmokeSeedError(
      "SMOKE_SEED_DIVERGENT_ROLE",
      "Smoke role code exists but does not match the expected smoke seed shape",
    );
  }
}

function assertStableAssignmentMatch(
  document: RoleAssignmentSeedDocument,
  expected: {
    readonly roleId: string;
    readonly userId: string;
  },
): void {
  if (
    document.roleId !== expected.roleId ||
    document.userId !== expected.userId ||
    document.state !== "ACTIVE" ||
    document.revokedAt !== null
  ) {
    throw new SmokeSeedError(
      "SMOKE_SEED_DIVERGENT_ASSIGNMENT",
      "Role assignment exists but is inactive or divergent",
    );
  }
}

async function assertUserActiveAssignmentsReferenceActiveRoles(
  collections: SmokeSeedCollections,
  userId: string,
): Promise<void> {
  if (!collections.roleAssignments.find) {
    return;
  }

  const assignments = await collections.roleAssignments
    .find({ userId, state: "ACTIVE" })
    .toArray();

  for (const assignment of assignments) {
    const role = await collections.roles.findOne({
      _id: assignment.roleId,
    });

    if (!role || role.state !== "ACTIVE") {
      throw new SmokeSeedError(
        "SMOKE_SEED_ASSIGNMENT_ROLE_INTEGRITY",
        "Active role assignment points to a missing or inactive role",
      );
    }
  }
}

function normalizeRequiredText(
  value: string | undefined,
  name: string,
): string {
  const normalized = value?.trim() ?? "";

  if (normalized.length === 0) {
    throw new SmokeSeedError(
      "SMOKE_SEED_REQUIRED_ENV_MISSING",
      `${name} is required`,
    );
  }

  return normalized;
}

function normalizeOptionalText(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalEmail(
  value: string | undefined,
): string | undefined {
  const normalized = normalizeOptionalText(value);
  return normalized?.toLowerCase();
}

function normalizeOptionalRoleCode(
  value: string | undefined,
): string | undefined {
  const normalized = normalizeOptionalText(value);
  return normalized?.toUpperCase();
}

function parseMongoPoolSize(
  value: string | undefined,
): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SmokeSeedError(
      "SMOKE_SEED_MONGO_POOL_INVALID",
      "MONGO_MAX_POOL_SIZE must be a positive integer",
    );
  }

  return parsed;
}

function toSearchField(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function arraysEqual(
  left: readonly unknown[] | undefined,
  right: readonly unknown[] | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function plainObjectsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function helpText(): string {
  return [
    "Real Auth0 first admin smoke seed",
    "",
    "Required runtime guards:",
    "  DOTENV_CONFIG_PATH=.env.dev",
    "  ALLOW_SMOKE_SEED=true",
    "  AUTH0_SUB=<masked Auth0 user subject>",
    "  NODE_ENV=development",
    "  APP_RUNTIME=http",
    "  LOCAL_MOCK_AUTH_ENABLED=false",
    "",
    "Optional inputs:",
    "  SMOKE_ADMIN_EMAIL",
    "  SMOKE_ADMIN_DISPLAY_NAME",
    "  SMOKE_ROLE_CODE",
    "  SMOKE_ROLE_NAME",
    "",
    "Dry run:",
    "  npm run smoke:seed:first-admin -- --dry-run",
    "",
    "Write mode:",
    "  npm run smoke:seed:first-admin -- --write",
    "",
    "Operator runbook:",
    "  1. Capture the Auth0 test user's subject.",
    "  2. Set DOTENV_CONFIG_PATH=.env.dev.",
    "  3. Set ALLOW_SMOKE_SEED=true and AUTH0_SUB.",
    "  4. Run dry-run and review create/no-op actions.",
    "  5. Run write mode only when dry-run is expected.",
    "  6. Start backend with .env.dev and local mock auth disabled.",
    "  7. Start frontend in real Auth0 mode.",
    "  8. Login and smoke read/list admin pages.",
  ].join("\n");
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/mongodb(\+srv)?:\/\/\S+/giu, "[redacted-mongo-uri]")
    .replace(/redis:\/\/\S+/giu, "[redacted-redis-url]")
    .replace(/(password|secret|key)=\S+/giu, "$1=[redacted]");
}

if (require.main === module) {
  runCli(
    process.argv.slice(2),
    process.env as SeedEnvSource,
  ).catch((error) => {
    if (error instanceof SmokeSeedError) {
      console.error(`${error.code}: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    const message =
      error instanceof Error
        ? redactSensitiveText(error.message)
        : "Unknown seed failure";
    console.error(`SMOKE_SEED_FAILED: ${message}`);
    process.exitCode = 1;
  });
}
