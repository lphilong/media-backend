import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Actor, ActorScopeGrants } from "@core/actor/actor";
import { BaseAppError } from "@core/errors/base.error";
import {
  createPhaseARuntimeFixtureServices,
} from "./seed-smoke-fixtures.composition";
import {
  PHASE_C_FIXTURE_MODULES,
  SMOKE_PHASE_A_ACTOR_ID,
  SMOKE_PHASE_A_PERMISSIONS,
  SMOKE_PHASE_A_SCOPE_GRANTS,
} from "./seed-smoke-fixtures.adapter";

export type FixtureMode = "dry-run" | "write";
export type FixtureProfile = "catalog";
type DbNameClass =
  | "dev-like"
  | "smoke-like"
  | "local-like"
  | "test-like"
  | "sandbox-like"
  | "nonlocal-override";
type FixtureOutcome = "create" | "no-op" | "skipped" | "failed";
type FixtureModuleAction =
  | "lookup"
  | "validate-existing"
  | "create"
  | "plan";
export type FixturePayload = Readonly<Record<string, unknown>>;
export type FixtureModule =
  | "identity-user"
  | "org-unit"
  | "employment-profile"
  | "talent"
  | "talent-group"
  | "talent-group-member"
  | "platform-account"
  | "studio-resource"
  | "work-pattern"
  | "holiday-calendar"
  | "holiday-calendar-entry"
  | "event-assignment"
  | "contract-registry"
  | "talent-kpi"
  | "revenue-ledger"
  | "commission-rule"
  | "commission-settlement"
  | "dashboard-lite";

interface FixtureEnvSource {
  readonly DOTENV_CONFIG_PATH?: string;
  readonly ALLOW_SMOKE_FIXTURES?: string;
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
}

export interface FixtureCliOptions {
  readonly mode: FixtureMode;
  readonly profile: FixtureProfile;
  readonly size: number;
  readonly prefix: string;
}

export interface FixtureEnvInput {
  readonly dbNameClass: DbNameClass;
  readonly mongoDbName: string;
}

export interface CatalogFixture {
  readonly module: FixtureModule;
  readonly key: string;
  readonly externalRef: string;
  readonly payload: FixturePayload;
  readonly dependsOn?: readonly string[];
}

export interface ExistingFixtureRecord {
  readonly id: string;
  readonly externalRef: string;
  readonly payload: FixturePayload;
}

export interface CreatedFixtureRecord {
  readonly id: string;
}

export interface CatalogFixtureServices {
  findByExternalRef(
    module: FixtureModule,
    externalRef: string,
    payload?: FixturePayload,
  ): Promise<ExistingFixtureRecord | null>;
  create(
    module: FixtureModule,
    payload: FixturePayload,
    actor: Actor,
  ): Promise<CreatedFixtureRecord>;
  close?(): Promise<void>;
}

export interface FixtureModuleSummary {
  readonly create: number;
  readonly noOp: number;
  readonly skipped: number;
  readonly failed: number;
}

export interface FixtureRunResult {
  readonly mode: FixtureMode;
  readonly profile: FixtureProfile;
  readonly prefix: string;
  readonly size: number;
  readonly dbNameClass: DbNameClass;
  readonly summaries: Readonly<
    Record<FixtureModule, FixtureModuleSummary>
  >;
  readonly warnings: readonly string[];
}

interface CliConsole {
  log(message?: unknown): void;
  error(message?: unknown): void;
}

interface FixtureContext {
  readonly prefix: string;
  readonly size: number;
  readonly now: number;
  readonly ids: Map<string, string>;
}

export class SmokeFixtureError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "SmokeFixtureError";
    this.code = code;
    this.cause = cause;
  }
}

const DEFAULT_SIZE = 12;
const MAX_SIZE = 20;
const SMOKE_OPERATOR_SCOPE_GRANTS: ActorScopeGrants =
  SMOKE_PHASE_A_SCOPE_GRANTS;
const MODULE_ORDER: readonly FixtureModule[] = Object.freeze([
  "identity-user",
  "org-unit",
  "studio-resource",
  "work-pattern",
  "holiday-calendar",
  "holiday-calendar-entry",
  "employment-profile",
  "talent",
  "talent-group",
  "talent-group-member",
  "platform-account",
  "event-assignment",
  "contract-registry",
  "talent-kpi",
  "revenue-ledger",
  "commission-rule",
  "commission-settlement",
  "dashboard-lite",
]);

