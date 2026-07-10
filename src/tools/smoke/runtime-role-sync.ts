import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { Db, MongoClient } from "mongodb";
import { clearEnvCacheForTests, getEnv } from "@config/env";
import { RoleRecord } from "@modules/role/domain/role.types";
import {
  evaluateRoleTemplateAssignability,
  getRoleTemplate,
  isRoleTemplateCode,
  normalizeRoleTemplateCode,
  ROLE_TEMPLATE_CODES,
  RoleTemplateCode,
  RoleTemplateDefinition,
} from "@modules/role/domain/role-template.catalog";

export type RuntimeRoleSyncMode = "dry-run" | "write";

export class RuntimeRoleSyncError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeRoleSyncError";
    this.code = code;
  }
}

export interface RuntimeRoleSyncInput {
  readonly roleCode: string;
  readonly mode: RuntimeRoleSyncMode;
  readonly mongoDbName?: string;
}

export interface RuntimeRoleSyncSummary {
  readonly roleCode: RoleTemplateCode;
  readonly mongoDbName?: string;
  readonly mode: RuntimeRoleSyncMode;
  readonly roleExists: boolean;
  readonly missingPermissions: readonly string[];
  readonly extraPermissions: readonly string[];
  readonly roleActive: boolean;
  readonly activationNeeded: boolean;
  readonly updateNeeded: boolean;
  readonly updated: boolean;
  readonly created: boolean;
  readonly activated: boolean;
}

export const SOURCE_READY_ASSIGNABLE_RUNTIME_ROLE_CODES = Object.freeze(
  ROLE_TEMPLATE_CODES.filter((code) => {
    const template = getRoleTemplate(code);
    return evaluateRoleTemplateAssignability(template).assignable;
  }),
);

interface RuntimeRoleSyncRepository {
  findByCode(code: string): Promise<RoleRecord | null>;
  replacePermissions(input: {
    readonly roleId: string;
    readonly roleCode: RoleTemplateCode;
    readonly permissions: readonly string[];
    readonly updatedAt: number;
  }): Promise<RoleRecord | null>;
  createFromTemplate(input: {
    readonly roleId: string;
    readonly template: RoleTemplateDefinition;
    readonly now: number;
  }): Promise<RoleRecord>;
  activateFromTemplate(input: {
    readonly roleId: string;
    readonly roleCode: RoleTemplateCode;
    readonly permissions: readonly string[];
    readonly templateVersion: string;
    readonly updatedAt: number;
  }): Promise<RoleRecord | null>;
}

interface RuntimeRoleSyncDependencies {
  readonly roleRepository: RuntimeRoleSyncRepository;
  readonly now?: () => number;
}

export class RuntimeRoleSyncService {
  constructor(private readonly deps: RuntimeRoleSyncDependencies) {}

  async run(input: RuntimeRoleSyncInput): Promise<RuntimeRoleSyncSummary> {
    const roleCode = normalizeTargetRoleCode(input.roleCode);
    const template = getRoleTemplate(roleCode);
    if (!template) {
      throw new RuntimeRoleSyncError(
        "RUNTIME_ROLE_SYNC_TEMPLATE_MISSING",
        `Runtime role sync template is missing: ${roleCode}`,
      );
    }
    const readiness = evaluateRoleTemplateAssignability(template);
    if (!readiness.assignable) {
      throw new RuntimeRoleSyncError(
        "RUNTIME_ROLE_SYNC_TEMPLATE_NOT_ASSIGNABLE",
        `Runtime role sync target is not source-ready assignable: ${roleCode}`,
      );
    }

    const role = await this.deps.roleRepository.findByCode(roleCode);
    if (!role) {
      if (input.mode === "dry-run") {
        return buildSummary({
          input,
          roleCode,
          role: null,
          templatePermissions: template.permissions,
          updated: false,
          created: false,
          activated: false,
        });
      }

      const created = await this.deps.roleRepository.createFromTemplate({
        roleId: crypto.randomUUID(),
        template,
        now: this.now(),
      });
      return buildSummary({
        input,
        roleCode,
        role: created,
        templatePermissions: template.permissions,
        updated: true,
        created: true,
        activated: true,
      });
    }

    assertSafeRuntimeRoleCode(role, roleCode);
    const preWriteSummary = buildSummary({
      input,
      roleCode,
      role,
      templatePermissions: template.permissions,
      updated: false,
      created: false,
      activated: false,
    });

    if (input.mode === "dry-run" || !preWriteSummary.updateNeeded) {
      return preWriteSummary;
    }

    const permissions = mergePermissionCodeSets(
      role.permissions,
      preWriteSummary.missingPermissions,
    );

    if (preWriteSummary.activationNeeded) {
      const activated = await this.deps.roleRepository.activateFromTemplate({
        roleId: role.id,
        roleCode,
        permissions,
        templateVersion: template.version,
        updatedAt: this.now(),
      });
      if (!activated) {
        throw new RuntimeRoleSyncError(
          "RUNTIME_ROLE_SYNC_ACTIVATION_FAILED",
          `Failed to activate runtime role: ${roleCode}`,
        );
      }
      return buildSummary({
        input,
        roleCode,
        role: activated,
        templatePermissions: template.permissions,
        updated: true,
        created: false,
        activated: true,
      });
    }

    const updated = await this.deps.roleRepository.replacePermissions({
      roleId: role.id,
      roleCode,
      permissions,
      updatedAt: this.now(),
    });
    if (!updated) {
      throw new RuntimeRoleSyncError(
        "RUNTIME_ROLE_SYNC_UPDATE_FAILED",
        `Failed to update runtime role permissions: ${roleCode}`,
      );
    }

    return buildSummary({
      input,
      roleCode,
      role: updated,
      templatePermissions: template.permissions,
      updated: true,
      created: false,
      activated: false,
    });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

export function createRuntimeRoleSyncService(params: {
  readonly mongoClient: MongoClient;
  readonly mongoDbName: string;
}): RuntimeRoleSyncService {
  return new RuntimeRoleSyncService({
    roleRepository: new MongoRuntimeRoleSyncRepository(
      params.mongoClient.db(params.mongoDbName),
    ),
  });
}

interface RuntimeRoleDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly state: RoleRecord["state"];
  readonly permissions: readonly string[];
  readonly delegationBand?: RoleRecord["delegationBand"];
  readonly maxDelegatableBand?: RoleRecord["maxDelegatableBand"];
  readonly templateCode?: string;
  readonly templateVersion?: string;
  readonly templateAppliedAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
}

class MongoRuntimeRoleSyncRepository implements RuntimeRoleSyncRepository {
  private readonly roles;

