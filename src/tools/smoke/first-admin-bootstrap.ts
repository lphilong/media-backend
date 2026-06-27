import crypto from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, ClientSession } from "mongodb";
import { ActorScopeGrants } from "@core/actor/actor";
import {
  Auth0ManagementConfig,
  Auth0ManagementHttpClient,
  resolveAuth0ManagementConfigFromEnv,
} from "@infra/auth0/auth0-management.client";
import { getEnv, clearEnvCacheForTests } from "@config/env";
import {
  NativeMongoRoleRepository,
  NativeMongoUserRoleAssignmentRepository,
} from "@infra/mongo/role/role.repository";
import { UserRepository } from "@infra/mongo/user/user.repository";
import {
  Auth0ManagementUser,
} from "@modules/user/domain/auth0-management.port";
import {
  RoleRepository,
} from "@modules/role/domain/role.repository";
import {
  UserRoleAssignmentRepository,
} from "@modules/role/domain/user-role-assignment.repository";
import {
  RoleRecord,
  UserRoleAssignmentRecord,
} from "@modules/role/domain/role.types";
import {
  getRoleTemplate,
  ROLE_TEMPLATE_CODES,
  RoleTemplateCode,
} from "@modules/role/domain/role-template.catalog";
import {
  normalizeAssignmentScopeGrants,
} from "@modules/role/domain/role-assignment-scope-grants";
import {
  CreateUserInput,
  SetUserAuthLinkageInput,
  TransitionUserLifecycleInput,
  UpdateUserProfileInput,
} from "@modules/user/domain/user.repository";
import {
  UserRecord,
} from "@modules/user/domain/user.types";

export type FirstAdminBootstrapMode = "dry-run" | "write";
type BootstrapAction =
  | "created"
  | "reused"
  | "updated"
  | "would-create"
  | "would-update";

export class FirstAdminBootstrapError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FirstAdminBootstrapError";
    this.code = code;
  }
}

export interface FirstAdminBootstrapAuth0Port {
  findUserByEmail(
    email: string,
  ): Promise<Auth0ManagementUser | readonly Auth0ManagementUser[] | null>;
}

type FirstAdminBootstrapRuntimeRoleRecord = Omit<RoleRecord, "templateCode"> & {
  readonly templateCode?: string;
};

export interface FirstAdminBootstrapRoleRepository extends RoleRepository {
  findRawByCode(
    code: string,
    session?: ClientSession,
  ): Promise<FirstAdminBootstrapRuntimeRoleRecord | null>;
  updateTemplateMetadata(
    input: {
      readonly roleId: string;
      readonly templateCode: RoleTemplateCode;
      readonly templateVersion: string;
      readonly templateAppliedAt: number;
      readonly updatedAt: number;
    },
    session: ClientSession,
  ): Promise<FirstAdminBootstrapRuntimeRoleRecord | null>;
}

export interface FirstAdminBootstrapUserRepository {
  insert(input: CreateUserInput, session: ClientSession): Promise<UserRecord>;
  findByAuthSubject(
    authSubject: string,
    session: ClientSession,
  ): Promise<UserRecord | null>;
  findManyByAuthSubject(
    authSubject: string,
    session: ClientSession,
  ): Promise<readonly UserRecord[]>;
  findManyByEmail(
    email: string,
    session: ClientSession,
  ): Promise<readonly UserRecord[]>;
  updateProfile(
    input: UpdateUserProfileInput,
    session: ClientSession,
  ): Promise<UserRecord | null>;
  transitionLifecycle(
    input: TransitionUserLifecycleInput,
    session: ClientSession,
  ): Promise<UserRecord | null>;
  setAuthLinkage(
    input: SetUserAuthLinkageInput,
    session: ClientSession,
  ): Promise<UserRecord | null>;
}

export interface FirstAdminBootstrapAssignmentRepository
  extends UserRoleAssignmentRepository {
  findActiveManyByRoleAndUser(
    roleId: string,
    userId: string,
    session: ClientSession,
  ): Promise<readonly UserRoleAssignmentRecord[]>;
  updateScopeGrants(
    assignmentId: string,
    scopeGrants: ActorScopeGrants,
    updatedAt: number,
    session: ClientSession,
  ): Promise<UserRoleAssignmentRecord | null>;
}

