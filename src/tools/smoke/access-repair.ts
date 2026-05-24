import crypto from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { Db, MongoClient } from "mongodb";
import { ActorScopeGrants } from "@core/actor/actor";
import { clearEnvCacheForTests, getEnv } from "@config/env";
import {
  getRoleTemplate,
  isRoleTemplateCode,
  normalizeRoleTemplateCode,
  ROLE_TEMPLATE_CODES,
  RoleTemplateCode,
} from "@modules/role/domain/role-template.catalog";
import { normalizeAssignmentScopeGrants } from "@modules/role/domain/role-assignment-scope-grants";

export type AccessRepairMode = "dry-run" | "write";

const AUTH_SECURITY_VERSION_COLLECTION = "auth_security_versions";
const AUTH_SECURITY_VERSION_DOCUMENT_ID = "admin.auth-security-version";

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

export class AccessRepairError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AccessRepairError";
    this.code = code;
  }
}

interface RoleSnapshot {
  readonly id: string;
  readonly code: RoleTemplateCode;
  readonly state: "ACTIVE" | string;
  readonly permissions: readonly string[];
}

interface AssignmentSnapshot {
  readonly assignmentId: string;
  readonly roleId: string;
  readonly userId: string;
  readonly scopeGrants?: ActorScopeGrants;
}

interface UserSnapshot {
  readonly id: string;
  readonly actorKind: "ADMIN" | "STAFF" | string;
  readonly accountStatus: string;
  readonly displayName: string;
  readonly email?: string;
  readonly authSubject?: string;
  readonly userScopeGrants?: ActorScopeGrants;
}

interface EmploymentProfileSnapshot {
  readonly id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly orgUnitId: string;
  readonly employmentStatus: string;
  readonly linkedUserId: string | null;
}

interface AccessRepairRepository {
  findActiveRoleByCode(code: RoleTemplateCode): Promise<RoleSnapshot | null>;
  listActiveAssignments(input: {
    readonly roleId: string;
    readonly userId?: string;
    readonly assignmentId?: string;
  }): Promise<readonly AssignmentSnapshot[]>;
  findUserById(userId: string): Promise<UserSnapshot | null>;
  findActiveEmploymentProfileByLinkedUserId(
    userId: string,
  ): Promise<EmploymentProfileSnapshot | null>;
  listEmploymentProfileCandidatesForUser(
    user: UserSnapshot,
  ): Promise<readonly EmploymentProfileSnapshot[]>;
  updateAssignmentScopeGrants(input: {
    readonly assignmentId: string;
    readonly roleId: string;
    readonly userId: string;
    readonly scopeGrants: ActorScopeGrants;
    readonly updatedAt: number;
  }): Promise<AssignmentSnapshot | null>;
  bumpAuthSecurityVersion(updatedAt: number): Promise<void>;
}

export interface AccessRepairInput {
  readonly roleCodes: readonly RoleTemplateCode[];
  readonly mode: AccessRepairMode;
  readonly mongoDbName?: string;
  readonly userId?: string;
  readonly assignmentId?: string;
}

export interface AccessRepairAssignmentSummary {
  readonly roleCode: RoleTemplateCode;
  readonly assignmentId: string;
  readonly userId: string;
  readonly user: {
    readonly displayName: string;
    readonly email?: string;
    readonly authSubject?: string;
    readonly actorKind: string;
    readonly accountStatus: string;
  } | null;
  readonly currentScopeGrants: ActorScopeGrants;
  readonly recommendedScopeGrants: Readonly<ActorScopeGrants>;
  readonly missingScopeGrants: ActorScopeGrants;
  readonly expectedScopeGrantsAfterRepair: ActorScopeGrants;
  readonly scopeRepairNeeded: boolean;
  readonly updated: boolean;
  readonly linkedEmploymentProfile: {
    readonly id: string;
    readonly employeeCode: string;
    readonly orgUnitId: string;
    readonly employmentStatus: string;
  } | null;
  readonly employmentProfileCandidates: readonly {
    readonly id: string;
    readonly employeeCode: string;
    readonly displayName: string;
    readonly orgUnitId: string;
    readonly employmentStatus: string;
  }[];
  readonly employmentProfileLinkageStatus:
    | "linked-active"
    | "manual-linkage-required"
    | "user-missing";
}