export function parseFixtureCliOptions(
  argv: readonly string[],
): FixtureCliOptions {
  let mode: FixtureMode = "dry-run";
  let profile: FixtureProfile = "catalog";
  let size = DEFAULT_SIZE;
  let prefix = "SMOKE";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      if (mode === "write") {
        throw new SmokeFixtureError(
          "SMOKE_FIXTURE_MODE_CONFLICT",
          "Use either --dry-run or --write, not both",
        );
      }
      mode = "dry-run";
      continue;
    }

    if (arg === "--write") {
      if (argv.includes("--dry-run")) {
        throw new SmokeFixtureError(
          "SMOKE_FIXTURE_MODE_CONFLICT",
          "Use either --dry-run or --write, not both",
        );
      }
      mode = "write";
      continue;
    }

    if (arg === "--profile") {
      const value = readCliValue(argv, index, "--profile");
      if (value !== "catalog") {
        throw new SmokeFixtureError(
          "SMOKE_FIXTURE_PROFILE_UNSUPPORTED",
          "Only the catalog fixture profile is supported",
        );
      }
      profile = value;
      index += 1;
      continue;
    }

    if (arg === "--size") {
      size = parseFixtureSize(
        readCliValue(argv, index, "--size"),
      );
      index += 1;
      continue;
    }

    if (arg === "--prefix") {
      prefix = normalizePrefix(
        readCliValue(argv, index, "--prefix"),
      );
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      continue;
    }

    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_UNKNOWN_FLAG",
      "Unsupported fixture CLI flag",
    );
  }

  return { mode, profile, size, prefix };
}

export function validateFixtureEnv(
  source: FixtureEnvSource,
): FixtureEnvInput {
  assertDotenvDevPath(source.DOTENV_CONFIG_PATH);
  assertFlagEquals(
    source.ALLOW_SMOKE_FIXTURES,
    "true",
    "ALLOW_SMOKE_FIXTURES",
  );

  if (source.NODE_ENV === "production") {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_PRODUCTION_FORBIDDEN",
      "NODE_ENV=production is forbidden",
    );
  }

  assertFlagEquals(source.NODE_ENV, "development", "NODE_ENV");
  assertFlagEquals(source.APP_RUNTIME, "http", "APP_RUNTIME");

  if (parseBooleanFlag(source.LOCAL_MOCK_AUTH_ENABLED, false)) {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_LOCAL_MOCK_FORBIDDEN",
      "LOCAL_MOCK_AUTH_ENABLED must be false or unset",
    );
  }

  if (hasDeployedRuntimeMarker(source)) {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_DEPLOYED_RUNTIME_FORBIDDEN",
      "Deployed or staging runtime markers are forbidden",
    );
  }

  const mongoDbName = normalizeRequiredText(
    source.MONGO_DB_NAME,
    "MONGO_DB_NAME",
  );

  return {
    mongoDbName,
    dbNameClass: classifyDbName(
      mongoDbName,
      parseBooleanFlag(
        source.ALLOW_NONLOCAL_SMOKE_DB,
        false,
      ),
    ),
  };
}

export function createSmokeFixtureActor(): Actor {
  return new Actor({
    id: SMOKE_PHASE_A_ACTOR_ID,
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: SMOKE_PHASE_A_PERMISSIONS,
    scopeGrants: SMOKE_OPERATOR_SCOPE_GRANTS,
    isActive: true,
  });
}

export function buildCatalogFixtures(options: {
  readonly prefix: string;
  readonly size: number;
  readonly now?: number;
}): readonly CatalogFixture[] {
  const normalizedPrefix = normalizePrefix(options.prefix);
  const size = clampFixtureSize(options.size);
  const now = options.now ?? Date.UTC(2026, 0, 15, 9, 0, 0);
  const ctx: FixtureContext = {
    prefix: normalizedPrefix,
    size,
    now,
    ids: new Map(),
  };

  return Object.freeze([
    ...identityFixtures(ctx),
    ...orgUnitFixtures(ctx),
    ...employmentProfileFixtures(ctx),
    ...talentFixtures(ctx),
    ...talentGroupFixtures(ctx),
    ...platformAccountFixtures(ctx),
    ...studioResourceFixtures(ctx),
    ...workPatternFixtures(ctx),
    ...holidayCalendarFixtures(ctx),
    ...eventFixtures(ctx),
    ...contractFixtures(ctx),
    ...talentKpiFixtures(ctx),
    ...revenueLedgerFixtures(ctx),
    ...commissionRuleFixtures(ctx),
    skipFixture(
      "commission-settlement",
      `${ctx.prefix}:commission-settlement:skip-default`,
      "Default skipped; settlement creation derives backend-owned selection data.",
    ),
    skipFixture(
      "dashboard-lite",
      `${ctx.prefix}:dashboard-lite:skip-projection`,
      "Projection-only surface; no direct fixture writes.",
    ),
  ]);
}

