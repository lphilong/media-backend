import path from "node:path";

import dotenv from "dotenv";
import {
  Collection,
  Db,
  Document,
  MongoClient,
  MongoClientOptions,
  ReadPreference,
} from "mongodb";

import { COMMISSION_RULE_STATUS_KIND_EFFECTIVE_WINDOW_INDEX_NAME } from "@infra/mongo/commission/commission.index";
import {
  DASHBOARD_LITE_CONTRACT_ACTIVE_EFFECTIVE_END_DATE_INDEX_NAME,
  DASHBOARD_LITE_REVENUE_DRAFT_CREATED_AT_INDEX_NAME,
  DASHBOARD_LITE_REVENUE_FINALIZED_FINALIZED_AT_INDEX_NAME,
  DASHBOARD_LITE_REVENUE_RECONCILED_RECONCILED_AT_INDEX_NAME,
  DASHBOARD_LITE_SETTLEMENT_DRAFT_CREATED_AT_INDEX_NAME,
  DASHBOARD_LITE_SETTLEMENT_FINALIZED_FINALIZED_AT_INDEX_NAME,
} from "@infra/mongo/dashboard-lite/dashboard-lite.index";
import { createDashboardLiteWindowSnapshot } from "@modules/dashboard-lite/domain/dashboard-lite.time";

type OperationKind = "countDocuments" | "aggregate";

interface CliOptions {
  readonly envFile: string;
  readonly operationFilter: ReadonlySet<string> | null;
  readonly generatedAt: number;
  readonly allowProduction: boolean;
}

interface RuntimeEnv {
  readonly mongoUri: string;
  readonly mongoDbName: string;
  readonly nodeEnv: string;
  readonly adminBusinessTimeZone: string;
  readonly mongoMaxPoolSize: number;
}

interface OperationDefinition {
  readonly operation: string;
  readonly priority: number;
  readonly collectionName: string;
  readonly kind: OperationKind;
  readonly businessWindow: string;
  readonly hint: string;
  readonly summary: Record<string, unknown>;
  readonly buildPipeline: (window: DashboardWindow) => readonly Document[];
}

interface DashboardWindow {
  readonly generatedAt: number;
  readonly trailing30DayWindowStartAt: number;
  readonly staleDraftThresholdAt: number;
  readonly expiringContractWindowStartDate: number;
  readonly expiringContractWindowEndDate: number;
}

interface SanitizedIndex {
  readonly name?: string;
  readonly key?: unknown;
  readonly partialFilterExpression?: unknown;
  readonly unique?: boolean;
  readonly sparse?: boolean;
}

interface OperationReport {
  readonly operation: string;
  readonly priority: number;
  readonly collection: string;
  readonly kind: OperationKind;
  readonly explainKind: "aggregate";
  readonly businessWindow: string;
  readonly filterOrPipelineSummary: Record<string, unknown>;
  readonly hint: string;
  readonly hintAccepted: boolean;
  readonly explainError?: string;
  readonly collectionEstimatedDocumentCount?: number;
  readonly indexes?: readonly SanitizedIndex[];
  readonly winningPlanIndexNames: readonly string[];
  readonly stageSummary: readonly string[];
  readonly totalKeysExamined: number | null;
  readonly totalDocsExamined: number | null;
  readonly nReturned: number | null;
  readonly executionTimeMillis: number | null;
  readonly resultCount: number | null;
  readonly hasCollscan: boolean;
  readonly hasSort: boolean;
  readonly hasGroup: boolean;
  readonly diagnosis: readonly string[];
}