export interface AccessRepairRoleSummary {
  readonly roleCode: RoleTemplateCode;
  readonly roleExists: boolean;
  readonly rolePermissions: readonly string[];
  readonly templatePermissions: readonly string[];
  readonly missingRuntimePermissions: readonly string[];
  readonly extraRuntimePermissions: readonly string[];
  readonly assignments: readonly AccessRepairAssignmentSummary[];
}

export interface AccessRepairSummary {
  readonly mode: AccessRepairMode;
  readonly mongoDbName?: string;
  readonly roleSummaries: readonly AccessRepairRoleSummary[];
  readonly authSecurityVersionBumped: boolean;
}

export class AccessRepairService {
  constructor(
    private readonly repository: AccessRepairRepository,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async run(input: AccessRepairInput): Promise<AccessRepairSummary> {
    if (input.mode === "write" && !input.userId && !input.assignmentId) {
      throw new AccessRepairError(
        "ACCESS_REPAIR_WRITE_TARGET_REQUIRED",
        "Access repair write mode requires --user-id or --assignment-id",
      );
    }

    const roleSummaries: AccessRepairRoleSummary[] = [];
    let wroteScopeChange = false;

    for (const roleCode of input.roleCodes) {
      const template = getRoleTemplate(roleCode);
      if (!template) {
        throw new AccessRepairError(
          "ACCESS_REPAIR_TEMPLATE_MISSING",
          `Role template missing: ${roleCode}`,
        );
      }

      const role = await this.repository.findActiveRoleByCode(roleCode);
      if (!role) {
        roleSummaries.push({
          roleCode,
          roleExists: false,
          rolePermissions: [],
          templatePermissions: [...template.permissions],
          missingRuntimePermissions: [...template.permissions],
          extraRuntimePermissions: [],
          assignments: [],
        });
        continue;
      }

      assertSafeRuntimeRole(role, roleCode);
      const assignments = await this.repository.listActiveAssignments({
        roleId: role.id,
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
      });
      const assignmentSummaries: AccessRepairAssignmentSummary[] = [];

      for (const assignment of assignments) {
        const user = await this.repository.findUserById(assignment.userId);
        const currentScopeGrants = normalizeScopeGrantsOrEmpty(
          assignment.scopeGrants,
        );
        const recommendedScopeGrants = normalizeScopeGrantsOrEmpty(
          template.recommendedScopeGrants,
        );
        const missingScopeGrants = diffScopeGrants(
          recommendedScopeGrants,
          currentScopeGrants,
        );
        const expectedScopeGrantsAfterRepair = unionScopeGrants(
          currentScopeGrants,
          missingScopeGrants,
        );
        const scopeRepairNeeded = hasAnyScopeGrant(missingScopeGrants);
        let updated = false;

        if (input.mode === "write" && scopeRepairNeeded) {
          const updatedAssignment =
            await this.repository.updateAssignmentScopeGrants({
              assignmentId: assignment.assignmentId,
              roleId: assignment.roleId,
              userId: assignment.userId,
              scopeGrants: expectedScopeGrantsAfterRepair,
              updatedAt: this.now(),
            });
          if (!updatedAssignment) {
            throw new AccessRepairError(
              "ACCESS_REPAIR_ASSIGNMENT_UPDATE_FAILED",
              `Failed to update active assignment: ${assignment.assignmentId}`,
            );
          }
          updated = true;
          wroteScopeChange = true;
        }

        const linkedEmploymentProfile = user
          ? await this.repository.findActiveEmploymentProfileByLinkedUserId(
              user.id,
            )
          : null;
        const candidates =
          user && !linkedEmploymentProfile
            ? await this.repository.listEmploymentProfileCandidatesForUser(user)
            : [];

        assignmentSummaries.push({
          roleCode,
          assignmentId: assignment.assignmentId,
          userId: assignment.userId,
          user: user
            ? {
                displayName: user.displayName,
                ...(user.email ? { email: maskEmail(user.email) } : {}),
                ...(user.authSubject
                  ? { authSubject: maskAuthSubject(user.authSubject) }
                  : {}),
                actorKind: user.actorKind,
                accountStatus: user.accountStatus,
              }
            : null,
          currentScopeGrants,
          recommendedScopeGrants,
          missingScopeGrants,
          expectedScopeGrantsAfterRepair,
          scopeRepairNeeded,
          updated,
          linkedEmploymentProfile: linkedEmploymentProfile
            ? {
                id: linkedEmploymentProfile.id,
                employeeCode: linkedEmploymentProfile.employeeCode,
                orgUnitId: linkedEmploymentProfile.orgUnitId,
                employmentStatus: linkedEmploymentProfile.employmentStatus,
              }
            : null,
          employmentProfileCandidates: candidates.map((candidate) => ({
            id: candidate.id,
            employeeCode: candidate.employeeCode,
            displayName: candidate.displayName,
            orgUnitId: candidate.orgUnitId,
            employmentStatus: candidate.employmentStatus,
          })),
          employmentProfileLinkageStatus: !user
            ? "user-missing"
            : linkedEmploymentProfile
              ? "linked-active"
              : "manual-linkage-required",
        });
      }

      roleSummaries.push({
        roleCode,
        roleExists: true,
        rolePermissions: [...role.permissions],
        templatePermissions: [...template.permissions],
        missingRuntimePermissions: setDifference(
          template.permissions,
          role.permissions,
        ),
        extraRuntimePermissions: setDifference(
          role.permissions,
          template.permissions,
        ),
        assignments: assignmentSummaries,
      });
    }

    if (input.mode === "write" && wroteScopeChange) {
      await this.repository.bumpAuthSecurityVersion(this.now());
    }

    return {
      mode: input.mode,
      ...(input.mongoDbName ? { mongoDbName: input.mongoDbName } : {}),
      roleSummaries,
      authSecurityVersionBumped: input.mode === "write" && wroteScopeChange,
    };
  }
}

export function createAccessRepairService(params: {
  readonly mongoClient: MongoClient;
  readonly mongoDbName: string;
}): AccessRepairService {
  return new AccessRepairService(
    new MongoAccessRepairRepository(
      params.mongoClient.db(params.mongoDbName),
    ),
  );
}

interface RoleDocument {
  readonly _id: string;
  readonly code: string;
  readonly state: string;
  readonly permissions?: readonly string[];
}

interface RoleAssignmentDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly userId: string;
  readonly state: string;
  readonly scopeGrants?: ActorScopeGrants;
}