export async function runCatalogFixtures(
  services: CatalogFixtureServices,
  options: {
    readonly mode: FixtureMode;
    readonly profile: FixtureProfile;
    readonly prefix: string;
    readonly size: number;
    readonly dbNameClass: DbNameClass;
    readonly now?: number;
  },
): Promise<FixtureRunResult> {
  const fixtures = buildCatalogFixtures({
    prefix: options.prefix,
    size: options.size,
    now: options.now,
  });
  const actor = createSmokeFixtureActor();
  const summaries = createEmptySummaries();
  const warnings: string[] = [];
  const ids = new Map<string, string>();
  const phaseSkipWarnedModules = new Set<FixtureModule>();

  for (const fixture of fixtures) {
    const summary = summaries[fixture.module];

    if (fixture.payload.__skipReason) {
      increment(summary, "skipped");
      warnings.push(String(fixture.payload.__skipReason));
      continue;
    }

    if (!PHASE_C_FIXTURE_MODULES.has(fixture.module)) {
      increment(summary, "skipped");
      if (!phaseSkipWarnedModules.has(fixture.module)) {
        phaseSkipWarnedModules.add(fixture.module);
        warnings.push(
          `${fixture.module} skipped because it is outside Smoke Fixture Catalog Phase C runtime adapter scope`,
        );
      }
      continue;
    }

    const missingDependency = fixture.dependsOn?.find(
      (key) => !ids.has(key),
    );
    if (missingDependency) {
      increment(summary, "skipped");
      warnings.push(
        `${fixture.module} skipped because dependency ${missingDependency} was unavailable`,
      );
      continue;
    }

    const payload = resolvePayloadRelationships(
      fixture.payload,
      ids,
    );
    assertNoBlockedFixtureKeys(payload);

    let action: FixtureModuleAction = "lookup";
    try {
      const existing = await services.findByExternalRef(
        fixture.module,
        fixture.externalRef,
        payload,
      );

      if (existing) {
        action = "validate-existing";
        assertExactFixtureMatch(existing.payload, payload);
        ids.set(fixture.key, existing.id);
        increment(summary, "no-op");
        continue;
      }

      increment(summary, "create");

      if (options.mode === "write") {
        action = "create";
        const created = await services.create(
          fixture.module,
          payload,
          actor,
        );
        ids.set(fixture.key, created.id);
      } else {
        action = "plan";
        ids.set(fixture.key, `planned:${fixture.key}`);
      }
    } catch (error) {
      increment(summary, "failed");
      if (error instanceof SmokeFixtureError) {
        throw error;
      }
      throw new SmokeFixtureError(
        "SMOKE_FIXTURE_MODULE_FAILED",
        formatFixtureModuleFailure(
          fixture.module,
          action,
          error,
        ),
        error,
      );
    }
  }

  return {
    mode: options.mode,
    profile: options.profile,
    prefix: options.prefix,
    size: options.size,
    dbNameClass: options.dbNameClass,
    summaries,
    warnings,
  };
}

export async function runCli(
  argv: readonly string[],
  envSource: FixtureEnvSource,
  io: CliConsole = console,
): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.log(helpText());
    return;
  }

  const cli = parseFixtureCliOptions(argv);
  assertDotenvDevPath(envSource.DOTENV_CONFIG_PATH);
  loadDotenvDev(envSource.DOTENV_CONFIG_PATH);
  const envInput = validateFixtureEnv(envSource);

  io.log("Smoke fixture catalog seed");
  io.log(`mode=${cli.mode}`);
  io.log(`profile=${cli.profile}`);
  io.log(`prefix=${cli.prefix}`);
  io.log(`size=${cli.size}`);
  io.log(`targetDbClass=${envInput.dbNameClass}`);

  const services = createRuntimeFixtureServices({
    mongoUri: normalizeRequiredText(
      envSource.MONGO_URI,
      "MONGO_URI",
    ),
    mongoDbName: envInput.mongoDbName,
    mongoMaxPoolSize: parseMongoPoolSize(
      envSource.MONGO_MAX_POOL_SIZE,
    ),
  });

  try {
    const result = await runCatalogFixtures(services, {
      ...cli,
      dbNameClass: envInput.dbNameClass,
    });
    logResult(result, io);
  } finally {
    await services.close?.();
  }
}

function identityFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  return [
    skipFixture(
      "identity-user",
      `${ctx.prefix}:identity-user:skip-phase-b`,
      "IDENTITY_FIXTURE_NOT_NEEDED_FOR_PHASE_B",
    ),
  ];
}

function orgUnitFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  return [
    {
      module: "org-unit",
      key: "org-root",
      externalRef: externalRef(ctx, "org-unit", "root"),
      payload: {
        externalRef: externalRef(ctx, "org-unit", "root"),
        name: "Smoke Studios",
        type: "BUSINESS_UNIT",
        parentOrgUnitId: null,
        displayOrder: 10,
        description: "Smoke catalog root org unit",
      },
    },
    {
      module: "org-unit",
      key: "org-production",
      externalRef: externalRef(ctx, "org-unit", "production"),
      dependsOn: ["org-root"],
      payload: {
        externalRef: externalRef(
          ctx,
          "org-unit",
          "production",
        ),
        name: "Smoke Production",
        type: "DEPARTMENT",
        parentOrgUnitId: ref("org-root"),
        displayOrder: 20,
        description: "Smoke catalog production department",
      },
    },
    {
      module: "org-unit",
      key: "org-talent",
      externalRef: externalRef(ctx, "org-unit", "talent"),
      dependsOn: ["org-root"],
      payload: {
        externalRef: externalRef(ctx, "org-unit", "talent"),
        name: "Smoke Talent",
        type: "DEPARTMENT",
        parentOrgUnitId: ref("org-root"),
        displayOrder: 30,
        description: "Smoke catalog talent department",
      },
    },
    {
      module: "org-unit",
      key: "org-commerce",
      externalRef: externalRef(ctx, "org-unit", "commerce"),
      dependsOn: ["org-root"],
      payload: {
        externalRef: externalRef(ctx, "org-unit", "commerce"),
        name: "Smoke Commerce",
        type: "DEPARTMENT",
        parentOrgUnitId: ref("org-root"),
        displayOrder: 40,
        description: "Smoke catalog commerce department",
      },
    },
  ];
}

function employmentProfileFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  const count = Math.min(Math.max(ctx.size, 8), 12);
  const titles = [
    "Studio Manager",
    "Talent Coordinator",
    "Producer",
    "Operations Specialist",
    "Content Lead",
    "Commerce Analyst",
    "Live Host Coordinator",
    "Resource Planner",
    "Talent Partner",
    "Campaign Coordinator",
    "Channel Specialist",
    "KPI Analyst",
  ];

  return Array.from({ length: count }, (_unused, index) => {
    const item = index + 1;
    const orgKey =
      index % 3 === 0
        ? "org-production"
        : index % 3 === 1
          ? "org-talent"
          : "org-commerce";
    return {
      module: "employment-profile",
      key: `employment-${item}`,
      externalRef: externalRef(ctx, "employment-profile", item),
      dependsOn: [orgKey],
      payload: {
        externalRef: externalRef(
          ctx,
          "employment-profile",
          item,
        ),
        legalName: `Smoke Employee ${item}`,
        displayName: `Smoke Staff ${item}`,
        employmentKind:
          index % 4 === 0
            ? "EMPLOYEE"
            : index % 4 === 1
              ? "CONTRACTOR"
              : index % 4 === 2
                ? "PART_TIME"
                : "INTERN",
        jobTitle: titles[index] ?? "Catalog Specialist",
        orgUnitId: ref(orgKey),
        managerEmploymentProfileId: null,
        linkedUserId: null,
        contractStatus:
          index % 3 === 0
            ? "ACTIVE"
            : index % 3 === 1
              ? "PENDING_SIGNATURE"
              : "NONE",
        employmentStartDate: Date.UTC(2026, 0, 1),
        titleDescription: "Smoke catalog employment record",
      },
    };
  });
}

function talentFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  return Array.from({ length: 8 }, (_unused, index) => {
    const item = index + 1;
    const isInternal = item <= 4;
    return {
      module: "talent",
      key: `talent-${item}`,
      externalRef: externalRef(ctx, "talent", item),
      dependsOn: isInternal ? [`employment-${item}`] : undefined,
      payload: {
        externalRef: externalRef(ctx, "talent", item),
        stageName: `Smoke Talent ${item}`,
        legalName: `Smoke Talent Legal ${item}`,
        talentOrigin: isInternal ? "INTERNAL" : "EXTERNAL",
        managerEmploymentProfileId: null,
        linkedEmploymentProfileId: isInternal
          ? ref(`employment-${item}`)
          : null,
        commercialParticipationStatus: "ELIGIBLE",
        livestreamEligible: index % 3 !== 0,
        eventEligible: true,
        displayShortName: `ST${item}`,
        profileSummary: "Smoke catalog talent reference",
      },
    };
  });
}

function talentGroupFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  return [
    {
      module: "talent-group",
      key: "talent-group-1",
      externalRef: externalRef(ctx, "talent-group", 1),
      payload: {
        externalRef: externalRef(ctx, "talent-group", 1),
        name: "Smoke Live Team",
        shortName: "Smoke Live",
        displayOrder: 10,
        description: "Smoke catalog live team",
      },
    },
    {
      module: "talent-group",
      key: "talent-group-2",
      externalRef: externalRef(ctx, "talent-group", 2),
      payload: {
        externalRef: externalRef(ctx, "talent-group", 2),
        name: "Smoke Commerce Team",
        shortName: "Smoke Commerce",
        displayOrder: 20,
        description: "Smoke catalog commerce team",
      },
    },
    ...[1, 2, 3, 4].map((item) => ({
      module: "talent-group-member" as const,
      key: `talent-group-member-1-${item}`,
      externalRef: externalRef(
        ctx,
        "talent-group-member",
        `1-${item}`,
      ),
      dependsOn: ["talent-group-1", `talent-${item}`],
      payload: {
        groupId: ref("talent-group-1"),
        talentId: ref(`talent-${item}`),
        lineupOrder: item,
        membershipStatus: "ACTIVE",
      },
    })),
    ...[5, 6, 7, 8].map((item) => ({
      module: "talent-group-member" as const,
      key: `talent-group-member-2-${item}`,
      externalRef: externalRef(
        ctx,
        "talent-group-member",
        `2-${item}`,
      ),
      dependsOn: ["talent-group-2", `talent-${item}`],
      payload: {
        groupId: ref("talent-group-2"),
        talentId: ref(`talent-${item}`),
        lineupOrder: item - 4,
        membershipStatus: "ACTIVE",
      },
    })),
  ];
}

function platformAccountFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  const owners = [
    { kind: "ORG_UNIT", key: "org-production" },
    { kind: "ORG_UNIT", key: "org-commerce" },
    { kind: "TALENT", key: "talent-1" },
    { kind: "TALENT", key: "talent-2" },
    { kind: "TALENT_GROUP", key: "talent-group-1" },
    { kind: "TALENT_GROUP", key: "talent-group-2" },
  ];
  const platforms = [
    "TIKTOK",
    "YOUTUBE",
    "FACEBOOK",
    "INSTAGRAM",
    "TIKTOK",
    "YOUTUBE",
  ];

  return owners.map((owner, index) => {
    const item = index + 1;
    const ownerFields =
      owner.kind === "ORG_UNIT"
        ? {
            ownerOrgUnitId: ref(owner.key),
            ownerTalentId: null,
            ownerTalentGroupId: null,
          }
        : owner.kind === "TALENT"
          ? {
              ownerOrgUnitId: null,
              ownerTalentId: ref(owner.key),
              ownerTalentGroupId: null,
            }
          : {
              ownerOrgUnitId: null,
              ownerTalentId: null,
              ownerTalentGroupId: ref(owner.key),
            };

    return {
      module: "platform-account",
      key: `platform-account-${item}`,
      externalRef: externalRef(ctx, "platform-account", item),
      dependsOn: [owner.key],
      payload: {
        externalRef: externalRef(
          ctx,
          "platform-account",
          item,
        ),
        platform: platforms[index],
        platformSurfaceType:
          index % 3 === 0
            ? "CHANNEL"
            : index % 3 === 1
              ? "ACCOUNT"
              : "PAGE",
        displayName: `Smoke ${platforms[index]} ${item}`,
        handle: `smoke_catalog_${item}`,
        externalPlatformId: `smoke-catalog-${item}`,
        profileUrl: `https://example.test/smoke/catalog/${item}`,
        ownerKind: owner.kind,
        ...ownerFields,
        livestreamEnabled: index !== 5,
        contentPublishingEnabled: true,
        monetizationEnabled: index % 2 === 0,
        description: "Smoke catalog platform account",
      },
    };
  });
}

function studioResourceFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  const classes = ["SPACE", "EQUIPMENT", "EQUIPMENT", "KIT", "SPACE"];

  return classes.map((resourceClass, index) => {
    const item = index + 1;
    return {
      module: "studio-resource",
      key: `studio-resource-${item}`,
      externalRef: externalRef(ctx, "studio-resource", item),
      payload: {
        externalRef: externalRef(
          ctx,
          "studio-resource",
          item,
        ),
        name: `Smoke ${resourceClass.replace("_", " ")} ${item}`,
        resourceClass,
        shortName: `SR${item}`,
        locationLabel: `Studio ${String.fromCharCode(65 + index)}`,
        description: "Smoke catalog studio resource",
        maxOccupancy: resourceClass === "SPACE" ? 8 : null,
      },
    };
  });
}

function workPatternFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  return [
    {
      module: "work-pattern",
      key: "work-pattern-weekday",
      externalRef: externalRef(ctx, "work-pattern", "weekday"),
      payload: {
        externalRef: externalRef(
          ctx,
          "work-pattern",
          "weekday",
        ),
        name: "Smoke Weekday Pattern",
        timezone: "Asia/Ho_Chi_Minh",
        startLocalTime: "09:00",
        workingMinutes: 480,
        breakMinutes: 60,
        workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
        description: "Smoke catalog weekday pattern",
      },
    },
    {
      module: "work-pattern",
      key: "work-pattern-weekend",
      externalRef: externalRef(ctx, "work-pattern", "weekend"),
      payload: {
        externalRef: externalRef(
          ctx,
          "work-pattern",
          "weekend",
        ),
        name: "Smoke Weekend Pattern",
        timezone: "Asia/Ho_Chi_Minh",
        startLocalTime: "13:00",
        workingMinutes: 300,
        breakMinutes: 30,
        workingDays: ["SAT", "SUN"],
        description: "Smoke catalog weekend pattern",
      },
    },
  ];
}

function holidayCalendarFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  return [
    {
      module: "holiday-calendar",
      key: "holiday-calendar-1",
      externalRef: externalRef(ctx, "holiday-calendar", 1),
      payload: {
        externalRef: externalRef(ctx, "holiday-calendar", 1),
        name: "Smoke Vietnam Holidays",
        scopeType: "GLOBAL",
        timezone: "Asia/Ho_Chi_Minh",
        description: "Smoke catalog holiday calendar",
      },
    },
    {
      module: "holiday-calendar-entry",
      key: "holiday-calendar-entry-1",
      externalRef: externalRef(
        ctx,
        "holiday-calendar-entry",
        1,
      ),
      dependsOn: ["holiday-calendar-1"],
      payload: {
        externalRef: externalRef(
          ctx,
          "holiday-calendar-entry",
          1,
        ),
        holidayCalendarId: ref("holiday-calendar-1"),
        date: "2026-01-01",
        entryType: "HOLIDAY",
        name: "Smoke New Year",
        description: "Smoke catalog holiday entry",
      },
    },
  ];
}

function eventFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  return [1, 2, 3, 4].map((item) => ({
    module: "event-assignment" as const,
    key: `event-${item}`,
    externalRef: externalRef(ctx, "event-assignment", item),
    dependsOn: [
      `talent-${item}`,
      `studio-resource-${Math.min(item, 5)}`,
      `platform-account-${Math.min(item, 6)}`,
    ],
    payload: {
      externalRef: externalRef(ctx, "event-assignment", item),
      title: `Smoke Catalog Event ${item}`,
      assignments: [
        {
          assignmentKind: "TALENT",
          assignmentEmploymentProfileId: null,
          assignmentTalentId: ref(`talent-${item}`),
          assignmentTalentGroupId: null,
        },
      ],
      studioResourceIds: [ref(`studio-resource-${Math.min(item, 5)}`)],
      platformAccountIds: [
        ref(`platform-account-${Math.min(item, 6)}`),
      ],
      eventStartAt: ctx.now + item * 86_400_000,
      eventEndAt: ctx.now + item * 86_400_000 + 7_200_000,
      description: "Smoke catalog event",
    },
  }));
}

function contractFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  return [1, 2, 3, 4].map((item) => ({
    module: "contract-registry" as const,
    key: `contract-${item}`,
    externalRef: externalRef(ctx, "contract-registry", item),
    dependsOn: [`talent-${item}`, "employment-1"],
    payload: {
      externalRef: externalRef(ctx, "contract-registry", item),
      title: `Smoke Talent Contract ${item}`,
      contractKind:
        item % 2 === 0 ? "TALENT_SERVICE" : "TALENT_MANAGEMENT",
      linkedEntityKind: "TALENT",
      linkedEmploymentProfileId: null,
      linkedTalentId: ref(`talent-${item}`),
      ownerEmploymentProfileId: ref("employment-1"),
      confidentialityTier: item % 2 === 0 ? "INTERNAL" : "CONFIDENTIAL",
      effectiveStartDate: "2026-01-01",
      effectiveEndDate: null,
      fileReferenceId: null,
      fileDisplayName: null,
      status: "ACTIVE",
      description: "Smoke catalog contract record",
    },
  }));
}

function talentKpiFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  return [1, 2, 3, 4].map((item) => ({
    module: "talent-kpi" as const,
    key: `talent-kpi-${item}`,
    externalRef: externalRef(ctx, "talent-kpi", item),
    dependsOn: [
      `talent-${item}`,
      `platform-account-${item}`,
      `event-${item}`,
    ],
    payload: {
      externalRef: externalRef(ctx, "talent-kpi", item),
      title: `Smoke KPI ${item}`,
      subjectTalentId: ref(`talent-${item}`),
      attributionPlatformAccountId: ref(`platform-account-${item}`),
      attributionEventId: ref(`event-${item}`),
      measurementSource: "MANUAL",
      periodStartAt: ctx.now,
      periodEndAt: ctx.now + 604_800_000,
      metrics: [
        { metricCode: "ENGAGEMENT_COUNT", numericValue: 100 * item },
        { metricCode: "EVENT_APPEARANCE_COUNT", numericValue: item },
      ],
      description: "Smoke catalog KPI draft",
    },
  }));
}

function revenueLedgerFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  return [1, 2, 3, 4, 5].map((item) => {
    const attributionItem = Math.min(item, 4);

    return {
      module: "revenue-ledger" as const,
      key: `revenue-${item}`,
      externalRef: externalRef(ctx, "revenue-ledger", item),
      dependsOn: [
        `talent-${attributionItem}`,
        `platform-account-${attributionItem}`,
        `event-${attributionItem}`,
      ],
      payload: {
        externalRef: externalRef(ctx, "revenue-ledger", item),
        title: `Smoke Revenue ${item}`,
        subjectTalentId: ref(`talent-${attributionItem}`),
        attributionPlatformAccountId: ref(
          `platform-account-${attributionItem}`,
        ),
        attributionEventId: ref(`event-${attributionItem}`),
        revenueKind:
          item % 2 === 0 ? "PLATFORM_CONTENT" : "PLATFORM_LIVESTREAM",
        entrySource: "MANUAL",
        currencyCode: "VND",
        recognizedAmount: 1_000_000 * item,
        recognizedAt: ctx.now + item * 86_400_000,
        description: "Smoke catalog revenue draft",
      },
    };
  });
}

function commissionRuleFixtures(
  ctx: FixtureContext,
): readonly CatalogFixture[] {
  return [1, 2].map((item) => ({
    module: "commission-rule" as const,
    key: `commission-rule-${item}`,
    externalRef: externalRef(ctx, "commission-rule", item),
    dependsOn: [`talent-${item}`, `contract-${item}`],
    payload: {
      externalRef: externalRef(ctx, "commission-rule", item),
      title: `Smoke Commission Rule ${item}`,
      settlementKind: "REVENUE_SHARE",
      beneficiaryKind: "TALENT",
      beneficiaryEmploymentProfileId: null,
      beneficiaryTalentId: ref(`talent-${item}`),
      sourceContractRecordId: ref(`contract-${item}`),
      settlementBasis: "RECOGNIZED_GROSS_REVENUE",
      ratePercent: item === 1 ? 10 : 12.5,
      appliesToRevenueKinds: [
        "PLATFORM_LIVESTREAM",
        "PLATFORM_CONTENT",
      ],
      effectiveStartDate: Date.UTC(2026, 0, 15),
      effectiveEndDate: null,
      description: "Smoke catalog commission rule draft",
    },
  }));
}

