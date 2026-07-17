import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertLexicallySafeBackendRoot,
  assertLexicallySafeOutputPath,
  deriveRisk001ProtectedOutputRoots,
  isContainedPath,
  Risk001PureContractError,
} from "./risk-001-cli-contract";
import { RISK001_NESTED_NONEXISTENT_OUTPUT_POLICY } from "./risk-001-completed-run-contract";

export interface Risk001OutputPreflight {
  readonly outputDir: string;
  readonly backendRealPath: string;
  readonly protectedRootRealPaths: readonly string[];
  readonly anchorPath: string;
  readonly anchorIdentity: string;
  readonly outputIdentity: string | null;
}

export interface Risk001OwnedOutputDirectory extends Risk001OutputPreflight {
  readonly outputIdentity: string;
  readonly outputRealPath: string;
  readonly createdForRun: boolean;
}

export interface Risk001OutputPublicationOperations {
  readonly rename: typeof fs.rename;
}

const DEFAULT_OUTPUT_PUBLICATION_OPERATIONS: Risk001OutputPublicationOperations = Object.freeze({
  rename: fs.rename,
});

/**
 * Non-mutating filesystem preflight. Production must acquire the returned
 * directory before loading configuration.
 */
export async function preflightRisk001OutputDirectory(
  outputDir: string,
  backendRoot: string,
): Promise<Risk001OutputPreflight> {
  const resolvedOutput = assertLexicallySafeOutputPath(outputDir, backendRoot);
  const resolvedBackend = assertLexicallySafeBackendRoot(backendRoot);
  const protectedRoots = deriveRisk001ProtectedOutputRoots(resolvedBackend);
  const [backendRealPath, ...evidenceRealPaths] = await Promise.all(
    protectedRoots.map((root) => verifiedRealPath(root, "Unable to verify a protected output root")),
  );
  const protectedRootRealPaths = Object.freeze([backendRealPath, ...evidenceRealPaths]);
  const chain = await inspectExistingPathChain(resolvedOutput);
  const outputStat = chain.outputStat;
  if (outputStat && !outputStat.isDirectory()) {
    throw new Risk001PureContractError("VALIDATION_FAILED", "Output path must not be an existing file");
  }
  if (outputStat) await assertOutputDirectoryEmpty(resolvedOutput, "VALIDATION_FAILED");
  if (RISK001_NESTED_NONEXISTENT_OUTPUT_POLICY === "REJECT_WHEN_ANY_INTERMEDIATE_PARENT_IS_MISSING" &&
    !outputStat && !samePath(chain.anchorPath, path.dirname(resolvedOutput))) {
    throw new Risk001PureContractError("VALIDATION_FAILED", "Output parent directory must already exist and be verifiable");
  }
  const anchorRealPath = await verifiedRealPath(chain.anchorPath, "Unable to verify the output parent real path");
  const resolvedTargetReal = outputStat
    ? await verifiedRealPath(resolvedOutput, "Unable to verify the output directory real path")
    : path.join(anchorRealPath, path.basename(resolvedOutput));
  assertOutsideProtectedRoots(resolvedTargetReal, protectedRootRealPaths);
  return Object.freeze({
    outputDir: resolvedOutput,
    backendRealPath,
    protectedRootRealPaths,
    anchorPath: chain.anchorPath,
    anchorIdentity: statIdentity(chain.anchorStat),
    outputIdentity: outputStat ? statIdentity(outputStat) : null,
  });
}

