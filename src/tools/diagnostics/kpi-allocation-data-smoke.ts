import path from "node:path";

import dotenv from "dotenv";
import {
  Db,
  MongoClient,
  MongoClientOptions,
  ReadPreference,
} from "mongodb";

const ACTIVE_SAMPLE_LIMIT = 20;
const WRITE_LIKE_FLAGS = new Set([
  "--write",
  "--fix",
  "--repair",
  "--migrate",
  "--cleanup",
]);
const FORBIDDEN_OUTPUT_KEYS = new Set([
  "snapshotMemberDisplayName",
  "legalName",
  "email",
  "phone",
  "contact",
  "notes",
  "note",
  "actorId",
  "createdByActorId",
  "updatedByActorId",
  "submittedByActorId",
  "approvedByActorId",
  "rejectedByActorId",
  "publishedByActorId",
  "authSubject",
  "provider",
  "actualValue",
  "effectiveValue",
]);

export interface KpiAllocationDataSmokeCliOptions {
  readonly sample: boolean;
  readonly json: boolean;
  readonly readOnly: boolean;
  readonly envFile?: string;
  readonly allowProduction: boolean;
  readonly help: boolean;
}

export interface AllocationStatusCount {
  readonly allocationStatus: string;
  readonly count: number;
}

export interface ActiveAndPublishedPlanPeriodCount {
  readonly allocationStatus: "ACTIVE" | "PUBLISHED";
  readonly planStatus: string;
  readonly periodMonth: string | null;
  readonly periodStartAt: number | null;
  readonly periodEndAt: number | null;
  readonly count: number;
}

export interface ActiveAllocationSample {
  readonly allocationId: string;
  readonly kpiPlanId: string;
  readonly groupId: string;
  readonly memberEmploymentProfileId: string | null;
  readonly memberTalentId: string;
  readonly membershipId: string | null;
  readonly allocationStatus: "ACTIVE";
  readonly allocationStartDate: string;
  readonly allocationEndDate: string | null;
}

export interface KpiAllocationDataSmokeReport {
  readonly mode: "sample" | "read-only";
  readonly generatedAt: string;
  readonly target: {
    readonly mongoDbName: string;
    readonly nodeEnv: string;
    readonly readPreference: "primary";
    readonly uriRedacted: true;
  } | null;
  readonly allocationStatusCounts: readonly AllocationStatusCount[];
  readonly activeAndPublishedByPlanStatusPeriod: readonly ActiveAndPublishedPlanPeriodCount[];
  readonly activeAllocationActualEntryCount: number;
  readonly activeAllocationSamples: readonly ActiveAllocationSample[];
  readonly recommendationHints: readonly string[];
}

export interface KpiAllocationDataSmokeRepository {
  countAllocationsByStatus(): Promise<readonly AllocationStatusCount[]>;
  countActiveAndPublishedByPlanStatusPeriod(): Promise<
    readonly ActiveAndPublishedPlanPeriodCount[]
  >;
  countActualEntriesForActiveAllocations(): Promise<number>;
  listActiveAllocationSamples(
    limit: number,
  ): Promise<readonly ActiveAllocationSample[]>;
}

interface RuntimeEnv {
  readonly mongoUri: string;
  readonly mongoDbName: string;
  readonly nodeEnv: string;
  readonly mongoMaxPoolSize: number;
}