function skipFixture(
  module: FixtureModule,
  externalRefValue: string,
  reason: string,
): CatalogFixture {
  return {
    module,
    key: externalRefValue,
    externalRef: externalRefValue,
    payload: {
      externalRef: externalRefValue,
      __skipReason: reason,
    },
  };
}

function createEmptySummaries(): Record<
  FixtureModule,
  FixtureModuleSummary
> {
  return Object.fromEntries(
    MODULE_ORDER.map((module) => [
      module,
      { create: 0, noOp: 0, skipped: 0, failed: 0 },
    ]),
  ) as Record<FixtureModule, FixtureModuleSummary>;
}

function increment(
  summary: FixtureModuleSummary,
  outcome: FixtureOutcome,
): void {
  const mutable = summary as {
    create: number;
    noOp: number;
    skipped: number;
    failed: number;
  };

  if (outcome === "no-op") {
    mutable.noOp += 1;
    return;
  }

  mutable[outcome] += 1;
}

function resolvePayloadRelationships(
  payload: FixturePayload,
  ids: ReadonlyMap<string, string>,
): FixturePayload {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    resolved[key] = resolveValue(value, ids);
  }

  return Object.freeze(resolved);
}

function resolveValue(
  value: unknown,
  ids: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, ids));
  }

  if (isReferenceToken(value)) {
    const resolved = ids.get(value.__fixtureRef);
    if (!resolved) {
      throw new SmokeFixtureError(
        "SMOKE_FIXTURE_RELATIONSHIP_MISSING",
        "Fixture relationship could not be resolved",
      );
    }
    return resolved;
  }

  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return resolvePayloadRelationships(
      value as FixturePayload,
      ids,
    );
  }

  return value;
}

function assertExactFixtureMatch(
  existing: FixturePayload,
  expected: FixturePayload,
): void {
  if (!plainObjectsEqual(existing, expected)) {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_DIVERGENT_EXISTING",
      "Existing smoke fixture diverges from expected catalog payload",
    );
  }
}

function assertNoBlockedFixtureKeys(payload: FixturePayload): void {
  const blocked = new Set([
    "code",
    "employeeCode",
    "talentCode",
    "groupCode",
    "accountCode",
    "resourceCode",
    "eventCode",
    "contractCode",
    "kpiRecordCode",
    "revenueEntryCode",
    "ruleCode",
    "settlementCode",
    "patternCode",
    "calendarCode",
    "rosterCode",
    "shiftCode",
    "source" + "Metadata",
  ]);

  for (const key of deepKeys(payload)) {
    if (blocked.has(key)) {
      throw new SmokeFixtureError(
        "SMOKE_FIXTURE_BACKEND_FIELD_SUPPLIED",
        "Fixture payload supplied a backend-owned field",
      );
    }
  }
}

function deepKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => deepKeys(entry));
  }

  if (
    value === null ||
    typeof value !== "object" ||
    isReferenceToken(value)
  ) {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...deepKeys(child),
  ]);
}

function createRuntimeFixtureServices(params: {
  readonly mongoUri: string;
  readonly mongoDbName: string;
  readonly mongoMaxPoolSize?: number;
}): CatalogFixtureServices {
  return createPhaseARuntimeFixtureServices(params);
}

function externalRef(
  ctx: FixtureContext,
  module: string,
  suffix: string | number,
): string {
  return `${ctx.prefix}:catalog:${module}:${suffix}`;
}

function ref(key: string): { readonly __fixtureRef: string } {
  return Object.freeze({ __fixtureRef: key });
}

function isReferenceToken(
  value: unknown,
): value is { readonly __fixtureRef: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { __fixtureRef?: unknown }).__fixtureRef ===
      "string"
  );
}

function loadDotenvDev(dotenvConfigPath: string | undefined): void {
  const normalized = normalizeRequiredText(
    dotenvConfigPath,
    "DOTENV_CONFIG_PATH",
  );

  if (!existsSync(normalized)) {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_DOTENV_FILE_MISSING",
      "DOTENV_CONFIG_PATH must point to an existing .env.dev file",
    );
  }

  const result = dotenv.config({
    path: normalized,
    override: false,
  });

  if (result.error) {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_DOTENV_LOAD_FAILED",
      "Failed to load .env.dev",
    );
  }
}

function logResult(result: FixtureRunResult, io: CliConsole): void {
  for (const module of MODULE_ORDER) {
    const summary = result.summaries[module];
    io.log(
      `${module}: create=${summary.create} no-op=${summary.noOp} skipped=${summary.skipped} failed=${summary.failed}`,
    );
  }

  for (const warning of result.warnings) {
    io.log(`warning=${warning}`);
  }
}

