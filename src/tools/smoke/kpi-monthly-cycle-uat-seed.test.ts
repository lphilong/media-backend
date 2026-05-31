import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  applyLinkedUserSeedResolutions,
  buildKpiMonthlyCycleUatSeedPlan,
  formatPublicSeedPlan,
  KpiMonthlyCycleUatSeedRepository,
  LinkedUserSeedResolution,
  parseKpiMonthlyCycleUatSeedCliOptions,
  SeedRecord,
  toPublicSeedPlan,
  validateSeedWriteEnv,
  writeKpiMonthlyCycleUatSeedPlan,
} from "./kpi-monthly-cycle-uat-seed";

const NOW = Date.UTC(2026, 4, 15, 0, 0, 0);

interface FakeUser {
  readonly _id: string;
  readonly actorKind: "ADMIN" | "STAFF";
  readonly accountStatus: "ACTIVE" | "DISABLED" | "PENDING" | "ARCHIVED";
}

interface FakeEmploymentProfile {
  readonly _id: string;
  readonly linkedUserId: string | null;
  readonly employmentStatus: "ACTIVE" | "TERMINATED" | "ARCHIVED";
  readonly displayName?: string;
}

interface FakeTalent {
  readonly _id: string;
  readonly linkedEmploymentProfileId: string | null;
  readonly talentOrigin: "INTERNAL" | "EXTERNAL";
  readonly operationalStatus: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "ARCHIVED";
}

class FakeSeedRepository implements KpiMonthlyCycleUatSeedRepository {
  readonly insertedRecords: SeedRecord[] = [];

  constructor(
    private readonly users: readonly FakeUser[] = [],
    private readonly employmentProfiles: readonly FakeEmploymentProfile[] = [],
    private readonly talents: readonly FakeTalent[] = [],
  ) {}

  async resolveLinkedUserForSeed(input: {
    readonly purpose: "manager" | "staff";
    readonly linkedUserId: string;
    readonly seedEmploymentProfileId: string;
  }): Promise<LinkedUserSeedResolution> {
    const label = input.purpose === "manager" ? "Manager" : "Staff";
    const user = this.users.find((item) => item._id === input.linkedUserId);
    if (!user) {
      throw new Error(`${label} linked user does not exist`);
    }
    if (user.accountStatus !== "ACTIVE") {
      throw new Error(`${label} linked user must be ACTIVE`);
    }
    if (input.purpose === "staff" && user.actorKind !== "STAFF") {
      throw new Error("Staff linked user is not self-service compatible");
    }

    const profiles = this.employmentProfiles.filter(
      (item) =>
        item.linkedUserId === input.linkedUserId &&
        item.employmentStatus !== "ARCHIVED",
    );
    if (profiles.length > 1) {
      throw new Error(
        `${label} linked user has ambiguous existing EmploymentProfile linkage`,
      );
    }
    const profile = profiles[0];
    if (!profile) {
      return {
        purpose: input.purpose,
        linkedUserId: input.linkedUserId,
        actorKind: user.actorKind,
        employmentProfileId: input.seedEmploymentProfileId,
        employmentProfileSource: "seed",
      };
    }

    const result: LinkedUserSeedResolution = {
      purpose: input.purpose,
      linkedUserId: input.linkedUserId,
      actorKind: user.actorKind,
      employmentProfileId: profile._id,
      employmentProfileSource: "existing",
      ...(profile.displayName
        ? { employmentProfileDisplayName: profile.displayName }
        : {}),
    };
    if (input.purpose !== "staff") {
      return result;
    }

    const linkedTalents = this.talents.filter(
      (item) =>
        item.linkedEmploymentProfileId === profile._id &&
        item.operationalStatus !== "ARCHIVED",
    );
    if (linkedTalents.length > 1) {
      throw new Error("Staff linked user has ambiguous existing Talent linkage");
    }
    const talent = linkedTalents[0];
    if (!talent) {
      return result;
    }
    if (talent.talentOrigin !== "INTERNAL") {
      throw new Error("Staff linked user has ambiguous existing Talent linkage");
    }
    return { ...result, linkedInternalTalentId: talent._id };
  }

