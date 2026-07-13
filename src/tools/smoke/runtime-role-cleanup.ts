import path from "node:path";
import dotenv from "dotenv";
import { Db, MongoClient } from "mongodb";
import { ActorScopeGrants } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { clearEnvCacheForTests, getEnv } from "@config/env";
import {
  normalizeRoleTemplateCode,
  RoleTemplateCode,
} from "@modules/role/domain/role-template.catalog";
import { RoleRecord } from "@modules/role/domain/role.types";
import { normalizeAssignmentScopeGrants } from "@modules/role/domain/role-assignment-scope-grants";

export type RuntimeRoleCleanupMode = "dry-run" | "write";

const TARGET_ROLE_CODE = "TEAM_MANAGER";
const STALE_PERMISSION_ALLOWLIST: readonly string[] = Object.freeze([
  Permission.WORK_SCHEDULE_CREATE,
  Permission.WORK_SCHEDULE_UPDATE,
  Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
]);
const STALE_WORK_SCHEDULE_SCOPE_ALLOWLIST = Object.freeze([
  "department",
  "global",
]);
const SCOPE_MODULES = [
  "workSchedule",
  "eventAssignment",
  "contractRegistry",
  "talentKpi",
  "kpi",
  "revenueLedger",
  "commission",
  "dashboardLite",
] as const;

type ScopeModule = (typeof SCOPE_MODULES)[number];

export class RuntimeRoleCleanupError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeRoleCleanupError";
    this.code = code;
  }
}

export interface RuntimeRoleCleanupInput {
  readonly roleCode: string;
  readonly mode: RuntimeRoleCleanupMode;
  readonly mongoDbName?: string;
}

export interface RuntimeRoleCleanupAssignmentSummary {
  readonly assignmentId: string;
  readonly userId: string;
  readonly currentScopeGrants: ActorScopeGrants;
  readonly currentScopeGrantsTargetedForRemoval: ActorScopeGrants;
  readonly preservedScopeGrants: ActorScopeGrants;
  readonly expectedScopeGrantsAfterCleanup: ActorScopeGrants;
  readonly updateNeeded: boolean;
  readonly updated: boolean;
}

export interface RuntimeRoleCleanupSummary {
  readonly roleCode: "TEAM_MANAGER";
  readonly mongoDbName?: string;
  readonly mode: RuntimeRoleCleanupMode;
  readonly roleExists: boolean;
  readonly currentPermissionsTargetedForRemoval: readonly string[];
  readonly preservedPermissions: readonly string[];
  readonly assignments: readonly RuntimeRoleCleanupAssignmentSummary[];
  readonly updateNeeded: boolean;
  readonly updated: boolean;
  readonly rolePermissionsUpdated: boolean;
  readonly assignmentsUpdated: number;
  readonly created: false;
}

interface RoleSnapshot {
  readonly id: string;
  readonly code: string;
  readonly state: RoleRecord["state"];
  readonly permissions: readonly string[];
}

interface AssignmentSnapshot {
  readonly assignmentId: string;
  readonly roleId: string;
  readonly userId: string;
  readonly scopeGrants?: ActorScopeGrants;
}

interface RuntimeRoleCleanupRepository {
  findByCode(code: "TEAM_MANAGER"): Promise<RoleSnapshot | null>;
  replacePermissions(input: {
    readonly roleId: string;
    readonly roleCode: "TEAM_MANAGER";
    readonly permissions: readonly string[];
    readonly updatedAt: number;
  }): Promise<RoleSnapshot | null>;
  listActiveAssignmentsByRoleId(
    roleId: string,
  ): Promise<readonly AssignmentSnapshot[]>;
  replaceAssignmentScopeGrants(input: {
    readonly assignmentId: string;
    readonly roleId: string;
    readonly userId: string;
    readonly scopeGrants: ActorScopeGrants;
    readonly updatedAt: number;
  }): Promise<AssignmentSnapshot | null>;
}

interface RuntimeRoleCleanupDependencies {
  readonly roleRepository: RuntimeRoleCleanupRepository;
  readonly now?: () => number;
  readonly permissionRemovalAllowlist?: readonly string[];
}

export class RuntimeRoleCleanupService {
  private readonly permissionRemovalAllowlist: readonly string[];

  constructor(private readonly deps: RuntimeRoleCleanupDependencies) {
    this.permissionRemovalAllowlist =
      deps.permissionRemovalAllowlist ?? STALE_PERMISSION_ALLOWLIST;
  }