  constructor(db: Db) {
    this.roles = db.collection<RuntimeRoleDocument>("roles");
  }

  async findByCode(code: string): Promise<RoleRecord | null> {
    const doc = await this.roles.findOne({ code });
    return doc ? toRoleRecord(doc) : null;
  }

  async replacePermissions(input: {
    readonly roleId: string;
    readonly roleCode: RoleTemplateCode;
    readonly permissions: readonly string[];
    readonly updatedAt: number;
  }): Promise<RoleRecord | null> {
    const doc = await this.roles.findOneAndUpdate(
      { _id: input.roleId, code: input.roleCode, state: "ACTIVE" },
      {
        $set: {
          permissions: [...input.permissions],
          updatedAt: input.updatedAt,
        },
      },
      { returnDocument: "after" },
    );

    return doc ? toRoleRecord(doc) : null;
  }

  async createFromTemplate(input: {
    readonly roleId: string;
    readonly template: RoleTemplateDefinition;
    readonly now: number;
  }): Promise<RoleRecord> {
    const document: RuntimeRoleDocument = {
      _id: input.roleId,
      code: input.template.code,
      name: input.template.name,
      description: input.template.description,
      state: "ACTIVE",
      permissions: [...input.template.permissions],
      delegationBand: "LIMITED",
      maxDelegatableBand: "NONE",
      templateCode: input.template.code,
      templateVersion: input.template.version,
      templateAppliedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
      activatedAt: input.now,
      archivedAt: null,
    };
    await this.roles.insertOne(document);
    return toRoleRecord(document);
  }