/** Creates only the final owned directory and verifies it before config/DB use. */
export async function acquireRisk001OutputDirectory(
  preflight: Risk001OutputPreflight,
): Promise<Risk001OwnedOutputDirectory> {
  let createdForRun = false;
  try {
    await assertIdentity(preflight.anchorPath, preflight.anchorIdentity, "Output parent identity changed after preflight");
    if (preflight.outputIdentity === null) {
      try {
        await fs.mkdir(preflight.outputDir, { recursive: false });
        createdForRun = true;
      } catch {
        throw new Risk001PureContractError("OUTPUT_FAILED", "Output path identity changed after preflight");
      }
    }
    const outputStat = await verifiedLstat(preflight.outputDir, "Unable to verify the acquired output directory");
    if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
      throw new Risk001PureContractError("OUTPUT_FAILED", "Acquired output path is not an owned directory");
    }
    if (preflight.outputIdentity && statIdentity(outputStat) !== preflight.outputIdentity) {
      throw new Risk001PureContractError("OUTPUT_FAILED", "Output path identity changed after preflight");
    }
    const outputRealPath = await verifiedRealPath(preflight.outputDir, "Unable to verify the acquired output real path");
    if (!samePath(outputRealPath, preflight.outputDir)) {
      throw new Risk001PureContractError("OUTPUT_FAILED", "Output path resolves through an unsupported alias or reparse point");
    }
    assertOutsideProtectedRoots(outputRealPath, preflight.protectedRootRealPaths);
    await assertOutputDirectoryEmpty(preflight.outputDir, "OUTPUT_FAILED");
    return Object.freeze({
      ...preflight,
      outputIdentity: statIdentity(outputStat),
      outputRealPath,
      createdForRun,
    });
  } catch (error) {
    if (createdForRun) await removeOwnedEmptyDirectory(preflight.outputDir);
    if (error instanceof Risk001PureContractError) throw error;
    throw new Risk001PureContractError("OUTPUT_FAILED", error instanceof Error ? error.message : String(error));
  }
}

export async function writeExactlyTwoOutputsAtomically(
  preflightOrOwnership: Risk001OutputPreflight | Risk001OwnedOutputDirectory,
  manifestText: string,
  summaryText: string,
  operations: Risk001OutputPublicationOperations = DEFAULT_OUTPUT_PUBLICATION_OPERATIONS,
): Promise<void> {
  const ownership = isOwnedOutputDirectory(preflightOrOwnership)
    ? preflightOrOwnership
    : await acquireRisk001OutputDirectory(preflightOrOwnership);
  const outputDir = ownership.outputDir;
  const manifestPath = path.join(outputDir, "manifest.json");
  const summaryPath = path.join(outputDir, "SUMMARY.md");
  const runId = crypto.randomUUID();
  const manifestTemp = path.join(outputDir, `.manifest.json.${runId}.tmp`);
  const summaryTemp = path.join(outputDir, `.SUMMARY.md.${runId}.tmp`);
  let manifestTempIdentity: string | null = null;
  let summaryTempIdentity: string | null = null;
  try {
    await assertOwnershipUnchanged(ownership);
    await assertDirectoryEntries(outputDir, [], "Output directory is no longer empty");
    await fs.writeFile(manifestTemp, manifestText, { encoding: "utf8", flag: "wx" });
    await fs.writeFile(summaryTemp, summaryText, { encoding: "utf8", flag: "wx" });
    manifestTempIdentity = statIdentity(await verifiedLstat(manifestTemp, "Unable to verify owned manifest temporary output"));
    summaryTempIdentity = statIdentity(await verifiedLstat(summaryTemp, "Unable to verify owned summary temporary output"));
    await assertOwnershipUnchanged(ownership);
    await assertDirectoryEntries(
      outputDir,
      [path.basename(manifestTemp), path.basename(summaryTemp)],
      "Output ownership changed before publication",
    );
    await operations.rename(summaryTemp, summaryPath);
    await assertIdentity(summaryPath, summaryTempIdentity, "Summary publication identity could not be verified");
    await assertOwnershipUnchanged(ownership);
    await assertDirectoryEntries(
      outputDir,
      ["SUMMARY.md", path.basename(manifestTemp)],
      "Output ownership changed during publication",
    );
    await operations.rename(manifestTemp, manifestPath);
    await assertIdentity(manifestPath, manifestTempIdentity, "Manifest publication identity could not be verified");
    await assertOwnershipUnchanged(ownership);
    await assertDirectoryEntries(
      outputDir,
      ["SUMMARY.md", "manifest.json"],
      "Output ownership changed after completion publication",
    );
  } catch (error) {
    await Promise.all([fs.rm(manifestTemp, { force: true }), fs.rm(summaryTemp, { force: true })]);
    if (manifestTempIdentity) await removeFileOnlyIfIdentityMatches(manifestPath, manifestTempIdentity);
    if (error instanceof Risk001PureContractError) throw error;
    throw new Risk001PureContractError("OUTPUT_FAILED", error instanceof Error ? error.message : String(error));
  }
}