  async run(
    input: RuntimeRoleCleanupInput,
  ): Promise<RuntimeRoleCleanupSummary> {
    const roleCode = normalizeCleanupRoleCode(input.roleCode);
    assertApprovedPermissionRemovalAllowlist(
      this.permissionRemovalAllowlist,
    );

    const role = await this.deps.roleRepository.findByCode(roleCode);
    if (!role) {
      return buildSummary({
        input,
        role: null,
        assignments: [],
        updated: false,
        rolePermissionsUpdated: false,
        assignmentsUpdated: 0,
        permissionRemovalAllowlist: this.permissionRemovalAllowlist,
      });
    }

    assertSafeRuntimeRole(role, roleCode);
    const assignments =
      await this.deps.roleRepository.listActiveAssignmentsByRoleId(role.id);
    const planned = buildSummary({
      input,
      role,
      assignments,
      updated: false,
      rolePermissionsUpdated: false,
      assignmentsUpdated: 0,
      permissionRemovalAllowlist: this.permissionRemovalAllowlist,
    });

    if (input.mode === "dry-run" || !planned.updateNeeded) {
      return planned;
    }

    let rolePermissionsUpdated = false;
    let assignmentsUpdated = 0;

    if (planned.currentPermissionsTargetedForRemoval.length > 0) {
      const updatedRole = await this.deps.roleRepository.replacePermissions({
        roleId: role.id,
        roleCode,
        permissions: planned.preservedPermissions,
        updatedAt: this.now(),
      });
      if (!updatedRole) {
        throw new RuntimeRoleCleanupError(
          "RUNTIME_ROLE_CLEANUP_ROLE_UPDATE_FAILED",
          `Failed to update runtime role permissions: ${roleCode}`,
        );
      }
      rolePermissionsUpdated = true;
    }

    for (const assignment of planned.assignments) {
      if (!assignment.updateNeeded) {
        continue;
      }

      const updatedAssignment =
        await this.deps.roleRepository.replaceAssignmentScopeGrants({
          assignmentId: assignment.assignmentId,
          roleId: role.id,
          userId: assignment.userId,
          scopeGrants: assignment.expectedScopeGrantsAfterCleanup,
          updatedAt: this.now(),
        });
      if (!updatedAssignment) {
        throw new RuntimeRoleCleanupError(
          "RUNTIME_ROLE_CLEANUP_ASSIGNMENT_UPDATE_FAILED",
          `Failed to update active assignment scope grants: ${assignment.assignmentId}`,
        );
      }
      assignmentsUpdated += 1;
    }

    const refreshedRole =
      (await this.deps.roleRepository.findByCode(roleCode)) ?? role;
    const refreshedAssignments =
      await this.deps.roleRepository.listActiveAssignmentsByRoleId(role.id);

    return buildSummary({
      input,
      role: refreshedRole,
      assignments: refreshedAssignments,
      updated: rolePermissionsUpdated || assignmentsUpdated > 0,
      rolePermissionsUpdated,
      assignmentsUpdated,
      permissionRemovalAllowlist: this.permissionRemovalAllowlist,
    });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

export function createRuntimeRoleCleanupService(params: {
  readonly mongoClient: MongoClient;
  readonly mongoDbName: string;
}): RuntimeRoleCleanupService {
  return new RuntimeRoleCleanupService({
    roleRepository: new MongoRuntimeRoleCleanupRepository(
      params.mongoClient.db(params.mongoDbName),
    ),
  });
}

interface RuntimeRoleDocument {
  readonly _id: string;
  readonly code: string;
  readonly state: RoleRecord["state"];
  readonly permissions?: readonly string[];
}

interface RuntimeRoleAssignmentDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly userId: string;
  readonly state: string;
  readonly scopeGrants?: ActorScopeGrants;
}

class MongoRuntimeRoleCleanupRepository
  implements RuntimeRoleCleanupRepository
{
  private readonly roles = this.db.collection<RuntimeRoleDocument>("roles");
  private readonly assignments =
    this.db.collection<RuntimeRoleAssignmentDocument>("role_assignments");

  constructor(private readonly db: Db) {}

  async findByCode(code: "TEAM_MANAGER"): Promise<RoleSnapshot | null> {
    const doc = await this.roles.findOne({ code });
    return doc
      ? {
          id: doc._id,
          code: doc.code,
          state: doc.state,
          permissions: [...(doc.permissions ?? [])],
        }
      : null;
  }

  async replacePermissions(input: {
    readonly roleId: string;
    readonly roleCode: "TEAM_MANAGER";
    readonly permissions: readonly string[];
    readonly updatedAt: number;
  }): Promise<RoleSnapshot | null> {
    const doc = await this.roles.findOneAndUpdate(
      {
        _id: input.roleId,
        code: input.roleCode,
        state: "ACTIVE",
      },
      {
        $set: {
          permissions: [...input.permissions],
          updatedAt: input.updatedAt,
        },
      },
      { returnDocument: "after" },
    );

    return doc
      ? {
          id: doc._id,
          code: doc.code,
          state: doc.state,
          permissions: [...(doc.permissions ?? [])],
        }
      : null;
  }

  async listActiveAssignmentsByRoleId(
    roleId: string,
  ): Promise<readonly AssignmentSnapshot[]> {
    const docs = await this.assignments
      .find({
        roleId,
        state: "ACTIVE",
      })
      .sort({ userId: 1, _id: 1 })
      .toArray();

    return docs.map((doc) => ({
      assignmentId: doc._id,
      roleId: doc.roleId,
      userId: doc.userId,
      ...(doc.scopeGrants ? { scopeGrants: doc.scopeGrants } : {}),
    }));
  }

  async replaceAssignmentScopeGrants(input: {
    readonly assignmentId: string;
    readonly roleId: string;
    readonly userId: string;
    readonly scopeGrants: ActorScopeGrants;
    readonly updatedAt: number;
  }): Promise<AssignmentSnapshot | null> {
    const updated = await this.assignments.findOneAndUpdate(
      {
        _id: input.assignmentId,
        roleId: input.roleId,
        userId: input.userId,
        state: "ACTIVE",
      },
      {
        $set: {
          scopeGrants: input.scopeGrants,
          updatedAt: input.updatedAt,
        },
      },
      { returnDocument: "after" },
    );

    return updated
      ? {
          assignmentId: updated._id,
          roleId: updated.roleId,
          userId: updated.userId,
          ...(updated.scopeGrants ? { scopeGrants: updated.scopeGrants } : {}),
        }
      : null;
  }
}

function buildSummary(params: {
  readonly input: RuntimeRoleCleanupInput;
  readonly role: RoleSnapshot | null;
  readonly assignments: readonly AssignmentSnapshot[];
  readonly updated: boolean;
  readonly rolePermissionsUpdated: boolean;
  readonly assignmentsUpdated: number;
  readonly permissionRemovalAllowlist: readonly string[];
}): RuntimeRoleCleanupSummary {
  const currentPermissions = params.role?.permissions ?? [];
  const currentPermissionsTargetedForRemoval = currentPermissions.filter(
    (permission) =>
      params.permissionRemovalAllowlist.includes(permission),
  );
  const preservedPermissions = currentPermissions.filter(
    (permission) =>
      !params.permissionRemovalAllowlist.includes(permission),
  );
  const assignmentSummaries = params.assignments.map((assignment) =>
    buildAssignmentSummary(assignment, false),
  );
  const updateNeeded =
    currentPermissionsTargetedForRemoval.length > 0 ||
    assignmentSummaries.some((assignment) => assignment.updateNeeded);

  return Object.freeze({
    roleCode: TARGET_ROLE_CODE,
    ...(params.input.mongoDbName
      ? { mongoDbName: params.input.mongoDbName }
      : {}),
    mode: params.input.mode,
    roleExists: params.role !== null,
    currentPermissionsTargetedForRemoval: [
      ...currentPermissionsTargetedForRemoval,
    ],
    preservedPermissions: [...preservedPermissions],
    assignments: assignmentSummaries,
    updateNeeded,
    updated: params.updated,
    rolePermissionsUpdated: params.rolePermissionsUpdated,
    assignmentsUpdated: params.assignmentsUpdated,
    created: false as const,
  });
}

function buildAssignmentSummary(
  assignment: AssignmentSnapshot,
  updated: boolean,
): RuntimeRoleCleanupAssignmentSummary {
  const currentScopeGrants =
    normalizeAssignmentScopeGrants(assignment.scopeGrants) ?? {};
  const staleWorkScheduleScopes = (
    currentScopeGrants.workSchedule ?? []
  ).filter((scope) =>
    STALE_WORK_SCHEDULE_SCOPE_ALLOWLIST.includes(scope),
  );
  const currentScopeGrantsTargetedForRemoval =
    staleWorkScheduleScopes.length > 0
      ? { workSchedule: staleWorkScheduleScopes }
      : {};
  const preservedScopeGrants = removeWorkScheduleScopes(
    currentScopeGrants,
    staleWorkScheduleScopes,
  );

  return Object.freeze({
    assignmentId: assignment.assignmentId,
    userId: assignment.userId,
    currentScopeGrants,
    currentScopeGrantsTargetedForRemoval,
    preservedScopeGrants,
    expectedScopeGrantsAfterCleanup: preservedScopeGrants,
    updateNeeded: staleWorkScheduleScopes.length > 0,
    updated,
  });
}

function removeWorkScheduleScopes(
  scopeGrants: Readonly<ActorScopeGrants>,
  removals: readonly string[],
): ActorScopeGrants {
  const removalSet = new Set(removals);
  const cleaned: Partial<Record<ScopeModule, readonly string[]>> = {};

  for (const module of SCOPE_MODULES) {
    const values = scopeGrants[module] ?? [];
    if (values.length === 0) {
      continue;
    }

    cleaned[module] =
      module === "workSchedule"
        ? values.filter((value) => !removalSet.has(value))
        : values;
  }

  return normalizeAssignmentScopeGrants(cleaned) ?? {};
}

function assertApprovedPermissionRemovalAllowlist(
  permissionRemovalAllowlist: readonly string[],
): void {
  const approved = new Set(STALE_PERMISSION_ALLOWLIST);
  for (const permission of permissionRemovalAllowlist) {
    if (!approved.has(permission)) {
      throw new RuntimeRoleCleanupError(
        "RUNTIME_ROLE_CLEANUP_UNAPPROVED_PERMISSION_REMOVAL",
        `Runtime role cleanup is not approved to remove permission: ${permission}`,
      );
    }
  }
}

function normalizeCleanupRoleCode(value: string): "TEAM_MANAGER" {
  const normalized = normalizeRoleTemplateCode(value);
  if (normalized !== TARGET_ROLE_CODE) {
    throw new RuntimeRoleCleanupError(
      "RUNTIME_ROLE_CLEANUP_UNSUPPORTED_ROLE",
      `Runtime role cleanup only supports ${TARGET_ROLE_CODE}: ${value}`,
    );
  }

  return TARGET_ROLE_CODE;
}

function assertSafeRuntimeRole(
  role: RoleSnapshot,
  expectedCode: "TEAM_MANAGER",
): void {
  if (role.code !== expectedCode) {
    throw new RuntimeRoleCleanupError(
      "RUNTIME_ROLE_CLEANUP_ROLE_CODE_CONFLICT",
      `Runtime role code mismatch: ${expectedCode}`,
    );
  }

  if (role.state !== "ACTIVE") {
    throw new RuntimeRoleCleanupError(
      "RUNTIME_ROLE_CLEANUP_ROLE_STATE_CONFLICT",
      `Runtime role exists but is not ACTIVE: ${expectedCode}`,
    );
  }
}

interface CliOptions {
  readonly envFile?: string;
  readonly roleCode?: "TEAM_MANAGER";
  readonly mode: RuntimeRoleCleanupMode;
  readonly help: boolean;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let envFile: string | undefined;
  const roleCodes: string[] = [];
  let confirm = false;
  let dryRun = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--confirm-runtime-role-cleanup") {
      confirm = true;
      continue;
    }

