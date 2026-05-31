import path from "node:path";

import dotenv from "dotenv";
import { Db, MongoClient, MongoClientOptions } from "mongodb";

const BASE_ALLOCATION_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "PUBLISHED",
  "REJECTED",
] as const;
const WRITE_ENV_FILES = new Set([".env.dev", ".env.stage", ".env.staging"]);
const SEED_ACTOR_ID = "kpi-monthly-cycle-uat-seed";

type SeedMode = "dry-run" | "write";
type AllocationStatus =
  | (typeof BASE_ALLOCATION_STATUSES)[number]
  | "ACTIVE";

export interface KpiMonthlyCycleUatSeedCliOptions {
  readonly mode: SeedMode;
  readonly scenario: "monthly-cycle";
  readonly seedKey: string;
  readonly includeLegacyActive: boolean;
  readonly json: boolean;
  readonly envFile?: string;
  readonly managerLinkedUserId?: string;
  readonly staffLinkedUserId?: string;
  readonly help: boolean;
}

export interface SeedRecord {
  readonly collection: string;
  readonly key: string;
  readonly document: Readonly<Record<string, unknown>>;
}

export interface KpiMonthlyCycleUatSeedPlan {
  readonly scenario: "monthly-cycle";
  readonly seedKey: string;
  readonly periodMonth: string;
  readonly includeLegacyActive: boolean;
  readonly records: readonly SeedRecord[];
  readonly warnings: readonly string[];
}

export interface PublicSeedPlan {
  readonly mode: SeedMode;
  readonly scenario: "monthly-cycle";
  readonly seedKey: string;
  readonly periodMonth: string;
  readonly includeLegacyActive: boolean;
  readonly countsByCollection: Readonly<Record<string, number>>;
  readonly allocationStatuses: readonly AllocationStatus[];
  readonly plannedRecords: readonly {
    readonly collection: string;
    readonly key: string;
  }[];
  readonly warnings: readonly string[];
  readonly writeResult?: {
    readonly created: number;
    readonly noOp: number;
  };
}

export interface KpiMonthlyCycleUatSeedRepository {
  assertLinkedUserEligible(
    linkedUserId: string,
    employmentProfileId: string,
  ): Promise<void>;
  ensureInsertOnly(record: SeedRecord): Promise<"created" | "no-op">;
}

interface SeedWriteRuntimeEnv {
  readonly mongoUri: string;
  readonly mongoDbName: string;
  readonly mongoMaxPoolSize: number;
}

interface SeedWriteEnvSource {
  readonly [key: string]: string | undefined;
  readonly ALLOW_KPI_UAT_SEED?: string;
  readonly NODE_ENV?: string;
  readonly APP_ENV?: string;
  readonly DEPLOY_ENV?: string;
  readonly MONGO_URI?: string;
  readonly MONGO_DB_NAME?: string;
  readonly MONGO_MAX_POOL_SIZE?: string;
}

export class NativeMongoKpiMonthlyCycleUatSeedRepository
  implements KpiMonthlyCycleUatSeedRepository
{
  constructor(private readonly db: Db) {}

  async assertLinkedUserEligible(
    linkedUserId: string,
    employmentProfileId: string,
  ): Promise<void> {
    const user = await this.db.collection<StringIdDocument>("users").findOne({
      _id: linkedUserId,
      actorKind: "STAFF",
      accountStatus: "ACTIVE",
    });
    if (!user) {
      throw new Error(
        "Linked UAT user must reference an existing ACTIVE STAFF user",
      );
    }
    const conflictingProfile = await this.db
      .collection<StringIdDocument>("employment_profiles")
      .findOne({
        linkedUserId,
        employmentStatus: { $ne: "ARCHIVED" },
        _id: { $ne: employmentProfileId },
      });
    if (conflictingProfile) {
      throw new Error(
        "Linked UAT user already belongs to another non-archived EmploymentProfile",
      );
    }
  }

  async ensureInsertOnly(record: SeedRecord): Promise<"created" | "no-op"> {
    const id = String(record.document._id);
    const collection = this.db.collection<StringIdDocument>(
      record.collection,
    );
    const existing = await collection.findOne({ _id: id });
    if (existing) {
      if (!plainObjectsEqual(existing, record.document)) {
        throw new Error(
          `Existing UAT record diverges; refusing rewrite: ${record.key}`,
        );
      }
      return "no-op";
    }
    const result = await collection.updateOne(
      { _id: id },
      { $setOnInsert: record.document },
      { upsert: true },
    );
    return result.upsertedCount === 1 ? "created" : "no-op";
  }
}

