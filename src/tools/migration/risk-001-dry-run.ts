import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fsSync from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import {
  loadAllRisk001PlannerInputs,
  RISK001_DEFAULT_PAGE_SIZE,
  RISK001_DEFAULT_SAFETY_CEILING,
} from "./risk-001-data-loaders";
import {
  sanitizedFailure,
  withReadOnlyMongoGateway,
} from "./read-only-mongo.gateway";
import { Risk001SanitizedError } from "./risk-001-sanitized-error";
import {
  parseRisk001CliArgs,
  type Risk001CliOptions,
} from "./risk-001-cli-contract";
import {
  acquireRisk001OutputDirectory,
  cleanupRisk001OwnedOutputDirectory,
  preflightRisk001OutputDirectory,
  writeExactlyTwoOutputsAtomically,
  type Risk001OwnedOutputDirectory,
  type Risk001OutputPreflight,
} from "./risk-001-output-publication";
import {
  prepareRisk001CompletedArtifacts,
  SourceVersionEvidence,
} from "./risk-001-output";

export {
  acquireRisk001OutputDirectory,
  parseRisk001CliArgs,
  preflightRisk001OutputDirectory,
  writeExactlyTwoOutputsAtomically,
};
export type { Risk001CliOptions, Risk001OutputPreflight, Risk001OwnedOutputDirectory };

export interface Risk001RuntimeConfig {
  readonly mongoUri: string;
  readonly mongoDbName: string;
}


export function loadRisk001RuntimeConfig(
  backendRoot: string,
  envSource: NodeJS.ProcessEnv = process.env,
): Risk001RuntimeConfig {
  const result = dotenv.config({
    path: path.join(backendRoot, ".env.dev"),
    override: true,
    quiet: true,
    processEnv: envSource as Record<string, string>,
  });
  if (result.error) {
    throw new Risk001SanitizedError("CONFIGURATION_FAILED", "Unable to load backend .env.dev");
  }
  const mongoUri = envSource.MONGO_URI?.trim();
  const mongoDbName = envSource.MONGO_DB_NAME?.trim();
  if (!mongoUri || !/^mongodb(?:\+srv)?:\/\//u.test(mongoUri)) {
    throw new Risk001SanitizedError("CONFIGURATION_FAILED", "MONGO_URI is missing or invalid");
  }
  if (
    !mongoDbName ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(mongoDbName) ||
    !/(?:dev|test|local|sandbox|smoke)/iu.test(mongoDbName)
  ) {
    throw new Risk001SanitizedError("CONFIGURATION_FAILED", "MONGO_DB_NAME must identify an authorized non-production test database");
  }
  return Object.freeze({ mongoUri, mongoDbName });
}

export async function runRisk001DryRunCli(params: {
  readonly args: readonly string[];
  readonly backendRoot?: string;
  readonly observedAt?: number;
}): Promise<{ readonly manifestPath: string; readonly summaryPath: string }> {
  const prepared = await prepareRisk001DryRunCli(params);
  const { backendRoot, options, outputOwnership, runtime } = prepared;
  try {
    const observedAt = params.observedAt ?? Date.now();
    const source = resolveSourceVersion(backendRoot);
    const artifacts = await withReadOnlyMongoGateway(
      { mongoUri: runtime.mongoUri, mongoDbName: runtime.mongoDbName },
      async (gateway) => {
        const loaded = await loadAllRisk001PlannerInputs(gateway, {
          observedAt,
          pageSize: RISK001_DEFAULT_PAGE_SIZE,
          safetyCeiling: RISK001_DEFAULT_SAFETY_CEILING,
        });
        return prepareRisk001CompletedArtifacts({
          loaded,
          source,
          databaseName: runtime.mongoDbName,
          observedAt,
          maxSamples: options.maxSamples,
          ...(options.runLabel ? { runLabel: options.runLabel } : {}),
        }, options.pretty);
      },
    );
    const manifestPath = path.join(options.outputDir, "manifest.json");
    const summaryPath = path.join(options.outputDir, "SUMMARY.md");
    await writeExactlyTwoOutputsAtomically(
      outputOwnership,
      artifacts.manifestText,
      artifacts.summaryText,
    );
    return Object.freeze({ manifestPath, summaryPath });
  } catch (error) {
    await cleanupRisk001OwnedOutputDirectory(outputOwnership);
    throw error;
  }
}

export async function prepareRisk001DryRunCli(
  params: {
    readonly args: readonly string[];
    readonly backendRoot?: string;
  },
  configLoader: (backendRoot: string) => Risk001RuntimeConfig = loadRisk001RuntimeConfig,
): Promise<{
  readonly backendRoot: string;
  readonly options: Risk001CliOptions;
  readonly outputOwnership: Risk001OwnedOutputDirectory;
  readonly runtime: Risk001RuntimeConfig;
}> {
  const backendRoot = path.resolve(params.backendRoot ?? process.cwd());
  const options = parseRisk001CliArgs(params.args, backendRoot);
  const outputPreflight = await preflightRisk001OutputDirectory(options.outputDir, backendRoot);
  const outputOwnership = await acquireRisk001OutputDirectory(outputPreflight);
  try {
    const runtime = configLoader(backendRoot);
    return Object.freeze({ backendRoot, options, outputOwnership, runtime });
  } catch (error) {
    await cleanupRisk001OwnedOutputDirectory(outputOwnership);
    throw error;
  }
}

export function resolveSourceVersion(backendRoot: string): SourceVersionEvidence {
  const commit = runGit(backendRoot, ["rev-parse", "HEAD"]);
  const status = runGit(backendRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const trackedDiff = runGit(
    backendRoot,
    ["diff", "--no-ext-diff", "--binary", "HEAD", "--"],
  );
  const untrackedFiles = runGit(
    backendRoot,
    ["ls-files", "--others", "--exclude-standard"],
  )
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort();
  const untrackedContents = untrackedFiles.map((relativePath) => {
    const absolutePath = path.resolve(backendRoot, relativePath);
    const relative = path.relative(backendRoot, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
    try {
      return `${relativePath}\0${fsSync.readFileSync(absolutePath).toString("base64")}`;
    } catch {
      return `${relativePath}\0[UNREADABLE]`;
    }
  });
  return Object.freeze({
    gitCommit: /^[0-9a-f]{40}$/u.test(commit) ? commit : "GIT_COMMIT_UNAVAILABLE",
    workingTreeFingerprint: crypto
      .createHash("sha256")
      .update(`${commit}\n${status}\n${trackedDiff}\n${untrackedContents.join("\n")}`, "utf8")
      .digest("hex"),
    workingTreeDirty: status.length > 0,
  });
}

function runGit(backendRoot: string, args: readonly string[]): string {
  const result = spawnSync("git", args, { cwd: backendRoot, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

async function main(): Promise<void> {
  const result = await runRisk001DryRunCli({ args: process.argv.slice(2) });
  process.stdout.write(`manifest: ${result.manifestPath}\n`);
  process.stdout.write(`summary: ${result.summaryPath}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const failure = sanitizedFailure("VALIDATION_FAILED", error);
    process.stderr.write(`RISK-001 dry-run failed [${failure.category}]\n`);
    process.exitCode = 1;
  });
}