interface UserDocument {
  readonly _id: string;
  readonly actorKind: string;
  readonly accountStatus: string;
  readonly authLinkage?: {
    readonly subject?: string;
    readonly status?: string;
  };
  readonly profile?: {
    readonly displayName?: string;
    readonly email?: string;
  };
  readonly scopeGrants?: ActorScopeGrants;
}

interface EmploymentProfileDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly normalizedDisplayName?: string;
  readonly normalizedLegalName?: string;
  readonly orgUnitId: string;
  readonly employmentStatus: string;
  readonly linkedUserId: string | null;
}

interface AuthSecurityVersionDocument {
  readonly _id: string;
  readonly version: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

class MongoAccessRepairRepository implements AccessRepairRepository {
  private readonly roles = this.db.collection<RoleDocument>("roles");
  private readonly assignments =
    this.db.collection<RoleAssignmentDocument>("role_assignments");
  private readonly users = this.db.collection<UserDocument>("users");
  private readonly employmentProfiles =
    this.db.collection<EmploymentProfileDocument>("employment_profiles");

  constructor(private readonly db: Db) {}

  async findActiveRoleByCode(
    code: RoleTemplateCode,
  ): Promise<RoleSnapshot | null> {
    const doc = await this.roles.findOne({ code, state: "ACTIVE" });
    if (!doc) {
      return null;
    }

    return {
      id: doc._id,
      code,
      state: doc.state,
      permissions: [...(doc.permissions ?? [])],
    };
  }