function readCliValue(
  argv: readonly string[],
  index: number,
  name: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_CLI_VALUE_MISSING",
      `${name} requires a value`,
    );
  }
  return value;
}

function parseFixtureSize(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_SIZE_INVALID",
      "Fixture size must be a positive integer",
    );
  }

  return clampFixtureSize(parsed);
}

function clampFixtureSize(value: number): number {
  if (value > MAX_SIZE) {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_SIZE_TOO_LARGE",
      "Fixture size must be 20 or lower",
    );
  }
  return value;
}

function normalizePrefix(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,20}$/u.test(normalized)) {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_PREFIX_INVALID",
      "Fixture prefix must be 2-21 safe uppercase characters",
    );
  }
  return normalized;
}

function assertDotenvDevPath(value: string | undefined): void {
  const normalized = normalizeRequiredText(
    value,
    "DOTENV_CONFIG_PATH",
  );
  const basename = path.basename(path.resolve(normalized));

  if (basename !== ".env.dev") {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_DOTENV_PATH_FORBIDDEN",
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

  throw new SmokeFixtureError(
    "SMOKE_FIXTURE_ENV_GUARD_FAILED",
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

  throw new SmokeFixtureError(
    "SMOKE_FIXTURE_BOOLEAN_GUARD_FAILED",
    "Boolean smoke fixture env flags must be true or false",
  );
}

function hasDeployedRuntimeMarker(source: FixtureEnvSource): boolean {
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

  throw new SmokeFixtureError(
    "SMOKE_FIXTURE_DB_NAME_FORBIDDEN",
    "MONGO_DB_NAME must be dev/smoke/local/test/sandbox-like unless ALLOW_NONLOCAL_SMOKE_DB=true",
  );
}

function normalizeRequiredText(
  value: string | undefined,
  name: string,
): string {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_REQUIRED_ENV_MISSING",
      `${name} is required`,
    );
  }
  return normalized;
}

function parseMongoPoolSize(
  value: string | undefined,
): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SmokeFixtureError(
      "SMOKE_FIXTURE_MONGO_POOL_INVALID",
      "MONGO_MAX_POOL_SIZE must be a positive integer",
    );
  }

  return parsed;
}

function plainObjectsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function helpText(): string {
  return [
    "Smoke fixture catalog seed",
    "",
    "Required guards:",
    "  DOTENV_CONFIG_PATH=.env.dev",
    "  ALLOW_SMOKE_FIXTURES=true",
    "  NODE_ENV=development",
    "  APP_RUNTIME=http",
    "  LOCAL_MOCK_AUTH_ENABLED=false",
    "",
    "Options:",
    "  --dry-run",
    "  --write",
    "  --profile catalog",
    "  --size <1-20>",
    "  --prefix SMOKE",
    "",
    "Examples:",
    "  npm run smoke:seed:fixtures -- --dry-run",
    "  npm run smoke:seed:fixtures -- --write --profile catalog --size 12 --prefix SMOKE",
  ].join("\n");
}

function formatFixtureModuleFailure(
  module: FixtureModule,
  action: FixtureModuleAction,
  error: unknown,
): string {
  const details = describeSafeFixtureError(error);
  const segments = [
    `${module} fixture failed`,
    `module=${module}`,
    `action=${action}`,
    `errorName=${details.name}`,
  ];

  if (details.code) {
    segments.push(`errorCode=${details.code}`);
  }

  segments.push(`safeMessage=${details.safeMessage}`);
  return segments.join("; ");
}

function describeSafeFixtureError(error: unknown): {
  readonly name: string;
  readonly code?: string;
  readonly safeMessage: string;
} {
  const name = readSafeErrorName(error);

  if (error instanceof BaseAppError) {
    return {
      name,
      code: safeIdentifier(error.code, "APP_ERROR"),
      safeMessage: sanitizeTrustedSafeMessage(error.safeMessage),
    };
  }

  return {
    name,
    safeMessage: "Unexpected fixture module error",
  };
}

function readSafeErrorName(error: unknown): string {
  if (!(error instanceof Error)) {
    return "NonError";
  }

  const constructorName =
    typeof error.constructor?.name === "string"
      ? error.constructor.name
      : undefined;
  const preferred =
    error.name && error.name !== "Error"
      ? error.name
      : constructorName;

  return safeIdentifier(preferred, "Error");
}

function safeIdentifier(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = value?.trim() ?? "";
  if (/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/u.test(normalized)) {
    return normalized;
  }
  return fallback;
}

function sanitizeTrustedSafeMessage(value: string): string {
  const normalized = redactSensitiveText(value)
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return normalized.length > 0
    ? normalized.slice(0, 180)
    : "Application error";
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
    process.env as FixtureEnvSource,
  ).catch((error) => {
    if (error instanceof SmokeFixtureError) {
      console.error(`${error.code}: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    const message =
      error instanceof Error
        ? redactSensitiveText(error.message)
        : "Unknown fixture failure";
    console.error(`SMOKE_FIXTURE_FAILED: ${message}`);
    process.exitCode = 1;
  });
}