export interface FirstAdminBootstrapTransactionRunner {
  run<T>(
    operation: (session: ClientSession) => Promise<T>,
  ): Promise<T>;
}

export interface FirstAdminBootstrapInput {
  readonly email: string;
  readonly displayName?: string;
  readonly mode: FirstAdminBootstrapMode;
  readonly mongoDbName?: string;
  readonly auth0ManagementConfigured: boolean;
}

export interface FirstAdminBootstrapSummary {
  readonly mode: FirstAdminBootstrapMode;
  readonly mongoDbName?: string;
  readonly maskedEmail: string;
  readonly roles: {
    readonly created: number;
    readonly reused: number;
    readonly updated: number;
    readonly wouldCreate: number;
    readonly wouldUpdate: number;
    readonly details: readonly {
      readonly code: RoleTemplateCode;
      readonly action: Extract<
        BootstrapAction,
        "created" | "reused" | "updated" | "would-create" | "would-update"
      >;
    }[];
  };
  readonly adminUser: {
    readonly action: BootstrapAction;
    readonly userId: string | null;
  };
  readonly assignment: {
    readonly action: BootstrapAction;
    readonly assignmentId: string | null;
  };
  readonly scopeGrantsEnsured: readonly string[];
  readonly nextManualSteps: readonly string[];
}

interface FirstAdminBootstrapDependencies {
  readonly auth0Management: FirstAdminBootstrapAuth0Port;
  readonly roleRepository: FirstAdminBootstrapRoleRepository;
  readonly userRepository: FirstAdminBootstrapUserRepository;
  readonly assignmentRepository: FirstAdminBootstrapAssignmentRepository;
  readonly transactionRunner: FirstAdminBootstrapTransactionRunner;
  readonly now?: () => number;
  readonly idFactory?: () => string;
}

const OWNER_ADMIN_CODE: RoleTemplateCode = "OWNER_ADMIN";
const BOOTSTRAP_ASSIGNMENT_REASON =
  "Smoke first admin bootstrap.";
const DEFAULT_DISPLAY_NAME = "First Admin";

const NORMALIZED_REQUIRED_OWNER_ADMIN_SCOPE_GRANTS =
  normalizeAssignmentScopeGrants({
    workSchedule: ["global"],
    eventAssignment: ["global"],
    contractRegistry: ["global"],
    talentKpi: ["global"],
    revenueLedger: ["global"],
    commission: ["global"],
    dashboardLite: ["global"],
    kpi: ["global"],
  });

if (!NORMALIZED_REQUIRED_OWNER_ADMIN_SCOPE_GRANTS) {
  throw new Error("Required OWNER_ADMIN scope grants are invalid");
}

export const REQUIRED_OWNER_ADMIN_SCOPE_GRANTS: ActorScopeGrants =
  NORMALIZED_REQUIRED_OWNER_ADMIN_SCOPE_GRANTS;

export class FirstAdminBootstrapService {
  constructor(
    private readonly deps: FirstAdminBootstrapDependencies,
  ) {}