  async listActiveAssignments(input: {
    readonly roleId: string;
    readonly userId?: string;
    readonly assignmentId?: string;
  }): Promise<readonly AssignmentSnapshot[]> {
    const query: Record<string, unknown> = {
      roleId: input.roleId,
      state: "ACTIVE",
    };
    if (input.userId) {
      query.userId = input.userId;
    }
    if (input.assignmentId) {
      query._id = input.assignmentId;
    }

    const docs = await this.assignments
      .find(query)
      .sort({ userId: 1, _id: 1 })
      .toArray();

    return docs.map((doc) => ({
      assignmentId: doc._id,
      roleId: doc.roleId,
      userId: doc.userId,
      ...(doc.scopeGrants ? { scopeGrants: doc.scopeGrants } : {}),
    }));
  }

  async findUserById(userId: string): Promise<UserSnapshot | null> {
    const doc = await this.users.findOne({ _id: userId });
    if (!doc) {
      return null;
    }

    return {
      id: doc._id,
      actorKind: doc.actorKind,
      accountStatus: doc.accountStatus,
      displayName: doc.profile?.displayName ?? doc._id,
      ...(doc.profile?.email ? { email: doc.profile.email } : {}),
      ...(doc.authLinkage?.subject
        ? { authSubject: doc.authLinkage.subject }
        : {}),
      ...(doc.scopeGrants ? { userScopeGrants: doc.scopeGrants } : {}),
    };
  }

  async findActiveEmploymentProfileByLinkedUserId(
    userId: string,
  ): Promise<EmploymentProfileSnapshot | null> {
    const doc = await this.employmentProfiles.findOne({
      linkedUserId: userId,
      employmentStatus: "ACTIVE",
    });

    return doc ? toEmploymentProfileSnapshot(doc) : null;
  }

  async listEmploymentProfileCandidatesForUser(
    user: UserSnapshot,
  ): Promise<readonly EmploymentProfileSnapshot[]> {
    const normalizedName = normalizeSearchName(user.displayName);
    const employeeCode = user.email?.split("@")[0]?.trim();
    const or: Record<string, unknown>[] = [];

    if (normalizedName) {
      or.push(
        { normalizedDisplayName: normalizedName },
        { normalizedLegalName: normalizedName },
      );
    }

    if (employeeCode) {
      or.push({ employeeCode });
    }

    if (or.length === 0) {
      return [];
    }

    const docs = await this.employmentProfiles
      .find({
        employmentStatus: "ACTIVE",
        linkedUserId: null,
        $or: or,
      })
      .sort({ employeeCode: 1, _id: 1 })
      .limit(5)
      .toArray();

    return docs.map(toEmploymentProfileSnapshot);
  }

