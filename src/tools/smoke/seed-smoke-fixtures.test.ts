import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import {
  COMMISSION_BENEFICIARY_KINDS,
  COMMISSION_SETTLEMENT_BASES,
  COMMISSION_SETTLEMENT_KINDS,
} from "@modules/commission/domain/commission.types";
import {
  CONTRACT_KINDS,
  CONTRACT_RECORD_STATUSES,
} from "@modules/contract-registry/domain/contract-registry.types";
import { ORG_UNIT_TYPES } from "@modules/org-unit/domain/org-unit.types";
import { REVENUE_ENTRY_KINDS } from "@modules/revenue-ledger/domain/revenue-ledger.types";
import { STUDIO_RESOURCE_CLASSES } from "@modules/studio-resource/domain/studio-resource.types";
import { StudioResourceValidationError } from "@modules/studio-resource/domain/studio-resource.errors";
import {
  buildCatalogFixtures,
  CatalogFixtureServices,
  createSmokeFixtureActor,
  ExistingFixtureRecord,
  FixtureCliOptions,
  FixturePayload,
  parseFixtureCliOptions,
  runCatalogFixtures,
  runCli,
  SmokeFixtureError,
  validateFixtureEnv,
} from "./seed-smoke-fixtures";

const NOW = Date.UTC(2026, 0, 15, 9, 0, 0);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function baseEnv(
  overrides: Record<string, string | undefined> = {},
) {
  return {
    DOTENV_CONFIG_PATH: ".env.dev",
    ALLOW_SMOKE_FIXTURES: "true",
    LOCAL_MOCK_AUTH_ENABLED: "false",
    NODE_ENV: "development",
    APP_RUNTIME: "http",
    MONGO_DB_NAME: "media_smoke",
    ...overrides,
  };
}

class FakeCatalogServices implements CatalogFixtureServices {
  readonly created: Array<{
    readonly module: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly actor: Actor;
  }> = [];
  readonly lookups: string[] = [];
  readonly deleted: string[] = [];

  constructor(
    readonly existing = new Map<string, ExistingFixtureRecord>(),
  ) {}

  async findByExternalRef(
    module: string,
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    this.lookups.push(`${module}:${externalRef}`);
    return this.existing.get(`${module}:${externalRef}`) ?? null;
  }

  async create(
    module: string,
    payload: Readonly<Record<string, unknown>>,
    actor: Actor,
  ) {
    assertNoReferenceTokens(payload);
    this.created.push({ module, payload, actor });
    return { id: `id:${module}:${this.created.length}` };
  }
}

class ThrowingStudioResourceCreateServices extends FakeCatalogServices {
  constructor(private readonly error: unknown) {
    super();
  }

  override async create(
    module: string,
    payload: Readonly<Record<string, unknown>>,
    actor: Actor,
  ) {
    if (module === "studio-resource") {
      throw this.error;
    }

    return super.create(module, payload, actor);
  }
}

test("fixture env rejects missing DOTENV_CONFIG_PATH", () => {
  assert.throws(
    () =>
      validateFixtureEnv(
        baseEnv({ DOTENV_CONFIG_PATH: undefined }),
      ),
    /DOTENV_CONFIG_PATH is required/u,
  );
});

test("fixture env rejects non-.env.dev DOTENV_CONFIG_PATH", () => {
  assert.throws(
    () =>
      validateFixtureEnv(
        baseEnv({ DOTENV_CONFIG_PATH: ".env.local" }),
      ),
    /DOTENV_CONFIG_PATH must resolve to \.env\.dev/u,
  );
});

test("fixture env rejects missing ALLOW_SMOKE_FIXTURES=true", () => {
  assert.throws(
    () =>
      validateFixtureEnv(
        baseEnv({ ALLOW_SMOKE_FIXTURES: undefined }),
      ),
    /ALLOW_SMOKE_FIXTURES must be true/u,
  );
});

test("fixture env rejects production node env", () => {
  assert.throws(
    () =>
      validateFixtureEnv(baseEnv({ NODE_ENV: "production" })),
    /NODE_ENV=production is forbidden/u,
  );
});

test("fixture env rejects deployed markers", () => {
  assert.throws(
    () => validateFixtureEnv(baseEnv({ RENDER: "true" })),
    /Deployed or staging runtime markers are forbidden/u,
  );
  assert.throws(
    () => validateFixtureEnv(baseEnv({ DEPLOY_ENV: "staging" })),
    /Deployed or staging runtime markers are forbidden/u,
  );
});

test("fixture env rejects enabled local mock auth", () => {
  assert.throws(
    () =>
      validateFixtureEnv(
        baseEnv({ LOCAL_MOCK_AUTH_ENABLED: "true" }),
      ),
    /LOCAL_MOCK_AUTH_ENABLED must be false or unset/u,
  );
});

test("fixture env rejects unsafe DB names unless override is set", () => {
  assert.throws(
    () => validateFixtureEnv(baseEnv({ MONGO_DB_NAME: "media" })),
    /MONGO_DB_NAME must be dev\/smoke\/local\/test\/sandbox-like/u,
  );

  const parsed = validateFixtureEnv(
    baseEnv({
      MONGO_DB_NAME: "media",
      ALLOW_NONLOCAL_SMOKE_DB: "true",
    }),
  );
  assert.equal(parsed.dbNameClass, "nonlocal-override");
});