interface DiagnosticReport {
  readonly generatedAt: string;
  readonly target: {
    readonly envFile: string;
    readonly mongoDbName: string;
    readonly nodeEnv: string;
    readonly adminBusinessTimeZone: string;
    readonly readPreference: "primary";
    readonly uriRedacted: true;
  };
  readonly window: {
    readonly generatedAt: number;
    readonly generatedAtIso: string;
    readonly trailing30Days: {
      readonly startAtInclusive: number;
      readonly endAtExclusive: number;
    };
    readonly staleDrafts: {
      readonly olderThanAtExclusive: number;
    };
    readonly contractExpiry30Days: {
      readonly startDateInclusive: string;
      readonly endDateInclusive: string;
    };
  };
  readonly operations: readonly OperationReport[];
}

const TARGET_OPERATION_NAMES = [
  "dashboardLite.metrics.contracts.expiring30d",
  "dashboardLite.metrics.commission.settlements.finalized30d",
  "dashboardLite.metrics.commission.settlements.draftSummary",
  "dashboardLite.metrics.revenue.finalized30d",
  "dashboardLite.metrics.revenue.draftSummary",
  "dashboardLite.metrics.revenue.reconciled30d",
  "dashboardLite.metrics.commission.rules.active",
] as const;

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  loadEnvFile(options.envFile);
  const runtimeEnv = readRuntimeEnv(process.env);
  assertNonProductionTarget(runtimeEnv, options.allowProduction);

  const client = new MongoClient(
    runtimeEnv.mongoUri,
    buildMongoClientOptions(runtimeEnv.mongoMaxPoolSize),
  );

  try {
    await client.connect();
    const db = client.db(runtimeEnv.mongoDbName, {
      readPreference: ReadPreference.primary,
    });
    const window = createDashboardLiteWindowSnapshot(
      options.generatedAt,
      runtimeEnv.adminBusinessTimeZone,
    );
    const operations = createOperationDefinitions().filter((operation) => {
      return (
        options.operationFilter === null ||
        options.operationFilter.has(operation.operation)
      );
    });

    const reports: OperationReport[] = [];
    for (const operation of operations) {
      reports.push(await explainOperation(db, operation, window));
    }

    const report: DiagnosticReport = {
      generatedAt: new Date().toISOString(),
      target: {
        envFile: path.basename(options.envFile),
        mongoDbName: runtimeEnv.mongoDbName,
        nodeEnv: runtimeEnv.nodeEnv,
        adminBusinessTimeZone: runtimeEnv.adminBusinessTimeZone,
        readPreference: "primary",
        uriRedacted: true,
      },
      window: {
        generatedAt: window.generatedAt,
        generatedAtIso: new Date(window.generatedAt).toISOString(),
        trailing30Days: {
          startAtInclusive: window.trailing30DayWindowStartAt,
          endAtExclusive: window.generatedAt,
        },
        staleDrafts: {
          olderThanAtExclusive: window.staleDraftThresholdAt,
        },
        contractExpiry30Days: {
          startDateInclusive: toUtcDateOnlyString(
            window.expiringContractWindowStartDate,
          ),
          endDateInclusive: toUtcDateOnlyString(
            window.expiringContractWindowEndDate,
          ),
        },
      },
      operations: reports,
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await client.close();
  }
}

function parseCliOptions(args: readonly string[]): CliOptions {
  let envFile: string | null = null;
  let operationFilter: ReadonlySet<string> | null = null;
  let generatedAt = Date.now();
  let allowProduction = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--env-file") {
      envFile = readRequiredArg(args, index, "--env-file");
      index += 1;
      continue;
    }

    if (arg === "--operation") {
      const rawOperations = readRequiredArg(args, index, "--operation");
      operationFilter = new Set(
        rawOperations
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      );
      index += 1;
      continue;
    }

    if (arg === "--generated-at") {
      const rawGeneratedAt = readRequiredArg(args, index, "--generated-at");
      const parsed = Date.parse(rawGeneratedAt);
      if (!Number.isFinite(parsed)) {
        throw new Error("--generated-at must be an ISO timestamp");
      }
      generatedAt = parsed;
      index += 1;
      continue;
    }

    if (arg === "--allow-production") {
      allowProduction = true;
      continue;
    }

    if (arg === "--help") {
      printUsageAndExit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!envFile) {
    printUsageAndExit(1);
  }

  return {
    envFile,
    operationFilter,
    generatedAt,
    allowProduction,
  };
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