export class NativeMongoKpiAllocationDataSmokeRepository
  implements KpiAllocationDataSmokeRepository
{
  constructor(private readonly db: Db) {}

  async countAllocationsByStatus(): Promise<readonly AllocationStatusCount[]> {
    return this.db
      .collection("kpi_allocations")
      .aggregate<AllocationStatusCount>([
        { $group: { _id: "$allocationStatus", count: { $sum: 1 } } },
        { $project: { _id: 0, allocationStatus: "$_id", count: 1 } },
        { $sort: { allocationStatus: 1 } },
      ])
      .toArray();
  }

  async countActiveAndPublishedByPlanStatusPeriod(): Promise<
    readonly ActiveAndPublishedPlanPeriodCount[]
  > {
    return this.db
      .collection("kpi_allocations")
      .aggregate<ActiveAndPublishedPlanPeriodCount>([
        { $match: { allocationStatus: { $in: ["ACTIVE", "PUBLISHED"] } } },
        {
          $lookup: {
            from: "kpi_plans",
            localField: "kpiPlanId",
            foreignField: "_id",
            as: "plan",
          },
        },
        { $unwind: { path: "$plan", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: {
              allocationStatus: "$allocationStatus",
              planStatus: { $ifNull: ["$plan.status", "MISSING_PLAN"] },
              periodMonth: { $ifNull: ["$plan.periodMonth", null] },
              periodStartAt: { $ifNull: ["$plan.periodStartAt", null] },
              periodEndAt: { $ifNull: ["$plan.periodEndAt", null] },
            },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            allocationStatus: "$_id.allocationStatus",
            planStatus: "$_id.planStatus",
            periodMonth: "$_id.periodMonth",
            periodStartAt: "$_id.periodStartAt",
            periodEndAt: "$_id.periodEndAt",
            count: 1,
          },
        },
        {
          $sort: {
            allocationStatus: 1,
            planStatus: 1,
            periodMonth: 1,
            periodStartAt: 1,
          },
        },
      ])
      .toArray();
  }

  async countActualEntriesForActiveAllocations(): Promise<number> {
    const rows = await this.db
      .collection("kpi_allocations")
      .aggregate<{ readonly count: number }>([
        { $match: { allocationStatus: "ACTIVE" } },
        {
          $lookup: {
            from: "kpi_actual_entries",
            localField: "_id",
            foreignField: "allocationId",
            as: "actualEntries",
          },
        },
        { $unwind: "$actualEntries" },
        { $count: "count" },
      ])
      .toArray();
    return rows[0]?.count ?? 0;
  }

  async listActiveAllocationSamples(
    limit: number,
  ): Promise<readonly ActiveAllocationSample[]> {
    const rows = await this.db
      .collection("kpi_allocations")
      .find(
        { allocationStatus: "ACTIVE" },
        {
          projection: {
            _id: 1,
            kpiPlanId: 1,
            groupId: 1,
            memberEmploymentProfileId: 1,
            memberTalentId: 1,
            membershipId: 1,
            allocationStatus: 1,
            allocationStartDate: 1,
            allocationEndDate: 1,
          },
        },
      )
      .sort({ updatedAt: -1, _id: 1 })
      .limit(Math.min(limit, ACTIVE_SAMPLE_LIMIT))
      .toArray();
    return rows.map((row) => ({
      allocationId: String(row._id),
      kpiPlanId: String(row.kpiPlanId),
      groupId: String(row.groupId),
      memberEmploymentProfileId:
        typeof row.memberEmploymentProfileId === "string"
          ? row.memberEmploymentProfileId
          : null,
      memberTalentId: String(row.memberTalentId),
      membershipId:
        typeof row.membershipId === "string" ? row.membershipId : null,
      allocationStatus: "ACTIVE",
      allocationStartDate: String(row.allocationStartDate),
      allocationEndDate:
        typeof row.allocationEndDate === "string"
          ? row.allocationEndDate
          : null,
    }));
  }
}

export function parseKpiAllocationDataSmokeCliOptions(
  args: readonly string[],
): KpiAllocationDataSmokeCliOptions {
  let sample = false;
  let json = false;
  let readOnly = false;
  let envFile: string | undefined;
  let allowProduction = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (WRITE_LIKE_FLAGS.has(arg)) {
      throw new Error(`Write-like flag is forbidden for KPI smoke: ${arg}`);
    }
    if (arg === "--sample") {
      sample = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--read-only") {
      readOnly = true;
      continue;
    }
    if (arg === "--allow-production") {
      allowProduction = true;
      continue;
    }
    if (arg === "--env-file") {
      envFile = readRequiredArg(args, index, "--env-file");
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!help && !sample && !readOnly) {
    throw new Error("DB mode requires explicit --read-only");
  }
  if (!help && !sample && !envFile) {
    throw new Error("DB mode requires --env-file");
  }

  return {
    sample,
    json,
    readOnly,
    ...(envFile ? { envFile } : {}),
    allowProduction,
    help,
  };
}