    if (arg === "--roles") {
      throw new RuntimeRoleCleanupError(
        "RUNTIME_ROLE_CLEANUP_MULTIPLE_ROLES_FORBIDDEN",
        "Runtime role cleanup requires a single --role",
      );
    }

    if (arg === "--env-file" || arg === "--role") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new RuntimeRoleCleanupError(
          "RUNTIME_ROLE_CLEANUP_CLI_VALUE_MISSING",
          `${arg} requires a value`,
        );
      }

      if (arg === "--env-file") {
        envFile = value;
      } else {
        roleCodes.push(value);
      }
      index += 1;
      continue;
    }

    throw new RuntimeRoleCleanupError(
      "RUNTIME_ROLE_CLEANUP_CLI_FLAG_UNSUPPORTED",
      `Unsupported CLI flag: ${arg ?? ""}`,
    );
  }

  if (confirm && dryRun) {
    throw new RuntimeRoleCleanupError(
      "RUNTIME_ROLE_CLEANUP_CLI_MODE_CONFLICT",
      "--dry-run cannot be combined with --confirm-runtime-role-cleanup",
    );
  }

  if (help) {
    return {
      ...(envFile ? { envFile } : {}),
      ...(roleCodes[0]
        ? { roleCode: normalizeCliRoleCode(roleCodes[0]) }
        : {}),
      mode: confirm ? "write" : "dry-run",
      help,
    };
  }

  if (!envFile) {
    throw new RuntimeRoleCleanupError(
      "RUNTIME_ROLE_CLEANUP_ENV_FILE_REQUIRED",
      "Runtime role cleanup requires --env-file .env.dev",
    );
  }

  if (!isDevEnvFile(envFile)) {
    throw new RuntimeRoleCleanupError(
      "RUNTIME_ROLE_CLEANUP_ENV_FILE_MUST_BE_DEV",
      "Runtime role cleanup requires --env-file .env.dev",
    );
  }

  if (roleCodes.length !== 1) {
    throw new RuntimeRoleCleanupError(
      "RUNTIME_ROLE_CLEANUP_ROLE_REQUIRED",
      "Runtime role cleanup requires exactly one --role TEAM_MANAGER",
    );
  }

  return {
    envFile,
    roleCode: normalizeCliRoleCode(roleCodes[0]),
    mode: confirm ? "write" : "dry-run",
    help,
  };
}