  async run(
    input: FirstAdminBootstrapInput,
  ): Promise<FirstAdminBootstrapSummary> {
    if (!input.auth0ManagementConfigured) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_AUTH0_CONFIG_MISSING",
        "Auth0 Management API config is missing",
      );
    }

    const email = normalizeEmail(input.email);
    const maskedEmail = maskEmail(email);
    const mode = input.mode;

    return this.deps.transactionRunner.run(async (session) => {
      const auth0User = await this.findSingleAuth0User(email);
      const adminUser = await this.ensureAdminUser({
        auth0User,
        displayName: normalizeDisplayName(input.displayName, auth0User.email),
        mode,
        session,
      });
      const roleSummary = await this.ensureRuntimeRoles(mode, session);
      const adminRole = await this.requireRuntimeRole(
        OWNER_ADMIN_CODE,
        mode,
        session,
      );
      const assignment = await this.ensureAdminAssignment({
        userId: adminUser.user.id,
        roleId: adminRole.id,
        mode,
        session,
      });

      return Object.freeze({
        mode,
        ...(input.mongoDbName ? { mongoDbName: input.mongoDbName } : {}),
        maskedEmail,
        roles: roleSummary,
        adminUser: {
          action: adminUser.action,
          userId: adminUser.user.id,
        },
        assignment,
        scopeGrantsEnsured: describeRequiredScopeGrants(),
        nextManualSteps: Object.freeze([
          "Login as first admin.",
          "Check /admin/me/capabilities.",
          "Use Account Management UI to provision the six remaining accounts.",
        ]),
      });
    });
  }

  private async findSingleAuth0User(
    email: string,
  ): Promise<Auth0ManagementUser> {
    const result = await this.deps.auth0Management.findUserByEmail(email);
    const users = Array.isArray(result)
      ? result
      : result
        ? [result]
        : [];

    if (users.length === 0) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_AUTH0_USER_NOT_FOUND",
        "Auth0 admin email was not found; internal admin was not created",
      );
    }

    if (users.length > 1) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_AUTH0_EMAIL_AMBIGUOUS",
        "Auth0 admin email matched multiple users; bootstrap stopped",
      );
    }

    const user = users[0];
    if (!user) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_AUTH0_USER_NOT_FOUND",
        "Auth0 admin email was not found; internal admin was not created",
      );
    }

    if (normalizeEmail(user.email) !== email) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_AUTH0_EMAIL_MISMATCH",
        "Auth0 user email did not match requested first admin email",
      );
    }

    return user;
  }

  private async ensureRuntimeRoles(
    mode: FirstAdminBootstrapMode,
    session: ClientSession,
  ): Promise<FirstAdminBootstrapSummary["roles"]> {
    let created = 0;
    let reused = 0;
    let updated = 0;
    let wouldCreate = 0;
    let wouldUpdate = 0;
    const details: Array<{
      readonly code: RoleTemplateCode;
      readonly action: Extract<
        BootstrapAction,
        "created" | "reused" | "updated" | "would-create" | "would-update"
      >;
    }> = [];

    for (const code of ROLE_TEMPLATE_CODES) {
      const template = getRoleTemplate(code);
      if (!template) {
        throw new FirstAdminBootstrapError(
          "FIRST_ADMIN_ROLE_TEMPLATE_MISSING",
          `Runtime role template is missing: ${code}`,
        );
      }

      const existing = await this.deps.roleRepository.findRawByCode(
        code,
        session,
      );

      if (existing) {
        const validation = validateReusableRuntimeRole(existing, code);
        if (!validation.needsTemplateMetadataRepair) {
          reused += 1;
          details.push({ code, action: "reused" });
          continue;
        }

        if (mode === "dry-run") {
          wouldUpdate += 1;
          details.push({ code, action: "would-update" });
          continue;
        }

        const now = this.now();
        const repaired =
          await this.deps.roleRepository.updateTemplateMetadata(
            {
              roleId: existing.id,
              templateCode: template.code,
              templateVersion: template.version,
              templateAppliedAt: now,
              updatedAt: now,
            },
            session,
          );
        if (!repaired) {
          throw new FirstAdminBootstrapError(
            "FIRST_ADMIN_ROLE_TEMPLATE_REPAIR_FAILED",
            `Failed to repair runtime role template metadata: ${code}`,
          );
        }
        validateReusableRuntimeRole(repaired, code);
        updated += 1;
        details.push({ code, action: "updated" });
        continue;
      }

      if (mode === "dry-run") {
        wouldCreate += 1;
        details.push({ code, action: "would-create" });
        continue;
      }

      const now = this.now();
      await this.deps.roleRepository.insert(
        {
          id: this.id(),
          code,
          name: template.name,
          description: template.description,
          state: "ACTIVE",
          permissions: [...template.permissions],
          delegationBand: code === OWNER_ADMIN_CODE ? "PRIVILEGED" : "LIMITED",
          maxDelegatableBand:
            code === OWNER_ADMIN_CODE ? "PRIVILEGED" : "NONE",
          templateCode: template.code,
          templateVersion: template.version,
          templateAppliedAt: now,
          createdAt: now,
          updatedAt: now,
          activatedAt: now,
          archivedAt: null,
        },
        session,
      );
      created += 1;
      details.push({ code, action: "created" });
    }

    return Object.freeze({
      created,
      reused,
      updated,
      wouldCreate,
      wouldUpdate,
      details: Object.freeze(details),
    });
  }

  private async requireRuntimeRole(
    code: RoleTemplateCode,
    mode: FirstAdminBootstrapMode,
    session: ClientSession,
  ): Promise<FirstAdminBootstrapRuntimeRoleRecord> {
    const role = await this.deps.roleRepository.findRawByCode(code, session);
    if (!role) {
      if (mode === "dry-run") {
        return buildDryRunRuntimeRole({
          id: "dry-run-admin-full-role",
          code,
          now: this.now(),
        });
      }

      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_ROLE_MISSING_AFTER_BOOTSTRAP",
        `Runtime role was not available after bootstrap: ${code}`,
      );
    }

    return role;
  }

  private async ensureAdminUser(params: {
    readonly auth0User: Auth0ManagementUser;
    readonly displayName: string;
    readonly mode: FirstAdminBootstrapMode;
    readonly session: ClientSession;
  }): Promise<{ readonly action: BootstrapAction; readonly user: UserRecord }> {
    const email = normalizeEmail(params.auth0User.email);
    const emailMatches = await this.deps.userRepository.findManyByEmail(
      email,
      params.session,
    );

    if (emailMatches.length > 1) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_INTERNAL_EMAIL_AMBIGUOUS",
        "Internal admin email matched multiple users; bootstrap stopped",
      );
    }

    const subjectMatches = await this.deps.userRepository.findManyByAuthSubject(
      params.auth0User.id,
      params.session,
    );
    const activeSubjectMatches = subjectMatches.filter(
      (user) => user.accountStatus !== "ARCHIVED",
    );
    if (activeSubjectMatches.length > 1) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_INTERNAL_SUBJECT_AMBIGUOUS",
        "Auth0 subject matched multiple non-archived internal users; bootstrap stopped",
      );
    }
    const subjectMatch = activeSubjectMatches[0] ?? null;
    const emailMatch = emailMatches[0] ?? null;

    if (subjectMatch && emailMatch && subjectMatch.id !== emailMatch.id) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_SUBJECT_EMAIL_CONFLICT",
        "Auth0 subject and email are linked to different internal users",
      );
    }

    if (emailMatch && !subjectMatch) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_EMAIL_DIFFERENT_SUBJECT",
        "Internal user with first admin email is linked to a different Auth0 subject",
      );
    }

    if (subjectMatch) {
      return this.reuseAdminUser({
        user: subjectMatch,
        email,
        displayName: params.displayName,
        mode: params.mode,
        session: params.session,
      });
    }

    if (params.mode === "dry-run") {
      return {
        action: "would-create",
        user: buildDryRunUser({
          id: "dry-run-first-admin-user",
          auth0User: params.auth0User,
          displayName: params.displayName,
          now: this.now(),
        }),
      };
    }

    const now = this.now();
    const user = await this.deps.userRepository.insert(
      {
        id: this.id(),
        accountStatus: "ACTIVE",
        actorKind: "ADMIN",
        authLinkage: {
          provider: "auth0",
          subject: params.auth0User.id,
          status: "LINKED",
        },
        profile: {
          displayName: params.displayName,
          email,
        },
        contextAccess: {
          contexts: ["ADMIN"],
        },
        preferences: {},
        createdAt: now,
        updatedAt: now,
        activatedAt: now,
        disabledAt: null,
        archivedAt: null,
      },
      params.session,
    );

    return { action: "created", user };
  }

  private async reuseAdminUser(params: {
    readonly user: UserRecord;
    readonly email: string;
    readonly displayName: string;
    readonly mode: FirstAdminBootstrapMode;
    readonly session: ClientSession;
  }): Promise<{ readonly action: BootstrapAction; readonly user: UserRecord }> {
    if (params.user.accountStatus === "ARCHIVED") {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_USER_ARCHIVED",
        "Existing same-subject internal user is archived; bootstrap stopped",
      );
    }

    const currentEmail = params.user.profile.email
      ? normalizeEmail(params.user.profile.email)
      : undefined;
    if (currentEmail && currentEmail !== params.email) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_SUBJECT_EMAIL_CONFLICT",
        "Existing same-subject internal user has a different email",
      );
    }

    const needsLinkageRepair =
      params.user.authLinkage.status !== "LINKED" ||
      params.user.accountStatus !== "ACTIVE";
    const needsProfileRepair =
      !currentEmail ||
      params.user.profile.displayName.trim().length === 0;

    if (!needsLinkageRepair && !needsProfileRepair) {
      return { action: "reused", user: params.user };
    }

    if (params.mode === "dry-run") {
      return { action: "would-update", user: params.user };
    }

    const now = this.now();
    let user = params.user;
    if (needsLinkageRepair) {
      const linked = await this.deps.userRepository.setAuthLinkage(
        {
          userId: params.user.id,
          provider: "auth0",
          subject: params.user.authLinkage.subject,
          status: "LINKED",
          accountStatus: "ACTIVE",
          updatedAt: now,
        },
        params.session,
      );
      if (!linked) {
        throw new FirstAdminBootstrapError(
          "FIRST_ADMIN_USER_UPDATE_FAILED",
          "Failed to repair first admin auth linkage",
        );
      }
      user = linked;
    }

    if (needsProfileRepair) {
      const profiled = await this.deps.userRepository.updateProfile(
        {
          userId: params.user.id,
          ...(currentEmail ? {} : { email: params.email }),
          ...(params.user.profile.displayName.trim().length === 0
            ? { displayName: params.displayName }
            : {}),
          updatedAt: now,
        },
        params.session,
      );
      if (!profiled) {
        throw new FirstAdminBootstrapError(
          "FIRST_ADMIN_USER_UPDATE_FAILED",
          "Failed to repair first admin profile",
        );
      }
      user = profiled;
    }

    return { action: "updated", user };
  }

  private async ensureAdminAssignment(params: {
    readonly roleId: string;
    readonly userId: string;
    readonly mode: FirstAdminBootstrapMode;
    readonly session: ClientSession;
  }): Promise<FirstAdminBootstrapSummary["assignment"]> {
    const activeAssignments =
      await this.deps.assignmentRepository.findActiveManyByRoleAndUser(
        params.roleId,
        params.userId,
        params.session,
      );
    if (activeAssignments.length > 1) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_ASSIGNMENT_AMBIGUOUS",
        "Multiple active OWNER_ADMIN assignments exist for first admin; bootstrap stopped",
      );
    }
    const existing = activeAssignments[0] ?? null;

    if (!existing) {
      if (params.mode === "dry-run") {
        return { action: "would-create", assignmentId: null };
      }

      const now = this.now();
      const assignment = await this.deps.assignmentRepository.insert(
        {
          assignmentId: this.id(),
          roleId: params.roleId,
          userId: params.userId,
          scopeGrants: REQUIRED_OWNER_ADMIN_SCOPE_GRANTS,
          state: "ACTIVE",
          effectiveAt: now,
          revokedAt: null,
          reason: BOOTSTRAP_ASSIGNMENT_REASON,
          createdAt: now,
          updatedAt: now,
        },
        params.session,
      );

      return {
        action: "created",
        assignmentId: assignment.assignmentId,
      };
    }

    const merged = mergeScopeGrants(
      existing.scopeGrants,
      REQUIRED_OWNER_ADMIN_SCOPE_GRANTS,
    );

    if (scopeGrantsEqual(existing.scopeGrants, merged)) {
      return {
        action: "reused",
        assignmentId: existing.assignmentId,
      };
    }

    if (params.mode === "dry-run") {
      return {
        action: "would-update",
        assignmentId: existing.assignmentId,
      };
    }

    const updated =
      await this.deps.assignmentRepository.updateScopeGrants(
        existing.assignmentId,
        merged,
        this.now(),
        params.session,
      );
    if (!updated) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_ASSIGNMENT_UPDATE_FAILED",
        "Failed to repair OWNER_ADMIN assignment scope grants",
      );
    }

    return {
      action: "updated",
      assignmentId: updated.assignmentId,
    };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private id(): string {
    return this.deps.idFactory?.() ?? crypto.randomUUID();
  }
}