export async function createKpiAllocationDataSmokeReport(
  repository: KpiAllocationDataSmokeRepository,
  params: {
    readonly mode: "sample" | "read-only";
    readonly target: KpiAllocationDataSmokeReport["target"];
    readonly now?: number;
  },
): Promise<KpiAllocationDataSmokeReport> {
  const [
    allocationStatusCounts,
    activeAndPublishedByPlanStatusPeriod,
    activeAllocationActualEntryCount,
    activeAllocationSamples,
  ] = await Promise.all([
    repository.countAllocationsByStatus(),
    repository.countActiveAndPublishedByPlanStatusPeriod(),
    repository.countActualEntriesForActiveAllocations(),
    repository.listActiveAllocationSamples(ACTIVE_SAMPLE_LIMIT),
  ]);
  const report: KpiAllocationDataSmokeReport = {
    mode: params.mode,
    generatedAt: new Date(params.now ?? Date.now()).toISOString(),
    target: params.target,
    allocationStatusCounts,
    activeAndPublishedByPlanStatusPeriod,
    activeAllocationActualEntryCount,
    activeAllocationSamples: activeAllocationSamples.slice(
      0,
      ACTIVE_SAMPLE_LIMIT,
    ),
    recommendationHints: buildRecommendationHints({
      allocationStatusCounts,
      activeAndPublishedByPlanStatusPeriod,
      activeAllocationActualEntryCount,
      now: params.now ?? Date.now(),
    }),
  };
  assertPiISafeOutput(report);
  return report;
}

export function buildRecommendationHints(params: {
  readonly allocationStatusCounts: readonly AllocationStatusCount[];
  readonly activeAndPublishedByPlanStatusPeriod: readonly ActiveAndPublishedPlanPeriodCount[];
  readonly activeAllocationActualEntryCount: number;
  readonly now: number;
}): readonly string[] {
  const activeCount =
    params.allocationStatusCounts.find(
      (entry) => entry.allocationStatus === "ACTIVE",
    )?.count ?? 0;
  const hints: string[] = [];

  if (activeCount === 0) {
    hints.push("PUBLISHED-only posture appears data-safe: ACTIVE count is 0.");
  } else if (params.activeAllocationActualEntryCount === 0) {
    hints.push(
      "ACTIVE rows exist without actual entries: owner can likely keep ACTIVE parse-only/nonofficial and clean up later.",
    );
  } else {
    hints.push(
      "ACTIVE rows have actual entries: owner must decide migration vs grandfather contract before rollout.",
    );
  }

  const currentPeriod = toUtcPeriodMonth(params.now);
  if (
    params.activeAndPublishedByPlanStatusPeriod.some(
      (entry) =>
        entry.allocationStatus === "ACTIVE" &&
        entry.periodMonth === currentPeriod,
    )
  ) {
    hints.push(
      "ACTIVE rows exist in the current period: owner decision is required before production rollout.",
    );
  }
  return hints;
}

export function createSampleKpiAllocationDataSmokeReport(
  now = Date.UTC(2026, 4, 15, 0, 0, 0),
): Promise<KpiAllocationDataSmokeReport> {
  const currentPeriod = toUtcPeriodMonth(now);
  const repository: KpiAllocationDataSmokeRepository = {
    async countAllocationsByStatus() {
      return [
        { allocationStatus: "ACTIVE", count: 1 },
        { allocationStatus: "PUBLISHED", count: 2 },
      ];
    },
    async countActiveAndPublishedByPlanStatusPeriod() {
      return [
        {
          allocationStatus: "ACTIVE",
          planStatus: "PUBLISHED",
          periodMonth: currentPeriod,
          periodStartAt: now,
          periodEndAt: now,
          count: 1,
        },
        {
          allocationStatus: "PUBLISHED",
          planStatus: "PUBLISHED",
          periodMonth: currentPeriod,
          periodStartAt: now,
          periodEndAt: now,
          count: 2,
        },
      ];
    },
    async countActualEntriesForActiveAllocations() {
      return 0;
    },
    async listActiveAllocationSamples() {
      return [
        {
          allocationId: "sample-allocation-active",
          kpiPlanId: "sample-plan-current",
          groupId: "sample-group",
          memberEmploymentProfileId: "sample-profile",
          memberTalentId: "sample-talent",
          membershipId: "sample-membership",
          allocationStatus: "ACTIVE",
          allocationStartDate: `${currentPeriod}-01`,
          allocationEndDate: null,
        },
      ];
    },
  };
  return createKpiAllocationDataSmokeReport(repository, {
    mode: "sample",
    target: null,
    now,
  });
}