function normalizeCliRoleCode(value: string): "TEAM_MANAGER" {
  if (value.includes(",")) {
    throw new RuntimeRoleCleanupError(
      "RUNTIME_ROLE_CLEANUP_MULTIPLE_ROLES_FORBIDDEN",
      "Runtime role cleanup requires a single --role TEAM_MANAGER",
    );
  }

  return normalizeCleanupRoleCode(value);
}

function isDevEnvFile(value: string | undefined): boolean {
  return value === ".env.dev";
}

function assertSafeRuntimeForWrite(): void {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "production") {
    throw new RuntimeRoleCleanupError(
      "RUNTIME_ROLE_CLEANUP_PRODUCTION_FORBIDDEN",
      "Runtime role cleanup write mode is forbidden when NODE_ENV=production",
    );
  }
}

export function formatRuntimeRoleCleanupSummary(
  summary: RuntimeRoleCleanupSummary,
): string {
  return JSON.stringify(summary, null, 2);
}

function helpText(): string {
  return [
    "Runtime role cleanup",
    "",
    "Dry run:",
    "  npm run role:cleanup-runtime -- --env-file .env.dev --role TEAM_MANAGER --dry-run",
    "",
    "Write mode:",
    "  npm run role:cleanup-runtime -- --env-file .env.dev --role TEAM_MANAGER --confirm-runtime-role-cleanup",
    "",
    "Notes:",
    "  Dry-run is the default.",
    "  Only TEAM_MANAGER is supported.",
    "  Removes only approved stale WorkSchedule mutation permissions.",
    "  Removes only stale workSchedule department/global scope grants from active TEAM_MANAGER assignments.",
    "  Does not create roles and does not touch other roles.",
  ].join("\n");
}