class MongoTransactionRunner implements FirstAdminBootstrapTransactionRunner {
  constructor(private readonly client: MongoClient) {}

  async run<T>(
    operation: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = this.client.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await operation(session);
      });
      if (result === undefined) {
        throw new FirstAdminBootstrapError(
          "FIRST_ADMIN_BOOTSTRAP_EMPTY_RESULT",
          "Bootstrap transaction did not return a result",
        );
      }
      return result;
    } finally {
      await session.endSession();
    }
  }
}

export function createFirstAdminBootstrapService(params: {
  readonly mongoClient: MongoClient;
  readonly auth0Config: Auth0ManagementConfig;
  readonly mongoDbName: string;
}): FirstAdminBootstrapService {
  const db = params.mongoClient.db(params.mongoDbName);
  const roleRepository = new NativeMongoRoleRepository(db);
  const assignmentRepository =
    new NativeMongoUserRoleAssignmentRepository(db);

  return new FirstAdminBootstrapService({
    auth0Management: new Auth0ManagementHttpClient(params.auth0Config),
    roleRepository,
    userRepository: new UserRepository(db),
    assignmentRepository,
    transactionRunner: new MongoTransactionRunner(params.mongoClient),
  });
}

export function maskEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const [local = "", domain = ""] = normalized.split("@");
  const [domainName = "", ...domainRest] = domain.split(".");
  return `${maskSegment(local)}@${maskSegment(domainName)}${
    domainRest.length > 0 ? `.${domainRest.join(".")}` : ""
  }`;
}