function printUsageAndExit(exitCode: number): never {
  process.stderr.write(
    [
      "Usage:",
      "  ts-node -r tsconfig-paths/register src/tools/diagnostics/dashboard-lite-explain.ts --env-file .env.dev",
      "",
      "Options:",
      "  --operation <name[,name]>  Limit to selected operation names.",
      "  --generated-at <iso>       Use a fixed dashboard generatedAt timestamp.",
      "  --allow-production         Allow production-looking targets.",
    ].join("\n"),
  );
  process.stderr.write("\n");
  process.exit(exitCode);
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

function readRuntimeEnv(source: NodeJS.ProcessEnv): RuntimeEnv {
  const mongoUri = readRequiredEnv(source, "MONGO_URI");
  const mongoDbName = readRequiredEnv(source, "MONGO_DB_NAME");
  const nodeEnv = source.NODE_ENV ?? "development";
  const adminBusinessTimeZone =
    source.ADMIN_BUSINESS_TIMEZONE ?? "UTC";
  const mongoMaxPoolSize = Number.parseInt(
    source.MONGO_MAX_POOL_SIZE ?? "10",
    10,
  );

  if (!Number.isInteger(mongoMaxPoolSize) || mongoMaxPoolSize <= 0) {
    throw new Error("MONGO_MAX_POOL_SIZE must be a positive integer");
  }

  return {
    mongoUri,
    mongoDbName,
    nodeEnv,
    adminBusinessTimeZone,
    mongoMaxPoolSize,
  };
}

function readRequiredEnv(
  source: NodeJS.ProcessEnv,
  key: string,
): string {
  const value = source[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function assertNonProductionTarget(
  runtimeEnv: RuntimeEnv,
  allowProduction: boolean,
): void {
  const targetTokens = [
    runtimeEnv.nodeEnv,
    runtimeEnv.mongoDbName,
  ].map((value) => value.toLowerCase());
  const productionLooking = targetTokens.some((value) => {
    return value.includes("prod") || value.includes("production");
  });

  if (productionLooking && !allowProduction) {
    throw new Error(
      "Refusing to run explain against a production-looking target without --allow-production",
    );
  }
}

function buildMongoClientOptions(
  maxPoolSize: number,
): MongoClientOptions {
  return {
    maxPoolSize,
    retryReads: true,
    retryWrites: false,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 30_000,
  };
}

function createOperationDefinitions(): readonly OperationDefinition[] {
  return [
    {
      operation: "dashboardLite.metrics.contracts.expiring30d",
      priority: 1,
      collectionName: "contract_records",
      kind: "countDocuments",
      businessWindow: "contractExpiry30Days",
      hint: DASHBOARD_LITE_CONTRACT_ACTIVE_EFFECTIVE_END_DATE_INDEX_NAME,
      summary: {
        predicateFields: ["status", "effectiveEndDate"],
        status: "ACTIVE",
        effectiveEndDate: "$gte startDate, $lte endDate",
      },
      buildPipeline: (window) => [
        {
          $match: {
            status: "ACTIVE",
            effectiveEndDate: {
              $gte: window.expiringContractWindowStartDate,
              $lte: window.expiringContractWindowEndDate,
            },
          },
        },
        { $count: "count" },
      ],
    },
    {
      operation:
        "dashboardLite.metrics.commission.settlements.finalized30d",
      priority: 2,
      collectionName: "commission_settlements",
      kind: "aggregate",
      businessWindow: "trailing30Days",
      hint: DASHBOARD_LITE_SETTLEMENT_FINALIZED_FINALIZED_AT_INDEX_NAME,
      summary: {
        stages: ["$match", "$group"],
        predicateFields: ["status", "finalizedAt"],
        status: "FINALIZED",
        finalizedAt: "$gte trailing30Start, $lt generatedAt",
        group: "sum settlementAmount",
      },
      buildPipeline: (window) => [
        {
          $match: {
            status: "FINALIZED",
            finalizedAt: {
              $gte: window.trailing30DayWindowStartAt,
              $lt: window.generatedAt,
            },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$settlementAmount" },
          },
        },
      ],
    },
    {
      operation:
        "dashboardLite.metrics.commission.settlements.draftSummary",
      priority: 2,
      collectionName: "commission_settlements",
      kind: "aggregate",
      businessWindow: "staleDrafts",
      hint: DASHBOARD_LITE_SETTLEMENT_DRAFT_CREATED_AT_INDEX_NAME,
      summary: {
        stages: ["$match", "$group"],
        predicateFields: ["status"],
        status: "DRAFT",
        group: "count all drafts and count stale createdAt",
      },
      buildPipeline: (window) => [
        { $match: { status: "DRAFT" } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            staleCount: {
              $sum: {
                $cond: [
                  { $lt: ["$createdAt", window.staleDraftThresholdAt] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ],
    },
    {
      operation: "dashboardLite.metrics.revenue.finalized30d",
      priority: 3,
      collectionName: "revenue_entries",
      kind: "aggregate",
      businessWindow: "trailing30Days",
      hint: DASHBOARD_LITE_REVENUE_FINALIZED_FINALIZED_AT_INDEX_NAME,
      summary: {
        stages: ["$match", "$group"],
        predicateFields: ["status", "finalizedAt"],
        status: "FINALIZED",
        finalizedAt: "$gte trailing30Start, $lt generatedAt",
        group: "sum recognizedAmount",
      },
      buildPipeline: (window) => [
        {
          $match: {
            status: "FINALIZED",
            finalizedAt: {
              $gte: window.trailing30DayWindowStartAt,
              $lt: window.generatedAt,
            },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$recognizedAmount" },
          },
        },
      ],
    },
    {
      operation: "dashboardLite.metrics.revenue.draftSummary",
      priority: 3,
      collectionName: "revenue_entries",
      kind: "aggregate",
      businessWindow: "staleDrafts",
      hint: DASHBOARD_LITE_REVENUE_DRAFT_CREATED_AT_INDEX_NAME,
      summary: {
        stages: ["$match", "$group"],
        predicateFields: ["status"],
        status: "DRAFT",
        group: "count all drafts and count stale createdAt",
      },
      buildPipeline: (window) => [
        { $match: { status: "DRAFT" } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            staleCount: {
              $sum: {
                $cond: [
                  { $lt: ["$createdAt", window.staleDraftThresholdAt] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ],
    },
    {
      operation: "dashboardLite.metrics.revenue.reconciled30d",
      priority: 3,
      collectionName: "revenue_entries",
      kind: "aggregate",
      businessWindow: "trailing30Days",
      hint: DASHBOARD_LITE_REVENUE_RECONCILED_RECONCILED_AT_INDEX_NAME,
      summary: {
        stages: ["$match", "$group"],
        predicateFields: ["status", "reconciledAt"],
        status: "RECONCILED",
        reconciledAt: "$gte trailing30Start, $lt generatedAt",
        group: "sum recognizedAmount",
      },
      buildPipeline: (window) => [
        {
          $match: {
            status: "RECONCILED",
            reconciledAt: {
              $gte: window.trailing30DayWindowStartAt,
              $lt: window.generatedAt,
            },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$recognizedAmount" },
          },
        },
      ],
    },
    {
      operation: "dashboardLite.metrics.commission.rules.active",
      priority: 4,
      collectionName: "commission_rules",
      kind: "countDocuments",
      businessWindow: "current",
      hint: COMMISSION_RULE_STATUS_KIND_EFFECTIVE_WINDOW_INDEX_NAME,
      summary: {
        predicateFields: ["status"],
        status: "ACTIVE",
      },
      buildPipeline: () => [
        { $match: { status: "ACTIVE" } },
        { $count: "count" },
      ],
    },
  ];
}

async function explainOperation(
  db: Db,
  operation: OperationDefinition,
  window: DashboardWindow,
): Promise<OperationReport> {
  const collection = db.collection(operation.collectionName);
  const pipeline = operation.buildPipeline(window);
  const indexes = await readIndexes(collection);
  const collectionEstimatedDocumentCount =
    await collection.estimatedDocumentCount();

  try {
    const explain = await db.command({
      explain: {
        aggregate: operation.collectionName,
        pipeline: [...pipeline],
        cursor: {},
        hint: operation.hint,
      },
      verbosity: "executionStats",
    });
    const resultCount = await readResultCount(
      collection,
      pipeline,
      operation.hint,
      operation.kind,
    );
    const metrics = summarizeExplain(explain);
    return {
      operation: operation.operation,
      priority: operation.priority,
      collection: operation.collectionName,
      kind: operation.kind,
      explainKind: "aggregate",
      businessWindow: operation.businessWindow,
      filterOrPipelineSummary: operation.summary,
      hint: operation.hint,
      hintAccepted: true,
      collectionEstimatedDocumentCount,
      indexes,
      winningPlanIndexNames: metrics.indexNames,
      stageSummary: metrics.stageSummary,
      totalKeysExamined: metrics.totalKeysExamined,
      totalDocsExamined: metrics.totalDocsExamined,
      nReturned: metrics.nReturned,
      executionTimeMillis: metrics.executionTimeMillis,
      resultCount,
      hasCollscan: metrics.stageSummary.includes("COLLSCAN"),
      hasSort: metrics.stageSummary.includes("SORT"),
      hasGroup: metrics.stageSummary.includes("$group"),
      diagnosis: diagnose({
        hintAccepted: true,
        metrics,
        resultCount,
      }),
    };
  } catch (error) {
    return {
      operation: operation.operation,
      priority: operation.priority,
      collection: operation.collectionName,
      kind: operation.kind,
      explainKind: "aggregate",
      businessWindow: operation.businessWindow,
      filterOrPipelineSummary: operation.summary,
      hint: operation.hint,
      hintAccepted: false,
      explainError: describeError(error),
      collectionEstimatedDocumentCount,
      indexes,
      winningPlanIndexNames: [],
      stageSummary: [],
      totalKeysExamined: null,
      totalDocsExamined: null,
      nReturned: null,
      executionTimeMillis: null,
      resultCount: null,
      hasCollscan: false,
      hasSort: false,
      hasGroup: false,
      diagnosis: ["hint rejected or explain failed"],
    };
  }
}

async function readIndexes(
  collection: Collection<Document>,
): Promise<readonly SanitizedIndex[]> {
  const indexes = await collection.indexes();
  return indexes.map((index) => ({
    name: typeof index.name === "string" ? index.name : undefined,
    key: index.key,
    partialFilterExpression: index.partialFilterExpression,
    unique: index.unique === true ? true : undefined,
    sparse: index.sparse === true ? true : undefined,
  }));
}

async function readResultCount(
  collection: Collection<Document>,
  pipeline: readonly Document[],
  hint: string,
  kind: OperationKind,
): Promise<number> {
  if (kind === "countDocuments") {
    return collection.countDocuments(readMatchStage(pipeline), { hint });
  }

  const rows = await collection.aggregate([...pipeline], { hint }).toArray();
  return rows.length;
}

function readMatchStage(pipeline: readonly Document[]): Document {
  const firstStage = pipeline[0] as Record<string, unknown> | undefined;
  const matchStage = firstStage?.$match;
  if (
    typeof matchStage !== "object" ||
    matchStage === null ||
    Array.isArray(matchStage)
  ) {
    throw new Error("countDocuments diagnostic requires a leading $match");
  }

  return matchStage as Document;
}

function summarizeExplain(explain: unknown): {
  readonly indexNames: readonly string[];
  readonly stageSummary: readonly string[];
  readonly totalKeysExamined: number | null;
  readonly totalDocsExamined: number | null;
  readonly nReturned: number | null;
  readonly executionTimeMillis: number | null;
} {
  const indexNames = new Set<string>();
  const stages = new Set<string>();
  let totalKeysExamined: number | null = null;
  let totalDocsExamined: number | null = null;
  let nReturned: number | null = null;
  let executionTimeMillis: number | null = null;

  walkExplain(explain, (record) => {
    const indexName = readString(record.indexName);
    if (indexName) {
      indexNames.add(indexName);
    }

    const stage = readString(record.stage);
    if (stage) {
      stages.add(stage);
    }

    for (const key of Object.keys(record)) {
      if (key.startsWith("$")) {
        stages.add(key);
      }
    }

    totalKeysExamined = chooseMax(
      totalKeysExamined,
      readNumber(record.totalKeysExamined),
    );
    totalDocsExamined = chooseMax(
      totalDocsExamined,
      readNumber(record.totalDocsExamined),
    );
    nReturned = chooseMax(nReturned, readNumber(record.nReturned));
    executionTimeMillis = chooseMax(
      executionTimeMillis,
      readNumber(record.executionTimeMillis),
    );
  });

  return {
    indexNames: [...indexNames.values()].sort(),
    stageSummary: [...stages.values()].sort(),
    totalKeysExamined,
    totalDocsExamined,
    nReturned,
    executionTimeMillis,
  };
}

function walkExplain(
  value: unknown,
  visitor: (record: Record<string, unknown>) => void,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkExplain(entry, visitor);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  const record = value as Record<string, unknown>;
  visitor(record);

  for (const child of Object.values(record)) {
    walkExplain(child, visitor);
  }
}

function diagnose(params: {
  readonly hintAccepted: boolean;
  readonly metrics: ReturnType<typeof summarizeExplain>;
  readonly resultCount: number;
}): readonly string[] {
  const notes: string[] = [];
  const {
    hintAccepted,
    metrics,
    resultCount,
  } = params;

  if (!hintAccepted) {
    notes.push("hint rejected");
  }
  if (metrics.stageSummary.includes("COLLSCAN")) {
    notes.push("COLLSCAN present");
  }
  if (metrics.stageSummary.includes("SORT")) {
    notes.push("blocking SORT present");
  }
  if (metrics.stageSummary.includes("$group")) {
    notes.push("$group stage present");
  }
  if (
    metrics.totalDocsExamined !== null &&
    resultCount <= 1 &&
    metrics.totalDocsExamined > 1_000
  ) {
    notes.push("low result count with high docsExamined");
  }
  if (
    metrics.totalKeysExamined !== null &&
    resultCount <= 1 &&
    metrics.totalKeysExamined > 1_000
  ) {
    notes.push("low result count with high keysExamined");
  }
  if (
    metrics.totalDocsExamined !== null &&
    metrics.nReturned !== null &&
    metrics.nReturned > 0 &&
    metrics.totalDocsExamined > metrics.nReturned * 20
  ) {
    notes.push("docsExamined materially exceeds nReturned");
  }
  if (
    metrics.totalKeysExamined !== null &&
    metrics.nReturned !== null &&
    metrics.nReturned > 0 &&
    metrics.totalKeysExamined > metrics.nReturned * 20
  ) {
    notes.push("keysExamined materially exceeds nReturned");
  }

  return notes.length > 0 ? notes : ["index plan looks efficient"];
}

function chooseMax(
  current: number | null,
  candidate: number | null,
): number | null {
  if (candidate === null) {
    return current;
  }
  if (current === null) {
    return candidate;
  }
  return Math.max(current, candidate);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toUtcDateOnlyString(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${describeError(error)}\n`);
  process.exit(1);
});