export function formatKpiAllocationDataSmokeReport(
  report: KpiAllocationDataSmokeReport,
): string {
  assertPiISafeOutput(report);
  return JSON.stringify(report, null, 2);
}

export function assertPiISafeOutput(value: unknown): void {
  for (const key of deepKeys(value)) {
    if (FORBIDDEN_OUTPUT_KEYS.has(key)) {
      throw new Error(`Forbidden KPI smoke output field: ${key}`);
    }
  }
}

function deepKeys(value: unknown): readonly string[] {
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

function readRuntimeEnv(source: NodeJS.ProcessEnv): RuntimeEnv {
  const mongoUri = readRequiredEnv(source, "MONGO_URI");
  const mongoDbName = readRequiredEnv(source, "MONGO_DB_NAME");
  const nodeEnv = source.NODE_ENV?.trim() || "development";
  const mongoMaxPoolSize = Number.parseInt(
    source.MONGO_MAX_POOL_SIZE ?? "10",
    10,
  );
  if (!Number.isInteger(mongoMaxPoolSize) || mongoMaxPoolSize <= 0) {
    throw new Error("MONGO_MAX_POOL_SIZE must be a positive integer");
  }
  return { mongoUri, mongoDbName, nodeEnv, mongoMaxPoolSize };
}

export function assertReadTargetAllowed(
  runtimeEnv: Pick<RuntimeEnv, "mongoUri" | "mongoDbName" | "nodeEnv">,
  allowProduction: boolean,
): void {
  const productionLooking = [
    runtimeEnv.nodeEnv,
    runtimeEnv.mongoDbName,
    runtimeEnv.mongoUri,
  ].some((value) => /(^|[^a-z])prod(uction)?([^a-z]|$)/iu.test(value));
  if (productionLooking && !allowProduction) {
    throw new Error(
      "Refusing KPI smoke against a production-looking target without --allow-production",
    );
  }
}

function readRequiredEnv(source: NodeJS.ProcessEnv, key: string): string {
  const value = source[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
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

function toUtcPeriodMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

function helpText(): string {
  return [
    "KPI allocation data smoke",
    "",
    "Sample mode (no DB connection):",
    "  npm run kpi:allocation-data-smoke -- --sample --json",
    "",
    "Read-only DB mode:",
    "  npm run kpi:allocation-data-smoke -- --env-file .env.dev --read-only --json",
    "",
    "Options:",
    "  --sample             Print representative output without DB connection.",
    "  --read-only          Required confirmation before any DB connection.",
    "  --allow-production   Allow a production-looking read target.",
    "  --json               Print JSON output.",
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseKpiAllocationDataSmokeCliOptions(
    process.argv.slice(2),
  );
  if (options.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }
  if (options.sample) {
    const report = await createSampleKpiAllocationDataSmokeReport();
    process.stdout.write(`${formatKpiAllocationDataSmokeReport(report)}\n`);
    return;
  }

  loadEnvFile(options.envFile as string);
  const runtimeEnv = readRuntimeEnv(process.env);
  assertReadTargetAllowed(runtimeEnv, options.allowProduction);
  const client = new MongoClient(
    runtimeEnv.mongoUri,
    buildMongoClientOptions(runtimeEnv.mongoMaxPoolSize),
  );
  try {
    await client.connect();
    const db = client.db(runtimeEnv.mongoDbName, {
      readPreference: ReadPreference.primary,
    });
    const report = await createKpiAllocationDataSmokeReport(
      new NativeMongoKpiAllocationDataSmokeRepository(db),
      {
        mode: "read-only",
        target: {
          mongoDbName: runtimeEnv.mongoDbName,
          nodeEnv: runtimeEnv.nodeEnv,
          readPreference: "primary",
          uriRedacted: true,
        },
      },
    );
    process.stdout.write(`${formatKpiAllocationDataSmokeReport(report)}\n`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "KPI smoke failed";
    process.stderr.write(
      `${message.replace(/mongodb(\+srv)?:\/\/\S+/giu, "[redacted-mongo-uri]")}\n`,
    );
    process.exitCode = 1;
  });
}
