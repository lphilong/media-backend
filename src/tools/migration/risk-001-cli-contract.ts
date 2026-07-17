import path from "node:path";

export type Risk001PureFailureCategory =
  | "CONFIGURATION_FAILED"
  | "CONNECTION_FAILED"
  | "READ_FAILED"
  | "VALIDATION_FAILED"
  | "MANUAL_SCOPE_ESCALATION_REQUIRED"
  | "OUTPUT_FAILED";

/** Database-free error used by the CLI preflight and publication contracts. */
export class Risk001PureContractError extends Error {
  constructor(readonly category: Risk001PureFailureCategory, message: string) {
    super(sanitizePureMessage(message));
    this.name = "Risk001SanitizedError";
  }
}

export interface Risk001CliOptions {
  readonly outputDir: string;
  readonly maxSamples: number;
  readonly pretty: boolean;
  readonly runLabel?: string;
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
  const seenOptions = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (MUTATION_LIKE_ARGUMENT.test(arg)) throw new Risk001PureContractError("VALIDATION_FAILED", `Mutation-like argument is prohibited: ${arg}`);
    switch (arg) {
      case "--output-dir":
        assertOptionNotRepeated(seenOptions, arg);
        outputDir = requiredValue(args, ++index, arg);
        break;
      case "--max-samples": {
        assertOptionNotRepeated(seenOptions, arg);
        const value = Number(requiredValue(args, ++index, arg));
        if (!Number.isInteger(value) || value < 1 || value > 10) throw new Risk001PureContractError("VALIDATION_FAILED", "--max-samples must be an integer from 1 through 10");
        maxSamples = value;
        break;
      }
      case "--pretty":
        assertOptionNotRepeated(seenOptions, arg);
        pretty = true;
        break;
      case "--run-label": {
        assertOptionNotRepeated(seenOptions, arg);
        const value = requiredValue(args, ++index, arg);
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value)) throw new Risk001PureContractError("VALIDATION_FAILED", "--run-label must be a sanitized label of at most 64 characters");
        runLabel = value;
        break;
      }
      default:
        throw new Risk001PureContractError("VALIDATION_FAILED", `Unknown argument: ${arg}`);
    }
  }
  if (!outputDir) throw new Risk001PureContractError("VALIDATION_FAILED", "--output-dir is required");
  const resolvedOutput = assertLexicallySafeOutputPath(outputDir, backendRoot);
  return Object.freeze({ outputDir: resolvedOutput, maxSamples, pretty, ...(runLabel ? { runLabel } : {}) });
}

export function assertLexicallySafeBackendRoot(backendRoot: string): string {
  if (/^[A-Za-z]:[\\/]/u.test(backendRoot)) return path.win32.normalize(backendRoot.replace(/\//gu, "\\"));
  return path.resolve(backendRoot);
}

export function assertLexicallySafeOutputPath(outputDir: string, backendRoot: string): string {
  if (/^(?:\\\\|\/\/)/u.test(outputDir)) throw new Risk001PureContractError("VALIDATION_FAILED", "UNC output paths are not supported");
  if (/^[A-Za-z]:[^\\/]/u.test(outputDir)) throw new Risk001PureContractError("VALIDATION_FAILED", "Drive-relative output paths are not allowed");
  const windowsForm = /^[A-Za-z]:[\\/]/u.test(outputDir) || outputDir.includes("\\");
  const pathApi = windowsForm ? path.win32 : path;
  if (!pathApi.isAbsolute(outputDir)) throw new Risk001PureContractError("VALIDATION_FAILED", "--output-dir must be absolute");
  const normalizedInput = windowsForm ? outputDir.replace(/\//gu, "\\") : outputDir;
  const parsed = pathApi.parse(normalizedInput);
  const components = normalizedInput.slice(parsed.root.length).split(/[\\/]/u).filter(Boolean);
  const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;
  for (const component of components) {
    if (component === "." || component === "..") throw new Risk001PureContractError("VALIDATION_FAILED", "Output path aliases are not allowed");
    if (/[. ]$/u.test(component) || reserved.test(component) || /[<>:"|?*\u0000-\u001f]/u.test(component)) throw new Risk001PureContractError("VALIDATION_FAILED", "Output path contains an invalid Windows component");
  }
  const resolvedOutput = pathApi.resolve(normalizedInput);
  const resolvedBackend = windowsForm ? path.win32.resolve(assertLexicallySafeBackendRoot(backendRoot).replace(/\//gu, "\\")) : path.resolve(backendRoot);
  const protectedRoot = deriveRisk001ProtectedOutputRoots(resolvedBackend).find((root) =>
    isContainedPath(root, resolvedOutput),
  );
  if (protectedRoot) throw new Risk001PureContractError("VALIDATION_FAILED", "Output directory must be outside protected repository and evidence roots");
  return resolvedOutput;
}

export function isContainedPath(root: string, candidate: string): boolean {
  const pathApi = /^[A-Za-z]:[\\/]/u.test(root) ? path.win32 : path;
  const normalizedRoot = normalizePathIdentity(root, pathApi);
  const normalizedCandidate = normalizePathIdentity(candidate, pathApi);
  const relative = pathApi.relative(normalizedRoot, normalizedCandidate);
  return relative === "" || (!relative.startsWith("..") && !pathApi.isAbsolute(relative));
}

/** Frozen Batch A roots that can never be assessment-output targets. */
export function deriveRisk001ProtectedOutputRoots(backendRoot: string): readonly string[] {
  const normalizedBackend = assertLexicallySafeBackendRoot(backendRoot);
  const pathApi = /^[A-Za-z]:[\\/]/u.test(normalizedBackend) ? path.win32 : path;
  const workspaceRoot = pathApi.dirname(normalizedBackend);
  return Object.freeze([
    normalizedBackend,
    pathApi.join(workspaceRoot, ".codex-contract"),
    pathApi.join(workspaceRoot, ".codex-repair"),
    pathApi.join(workspaceRoot, ".codex-audit"),
  ].map((root) => pathApi.normalize(root)));
}

function normalizePathIdentity(value: string, pathApi: typeof path): string {
  const normalized = pathApi.normalize(value);
  return pathApi === path.win32 ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function assertOptionNotRepeated(seen: Set<string>, option: string): void {
  if (seen.has(option)) throw new Risk001PureContractError("VALIDATION_FAILED", `Repeated option is not allowed: ${option}`);
  seen.add(option);
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Risk001PureContractError("VALIDATION_FAILED", `${flag} requires a value`);
  return value;
}

function sanitizePureMessage(value: string): string {
  return value
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/giu, "[REDACTED_MONGO_URI]")
    .replace(/\b(?:MONGO_URI|MONGO_URL|AUTH0_CLIENT_SECRET|PASSWORD)\s*[=:]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .replace(/\b[\w.+-]+:[^@\s]+@(?=[\w.-]+)/gu, "[REDACTED_CREDENTIALS]@");
}