  async updateAssignmentScopeGrants(input: {
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

  async bumpAuthSecurityVersion(updatedAt: number): Promise<void> {
    await this.db
      .collection<AuthSecurityVersionDocument>(
        AUTH_SECURITY_VERSION_COLLECTION,
      )
      .updateOne(
        {
          _id: AUTH_SECURITY_VERSION_DOCUMENT_ID,
        },
        {
          $set: {
            version: crypto.randomUUID(),
            updatedAt,
          },
          $setOnInsert: {
            createdAt: updatedAt,
          },
        },
        { upsert: true },
      );
  }
}

function toEmploymentProfileSnapshot(
  doc: EmploymentProfileDocument,
): EmploymentProfileSnapshot {
  return {
    id: doc._id,
    employeeCode: doc.employeeCode,
    displayName: doc.displayName,
    legalName: doc.legalName,
    orgUnitId: doc.orgUnitId,
    employmentStatus: doc.employmentStatus,
    linkedUserId: doc.linkedUserId,
  };
}

function assertSafeRuntimeRole(
  role: RoleSnapshot,
  expectedCode: RoleTemplateCode,
): void {
  if (role.code !== expectedCode || role.state !== "ACTIVE") {
    throw new AccessRepairError(
      "ACCESS_REPAIR_ROLE_CONFLICT",
      `Runtime role is not the expected active role: ${expectedCode}`,
    );
  }
}

function normalizeScopeGrantsOrEmpty(
  scopeGrants: ActorScopeGrants | undefined,
): ActorScopeGrants {
  return normalizeAssignmentScopeGrants(scopeGrants) ?? {};
}

function diffScopeGrants(
  expected: Readonly<ActorScopeGrants>,
  current: Readonly<ActorScopeGrants>,
): ActorScopeGrants {
  const missing: Record<string, readonly string[]> = {};

  for (const module of SCOPE_MODULES) {
    const expectedValues = expected[module] ?? [];
    const currentValues = new Set(current[module] ?? []);
    const values = expectedValues.filter((value) => !currentValues.has(value));
    if (values.length > 0) {
      missing[module] = values;
    }
  }

  return normalizeAssignmentScopeGrants(missing) ?? {};
}

function unionScopeGrants(
  current: Readonly<ActorScopeGrants>,
  additions: Readonly<ActorScopeGrants>,
): ActorScopeGrants {
  const merged: Record<string, readonly string[]> = {};

  for (const module of SCOPE_MODULES) {
    const values = [...(current[module] ?? []), ...(additions[module] ?? [])];
    if (values.length > 0) {
      merged[module] = values;
    }
  }

  return normalizeAssignmentScopeGrants(merged) ?? {};
}

function hasAnyScopeGrant(scopeGrants: Readonly<ActorScopeGrants>): boolean {
  return SCOPE_MODULES.some((module) => (scopeGrants[module]?.length ?? 0) > 0);
}

function setDifference(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => !rightSet.has(value));
}

function normalizeTargetRoleCode(value: string): RoleTemplateCode {
  const normalized = normalizeRoleTemplateCode(value);
  if (!isRoleTemplateCode(normalized)) {
    throw new AccessRepairError(
      "ACCESS_REPAIR_UNSUPPORTED_ROLE",
      `Unsupported access repair target: ${value}`,
    );
  }

  return normalized;
}

function parseRoleCodes(value: string): readonly RoleTemplateCode[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(normalizeTargetRoleCode);
}

function normalizeSearchName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) {
    return "[masked-email]";
  }

  const visible = local.slice(0, 2);
  return `${visible || "*"}***@${domain}`;
}

function maskAuthSubject(subject: string): string {
  if (subject.startsWith("auth0|")) {
    return "auth0|[redacted]";
  }

  return "[redacted-auth-subject]";
}

interface CliOptions {
  readonly envFile?: string;
  readonly roleCodes: readonly RoleTemplateCode[];
  readonly mode: AccessRepairMode;
  readonly userId?: string;
  readonly assignmentId?: string;
  readonly help: boolean;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let envFile: string | undefined;
  const roleCodes: RoleTemplateCode[] = [];
  let confirm = false;
  let dryRun = false;
  let userId: string | undefined;
  let assignmentId: string | undefined;
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

    if (arg === "--confirm-access-repair") {
      confirm = true;
      continue;
    }

    if (
      arg === "--env-file" ||
      arg === "--roles" ||
      arg === "--role" ||
      arg === "--user-id" ||
      arg === "--assignment-id"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new AccessRepairError(
          "ACCESS_REPAIR_CLI_VALUE_MISSING",
          `${arg} requires a value`,
        );
      }