  async ensureInsertOnly(record: SeedRecord): Promise<"created" | "no-op"> {
    this.insertedRecords.push(record);
    return "created";
  }
}

class DivergentSeedRepository extends FakeSeedRepository {
  override async ensureInsertOnly(record: SeedRecord): Promise<"created" | "no-op"> {
    throw new Error(
      `Existing UAT record diverges; refusing rewrite: ${record.key}`,
    );
  }
}

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    ALLOW_KPI_UAT_SEED: "true",
    NODE_ENV: "development",
    APP_ENV: "development",
    MONGO_URI: "mongodb://localhost:27017/media_dev",
    MONGO_DB_NAME: "media_dev",
    ...overrides,
  };
}

function findInsertedRecord(
  repository: FakeSeedRepository,
  key: string,
): SeedRecord {
  const record = repository.insertedRecords.find((item) => item.key === key);
  assert.ok(record, `Expected inserted seed record: ${key}`);
  return record;
}

test("KPI UAT seed CLI defaults to dry-run monthly-cycle", () => {
  assert.deepEqual(parseKpiMonthlyCycleUatSeedCliOptions([]), {
    mode: "dry-run",
    scenario: "monthly-cycle",
    seedKey: "KPI-UAT",
    includeLegacyActive: false,
    json: false,
    help: false,
  });
});

test("KPI UAT seed write requires env file and rejects production override", () => {
  assert.throws(
    () => parseKpiMonthlyCycleUatSeedCliOptions(["--write"]),
    /requires --env-file/u,
  );
  assert.throws(
    () =>
      parseKpiMonthlyCycleUatSeedCliOptions([
        "--write",
        "--env-file",
        ".env.dev",
        "--allow-production",
      ]),
    /Production write is forbidden/u,
  );
});

test("KPI UAT seed write env refuses production-looking targets", () => {
  assert.throws(
    () =>
      validateSeedWriteEnv(
        baseEnv({
          NODE_ENV: "production",
          MONGO_DB_NAME: "media_prod",
        }),
        ".env.dev",
      ),
    /Production write is forbidden/u,
  );
  assert.equal(
    validateSeedWriteEnv(
      baseEnv({
        NODE_ENV: "development",
        APP_ENV: "staging",
        MONGO_DB_NAME: "media_staging",
      }),
      ".env.staging",
    ).mongoDbName,
    "media_staging",
  );
});

test("KPI UAT seed dry-run plan covers monthly lifecycle and published actual", () => {
  const plan = buildKpiMonthlyCycleUatSeedPlan({
    seedKey: "KPI-UAT",
    now: NOW,
    includeLegacyActive: true,
  });
  const publicPlan = toPublicSeedPlan(plan, "dry-run");
  assert.equal(publicPlan.periodMonth, "2026-05");
  assert.deepEqual(publicPlan.allocationStatuses, [
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "PUBLISHED",
    "REJECTED",
    "ACTIVE",
  ]);
  assert.equal(publicPlan.countsByCollection.kpi_actual_entries, 1);
  assert.equal(
    plan.records.find(
      (record) => record.collection === "kpi_actual_entries",
    )?.document.actualDate,
    "01-05-2026",
  );
  assert.equal(
    publicPlan.countsByCollection.talent_group_manager_assignments,
    1,
  );
});