async function runCli(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  if (!options.envFile || !options.roleCode) {
    throw new RuntimeRoleCleanupError(
      "RUNTIME_ROLE_CLEANUP_CLI_INVALID_STATE",
      "Runtime role cleanup requires --env-file .env.dev --role TEAM_MANAGER",
    );
  }

  dotenv.config({
    path: path.resolve(process.cwd(), options.envFile),
    override: true,
  });
  clearEnvCacheForTests();

  if (options.mode === "write") {
    assertSafeRuntimeForWrite();
  }

  const env = getEnv();
  const client = new MongoClient(env.MONGO_URI, {
    maxPoolSize: env.MONGO_MAX_POOL_SIZE,
  });

  try {
    await client.connect();
    const service = createRuntimeRoleCleanupService({
      mongoClient: client,
      mongoDbName: env.MONGO_DB_NAME,
    });
    const summary = await service.run({
      roleCode: options.roleCode,
      mode: options.mode,
      mongoDbName: env.MONGO_DB_NAME,
    });

    console.log(formatRuntimeRoleCleanupSummary(summary));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  runCli().catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Runtime role cleanup failed";
    console.error(redactForOutput(message));
    process.exitCode = 1;
  });
}

function redactForOutput(value: string): string {
  return value
    .replace(/auth0\|[^\s]+/giu, "auth0|[redacted]")
    .replace(
      /([A-Z0-9._%+-]{1,2})[A-Z0-9._%+-]*@([A-Z0-9.-]+\.[A-Z]{2,})/giu,
      "$1***@$2",
    )
    .replace(/(password|secret|token|ticket)=\S+/giu, "$1=[redacted]")
    .replace(/mongodb(\+srv)?:\/\/\S+/giu, "[redacted-mongo-uri]");
}