test("fixture CLI defaults to dry-run catalog size 12", () => {
  assert.deepEqual(parseFixtureCliOptions([]), {
    mode: "dry-run",
    profile: "catalog",
    size: 12,
    prefix: "SMOKE",
  } satisfies FixtureCliOptions);
});

test("fixture CLI accepts explicit write mode", () => {
  assert.equal(
    parseFixtureCliOptions(["--write"]).mode,
    "write",
  );
});

test("fixture CLI rejects unknown flags", () => {
  assert.throws(
    () => parseFixtureCliOptions(["--unexpected"]),
    /Unsupported fixture CLI flag/u,
  );
});

test("fixture CLI enforces max size", () => {
  assert.equal(
    parseFixtureCliOptions(["--size", "20"]).size,
    20,
  );
  assert.throws(
    () => parseFixtureCliOptions(["--size", "21"]),
    /Fixture size must be 20 or lower/u,
  );
});

test("dry-run plans catalog fixtures without writes", async () => {
  const fake = new FakeCatalogServices();

  const result = await runCatalogFixtures(fake, {
    mode: "dry-run",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(fake.created.length, 0);
  assert.equal(result.summaries["identity-user"].skipped, 1);
  assert.equal(result.summaries["org-unit"].create, 4);
  assert.equal(result.summaries["employment-profile"].create, 12);
  assert.equal(result.summaries["talent"].create, 8);
  assert.equal(result.summaries["talent-group"].create, 2);
  assert.equal(result.summaries["talent-group-member"].create, 8);
  assert.equal(result.summaries["platform-account"].create, 6);
  assert.equal(result.summaries["studio-resource"].create, 5);
  assert.equal(result.summaries["work-pattern"].create, 2);
  assert.equal(result.summaries["holiday-calendar"].create, 1);
  assert.equal(result.summaries["holiday-calendar-entry"].create, 1);
  assert.equal(result.summaries["event-assignment"].create, 4);
  assert.equal(result.summaries["contract-registry"].create, 4);
  assert.equal(result.summaries["talent-kpi"].create, 4);
  assert.equal(result.summaries["revenue-ledger"].create, 5);
  assert.equal(result.summaries["commission-rule"].create, 2);
  assert.equal(result.summaries["commission-settlement"].skipped, 1);
  assert.equal(result.summaries["dashboard-lite"].skipped, 1);
});

test("write mode uses injected fake services only", async () => {
  const fake = new FakeCatalogServices();

  await runCatalogFixtures(fake, {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(fake.created.length > 0, true);
  assert.equal(fake.deleted.length, 0);
  assert.equal(
    fake.created.every(
      (entry) => entry.actor.id === "smoke-fixture-actor",
    ),
    true,
  );
  assert.deepEqual(
    [...new Set(fake.created.map((entry) => entry.module))],
    [
      "org-unit",
      "employment-profile",
      "talent",
      "talent-group",
      "talent-group-member",
      "platform-account",
      "studio-resource",
      "work-pattern",
      "holiday-calendar",
      "holiday-calendar-entry",
      "event-assignment",
      "contract-registry",
      "talent-kpi",
      "revenue-ledger",
      "commission-rule",
    ],
  );
});

test("business fixture payloads omit backend-owned generated fields", () => {
  const fixtures = buildCatalogFixtures({
    prefix: "SMOKE",
    size: 12,
    now: NOW,
  });
  const forbidden = [
    "employee" + "Code",
    "talent" + "Code",
    "group" + "Code",
    "account" + "Code",
    "resource" + "Code",
    "event" + "Code",
    "contract" + "Code",
    "kpiRecord" + "Code",
    "revenueEntry" + "Code",
    "rule" + "Code",
    "settlement" + "Code",
  ];

  for (const fixture of fixtures) {
    const keys = new Set(deepKeys(fixture.payload));
    for (const key of forbidden) {
      assert.equal(keys.has(key), false, `${fixture.module}:${key}`);
    }
  }
});

test("Phase B fixture payloads are identity-safe and use service create shapes", () => {
  const fixtures = buildCatalogFixtures({
    prefix: "SMOKE",
    size: 12,
    now: NOW,
  });

  const identity = fixtures.filter(
    (fixture) => fixture.module === "identity-user",
  );
  assert.equal(identity.length, 1);
  assert.equal(
    identity[0].payload.__skipReason,
    "IDENTITY_FIXTURE_NOT_NEEDED_FOR_PHASE_B",
  );

  const employmentProfiles = fixtures.filter(
    (fixture) => fixture.module === "employment-profile",
  );
  assert.equal(employmentProfiles.length, 12);
  assert.equal(
    employmentProfiles.every(
      (fixture) => fixture.payload.linkedUserId === null,
    ),
    true,
  );
  assert.equal(
    employmentProfiles.some(
      (fixture) => "employeeCode" in fixture.payload,
    ),
    false,
  );

  const talents = fixtures.filter(
    (fixture) => fixture.module === "talent",
  );
  assert.equal(talents.length, 8);
  assert.equal(
    talents.some((fixture) => "talentCode" in fixture.payload),
    false,
  );
  assert.equal(
    talents
      .filter((fixture) => fixture.payload.talentOrigin === "EXTERNAL")
      .every(
        (fixture) =>
          fixture.payload.linkedEmploymentProfileId === null,
      ),
    true,
  );

  const memberships = fixtures.filter(
    (fixture) => fixture.module === "talent-group-member",
  );
  assert.equal(memberships.length, 8);
  assert.equal(
    new Set(
      memberships.map(
        (fixture) =>
          `${fixture.dependsOn?.[0] ?? ""}:${fixture.dependsOn?.[1] ?? ""}`,
      ),
    ).size,
    memberships.length,
  );

  const platformAccounts = fixtures.filter(
    (fixture) => fixture.module === "platform-account",
  );
  assert.equal(platformAccounts.length, 6);
  assert.equal(
    platformAccounts.some(
      (fixture) => "accountCode" in fixture.payload,
    ),
    false,
  );
  for (const fixture of platformAccounts) {
    const ownerRefs = [
      fixture.payload.ownerOrgUnitId,
      fixture.payload.ownerTalentId,
      fixture.payload.ownerTalentGroupId,
    ].filter((value) => value !== null);
    assert.equal(ownerRefs.length, 1);
  }
});

test("Phase C fixture payloads use service create shapes and safe references", () => {
  const fixtures = buildCatalogFixtures({
    prefix: "SMOKE",
    size: 12,
    now: NOW,
  });

  const events = fixtures.filter(
    (fixture) => fixture.module === "event-assignment",
  );
  assert.equal(events.length, 4);
  assert.equal(
    events.every(
      (fixture) =>
        fixture.dependsOn?.some((key) => key.startsWith("talent-")) &&
        fixture.dependsOn?.some((key) =>
          key.startsWith("studio-resource-"),
        ) &&
        fixture.dependsOn?.some((key) =>
          key.startsWith("platform-account-"),
        ),
    ),
    true,
  );
  assert.equal(
    events.some((fixture) => "workShiftId" in fixture.payload),
    false,
  );

  const contracts = fixtures.filter(
    (fixture) => fixture.module === "contract-registry",
  );
  assert.equal(contracts.length, 4);
  assert.equal(
    contracts.every(
      (fixture) =>
        fixture.payload.linkedEntityKind === "TALENT" &&
        fixture.payload.fileReferenceId === null &&
        fixture.payload.fileDisplayName === null &&
        fixture.payload.status === "ACTIVE",
    ),
    true,
  );

  const kpis = fixtures.filter(
    (fixture) => fixture.module === "talent-kpi",
  );
  assert.equal(kpis.length, 4);
  assert.deepEqual(kpis[0].payload.metrics, [
    { metricCode: "ENGAGEMENT_COUNT", numericValue: 100 },
    { metricCode: "EVENT_APPEARANCE_COUNT", numericValue: 1 },
  ]);

  const revenues = fixtures.filter(
    (fixture) => fixture.module === "revenue-ledger",
  );
  assert.equal(revenues.length, 5);
  assert.equal(
    revenues.every(
      (fixture) =>
        fixture.payload.entrySource === "MANUAL" &&
        fixture.payload.currencyCode === "VND" &&
        !("finalizedAt" in fixture.payload) &&
        !("reconciledAt" in fixture.payload) &&
        !("settlementId" in fixture.payload),
    ),
    true,
  );

  const rules = fixtures.filter(
    (fixture) => fixture.module === "commission-rule",
  );
  assert.equal(rules.length, 2);
  assert.equal(
    rules.every(
      (fixture) =>
        fixture.payload.settlementBasis ===
          "RECOGNIZED_GROSS_REVENUE" &&
        fixture.payload.beneficiaryKind === "TALENT",
    ),
    true,
  );
});

test("Commission Rule fixtures use canonical UTC-midnight effective dates", () => {
  const fixtures = buildCatalogFixtures({
    prefix: "SMOKE",
    size: 12,
    now: NOW,
  });
  const rules = fixtures.filter(
    (fixture) => fixture.module === "commission-rule",
  );

  assert.equal(rules.length, 2);
  for (const fixture of rules) {
    const value = fixture.payload.effectiveStartDate;
    assert.equal(typeof value, "number", fixture.externalRef);
    const timestamp = value as number;
    assert.equal(Number.isFinite(timestamp), true, fixture.externalRef);
    assert.equal(timestamp % MS_PER_DAY, 0, fixture.externalRef);

    const date = new Date(timestamp);
    assert.equal(date.getUTCHours(), 0, fixture.externalRef);
    assert.equal(date.getUTCMinutes(), 0, fixture.externalRef);
    assert.equal(date.getUTCSeconds(), 0, fixture.externalRef);
    assert.equal(date.getUTCMilliseconds(), 0, fixture.externalRef);
    assert.equal(timestamp, Date.UTC(2026, 0, 15), fixture.externalRef);
    assert.notEqual(timestamp, NOW, fixture.externalRef);
  }
});

test("Commission Rule fixtures keep valid enum sets and talent contract compatibility", () => {
  const fixtures = buildCatalogFixtures({
    prefix: "SMOKE",
    size: 12,
    now: NOW,
  });
  const rules = fixtures.filter(
    (fixture) => fixture.module === "commission-rule",
  );
  const contractsByKey = new Map(
    fixtures
      .filter((fixture) => fixture.module === "contract-registry")
      .map((fixture) => [fixture.key, fixture]),
  );
  const validSettlementKinds = new Set<string>(
    COMMISSION_SETTLEMENT_KINDS,
  );
  const validBeneficiaryKinds = new Set<string>(
    COMMISSION_BENEFICIARY_KINDS,
  );
  const validSettlementBases = new Set<string>(
    COMMISSION_SETTLEMENT_BASES,
  );
  const validRevenueKinds = new Set<string>(REVENUE_ENTRY_KINDS);
  const validContractKinds = new Set<string>(CONTRACT_KINDS);
  const validContractStatuses = new Set<string>(
    CONTRACT_RECORD_STATUSES,
  );
  const allowedTalentContractKinds = new Set([
    "TALENT_MANAGEMENT",
    "TALENT_SERVICE",
  ]);

  assert.equal(rules.length, 2);
  for (const rule of rules) {
    assert.equal(
      validSettlementKinds.has(String(rule.payload.settlementKind)),
      true,
      rule.externalRef,
    );
    assert.equal(rule.payload.settlementKind, "REVENUE_SHARE");
    assert.equal(
      validBeneficiaryKinds.has(String(rule.payload.beneficiaryKind)),
      true,
      rule.externalRef,
    );
    assert.equal(rule.payload.beneficiaryKind, "TALENT");
    assert.equal(
      validSettlementBases.has(String(rule.payload.settlementBasis)),
      true,
      rule.externalRef,
    );
    assert.equal(
      rule.payload.settlementBasis,
      "RECOGNIZED_GROSS_REVENUE",
    );
    assert.equal(
      Array.isArray(rule.payload.appliesToRevenueKinds),
      true,
      rule.externalRef,
    );
    for (const revenueKind of rule.payload
      .appliesToRevenueKinds as readonly unknown[]) {
      assert.equal(
        validRevenueKinds.has(String(revenueKind)),
        true,
        `${rule.externalRef}:${String(revenueKind)}`,
      );
    }

    const sourceContractKey = readFixtureRef(
      rule.payload.sourceContractRecordId,
    );
    const beneficiaryTalentKey = readFixtureRef(
      rule.payload.beneficiaryTalentId,
    );
    const contract = contractsByKey.get(sourceContractKey);

    assert.ok(contract, rule.externalRef);
    assert.equal(contract.payload.status, "ACTIVE");
    assert.equal(
      validContractStatuses.has(String(contract.payload.status)),
      true,
      contract.externalRef,
    );
    assert.equal(contract.payload.linkedEntityKind, "TALENT");
    assert.equal(
      validContractKinds.has(String(contract.payload.contractKind)),
      true,
      contract.externalRef,
    );
    assert.equal(
      allowedTalentContractKinds.has(
        String(contract.payload.contractKind),
      ),
      true,
      contract.externalRef,
    );
    assert.equal(
      readFixtureRef(contract.payload.linkedTalentId),
      beneficiaryTalentKey,
      rule.externalRef,
    );
  }
});

test("partial Phase C state creates only missing Commission Rules when prior records no-op", async () => {
  const existing = buildExistingFixtureRecords();
  existing.delete("commission-rule:SMOKE:catalog:commission-rule:1");
  existing.delete("commission-rule:SMOKE:catalog:commission-rule:2");
  const fake = new FakeCatalogServices(existing);

  const result = await runCatalogFixtures(fake, {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(result.summaries["event-assignment"].noOp, 4);
  assert.equal(result.summaries["contract-registry"].noOp, 4);
  assert.equal(result.summaries["talent-kpi"].noOp, 4);
  assert.equal(result.summaries["revenue-ledger"].noOp, 5);
  assert.equal(result.summaries["commission-rule"].create, 2);
  assert.equal(result.summaries["commission-settlement"].skipped, 1);
  assert.equal(result.summaries["dashboard-lite"].skipped, 1);
  assert.deepEqual(
    fake.created.map((entry) => entry.module),
    ["commission-rule", "commission-rule"],
  );
  assert.equal(
    fake.created.some(
      (entry) => entry.module === "commission-settlement",
    ),
    false,
  );
  assert.equal(
    fake.created.some((entry) =>
      deepKeys(entry.payload).some((key) =>
        key.toLowerCase().includes("settlementline"),
      ),
    ),
    false,
  );
});

test("divergent existing Commission Rule effective date fails closed", async () => {
  const existing = buildExistingFixtureRecords();
  const divergentKey =
    "commission-rule:SMOKE:catalog:commission-rule:1";
  const rule = existing.get(divergentKey);
  assert.ok(rule);
  existing.set(divergentKey, {
    ...rule,
    payload: {
      ...rule.payload,
      effectiveStartDate: NOW,
    },
  });

  await assert.rejects(
    runCatalogFixtures(new FakeCatalogServices(existing), {
      mode: "dry-run",
      profile: "catalog",
      prefix: "SMOKE",
      size: 12,
      dbNameClass: "smoke-like",
      now: NOW,
    }),
    /Existing smoke fixture diverges/u,
  );
});

test("Revenue Ledger fixture event attribution pairs match active talent event assignments", () => {
  const fixtures = buildCatalogFixtures({
    prefix: "SMOKE",
    size: 12,
    now: NOW,
  });
  const eventsByKey = new Map(
    fixtures
      .filter((fixture) => fixture.module === "event-assignment")
      .map((fixture) => [fixture.key, fixture]),
  );
  const revenues = fixtures.filter(
    (fixture) => fixture.module === "revenue-ledger",
  );

  assert.equal(eventsByKey.size, 4);
  assert.equal(revenues.length, 5);

  for (const revenue of revenues) {
    const attributionEventRef = readFixtureRef(
      revenue.payload.attributionEventId,
    );
    const subjectTalentRef = readFixtureRef(
      revenue.payload.subjectTalentId,
    );
    const attributionPlatformRef = readFixtureRef(
      revenue.payload.attributionPlatformAccountId,
    );
    const event = eventsByKey.get(attributionEventRef);

    assert.ok(
      event,
      `${revenue.externalRef} references missing event ${attributionEventRef}`,
    );
    assert.equal(
      hasTalentAssignment(event.payload.assignments, subjectTalentRef),
      true,
      `${revenue.externalRef} must reference an event with its subject talent assignment`,
    );
    assert.equal(
      readFixtureRefArray(event.payload.platformAccountIds).includes(
        attributionPlatformRef,
      ),
      true,
      `${revenue.externalRef} must reference a platform assigned to its event`,
    );
  }
});

test("Revenue Ledger fixture 5 uses event 4 active talent attribution", () => {
  const fixtures = buildCatalogFixtures({
    prefix: "SMOKE",
    size: 12,
    now: NOW,
  });
  const revenue = fixtures.find(
    (fixture) =>
      fixture.module === "revenue-ledger" &&
      fixture.externalRef === "SMOKE:catalog:revenue-ledger:5",
  );

  assert.ok(revenue);
  assert.equal(readFixtureRef(revenue.payload.subjectTalentId), "talent-4");
  assert.equal(
    readFixtureRef(revenue.payload.attributionPlatformAccountId),
    "platform-account-4",
  );
  assert.equal(readFixtureRef(revenue.payload.attributionEventId), "event-4");
});

test("Org Unit fixture payload types match the real domain enum", () => {
  const fixtures = buildCatalogFixtures({
    prefix: "SMOKE",
    size: 12,
    now: NOW,
  }).filter((fixture) => fixture.module === "org-unit");
  const validTypes = new Set<string>(ORG_UNIT_TYPES);

  assert.equal(fixtures.length, 4);
  for (const fixture of fixtures) {
    assert.equal(
      validTypes.has(String(fixture.payload.type)),
      true,
      `${fixture.externalRef}:${String(fixture.payload.type)}`,
    );
  }
});

test("Studio Resource fixture payload classes match the real domain enum", () => {
  const fixtures = buildCatalogFixtures({
    prefix: "SMOKE",
    size: 12,
    now: NOW,
  }).filter((fixture) => fixture.module === "studio-resource");
  const validClasses = new Set<string>(STUDIO_RESOURCE_CLASSES);
  const classes = fixtures.map((fixture) =>
    String(fixture.payload.resourceClass),
  );

  assert.equal(fixtures.length, 5);
  assert.deepEqual(classes, [
    "SPACE",
    "EQUIPMENT",
    "EQUIPMENT",
    "KIT",
    "SPACE",
  ]);
  assert.equal(classes.includes("SPACE"), true);
  assert.equal(classes.includes("EQUIPMENT"), true);
  assert.equal(classes.includes("KIT"), true);

  for (const fixture of fixtures) {
    assert.equal(
      validClasses.has(String(fixture.payload.resourceClass)),
      true,
      `${fixture.externalRef}:${String(fixture.payload.resourceClass)}`,
    );
  }
});

test("relationship fields are resolved to internal IDs in dependency order", async () => {
  const fake = new FakeCatalogServices();

  await runCatalogFixtures(fake, {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  const childOrgUnit = fake.created.find(
    (entry) =>
      entry.module === "org-unit" &&
      entry.payload.externalRef ===
        "SMOKE:catalog:org-unit:production",
  );
  const holidayEntry = fake.created.find(
    (entry) => entry.module === "holiday-calendar-entry",
  );
  const event = fake.created.find(
    (entry) => entry.module === "event-assignment",
  );
  const commissionRule = fake.created.find(
    (entry) => entry.module === "commission-rule",
  );
  assert.ok(childOrgUnit);
  assert.ok(holidayEntry);
  assert.ok(event);
  assert.ok(commissionRule);
  assert.match(
    String(childOrgUnit.payload.parentOrgUnitId),
    /^id:org-unit:/u,
  );
  assert.match(
    String(holidayEntry.payload.holidayCalendarId),
    /^id:holiday-calendar:/u,
  );
  assert.match(
    String(
      (
        event.payload.assignments as readonly Record<
          string,
          unknown
        >[]
      )[0].assignmentTalentId,
    ),
    /^id:talent:/u,
  );
  assert.match(
    String(commissionRule.payload.sourceContractRecordId),
    /^id:contract-registry:/u,
  );

  const modules = fake.created.map((entry) => entry.module);
  assert.equal(
    modules.indexOf("org-unit") < modules.indexOf("studio-resource"),
    true,
  );
  assert.equal(
    modules.indexOf("holiday-calendar") <
      modules.indexOf("holiday-calendar-entry"),
    true,
  );
  assert.equal(
    modules.indexOf("platform-account") <
      modules.indexOf("event-assignment"),
    true,
  );
  assert.equal(
    modules.indexOf("contract-registry") <
      modules.indexOf("commission-rule"),
    true,
  );
});

test("exact existing fixture records no-op", async () => {
  const existing = new Map<string, ExistingFixtureRecord>();
  existing.set("org-unit:SMOKE:catalog:org-unit:root", {
    id: "existing-org-root",
    externalRef: "SMOKE:catalog:org-unit:root",
    payload: {
      externalRef: "SMOKE:catalog:org-unit:root",
      name: "Smoke Studios",
      type: "BUSINESS_UNIT",
      parentOrgUnitId: null,
      displayOrder: 10,
      description: "Smoke catalog root org unit",
    },
  });
  const fake = new FakeCatalogServices(existing);

  const result = await runCatalogFixtures(fake, {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(result.summaries["org-unit"].noOp, 1);
  assert.equal(
    fake.created.some(
      (entry) =>
        entry.module === "org-unit" &&
        entry.payload.externalRef ===
          "SMOKE:catalog:org-unit:root",
    ),
    false,
  );
});

test("divergent existing fixture fails closed", async () => {
  const existing = new Map<string, ExistingFixtureRecord>();
  existing.set("org-unit:SMOKE:catalog:org-unit:root", {
    id: "existing-org-root",
    externalRef: "SMOKE:catalog:org-unit:root",
    payload: {
      externalRef: "SMOKE:catalog:org-unit:root",
      name: "Divergent Smoke Studios",
      type: "BUSINESS_UNIT",
      parentOrgUnitId: null,
      displayOrder: 10,
      description: "Smoke catalog root org unit",
    },
  });

  await assert.rejects(
    runCatalogFixtures(new FakeCatalogServices(existing), {
      mode: "dry-run",
      profile: "catalog",
      prefix: "SMOKE",
      size: 12,
      dbNameClass: "smoke-like",
      now: NOW,
    }),
    /Existing smoke fixture diverges/u,
  );
});

test("exact existing Phase B and Phase C fixtures no-op and divergent fixtures fail closed", async () => {
  const exact = buildExistingFixtureRecords();
  const exactResult = await runCatalogFixtures(
    new FakeCatalogServices(exact),
    {
      mode: "write",
      profile: "catalog",
      prefix: "SMOKE",
      size: 12,
      dbNameClass: "smoke-like",
      now: NOW,
    },
  );

  for (const module of [
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
  ] as const) {
    assert.equal(exactResult.summaries[module].create, 0);
    assert.equal(exactResult.summaries[module].failed, 0);
    assert.equal(exactResult.summaries[module].noOp > 0, true);
  }

  const divergent = buildExistingFixtureRecords();
  const divergentKey =
    "revenue-ledger:SMOKE:catalog:revenue-ledger:1";
  const existing = divergent.get(divergentKey);
  assert.ok(existing);
  divergent.set(divergentKey, {
    ...existing,
    payload: {
      ...existing.payload,
      title: "Divergent Revenue Entry",
    },
  });

  await assert.rejects(
    runCatalogFixtures(new FakeCatalogServices(divergent), {
      mode: "dry-run",
      profile: "catalog",
      prefix: "SMOKE",
      size: 12,
      dbNameClass: "smoke-like",
      now: NOW,
    }),
    /Existing smoke fixture diverges/u,
  );
});

test("partial Phase C write keeps Revenue Ledger 1-4 no-op and creates missing 5 before commission rules", async () => {
  const existing = buildExistingFixtureRecords();
  existing.delete("revenue-ledger:SMOKE:catalog:revenue-ledger:5");
  existing.delete("commission-rule:SMOKE:catalog:commission-rule:1");
  existing.delete("commission-rule:SMOKE:catalog:commission-rule:2");
  const fake = new FakeCatalogServices(existing);

  const result = await runCatalogFixtures(fake, {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(result.summaries["event-assignment"].noOp, 4);
  assert.equal(result.summaries["contract-registry"].noOp, 4);
  assert.equal(result.summaries["talent-kpi"].noOp, 4);
  assert.equal(result.summaries["revenue-ledger"].noOp, 4);
  assert.equal(result.summaries["revenue-ledger"].create, 1);
  assert.equal(result.summaries["commission-rule"].create, 2);

  const revenueCreates = fake.created.filter(
    (entry) => entry.module === "revenue-ledger",
  );
  assert.equal(revenueCreates.length, 1);
  assert.equal(
    revenueCreates[0].payload.externalRef,
    "SMOKE:catalog:revenue-ledger:5",
  );
  assert.equal(
    revenueCreates[0].payload.subjectTalentId,
    "existing:talent-4",
  );
  assert.equal(
    revenueCreates[0].payload.attributionEventId,
    "existing:event-4",
  );

  const createdModules = fake.created.map((entry) => entry.module);
  assert.equal(
    createdModules.indexOf("revenue-ledger") <
      createdModules.indexOf("commission-rule"),
    true,
  );
});

test("divergent existing Revenue Ledger fixture 5 fails closed", async () => {
  const existing = buildExistingFixtureRecords();
  const divergentKey =
    "revenue-ledger:SMOKE:catalog:revenue-ledger:5";
  const revenue = existing.get(divergentKey);
  assert.ok(revenue);
  existing.set(divergentKey, {
    ...revenue,
    payload: {
      ...revenue.payload,
      subjectTalentId: "existing:talent-5",
    },
  });

  await assert.rejects(
    runCatalogFixtures(new FakeCatalogServices(existing), {
      mode: "dry-run",
      profile: "catalog",
      prefix: "SMOKE",
      size: 12,
      dbNameClass: "smoke-like",
      now: NOW,
    }),
    /Existing smoke fixture diverges/u,
  );
});

test("module failures expose app error code and safe message only", async () => {
  await assert.rejects(
    runCatalogFixtures(
      new ThrowingStudioResourceCreateServices(
        new StudioResourceValidationError(
          "resourceClass leaked mongodb://user:pass@example.test/db token=secret",
        ),
      ),
      {
        mode: "write",
        profile: "catalog",
        prefix: "SMOKE",
        size: 12,
        dbNameClass: "smoke-like",
        now: NOW,
      },
    ),
    (error) => {
      assert.ok(error instanceof SmokeFixtureError);
      assert.equal(error.code, "SMOKE_FIXTURE_MODULE_FAILED");
      assert.match(error.message, /module=studio-resource/u);
      assert.match(error.message, /action=create/u);
      assert.match(
        error.message,
        /errorName=StudioResourceValidationError/u,
      );
      assert.match(
        error.message,
        /errorCode=STUDIO_RESOURCE_VALIDATION_ERROR/u,
      );
      assert.match(
        error.message,
        /safeMessage=Invalid studio resource payload/u,
      );
      assert.equal(error.message.includes("mongodb://"), false);
      assert.equal(error.message.includes("token=secret"), false);
      return true;
    },
  );
});

test("module failures keep unknown errors generic and secret-free", async () => {
  await assert.rejects(
    runCatalogFixtures(
      new ThrowingStudioResourceCreateServices(
        new Error(
          "connect mongodb://user:pass@example.test/db AUTH0_SECRET=abc cookie=def",
        ),
      ),
      {
        mode: "write",
        profile: "catalog",
        prefix: "SMOKE",
        size: 12,
        dbNameClass: "smoke-like",
        now: NOW,
      },
    ),
    (error) => {
      assert.ok(error instanceof SmokeFixtureError);
      assert.equal(error.code, "SMOKE_FIXTURE_MODULE_FAILED");
      assert.match(error.message, /module=studio-resource/u);
      assert.match(error.message, /action=create/u);
      assert.match(error.message, /errorName=Error/u);
      assert.match(
        error.message,
        /safeMessage=Unexpected fixture module error/u,
      );
      assert.equal(error.message.includes("mongodb://"), false);
      assert.equal(error.message.includes("AUTH0_SECRET"), false);
      assert.equal(error.message.includes("cookie=def"), false);
      assert.equal(error.message.includes("connect "), false);
      assert.equal(error.message.includes("at "), false);
      return true;
    },
  );
});

test("fixture source has no destructive data repair operations", () => {
  const source = readFixtureSource();
  for (const token of [
    "delete" + "Many",
    "drop" + "Database",
    "drop" + "Collection",
    "bulk" + "Write",
    "update" + "Many",
    "findOne" + "AndUpdate",
    "delete" + "One",
    "update" + "One",
  ]) {
    assert.equal(source.includes(token), false, token);
  }
});

test("fixture source has no Redis, Auth0, frontend env, or local mock dependency", () => {
  const source = readFixtureSource();
  assert.equal(source.includes("REDIS_" + "URL"), false);
  assert.equal(source.includes("AUTH0_" + "CLIENT_SECRET"), false);
  assert.equal(source.includes("VITE_" + "AUTH_MODE"), false);
  assert.equal(source.includes("mock-" + "access-token"), false);
});

test("help output does not include secret-looking input values", async () => {
  const lines: string[] = [];
  await runCli(["--help"], baseEnv(), {
    log(message?: unknown) {
      lines.push(String(message ?? ""));
    },
    error() {
      throw new Error("unexpected error output");
    },
  });

  const output = lines.join("\n");
  assert.equal(output.includes("mongodb://" + "user:pass"), false);
  assert.equal(output.includes("redis://" + ":secret"), false);
  assert.equal(output.includes("auth0-client-secret"), false);
});

test("fixture actor is an admin actor", () => {
  const actor = createSmokeFixtureActor();
  assert.equal(actor.type, "admin");
  assert.equal(actor.id, "smoke-fixture-actor");
});

test("commission settlement and dashboard projection are skipped by default", async () => {
  const result = await runCatalogFixtures(new FakeCatalogServices(), {
    mode: "dry-run",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(result.summaries["commission-settlement"].skipped, 1);
  assert.equal(result.summaries["dashboard-lite"].skipped, 1);
});

test("work schedule workflow service methods are absent from fixture services", async () => {
  const fake = new FakeCatalogServices();

  await runCatalogFixtures(fake, {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(
    fake.created.some(
      (entry) =>
        entry.module === "work-pattern" ||
        entry.module === "holiday-calendar",
    ),
    true,
  );
  assert.equal(
    fake.created.some((entry) => entry.module === "monthly-roster"),
    false,
  );
  assert.equal(
    fake.created.some((entry) => entry.module === "work-shift"),
    false,
  );
  assert.equal(
    fake.created
      .filter((entry) => entry.module === "event-assignment")
      .some((entry) => "workShiftId" in entry.payload),
    false,
  );
});

test("help-size source has no node test focus markers", () => {
  const source = readFixtureSource();
  assert.equal(source.includes(".on" + "ly("), false);
  assert.equal(source.includes("test.on" + "ly"), false);
  assert.equal(source.includes("describe.on" + "ly"), false);
  assert.equal(source.includes(".s" + "kip("), false);
  assert.equal(source.includes("test.s" + "kip"), false);
  assert.equal(source.includes("describe.s" + "kip"), false);
});

function assertNoReferenceTokens(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertNoReferenceTokens(entry);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  assert.equal(
    Object.prototype.hasOwnProperty.call(value, "__fixtureRef"),
    false,
  );

  for (const child of Object.values(value)) {
    assertNoReferenceTokens(child);
  }
}

function deepKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => deepKeys(entry));
  }

  if (value === null || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...deepKeys(child),
  ]);
}

function readFixtureRef(value: unknown): string {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { __fixtureRef?: unknown }).__fixtureRef ===
      "string"
  ) {
    return (value as { __fixtureRef: string }).__fixtureRef;
  }

  throw new Error("Expected fixture reference token");
}

function readFixtureRefArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Expected fixture reference token array");
  }

  return value.map((entry) => readFixtureRef(entry));
}

function hasTalentAssignment(
  assignments: unknown,
  subjectTalentRef: string,
): boolean {
  if (!Array.isArray(assignments)) {
    throw new Error("Expected event assignment array");
  }

  return assignments.some(
    (assignment) =>
      assignment !== null &&
      typeof assignment === "object" &&
      !Array.isArray(assignment) &&
      (assignment as Record<string, unknown>).assignmentKind ===
        "TALENT" &&
      readFixtureRef(
        (assignment as Record<string, unknown>).assignmentTalentId,
      ) === subjectTalentRef,
  );
}

function buildExistingFixtureRecords(): Map<
  string,
  ExistingFixtureRecord
> {
  const existing = new Map<string, ExistingFixtureRecord>();
  const ids = new Map<string, string>();
  const phaseCModules = new Set([
    "org-unit",
    "employment-profile",
    "talent",
    "talent-group",
    "talent-group-member",
    "platform-account",
    "studio-resource",
    "work-pattern",
    "holiday-calendar",
    "holiday-calendar-entry",
    "event-assignment",
    "contract-registry",
    "talent-kpi",
    "revenue-ledger",
    "commission-rule",
  ]);

  for (const fixture of buildCatalogFixtures({
    prefix: "SMOKE",
    size: 12,
    now: NOW,
  })) {
    if (
      fixture.payload.__skipReason ||
      !phaseCModules.has(fixture.module)
    ) {
      continue;
    }

    const missingDependency = fixture.dependsOn?.find(
      (key) => !ids.has(key),
    );
    if (missingDependency) {
      continue;
    }

    const id = `existing:${fixture.key}`;
    const payload = resolveTestFixturePayload(
      fixture.payload,
      ids,
    );
    ids.set(fixture.key, id);
    existing.set(`${fixture.module}:${fixture.externalRef}`, {
      id,
      externalRef: fixture.externalRef,
      payload,
    });
  }

  return existing;
}

function resolveTestFixturePayload(
  value: unknown,
  ids: ReadonlyMap<string, string>,
): FixturePayload {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("Expected fixture payload object");
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      resolveTestFixtureValue(child, ids),
    ]),
  );
}

function resolveTestFixtureValue(
  value: unknown,
  ids: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      resolveTestFixtureValue(entry, ids),
    );
  }

  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { __fixtureRef?: unknown }).__fixtureRef ===
      "string"
  ) {
    const resolved = ids.get(
      (value as { __fixtureRef: string }).__fixtureRef,
    );
    if (!resolved) {
      throw new Error("Missing test fixture relationship");
    }
    return resolved;
  }

  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return resolveTestFixturePayload(value, ids);
  }

  return value;
}

function readFixtureSource(): string {
  return readFileSync(
    __filename.replace(/\.test\.ts$/u, ".ts"),
    "utf8",
  );
}