interface StringIdDocument {
  readonly _id: string;
  readonly [key: string]: unknown;
}

export function parseKpiMonthlyCycleUatSeedCliOptions(
  args: readonly string[],
): KpiMonthlyCycleUatSeedCliOptions {
  let mode: SeedMode = "dry-run";
  let scenario: "monthly-cycle" = "monthly-cycle";
  let seedKey = "KPI-UAT";
  let includeLegacyActive = false;
  let json = false;
  let envFile: string | undefined;
  let managerLinkedUserId: string | undefined;
  let staffLinkedUserId: string | undefined;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      if (mode === "write") {
        throw new Error("Use either --dry-run or --write, not both");
      }
      mode = "dry-run";
      continue;
    }
    if (arg === "--write") {
      if (args.includes("--dry-run")) {
        throw new Error("Use either --dry-run or --write, not both");
      }
      mode = "write";
      continue;
    }
    if (arg === "--include-legacy-active") {
      includeLegacyActive = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--allow-production") {
      throw new Error("Production write is forbidden for KPI UAT seed");
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (
      arg === "--env-file" ||
      arg === "--scenario" ||
      arg === "--seed-key" ||
      arg === "--manager-linked-user-id" ||
      arg === "--staff-linked-user-id"
    ) {
      const value = readRequiredArg(args, index, arg);
      if (arg === "--env-file") {
        envFile = value;
      } else if (arg === "--scenario") {
        if (value !== "monthly-cycle") {
          throw new Error("Only --scenario monthly-cycle is supported");
        }
        scenario = value;
      } else if (arg === "--seed-key") {
        seedKey = normalizeSeedKey(value);
      } else if (arg === "--manager-linked-user-id") {
        managerLinkedUserId = value.trim();
      } else {
        staffLinkedUserId = value.trim();
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!help && mode === "write" && !envFile) {
    throw new Error("KPI UAT seed write mode requires --env-file");
  }
  return {
    mode,
    scenario,
    seedKey,
    includeLegacyActive,
    json,
    ...(envFile ? { envFile } : {}),
    ...(managerLinkedUserId ? { managerLinkedUserId } : {}),
    ...(staffLinkedUserId ? { staffLinkedUserId } : {}),
    help,
  };
}

export function buildKpiMonthlyCycleUatSeedPlan(params: {
  readonly seedKey: string;
  readonly now?: number;
  readonly includeLegacyActive?: boolean;
  readonly managerLinkedUserId?: string;
  readonly staffLinkedUserId?: string;
}): KpiMonthlyCycleUatSeedPlan {
  const seedKey = normalizeSeedKey(params.seedKey);
  const now = params.now ?? Date.now();
  const supportAt = Date.UTC(2020, 0, 1);
  const period = createPeriod(now);
  const statuses: readonly AllocationStatus[] = params.includeLegacyActive
    ? [...BASE_ALLOCATION_STATUSES, "ACTIVE"]
    : BASE_ALLOCATION_STATUSES;
  const stable = (suffix: string) =>
    `${seedKey.toLowerCase()}:${suffix.toLowerCase()}`;
  const monthly = (suffix: string) =>
    `${seedKey.toLowerCase()}:${period.periodMonth}:${suffix.toLowerCase()}`;
  const orgUnitId = stable("org-unit");
  const groupId = stable("talent-group");
  const managerEmploymentProfileId = stable("employment-profile:manager");
  const records: SeedRecord[] = [];
  const add = (
    collection: string,
    key: string,
    document: Readonly<Record<string, unknown>>,
  ) => records.push({ collection, key, document });

  add("org_units", "support.org-unit", {
    _id: orgUnitId,
    code: `${seedKey}-OU`,
    searchCode: `${seedKey}-OU`,
    name: `${seedKey} Monthly Cycle`,
    normalizedName: `${seedKey.toLowerCase()} monthly cycle`,
    type: "TEAM",
    status: "ACTIVE",
    parentOrgUnitId: null,
    ancestorChain: [],
    depth: 0,
    displayOrder: 9000,
    description: "UAT demo org unit",
    externalRef: stable("org-unit"),
    createdAt: supportAt,
    updatedAt: supportAt,
  });
  add("talent_groups", "support.talent-group", {
    _id: groupId,
    groupCode: `${seedKey}-TG`,
    name: `${seedKey} Monthly Cycle`,
    normalizedName: `${seedKey.toLowerCase()} monthly cycle`,
    shortName: `${seedKey} KPI`,
    normalizedShortName: `${seedKey.toLowerCase()} kpi`,
    description: "UAT demo KPI monthly-cycle group",
    externalRef: stable("talent-group"),
    status: "ACTIVE",
    displayOrder: 9000,
    createdAt: supportAt,
    updatedAt: supportAt,
  });
  add("employment_profiles", "support.manager-employment-profile", {
    _id: managerEmploymentProfileId,
    employeeCode: `${seedKey}-EP-MANAGER`,
    legalName: `${seedKey} Demo Manager`,
    normalizedLegalName: `${seedKey.toLowerCase()} demo manager`,
    displayName: `${seedKey} Demo Manager`,
    normalizedDisplayName: `${seedKey.toLowerCase()} demo manager`,
    employmentKind: "EMPLOYEE",
    jobTitle: "UAT KPI Manager",
    titleDescription: "UAT demo record",
    externalRef: stable("employment-profile:manager"),
    orgUnitId,
    managerEmploymentProfileId: null,
    recruiterEmploymentProfileId: null,
    hrOwnerEmploymentProfileId: null,
    onboardingOwnerEmploymentProfileId: null,
    sourcedByEmploymentProfileId: null,
    linkedUserId: params.managerLinkedUserId ?? null,
    employmentStatus: "ACTIVE",
    contractStatus: "ACTIVE",
    employmentStartDate: supportAt,
    employmentEndDate: null,
    hiredAt: supportAt,
    onboardedAt: supportAt,
    createdAt: supportAt,
    updatedAt: supportAt,
  });
  add("talent_group_manager_assignments", "support.manager-assignment", {
    _id: stable("manager-assignment"),
    groupId,
    managerEmploymentProfileId,
    role: "MANAGER",
    effectiveFrom: supportAt,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: true,
    createdAt: supportAt,
    createdByActorId: SEED_ACTOR_ID,
    updatedAt: supportAt,
    updatedByActorId: SEED_ACTOR_ID,
  });

  for (const [index, status] of statuses.entries()) {
    const suffix = status.toLowerCase().replace(/_/gu, "-");
    const employmentProfileId = stable(`employment-profile:${suffix}`);
    const talentId = stable(`talent:${suffix}`);
    const membershipId = stable(`membership:${suffix}`);
    const kpiPlanId = monthly(`plan:${suffix}`);
    const allocationId = monthly(`allocation:${suffix}`);
    const isPublished = status === "PUBLISHED";
    const submittedAt =
      status === "PENDING_APPROVAL" ||
      status === "APPROVED" ||
      status === "PUBLISHED" ||
      status === "REJECTED"
        ? period.periodStartAt
        : null;
    const approvedAt =
      status === "APPROVED" || status === "PUBLISHED"
        ? period.periodStartAt
        : null;
    const rejectedAt = status === "REJECTED" ? period.periodStartAt : null;

    add("employment_profiles", `member.${suffix}.employment-profile`, {
      _id: employmentProfileId,
      employeeCode: `${seedKey}-EP-${index + 1}`,
      legalName: `${seedKey} Demo Member ${index + 1}`,
      normalizedLegalName: `${seedKey.toLowerCase()} demo member ${index + 1}`,
      displayName: `${seedKey} Demo Member ${index + 1}`,
      normalizedDisplayName: `${seedKey.toLowerCase()} demo member ${index + 1}`,
      employmentKind: "EMPLOYEE",
      jobTitle: "UAT KPI Talent",
      titleDescription: "UAT demo record",
      externalRef: stable(`employment-profile:${suffix}`),
      orgUnitId,
      managerEmploymentProfileId,
      recruiterEmploymentProfileId: null,
      hrOwnerEmploymentProfileId: null,
      onboardingOwnerEmploymentProfileId: null,
      sourcedByEmploymentProfileId: null,
      linkedUserId:
        isPublished && params.staffLinkedUserId
          ? params.staffLinkedUserId
          : null,
      employmentStatus: "ACTIVE",
      contractStatus: "ACTIVE",
      employmentStartDate: supportAt,
      employmentEndDate: null,
      hiredAt: supportAt,
      onboardedAt: supportAt,
      createdAt: supportAt,
      updatedAt: supportAt,
    });
    add("talents", `member.${suffix}.talent`, {
      _id: talentId,
      talentCode: `${seedKey}-TAL-${index + 1}`,
      stageName: "",
      normalizedStageName: "",
      legalName: `${seedKey} Demo Member ${index + 1}`,
      normalizedLegalName: `${seedKey.toLowerCase()} demo member ${index + 1}`,
      displayShortName: null,
      normalizedDisplayShortName: null,
      talentOrigin: "INTERNAL",
      operationalStatus: "ACTIVE",
      managerEmploymentProfileId,
      linkedEmploymentProfileId: employmentProfileId,
      commercialParticipationStatus: "ELIGIBLE",
      livestreamEligible: true,
      eventEligible: true,
      externalRef: stable(`talent:${suffix}`),
      profileSummary: "UAT demo record",
      createdAt: supportAt,
      updatedAt: supportAt,
    });
    add("talent_group_members", `member.${suffix}.membership`, {
      _id: membershipId,
      groupId,
      talentId,
      membershipStatus: "ACTIVE",
      lineupOrder: index + 1,
      joinedAt: supportAt,
      leftAt: null,
      createdAt: supportAt,
      updatedAt: supportAt,
    });
    add("kpi_plans", `monthly.${suffix}.plan`, {
      _id: kpiPlanId,
      planCode: `${seedKey}-${period.periodMonth.replace("-", "")}-${index + 1}`,
      normalizedPlanCode: `${seedKey.toLowerCase()}-${period.periodMonth.replace("-", "")}-${index + 1}`,
      title: `${seedKey} ${status} Monthly Cycle`,
      normalizedTitle: `${seedKey.toLowerCase()} ${status.toLowerCase()} monthly cycle`,
      description: "UAT demo KPI monthly-cycle plan",
      subjectType: "TALENT_GROUP",
      subjectId: groupId,
      status: "PUBLISHED",
      currencyCode: "VND",
      periodMonth: period.periodMonth,
      periodStartAt: period.periodStartAt,
      periodEndAt: period.periodEndAt,
      timezone: "Asia/Ho_Chi_Minh",
      actualPolicySnapshot: {
        timezone: "Asia/Ho_Chi_Minh",
        entryOpenLocalTime: "06:00",
        entryLockLocalTime: "23:00",
        maxDirectEditsPerEntry: 2,
        correctionAllowedUntil: "PLAN_FINALIZED",
        policyVersion: "uat-monthly-cycle-v1",
        policySource: "DEFAULT",
        snapshottedAt: period.periodStartAt,
      },
      publishedAt: period.periodStartAt,
      publishedByActorId: SEED_ACTOR_ID,
      finalizedAt: null,
      finalizedByActorId: null,
      archivedAt: null,
      archivedByActorId: null,
      createdAt: period.periodStartAt,
      createdByActorId: SEED_ACTOR_ID,
      updatedAt: period.periodStartAt,
      updatedByActorId: SEED_ACTOR_ID,
      externalRef: monthly(`plan:${suffix}`),
    });
    add("kpi_target_metrics", `monthly.${suffix}.target-metric`, {
      _id: monthly(`target-metric:${suffix}`),
      kpiPlanId,
      metricCode: "CONTENT_OUTPUT_COUNT",
      targetValue: 10,
      unit: "COUNT",
      rollupMethod: "SUM",
      actualSource: "MANUAL",
      createdAt: period.periodStartAt,
      updatedAt: period.periodStartAt,
    });
    add("kpi_allocations", `monthly.${suffix}.allocation`, {
      _id: allocationId,
      kpiPlanId,
      groupId,
      memberEmploymentProfileId: employmentProfileId,
      memberTalentId: talentId,
      membershipId,
      allocationStatus: status,
      allocationStartDate: period.periodStartDate,
      allocationEndDate: period.periodEndDate,
      targetMetrics: [
        { metricCode: "CONTENT_OUTPUT_COUNT", targetValue: 10 },
      ],
      snapshotMemberDisplayName: `${seedKey} Demo Member ${index + 1}`,
      note: "UAT demo allocation",
      createdAt: period.periodStartAt,
      createdByActorId: SEED_ACTOR_ID,
      updatedAt: period.periodStartAt,
      updatedByActorId: SEED_ACTOR_ID,
      submittedAt,
      submittedByActorId: submittedAt ? SEED_ACTOR_ID : null,
      approvedAt,
      approvedByActorId: approvedAt ? SEED_ACTOR_ID : null,
      approvalNote: approvedAt ? "UAT demo approval" : null,
      rejectedAt,
      rejectedByActorId: rejectedAt ? SEED_ACTOR_ID : null,
      rejectionReason: rejectedAt ? "UAT demo rejection" : null,
      publishedAt: isPublished ? period.periodStartAt : null,
      publishedByActorId: isPublished ? SEED_ACTOR_ID : null,
      closedAt: null,
    });
    if (isPublished) {
      add("kpi_actual_entries", "monthly.published.actual-entry", {
        _id: monthly("actual-entry:published"),
        kpiPlanId,
        allocationId,
        memberTalentId: talentId,
        metricCode: "CONTENT_OUTPUT_COUNT",
        actualDate: period.periodStartActualDate,
        actualValue: 4,
        effectiveValue: 4,
        editCount: 0,
        correctionCount: 0,
        latestCorrectionId: null,
        createdAt: period.periodStartAt,
        createdByActorId: SEED_ACTOR_ID,
        updatedAt: period.periodStartAt,
        updatedByActorId: SEED_ACTOR_ID,
        lastEditedAt: null,
        lastEditedByActorId: null,
      });
    }
  }

  const warnings: string[] = [];
  if (!params.managerLinkedUserId) {
    warnings.push(
      "Manager EmploymentProfile is not linked to a runtime user; pass --manager-linked-user-id for manager-view UAT.",
    );
  }
  if (!params.staffLinkedUserId) {
    warnings.push(
      "Published member EmploymentProfile is not linked to a runtime user; pass --staff-linked-user-id for Self-Service My KPI UAT.",
    );
  }
  return {
    scenario: "monthly-cycle",
    seedKey,
    periodMonth: period.periodMonth,
    includeLegacyActive: params.includeLegacyActive ?? false,
    records,
    warnings,
  };
}

export async function writeKpiMonthlyCycleUatSeedPlan(
  repository: KpiMonthlyCycleUatSeedRepository,
  plan: KpiMonthlyCycleUatSeedPlan,
  params: {
    readonly managerLinkedUserId?: string;
    readonly staffLinkedUserId?: string;
  },
): Promise<{ readonly created: number; readonly noOp: number }> {
  if (params.managerLinkedUserId) {
    await repository.assertLinkedUserEligible(
      params.managerLinkedUserId,
      `${plan.seedKey.toLowerCase()}:employment-profile:manager`,
    );
  }
  if (params.staffLinkedUserId) {
    await repository.assertLinkedUserEligible(
      params.staffLinkedUserId,
      `${plan.seedKey.toLowerCase()}:employment-profile:published`,
    );
  }
  let created = 0;
  let noOp = 0;
  for (const record of plan.records) {
    const result = await repository.ensureInsertOnly(record);
    if (result === "created") {
      created += 1;
    } else {
      noOp += 1;
    }
  }
  return { created, noOp };
}

export function toPublicSeedPlan(
  plan: KpiMonthlyCycleUatSeedPlan,
  mode: SeedMode,
  writeResult?: { readonly created: number; readonly noOp: number },
): PublicSeedPlan {
  const countsByCollection: Record<string, number> = {};
  for (const record of plan.records) {
    countsByCollection[record.collection] =
      (countsByCollection[record.collection] ?? 0) + 1;
  }
  const allocationStatuses = plan.records
    .filter((record) => record.collection === "kpi_allocations")
    .map((record) => String(record.document.allocationStatus) as AllocationStatus);
  return {
    mode,
    scenario: plan.scenario,
    seedKey: plan.seedKey,
    periodMonth: plan.periodMonth,
    includeLegacyActive: plan.includeLegacyActive,
    countsByCollection,
    allocationStatuses,
    plannedRecords: plan.records.map((record) => ({
      collection: record.collection,
      key: record.key,
    })),
    warnings: plan.warnings,
    ...(writeResult ? { writeResult } : {}),
  };
}

export function formatPublicSeedPlan(plan: PublicSeedPlan): string {
  return JSON.stringify(plan, null, 2);
}

export function validateSeedWriteEnv(
  source: SeedWriteEnvSource,
  envFile: string,
): SeedWriteRuntimeEnv {
  if (!WRITE_ENV_FILES.has(path.basename(path.resolve(envFile)))) {
    throw new Error("KPI UAT seed write mode requires .env.dev or .env.staging");
  }
  if (source.ALLOW_KPI_UAT_SEED?.trim().toLowerCase() !== "true") {
    throw new Error("ALLOW_KPI_UAT_SEED must be true");
  }
  const mongoUri = readRequiredEnv(source, "MONGO_URI");
  const mongoDbName = readRequiredEnv(source, "MONGO_DB_NAME");
  const targetText = [
    source.NODE_ENV,
    source.APP_ENV,
    source.DEPLOY_ENV,
    mongoDbName,
    mongoUri,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  if (/(^|[^a-z])prod(uction)?([^a-z]|$)/iu.test(targetText)) {
    throw new Error("Production write is forbidden for KPI UAT seed");
  }
  if (!/(^|[^a-z])(dev(elopment)?|stage|staging|uat)([^a-z]|$)/iu.test(targetText)) {
    throw new Error("KPI UAT seed write target must be dev/staging/UAT-like");
  }
  const mongoMaxPoolSize = Number.parseInt(
    source.MONGO_MAX_POOL_SIZE ?? "5",
    10,
  );
  if (!Number.isInteger(mongoMaxPoolSize) || mongoMaxPoolSize <= 0) {
    throw new Error("MONGO_MAX_POOL_SIZE must be a positive integer");
  }
  return { mongoUri, mongoDbName, mongoMaxPoolSize };
}

function createPeriod(now: number): {
  readonly periodMonth: string;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly periodStartDate: string;
  readonly periodStartActualDate: string;
  readonly periodEndDate: string;
} {
  const date = new Date(now);
  const periodStartAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const periodEndAt =
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1;
  return {
    periodMonth: new Date(periodStartAt).toISOString().slice(0, 7),
    periodStartAt,
    periodEndAt,
    periodStartDate: new Date(periodStartAt).toISOString().slice(0, 10),
    periodStartActualDate: toDdMmYyyy(periodStartAt),
    periodEndDate: new Date(periodEndAt).toISOString().slice(0, 10),
  };
}

function toDdMmYyyy(timestamp: number): string {
  const [year, month, day] = new Date(timestamp)
    .toISOString()
    .slice(0, 10)
    .split("-");
  return `${day}-${month}-${year}`;
}

function normalizeSeedKey(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{2,20}$/u.test(normalized)) {
    throw new Error("Seed key must be 3-21 safe uppercase characters");
  }
  return normalized;
}

function plainObjectsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readRequiredArg(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readRequiredEnv(
  source: SeedWriteEnvSource,
  key: keyof SeedWriteEnvSource,
): string {
  const value = source[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function loadEnvFile(envFile: string): void {
  const result = dotenv.config({
    path: path.resolve(envFile),
    override: true,
    quiet: true,
  });
  if (result.error) {
    throw result.error;
  }
}

function buildMongoClientOptions(maxPoolSize: number): MongoClientOptions {
  return {
    maxPoolSize,
    retryReads: true,
    retryWrites: false,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 30_000,
  };
}

function helpText(): string {
  return [
    "KPI monthly-cycle UAT seed",
    "",
    "Dry run (no DB connection):",
    "  npm run kpi:monthly-cycle-uat-seed -- --dry-run --scenario monthly-cycle --json",
    "",
    "Dev/staging write:",
    "  npm run kpi:monthly-cycle-uat-seed -- --write --env-file .env.dev --scenario monthly-cycle --seed-key KPI-UAT --json",
    "",
    "Optional UAT linkage:",
    "  --manager-linked-user-id <existing-active-staff-user-id>",
    "  --staff-linked-user-id <existing-active-staff-user-id>",
    "  --include-legacy-active",
    "",
    "Write guard:",
    "  ALLOW_KPI_UAT_SEED=true",
    "  Production-looking targets are always refused.",
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseKpiMonthlyCycleUatSeedCliOptions(
    process.argv.slice(2),
  );
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }
  const plan = buildKpiMonthlyCycleUatSeedPlan({
    seedKey: options.seedKey,
    includeLegacyActive: options.includeLegacyActive,
    ...(options.managerLinkedUserId
      ? { managerLinkedUserId: options.managerLinkedUserId }
      : {}),
    ...(options.staffLinkedUserId
      ? { staffLinkedUserId: options.staffLinkedUserId }
      : {}),
  });
  if (options.mode === "dry-run") {
    process.stdout.write(
      `${formatPublicSeedPlan(toPublicSeedPlan(plan, "dry-run"))}\n`,
    );
    return;
  }

  loadEnvFile(options.envFile as string);
  const runtimeEnv = validateSeedWriteEnv(
    process.env,
    options.envFile as string,
  );
  const client = new MongoClient(
    runtimeEnv.mongoUri,
    buildMongoClientOptions(runtimeEnv.mongoMaxPoolSize),
  );
  try {
    await client.connect();
    const writeResult = await writeKpiMonthlyCycleUatSeedPlan(
      new NativeMongoKpiMonthlyCycleUatSeedRepository(
        client.db(runtimeEnv.mongoDbName),
      ),
      plan,
      options,
    );
    process.stdout.write(
      `${formatPublicSeedPlan(toPublicSeedPlan(plan, "write", writeResult))}\n`,
    );
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "KPI UAT seed failed";
    process.stderr.write(
      `${message.replace(/mongodb(\+srv)?:\/\/\S+/giu, "[redacted-mongo-uri]")}\n`,
    );
    process.exitCode = 1;
  });
}