export function formatFirstAdminBootstrapSummary(
  summary: FirstAdminBootstrapSummary,
): string {
  return [
    "Smoke first-admin bootstrap summary",
    `mode: ${summary.mode}`,
    `db: ${summary.mongoDbName ?? "not-provided"}`,
    `email: ${summary.maskedEmail}`,
    `roles: created=${summary.roles.created}, reused=${summary.roles.reused}, updated=${summary.roles.updated}, wouldCreate=${summary.roles.wouldCreate}, wouldUpdate=${summary.roles.wouldUpdate}`,
    `adminUser: ${summary.adminUser.action}`,
    `assignment: ${summary.assignment.action}`,
    `scopeGrantsEnsured: ${summary.scopeGrantsEnsured.join(", ")}`,
    "next: login as first admin; check /admin/me/capabilities; provision six remaining accounts in UI",
  ].join("\n");
}

function validateReusableRuntimeRole(
  role: FirstAdminBootstrapRuntimeRoleRecord,
  code: RoleTemplateCode,
): { readonly needsTemplateMetadataRepair: boolean } {
  const template = getRoleTemplate(code);
  if (!template) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_ROLE_TEMPLATE_MISSING",
      `Runtime role template is missing: ${code}`,
    );
  }

  if (role.state !== "ACTIVE") {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_ROLE_STATE_CONFLICT",
      `Runtime role exists but is not ACTIVE: ${code}`,
    );
  }

  if (role.code !== code) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_ROLE_CODE_CONFLICT",
      `Runtime role code conflicts with template: ${code}`,
    );
  }

  if (
    role.templateCode !== undefined &&
    role.templateCode !== code
  ) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_ROLE_TEMPLATE_CONFLICT",
      `Runtime role template metadata conflicts: ${code}`,
    );
  }

  if (
    role.templateVersion !== undefined &&
    role.templateVersion !== template.version
  ) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_ROLE_TEMPLATE_CONFLICT",
      `Runtime role template version metadata conflicts: ${code}`,
    );
  }

  if (!stringSetsEqual(role.permissions, template.permissions)) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_ROLE_PERMISSION_CONFLICT",
      `Runtime role permissions diverge from template: ${code}`,
    );
  }

  const expectedDelegationBand =
    code === OWNER_ADMIN_CODE ? "PRIVILEGED" : "LIMITED";
  const expectedMaxDelegatableBand =
    code === OWNER_ADMIN_CODE ? "PRIVILEGED" : "NONE";

  if (
    role.delegationBand !== expectedDelegationBand ||
    role.maxDelegatableBand !== expectedMaxDelegatableBand
  ) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_ROLE_DELEGATION_CONFLICT",
      `Runtime role delegation metadata conflicts with template: ${code}`,
    );
  }

  return {
    needsTemplateMetadataRepair:
      role.templateCode === undefined ||
      role.templateVersion === undefined ||
      role.templateAppliedAt === undefined,
  };
}