  async activateFromTemplate(input: {
    readonly roleId: string;
    readonly roleCode: RoleTemplateCode;
    readonly permissions: readonly string[];
    readonly templateVersion: string;
    readonly updatedAt: number;
  }): Promise<RoleRecord | null> {
    const doc = await this.roles.findOneAndUpdate(
      { _id: input.roleId, code: input.roleCode },
      {
        $set: {
          state: "ACTIVE",
          permissions: [...input.permissions],
          templateCode: input.roleCode,
          templateVersion: input.templateVersion,
          templateAppliedAt: input.updatedAt,
          updatedAt: input.updatedAt,
          activatedAt: input.updatedAt,
          archivedAt: null,
        },
      },
      { returnDocument: "after" },
    );

    return doc ? toRoleRecord(doc) : null;
  }
}

function toRoleRecord(document: RuntimeRoleDocument): RoleRecord {
  return {
    id: document._id,
    code: document.code,
    name: document.name,
    description: document.description,
    state: document.state,
    permissions: [...document.permissions],
    delegationBand: document.delegationBand ?? "LIMITED",
    maxDelegatableBand: document.maxDelegatableBand ?? "NONE",
    ...(typeof document.templateCode === "string" &&
    isRoleTemplateCode(document.templateCode)
      ? { templateCode: document.templateCode }
      : {}),
    ...(typeof document.templateVersion === "string"
      ? { templateVersion: document.templateVersion }
      : {}),
    ...(typeof document.templateAppliedAt === "number"
      ? { templateAppliedAt: document.templateAppliedAt }
      : {}),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    activatedAt: document.activatedAt,
    archivedAt: document.archivedAt,
  };
}

function buildSummary(params: {
  readonly input: RuntimeRoleSyncInput;
  readonly roleCode: RoleTemplateCode;
  readonly role: RoleRecord | null;
  readonly templatePermissions: readonly string[];
  readonly updated: boolean;
  readonly created: boolean;
  readonly activated: boolean;
}): RuntimeRoleSyncSummary {
  const currentPermissions = params.role?.permissions ?? [];
  const missingPermissions = setDifference(
    params.templatePermissions,
    currentPermissions,
  );
  const extraPermissions = setDifference(
    currentPermissions,
    params.templatePermissions,
  );

  return Object.freeze({
    roleCode: params.roleCode,
    ...(params.input.mongoDbName
      ? { mongoDbName: params.input.mongoDbName }
      : {}),
    mode: params.input.mode,
    roleExists: params.role !== null,
    missingPermissions,
    extraPermissions,
    roleActive: params.role?.state === "ACTIVE",
    activationNeeded: params.role !== null && params.role.state !== "ACTIVE",
    updateNeeded:
      params.role === null ||
      params.role.state !== "ACTIVE" ||
      missingPermissions.length > 0,
    updated: params.updated,
    created: params.created,
    activated: params.activated,
  });
}

export function formatRuntimeRoleSyncSummary(
  summary: RuntimeRoleSyncSummary,
): string {
  return [
    "Runtime role sync summary",
    `mode: ${summary.mode}`,
    `db: ${summary.mongoDbName ?? "not-provided"}`,
    `role: ${summary.roleCode}`,
    `roleExists: ${summary.roleExists}`,
    `roleActive: ${summary.roleActive}`,
    `missingPermissions: ${formatList(summary.missingPermissions)}`,
    `extraPermissions: ${formatList(summary.extraPermissions)}`,
    `activationNeeded: ${summary.activationNeeded}`,
    `updateNeeded: ${summary.updateNeeded}`,
    `updated: ${summary.updated}`,
    `created: ${summary.created}`,
    `activated: ${summary.activated}`,
  ].join("\n");
}

function normalizeTargetRoleCode(value: string): RoleTemplateCode {
  const normalized = normalizeRoleTemplateCode(value);
  if (!isRoleTemplateCode(normalized)) {
    throw new RuntimeRoleSyncError(
      "RUNTIME_ROLE_SYNC_UNSUPPORTED_ROLE",
      `Unsupported runtime role sync target: ${value}`,
    );
  }

  return normalized;
}

function assertSafeRuntimeRoleCode(
  role: RoleRecord,
  expectedCode: RoleTemplateCode,
): void {
  if (role.code !== expectedCode) {
    throw new RuntimeRoleSyncError(
      "RUNTIME_ROLE_SYNC_ROLE_CODE_CONFLICT",
      `Runtime role code mismatch: ${expectedCode}`,
    );
  }
}

function mergePermissionCodeSets(
  current: readonly string[],
  additions: readonly string[],
): readonly string[] {
  return [...new Set([...current, ...additions])];
}

function setDifference(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => !rightSet.has(value));
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

interface CliOptions {
  readonly envFile?: string;
  readonly roleCodes: readonly RoleTemplateCode[];
  readonly mode: RuntimeRoleSyncMode;
  readonly help: boolean;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let envFile: string | undefined;
  let roleCodes: readonly RoleTemplateCode[] = [];
  let confirm = false;
  let dryRun = false;
  let allSourceReadyAssignable = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--confirm-runtime-role-sync") {
      confirm = true;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--all-source-ready-assignable") {
      allSourceReadyAssignable = true;
      continue;
    }