/** Removes only an empty directory created by this run; foreign content is untouched. */
export async function cleanupRisk001OwnedOutputDirectory(
  ownership: Risk001OwnedOutputDirectory,
): Promise<void> {
  if (!ownership.createdForRun) return;
  try {
    await assertOwnershipUnchanged(ownership);
    await assertOutputDirectoryEmpty(ownership.outputDir, "OUTPUT_FAILED");
    await fs.rmdir(ownership.outputDir);
  } catch {
    // Failures never authorize removal of a changed, occupied, or ambiguous path.
  }
}

async function inspectExistingPathChain(outputDir: string): Promise<{
  readonly anchorPath: string;
  readonly anchorStat: Awaited<ReturnType<typeof fs.lstat>>;
  readonly outputStat: Awaited<ReturnType<typeof fs.lstat>> | null;
}> {
  const pathApi = /^[A-Za-z]:[\\/]/u.test(outputDir) ? path.win32 : path;
  const parsed = pathApi.parse(outputDir);
  const parts = outputDir.slice(parsed.root.length).split(/[\\/]/u).filter(Boolean);
  let current = parsed.root;
  let anchorPath = parsed.root;
  let anchorStat = await verifiedLstat(parsed.root, "Unable to verify the output filesystem root");
  if (anchorStat.isSymbolicLink()) {
    throw new Risk001PureContractError("VALIDATION_FAILED", "Reparse-point output ancestors are not supported");
  }
  await assertPathDoesNotResolveThroughAlias(parsed.root, pathApi);
  let outputStat: Awaited<ReturnType<typeof fs.lstat>> | null = parts.length === 0 ? anchorStat : null;
  for (const [index, part] of parts.entries()) {
    current = pathApi.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Risk001PureContractError("VALIDATION_FAILED", "Reparse-point output paths are not supported");
      }
      await assertPathDoesNotResolveThroughAlias(current, pathApi);
      if (index < parts.length - 1 && !stat.isDirectory()) {
        throw new Risk001PureContractError("VALIDATION_FAILED", "Output path has a non-directory ancestor");
      }
      anchorPath = current;
      anchorStat = stat;
      if (samePath(current, outputDir)) outputStat = stat;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return { anchorPath, anchorStat, outputStat };
}

async function assertPathDoesNotResolveThroughAlias(candidate: string, pathApi: typeof path): Promise<void> {
  const real = await verifiedRealPath(candidate, "Unable to verify an output ancestor real path");
  if (!samePath(real, candidate, pathApi)) {
    throw new Risk001PureContractError("VALIDATION_FAILED", "Output path resolves through an unsupported alias or reparse point");
  }
}

async function assertOutputDirectoryEmpty(
  outputDir: string,
  category: "VALIDATION_FAILED" | "OUTPUT_FAILED",
): Promise<void> {
  let existing: string[];
  try {
    existing = await fs.readdir(outputDir);
  } catch {
    throw new Risk001PureContractError(category, "Unable to verify output directory ownership");
  }
  if (existing.length > 0) {
    throw new Risk001PureContractError(category, "Output directory must be empty and unoccupied");
  }
}