test("KPI UAT seed accepts manager linked ACTIVE ADMIN user with existing EmploymentProfile", async () => {
  const repository = new FakeSeedRepository(
    [
      {
        _id: "user-manager-admin",
        actorKind: "ADMIN",
        accountStatus: "ACTIVE",
      },
    ],
    [
      {
        _id: "ep-existing-manager",
        linkedUserId: "user-manager-admin",
        employmentStatus: "ACTIVE",
      },
    ],
  );

  await writeKpiMonthlyCycleUatSeedPlan(
    repository,
    buildKpiMonthlyCycleUatSeedPlan({
      seedKey: "KPI-UAT",
      now: NOW,
      managerLinkedUserId: "user-manager-admin",
    }),
    { managerLinkedUserId: "user-manager-admin" },
  );

  assert.equal(
    repository.insertedRecords.some(
      (record) => record.key === "support.manager-employment-profile",
    ),
    false,
  );
  assert.equal(
    findInsertedRecord(repository, "support.manager-assignment").document
      .managerEmploymentProfileId,
    "ep-existing-manager",
  );
  assert.equal(
    findInsertedRecord(repository, "member.published.employment-profile")
      .document.managerEmploymentProfileId,
    "ep-existing-manager",
  );
});

test("KPI UAT seed does not require STAFF actorKind for unlinked manager user", async () => {
  const repository = new FakeSeedRepository([
    {
      _id: "user-manager-admin",
      actorKind: "ADMIN",
      accountStatus: "ACTIVE",
    },
  ]);

  await writeKpiMonthlyCycleUatSeedPlan(
    repository,
    buildKpiMonthlyCycleUatSeedPlan({
      seedKey: "KPI-UAT",
      now: NOW,
      managerLinkedUserId: "user-manager-admin",
    }),
    { managerLinkedUserId: "user-manager-admin" },
  );

  assert.equal(
    findInsertedRecord(repository, "support.manager-employment-profile")
      .document.linkedUserId,
    "user-manager-admin",
  );
});

test("KPI UAT seed keeps staff linked user self-service compatible", async () => {
  const repository = new FakeSeedRepository([
    {
      _id: "user-staff-admin",
      actorKind: "ADMIN",
      accountStatus: "ACTIVE",
    },
  ]);

  await assert.rejects(
    () =>
      writeKpiMonthlyCycleUatSeedPlan(
        repository,
        buildKpiMonthlyCycleUatSeedPlan({
          seedKey: "KPI-UAT",
          now: NOW,
          staffLinkedUserId: "user-staff-admin",
        }),
        { staffLinkedUserId: "user-staff-admin" },
      ),
    /Staff linked user is not self-service compatible/u,
  );
});

test("KPI UAT seed reuses existing staff EmploymentProfile and INTERNAL Talent", async () => {
  const repository = new FakeSeedRepository(
    [
      {
        _id: "user-staff",
        actorKind: "STAFF",
        accountStatus: "ACTIVE",
      },
    ],
    [
      {
        _id: "ep-existing-staff",
        linkedUserId: "user-staff",
        employmentStatus: "ACTIVE",
        displayName: "Existing Staff",
      },
    ],
    [
      {
        _id: "tal-existing-staff",
        linkedEmploymentProfileId: "ep-existing-staff",
        talentOrigin: "INTERNAL",
        operationalStatus: "ACTIVE",
      },
    ],
  );

  await writeKpiMonthlyCycleUatSeedPlan(
    repository,
    buildKpiMonthlyCycleUatSeedPlan({
      seedKey: "KPI-UAT",
      now: NOW,
      staffLinkedUserId: "user-staff",
    }),
    { staffLinkedUserId: "user-staff" },
  );

  assert.equal(
    repository.insertedRecords.some(
      (record) => record.key === "member.published.employment-profile",
    ),
    false,
  );
  assert.equal(
    repository.insertedRecords.some(
      (record) => record.key === "member.published.talent",
    ),
    false,
  );
  assert.equal(
    findInsertedRecord(repository, "member.published.membership").document
      .talentId,
    "tal-existing-staff",
  );
  const allocation = findInsertedRecord(
    repository,
    "monthly.published.allocation",
  ).document;
  assert.equal(allocation.memberEmploymentProfileId, "ep-existing-staff");
  assert.equal(allocation.memberTalentId, "tal-existing-staff");
  assert.equal(allocation.snapshotMemberDisplayName, "Existing Staff");
  assert.equal(
    findInsertedRecord(repository, "monthly.published.actual-entry").document
      .memberTalentId,
    "tal-existing-staff",
  );
});