function buildDryRunUser(params: {
  readonly id: string;
  readonly auth0User: Auth0ManagementUser;
  readonly displayName: string;
  readonly now: number;
}): UserRecord {
  return {
    id: params.id,
    accountStatus: "ACTIVE",
    actorKind: "ADMIN",
    authLinkage: {
      provider: "auth0",
      subject: params.auth0User.id,
      status: "LINKED",
    },
    profile: {
      displayName: params.displayName,
      email: normalizeEmail(params.auth0User.email),
    },
    contextAccess: {
      contexts: ["ADMIN"],
    },
    preferences: {},
    createdAt: params.now,
    updatedAt: params.now,
    activatedAt: params.now,
    disabledAt: null,
    archivedAt: null,
  };
}

function buildDryRunRuntimeRole(params: {
  readonly id: string;
  readonly code: RoleTemplateCode;
  readonly now: number;
}): FirstAdminBootstrapRuntimeRoleRecord {
  const template = getRoleTemplate(params.code);
  if (!template) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_ROLE_TEMPLATE_MISSING",
      `Runtime role template is missing: ${params.code}`,
    );
  }

  return {
    id: params.id,
    code: params.code,
    name: template.name,
    description: template.description,
    state: "ACTIVE",
    permissions: [...template.permissions],
    delegationBand:
      params.code === OWNER_ADMIN_CODE ? "PRIVILEGED" : "LIMITED",
    maxDelegatableBand:
      params.code === OWNER_ADMIN_CODE ? "PRIVILEGED" : "NONE",
    templateCode: template.code,
    templateVersion: template.version,
    templateAppliedAt: params.now,
    createdAt: params.now,
    updatedAt: params.now,
    activatedAt: params.now,
    archivedAt: null,
  };
}