async function assertDirectoryEntries(outputDir: string, expected: readonly string[], message: string): Promise<void> {
  let actual: string[];
  try {
    actual = (await fs.readdir(outputDir)).sort();
  } catch {
    throw new Risk001PureContractError("OUTPUT_FAILED", "Unable to verify output directory contents");
  }
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((name, index) => name !== sortedExpected[index])) {
    throw new Risk001PureContractError("OUTPUT_FAILED", message);
  }
  for (const name of actual) {
    const stat = await verifiedLstat(path.join(outputDir, name), "Unable to verify an output entry");
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Risk001PureContractError("OUTPUT_FAILED", "Output directory contains an unsupported entry type");
    }
  }
}

function assertOutsideProtectedRoots(candidate: string, protectedRoots: readonly string[]): void {
  if (protectedRoots.some((root) => isContainedPath(root, candidate))) {
    throw new Risk001PureContractError("VALIDATION_FAILED", "Output directory resolves inside a protected repository or evidence root");
  }
}

function statIdentity(stat: Awaited<ReturnType<typeof fs.lstat>>): string {
  if (![stat.dev, stat.ino, stat.mode].every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Risk001PureContractError("VALIDATION_FAILED", "Output path identity is unavailable");
  }
  return `${stat.dev}:${stat.ino}:${stat.mode}`;
}

async function assertIdentity(candidate: string, expected: string, message: string): Promise<void> {
  const stat = await verifiedLstat(candidate, message);
  if (stat.isSymbolicLink() || statIdentity(stat) !== expected) {
    throw new Risk001PureContractError("OUTPUT_FAILED", message);
  }
}

async function assertOwnershipUnchanged(ownership: Risk001OwnedOutputDirectory): Promise<void> {
  await assertIdentity(ownership.anchorPath, ownership.anchorIdentity, "Output parent identity changed after preflight");
  await assertIdentity(ownership.outputDir, ownership.outputIdentity, "Output path identity changed after preflight");
  const outputRealPath = await verifiedRealPath(ownership.outputDir, "Unable to revalidate output real path");
  if (!samePath(outputRealPath, ownership.outputRealPath)) {
    throw new Risk001PureContractError("OUTPUT_FAILED", "Output path real identity changed after preflight");
  }
  assertOutsideProtectedRoots(outputRealPath, ownership.protectedRootRealPaths);
}

async function verifiedRealPath(candidate: string, message: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch {
    throw new Risk001PureContractError("VALIDATION_FAILED", message);
  }
}

async function verifiedLstat(candidate: string, message: string): Promise<Awaited<ReturnType<typeof fs.lstat>>> {
  try {
    return await fs.lstat(candidate);
  } catch {
    throw new Risk001PureContractError("OUTPUT_FAILED", message);
  }
}

async function removeOwnedEmptyDirectory(outputDir: string): Promise<void> {
  try {
    if ((await fs.readdir(outputDir)).length === 0) await fs.rmdir(outputDir);
  } catch {
    // A changed or occupied path is never removed by cleanup.
  }
}

async function removeFileOnlyIfIdentityMatches(candidate: string, expectedIdentity: string): Promise<void> {
  try {
    const stat = await fs.lstat(candidate);
    if (!stat.isSymbolicLink() && stat.isFile() && statIdentity(stat) === expectedIdentity) {
      await fs.rm(candidate);
    }
  } catch {
    // Foreign or ambiguous content is never removed by cleanup.
  }
}

function samePath(left: string, right: string, pathApi: typeof path = /^[A-Za-z]:[\\/]/u.test(left) ? path.win32 : path): boolean {
  const normalize = (value: string): string => {
    const normalized = pathApi.normalize(value);
    return pathApi === path.win32 ? normalized.toLocaleLowerCase("en-US") : normalized;
  };
  return normalize(left) === normalize(right);
}

function isOwnedOutputDirectory(
  value: Risk001OutputPreflight | Risk001OwnedOutputDirectory,
): value is Risk001OwnedOutputDirectory {
  return "createdForRun" in value && "outputRealPath" in value && value.outputIdentity !== null;
}