    if (arg === "--env-file" || arg === "--roles") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new RuntimeRoleSyncError(
          "RUNTIME_ROLE_SYNC_CLI_VALUE_MISSING",
          `${arg} requires a value`,
        );
      }

      if (arg === "--env-file") {
        envFile = value;
      } else {
        roleCodes = parseRoleCodes(value);
      }
      index += 1;
      continue;
    }

    throw new RuntimeRoleSyncError(
      "RUNTIME_ROLE_SYNC_CLI_FLAG_UNSUPPORTED",
      `Unsupported CLI flag: ${arg ?? ""}`,
    );
  }

  if (confirm && dryRun) {
    throw new RuntimeRoleSyncError(
      "RUNTIME_ROLE_SYNC_CLI_MODE_CONFLICT",
      "--dry-run cannot be combined with --confirm-runtime-role-sync",
    );
  }

  if (confirm && !envFile) {
    throw new RuntimeRoleSyncError(
      "RUNTIME_ROLE_SYNC_ENV_FILE_REQUIRED_FOR_WRITE",
      "Runtime role sync write mode requires --env-file",
    );
  }

  if (confirm && !isDevEnvFile(envFile)) {
    throw new RuntimeRoleSyncError(
      "RUNTIME_ROLE_SYNC_ENV_FILE_MUST_BE_DEV",
      "Runtime role sync write mode requires --env-file .env.dev",
    );
  }

  if (help) {
    return {
      ...(envFile ? { envFile } : {}),
      roleCodes,
      mode: confirm ? "write" : "dry-run",
      help,
    };
  }

  if (allSourceReadyAssignable) {
    roleCodes = SOURCE_READY_ASSIGNABLE_RUNTIME_ROLE_CODES;
  }

  if (roleCodes.length === 0) {
    throw new RuntimeRoleSyncError(
      "RUNTIME_ROLE_SYNC_ROLES_REQUIRED",
      "Runtime role sync requires explicit --roles",
    );
  }

  return {
    ...(envFile ? { envFile } : {}),
    roleCodes,
    mode: confirm ? "write" : "dry-run",
    help,
  };
}

export function helpText(): string {
  return [
    "Runtime role sync",
    "",
    "Dry run:",
    "  npm run role:sync-runtime -- --env-file .env.dev --roles REVENUE_FINANCE_OPS,PRODUCTION_OPS,HR_OPERATIONS --dry-run",
    "  npm run role:sync-runtime -- --env-file .env.dev --all-source-ready-assignable --dry-run",
    "",
    "Write mode:",
    "  npm run role:sync-runtime -- --env-file .env.dev --roles REVENUE_FINANCE_OPS,PRODUCTION_OPS,HR_OPERATIONS --confirm-runtime-role-sync",
    "  npm run role:sync-runtime -- --env-file .env.dev --all-source-ready-assignable --confirm-runtime-role-sync",
    "",
    "Notes:",
    `  Supported role template codes: ${ROLE_TEMPLATE_CODES.join(", ")}.`,
    "  Use --all-source-ready-assignable to sync every catalog target that passes assignability readiness.",
    "  --roles or --all-source-ready-assignable is always required outside --help.",
    "  Write mode materializes missing source-ready roles, activates inactive rows, and union-adds missing template permissions.",
  ].join("\n");
}

function parseRoleCodes(value: string): readonly RoleTemplateCode[] {
  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (values.length === 0) {
    throw new RuntimeRoleSyncError(
      "RUNTIME_ROLE_SYNC_ROLES_REQUIRED",
      "Runtime role sync requires explicit --roles",
    );
  }

  return [...new Set(values.map((entry) => normalizeTargetRoleCode(entry)))];
}

function isDevEnvFile(value: string | undefined): boolean {
  return value !== undefined && path.basename(value) === ".env.dev";
}

function assertSafeRuntimeForWrite(): void {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "production") {
    throw new RuntimeRoleSyncError(
      "RUNTIME_ROLE_SYNC_PRODUCTION_FORBIDDEN",
      "Runtime role sync write mode is forbidden when NODE_ENV=production",
    );
  }
}

async function runCli(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  if (options.envFile) {
    dotenv.config({
      path: path.resolve(process.cwd(), options.envFile),
      override: true,
    });
    clearEnvCacheForTests();
  }

  if (options.mode === "write") {
    assertSafeRuntimeForWrite();
  }

  const env = getEnv();
  const client = new MongoClient(env.MONGO_URI, {
    maxPoolSize: env.MONGO_MAX_POOL_SIZE,
  });

  try {
    await client.connect();
    const service = createRuntimeRoleSyncService({
      mongoClient: client,
      mongoDbName: env.MONGO_DB_NAME,
    });
    const summaries: RuntimeRoleSyncSummary[] = [];
    for (const roleCode of options.roleCodes) {
      summaries.push(
        await service.run({
          roleCode,
          mode: options.mode,
          mongoDbName: env.MONGO_DB_NAME,
        }),
      );
    }
    console.log(summaries.map(formatRuntimeRoleSyncSummary).join("\n\n"));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  runCli().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Runtime role sync failed";
    console.error(redactForOutput(message));
    process.exitCode = 1;
  });
}

function redactForOutput(value: string): string {
  return value
    .replace(/auth0\|[^\s]+/giu, "[redacted-auth0-subject]")
    .replace(/(password|secret|token|ticket)=\S+/giu, "$1=[redacted]")
    .replace(/mongodb(\+srv)?:\/\/\S+/giu, "[redacted-mongo-uri]");
}