function mergeScopeGrants(
  existing: ActorScopeGrants | undefined,
  required: ActorScopeGrants,
): ActorScopeGrants {
  const merged = normalizeAssignmentScopeGrants({
    workSchedule: mergeArray(existing?.workSchedule, required.workSchedule),
    eventAssignment: mergeArray(
      existing?.eventAssignment,
      required.eventAssignment,
    ),
    contractRegistry: mergeArray(
      existing?.contractRegistry,
      required.contractRegistry,
    ),
    talentKpi: mergeArray(existing?.talentKpi, required.talentKpi),
    kpi: mergeArray(existing?.kpi, required.kpi),
    revenueLedger: mergeArray(
      existing?.revenueLedger,
      required.revenueLedger,
    ),
    commission: mergeArray(existing?.commission, required.commission),
    dashboardLite: mergeArray(
      existing?.dashboardLite,
      required.dashboardLite,
    ),
  });

  if (!merged) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_SCOPE_GRANTS_INVALID",
      "Merged OWNER_ADMIN scope grants are invalid",
    );
  }

  return merged;
}

function scopeGrantsEqual(
  left: ActorScopeGrants | undefined,
  right: ActorScopeGrants,
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right);
}

function mergeArray<T extends string>(
  left: readonly T[] | undefined,
  right: readonly T[] | undefined,
): readonly T[] {
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

function describeRequiredScopeGrants(): readonly string[] {
  return Object.entries(REQUIRED_OWNER_ADMIN_SCOPE_GRANTS).map(
    ([module, scopes]) => `${module}.${scopes.join("+")}`,
  );
}

function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_EMAIL_INVALID",
      "First admin email is invalid",
    );
  }
  return normalized;
}