      if (arg === "--env-file") {
        envFile = value;
      } else if (arg === "--roles" || arg === "--role") {
        roleCodes.push(...parseRoleCodes(value));
      } else if (arg === "--user-id") {
        userId = value.trim();
      } else {
        assignmentId = value.trim();
      }
      index += 1;
      continue;
    }

    throw new AccessRepairError(
      "ACCESS_REPAIR_CLI_FLAG_UNSUPPORTED",
      `Unsupported CLI flag: ${arg ?? ""}`,
    );
  }

  if (confirm && dryRun) {
    throw new AccessRepairError(
      "ACCESS_REPAIR_CLI_MODE_CONFLICT",
      "--dry-run cannot be combined with --confirm-access-repair",
    );
  }

  if (confirm && !envFile) {
    throw new AccessRepairError(
      "ACCESS_REPAIR_ENV_FILE_REQUIRED_FOR_WRITE",
      "Access repair write mode requires --env-file",
    );
  }

  if (confirm && !isDevEnvFile(envFile)) {
    throw new AccessRepairError(
      "ACCESS_REPAIR_ENV_FILE_MUST_BE_DEV",
      "Access repair write mode requires --env-file .env.dev",
    );
  }

  if (confirm && !userId && !assignmentId) {
    throw new AccessRepairError(
      "ACCESS_REPAIR_WRITE_TARGET_REQUIRED",
      "Access repair write mode requires --user-id or --assignment-id",
    );
  }

  const uniqueRoleCodes = [...new Set(roleCodes)];

  if (!help && uniqueRoleCodes.length === 0) {
    throw new AccessRepairError(
      "ACCESS_REPAIR_ROLES_REQUIRED",
      "Access repair requires explicit --roles",
    );
  }

  return {
    ...(envFile ? { envFile } : {}),
    roleCodes: uniqueRoleCodes,
    mode: confirm ? "write" : "dry-run",
    ...(userId ? { userId } : {}),
    ...(assignmentId ? { assignmentId } : {}),
    help,
  };
}

function isDevEnvFile(value: string | undefined): boolean {
  return value !== undefined && path.basename(value) === ".env.dev";
}

function assertSafeRuntimeForWrite(): void {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "production") {
    throw new AccessRepairError(
      "ACCESS_REPAIR_PRODUCTION_FORBIDDEN",
      "Access repair write mode is forbidden when NODE_ENV=production",
    );
  }
}

export function formatAccessRepairSummary(
  summary: AccessRepairSummary,
): string {
  return JSON.stringify(summary, null, 2);
}

function helpText(): string {
  return [
    "Access repair",
    "",
    "Dry run:",
    "  npm run access:repair -- --env-file .env.dev --roles TEAM_MANAGER,PRODUCTION_OPS,HR_OPERATIONS --dry-run",
    "",
    "Write mode:",
    "  npm run access:repair -- --env-file .env.dev --roles TEAM_MANAGER --user-id <user-id> --confirm-access-repair",
    "  npm run access:repair -- --env-file .env.dev --roles PRODUCTION_OPS --assignment-id <assignment-id> --confirm-access-repair",
    "",
    "Notes:",
    `  Supported role template codes: ${ROLE_TEMPLATE_CODES.join(", ")}.`,
    "  Dry-run is the default.",
    "  Write mode union-adds missing recommended scope grants only.",
    "  EmploymentProfile linkage is diagnostic-only; use the admin linkage workflow for actual linking.",
  ].join("\n");
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
    const service = createAccessRepairService({
      mongoClient: client,
      mongoDbName: env.MONGO_DB_NAME,
    });
    const summary = await service.run({
      roleCodes: options.roleCodes,
      mode: options.mode,
      mongoDbName: env.MONGO_DB_NAME,
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.assignmentId ? { assignmentId: options.assignmentId } : {}),
    });

    console.log(formatAccessRepairSummary(summary));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  runCli().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Access repair failed";
    console.error(redactForOutput(message));
    process.exitCode = 1;
  });
}

function redactForOutput(value: string): string {
  return value
    .replace(/auth0\|[^\s]+/giu, "auth0|[redacted]")
    .replace(/([A-Z0-9._%+-]{1,2})[A-Z0-9._%+-]*@([A-Z0-9.-]+\.[A-Z]{2,})/giu, "$1***@$2")
    .replace(/(password|secret|token|ticket)=\S+/giu, "$1=[redacted]")
    .replace(/mongodb(\+srv)?:\/\/\S+/giu, "[redacted-mongo-uri]");
}