test("KPI UAT seed refuses duplicate non-archived linked EmploymentProfile state", async () => {
  const repository = new FakeSeedRepository(
    [
      {
        _id: "user-staff",
        actorKind: "STAFF",
        accountStatus: "ACTIVE",
      },
    ],
    [
      {
        _id: "ep-existing-staff-1",
        linkedUserId: "user-staff",
        employmentStatus: "ACTIVE",
      },
      {
        _id: "ep-existing-staff-2",
        linkedUserId: "user-staff",
        employmentStatus: "TERMINATED",
      },
    ],
  );

  await assert.rejects(
    () =>
      writeKpiMonthlyCycleUatSeedPlan(
        repository,
        buildKpiMonthlyCycleUatSeedPlan({
          seedKey: "KPI-UAT",
          now: NOW,
          staffLinkedUserId: "user-staff",
        }),
        { staffLinkedUserId: "user-staff" },
      ),
    /ambiguous existing EmploymentProfile linkage/u,
  );
  assert.equal(repository.insertedRecords.length, 0);
});

test("KPI UAT seed still fails closed on divergent existing seed records", async () => {
  await assert.rejects(
    () =>
      writeKpiMonthlyCycleUatSeedPlan(
        new DivergentSeedRepository(),
        buildKpiMonthlyCycleUatSeedPlan({
          seedKey: "KPI-UAT",
          now: NOW,
        }),
        {},
      ),
    /Existing UAT record diverges; refusing rewrite: support\.org-unit/u,
  );
});

test("KPI UAT seed fails closed when existing staff Talent reuse is ambiguous", () => {
  assert.throws(
    () =>
      applyLinkedUserSeedResolutions(
        buildKpiMonthlyCycleUatSeedPlan({
          seedKey: "KPI-UAT",
          now: NOW,
          staffLinkedUserId: "user-staff",
        }),
        {
          staff: {
            purpose: "staff",
            linkedUserId: "user-staff",
            actorKind: "STAFF",
            employmentProfileId: "ep-existing-staff",
            employmentProfileSource: "existing",
          },
        },
      ),
    /existing EmploymentProfile without a reusable INTERNAL Talent/u,
  );
});

test("KPI UAT seed help text preserves dry-run write no-op discipline", () => {
  const source = readFileSync(
    "src/tools/smoke/kpi-monthly-cycle-uat-seed.ts",
    "utf8",
  );
  assert.match(source, /Always run dry-run before write/u);
  assert.match(source, /expect insert-only no-op behavior/u);
  assert.match(source, /do not rerun write blindly/u);
});

test("KPI UAT dry-run output exposes summaries only", () => {
  const output = formatPublicSeedPlan(
    toPublicSeedPlan(
      buildKpiMonthlyCycleUatSeedPlan({
        seedKey: "KPI-UAT",
        now: NOW,
      }),
      "dry-run",
    ),
  );
  assert.match(output, /plannedRecords/u);
  for (const forbidden of [
    "legalName",
    "snapshotMemberDisplayName",
    "actualValue",
    "linkedUserId",
    "createdByActorId",
  ]) {
    assert.doesNotMatch(output, new RegExp(forbidden, "u"));
  }
});

test("KPI package scripts do not embed runtime modes", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    readonly scripts?: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts?.["kpi:allocation-data-smoke"],
    "ts-node -r tsconfig-paths/register src/tools/diagnostics/kpi-allocation-data-smoke.ts",
  );
  assert.equal(
    packageJson.scripts?.["kpi:monthly-cycle-uat-seed"],
    "ts-node -r tsconfig-paths/register src/tools/smoke/kpi-monthly-cycle-uat-seed.ts",
  );
  assert.doesNotMatch(
    packageJson.scripts?.["kpi:monthly-cycle-uat-seed"] ?? "",
    /--write/u,
  );
});