function normalizeDisplayName(
  value: string | undefined,
  email: string,
): string {
  const normalized = value?.trim();
  if (normalized) {
    return normalized;
  }

  const local = email.split("@")[0]?.trim();
  return local || DEFAULT_DISPLAY_NAME;
}

function stringSetsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const leftSet = new Set(left);
  return right.every((item) => leftSet.has(item));
}

function maskSegment(value: string): string {
  if (value.length <= 1) {
    return "*";
  }

  return `${value[0]}***`;
}

interface CliOptions {
  readonly envFile?: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly mode: FirstAdminBootstrapMode;
  readonly help: boolean;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let envFile: string | undefined;
  let email: string | undefined;
  let displayName: string | undefined;
  let confirm = false;
  let dryRun = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--confirm-bootstrap-first-admin") {
      confirm = true;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--env-file" || arg === "--email" || arg === "--display-name") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new FirstAdminBootstrapError(
          "FIRST_ADMIN_CLI_VALUE_MISSING",
          `${arg} requires a value`,
        );
      }

      if (arg === "--env-file") {
        envFile = value;
      } else if (arg === "--email") {
        email = value;
      } else {
        displayName = value;
      }
      index += 1;
      continue;
    }

    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_CLI_FLAG_UNSUPPORTED",
      `Unsupported CLI flag: ${arg ?? ""}`,
    );
  }

  if (confirm && dryRun) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_CLI_MODE_CONFLICT",
      "--dry-run cannot be combined with --confirm-bootstrap-first-admin",
    );
  }

  return {
    ...(envFile ? { envFile } : {}),
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
    mode: confirm ? "write" : "dry-run",
    help,
  };
}

function helpText(): string {
  return [
    "Smoke first-admin bootstrap",
    "",
    "Dry run:",
    "  npm run smoke:bootstrap:first-admin -- --env-file .env.dev --email admin@example.test --dry-run",
    "",
    "Write mode:",
    "  npm run smoke:bootstrap:first-admin -- --env-file .env.dev --email admin@example.test --confirm-bootstrap-first-admin",
    "",
    "Inputs:",
    "  --email or FIRST_ADMIN_EMAIL",
    "  --display-name or FIRST_ADMIN_DISPLAY_NAME",
    "  --env-file, for example .env.dev",
  ].join("\n");
}

function assertSafeRuntimeForWrite(): void {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "production") {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_PRODUCTION_FORBIDDEN",
      "First admin bootstrap write mode is forbidden when NODE_ENV=production",
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
    if (!options.envFile) {
      throw new FirstAdminBootstrapError(
        "FIRST_ADMIN_ENV_FILE_REQUIRED_FOR_WRITE",
        "First admin bootstrap write mode requires --env-file",
      );
    }
    assertSafeRuntimeForWrite();
  }

  const env = getEnv();
  const auth0Config = resolveAuth0ManagementConfigFromEnv();
  if (!auth0Config) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_AUTH0_CONFIG_MISSING",
      "Auth0 Management API config is missing",
    );
  }

  const email = options.email ?? process.env.FIRST_ADMIN_EMAIL;
  if (!email) {
    throw new FirstAdminBootstrapError(
      "FIRST_ADMIN_EMAIL_REQUIRED",
      "First admin email is required via --email or FIRST_ADMIN_EMAIL",
    );
  }

  const client = new MongoClient(env.MONGO_URI, {
    maxPoolSize: env.MONGO_MAX_POOL_SIZE,
  });

  try {
    await client.connect();
    const service = createFirstAdminBootstrapService({
      mongoClient: client,
      auth0Config,
      mongoDbName: env.MONGO_DB_NAME,
    });
    const summary = await service.run({
      email,
      displayName:
        options.displayName ?? process.env.FIRST_ADMIN_DISPLAY_NAME,
      mode: options.mode,
      mongoDbName: env.MONGO_DB_NAME,
      auth0ManagementConfigured: true,
    });
    console.log(formatFirstAdminBootstrapSummary(summary));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  runCli().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "First admin bootstrap failed";
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
