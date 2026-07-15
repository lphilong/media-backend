import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import {
  loadAllRisk001PlannerInputs,
  RISK001_DEFAULT_PAGE_SIZE,
  RISK001_DEFAULT_SAFETY_CEILING,
} from "./risk-001-data-loaders";
import {
  Risk001SanitizedError,
  sanitizedFailure,
  withReadOnlyMongoGateway,
} from "./read-only-mongo.gateway";
import {
  buildRisk001DryRunManifest,
  renderRisk001Summary,
  SourceVersionEvidence,
} from "./risk-001-output";

export interface Risk001CliOptions {
  readonly outputDir: string;
  readonly maxSamples: number;
  readonly pretty: boolean;
  readonly runLabel?: string;
}

interface Risk001RuntimeConfig {
  readonly mongoUri: string;
  readonly mongoDbName: string;
}

const MUTATION_LIKE_ARGUMENT = /(?:write|apply|execute|repair|sync|cleanup|seed|migrate|delete|update|insert|replace|drop|create-index)/iu;

export function parseRisk001CliArgs(
  args: readonly string[],
  backendRoot: string = process.cwd(),
): Risk001CliOptions {
  let outputDir: string | undefined;
  let maxSamples = 5;
  let pretty = false;
  let runLabel: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (MUTATION_LIKE_ARGUMENT.test(arg)) {
      throw new Risk001SanitizedError("VALIDATION_FAILED", `Mutation-like argument is prohibited: ${arg}`);
    }
    switch (arg) {
      case "--output-dir":
        outputDir = requiredValue(args, ++index, arg);
        break;
      case "--max-samples": {
        const value = Number(requiredValue(args, ++index, arg));
        if (!Number.isInteger(value) || value < 1 || value > 10) {
          throw new Risk001SanitizedError("VALIDATION_FAILED", "--max-samples must be an integer from 1 through 10");
        }
        maxSamples = value;
        break;
      }
      case "--pretty":
        pretty = true;
        break;
      case "--run-label": {
        const value = requiredValue(args, ++index, arg);
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value)) {
          throw new Risk001SanitizedError("VALIDATION_FAILED", "--run-label must be a sanitized label of at most 64 characters");
        }
        runLabel = value;
        break;
      }
      default:
        throw new Risk001SanitizedError("VALIDATION_FAILED", `Unknown argument: ${arg}`);
    }
  }
  if (!outputDir) {
    throw new Risk001SanitizedError("VALIDATION_FAILED", "--output-dir is required");
  }
  if (!path.isAbsolute(outputDir)) {
    throw new Risk001SanitizedError("VALIDATION_FAILED", "--output-dir must be absolute");
  }
  const resolvedOutput = path.resolve(outputDir);
  const resolvedBackend = path.resolve(backendRoot);
  const relative = path.relative(resolvedBackend, resolvedOutput);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Risk001SanitizedError("VALIDATION_FAILED", "Output directory must be outside the backend source tree");
  }
  return Object.freeze({ outputDir: resolvedOutput, maxSamples, pretty, ...(runLabel ? { runLabel } : {}) });
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
  const backendRoot = path.resolve(params.backendRoot ?? process.cwd());
  const options = parseRisk001CliArgs(params.args, backendRoot);
  const runtime = loadRisk001RuntimeConfig(backendRoot);
  const observedAt = params.observedAt ?? Date.now();
  const source = resolveSourceVersion(backendRoot);
  const manifest = await withReadOnlyMongoGateway(
    { mongoUri: runtime.mongoUri, mongoDbName: runtime.mongoDbName },
    async (gateway) => {
      const loaded = await loadAllRisk001PlannerInputs(gateway, {
        observedAt,
        pageSize: RISK001_DEFAULT_PAGE_SIZE,
        safetyCeiling: RISK001_DEFAULT_SAFETY_CEILING,
      });
      return buildRisk001DryRunManifest({
        loaded,
        source,
        databaseName: runtime.mongoDbName,
        observedAt,
        maxSamples: options.maxSamples,
        ...(options.runLabel ? { runLabel: options.runLabel } : {}),
      });
    },
  );
  const manifestText = `${JSON.stringify(manifest, null, options.pretty ? 2 : 0)}\n`;
  const summaryText = renderRisk001Summary(manifest);
  const manifestPath = path.join(options.outputDir, "manifest.json");
  const summaryPath = path.join(options.outputDir, "SUMMARY.md");
  await writeExactlyTwoOutputsAtomically(options.outputDir, manifestText, summaryText);
  return Object.freeze({ manifestPath, summaryPath });
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

async function writeExactlyTwoOutputsAtomically(
  outputDir: string,
  manifestText: string,
  summaryText: string,
): Promise<void> {
  const manifestPath = path.join(outputDir, "manifest.json");
  const summaryPath = path.join(outputDir, "SUMMARY.md");
  const manifestTemp = path.join(outputDir, ".manifest.json.tmp");
  const summaryTemp = path.join(outputDir, ".SUMMARY.md.tmp");
  try {
    await fs.mkdir(outputDir, { recursive: true });
    const existing = await fs.readdir(outputDir);
    const unexpected = existing.filter((name) => !["manifest.json", "SUMMARY.md"].includes(name));
    if (unexpected.length > 0) {
      throw new Risk001SanitizedError("OUTPUT_FAILED", "Output directory must be empty or contain only prior RISK-001 outputs");
    }
    await fs.writeFile(manifestTemp, manifestText, { encoding: "utf8", flag: "wx" });
    await fs.writeFile(summaryTemp, summaryText, { encoding: "utf8", flag: "wx" });
    // Absence of manifest.json is the incomplete-run marker. Publish it last.
    await fs.rm(manifestPath, { force: true });
    await replaceFile(summaryTemp, summaryPath);
    await fs.rename(manifestTemp, manifestPath);
  } catch (error) {
    await Promise.all([fs.rm(manifestTemp, { force: true }), fs.rm(summaryTemp, { force: true })]);
    throw sanitizedFailure("OUTPUT_FAILED", error);
  }
}

async function replaceFile(tempPath: string, targetPath: string): Promise<void> {
  await fs.rm(targetPath, { force: true });
  await fs.rename(tempPath, targetPath);
}

function runGit(backendRoot: string, args: readonly string[]): string {
  const result = spawnSync("git", args, { cwd: backendRoot, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Risk001SanitizedError("VALIDATION_FAILED", `${flag} requires a value`);
  }
  return value;
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
