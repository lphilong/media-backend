import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Permission } from "@core/permission/permission.enum";
import { RoleRecord } from "@modules/role/domain/role.types";
import {
  getRoleTemplate,
  ROLE_TEMPLATE_CODES,
  RoleTemplateCode,
} from "@modules/role/domain/role-template.catalog";
import {
  RuntimeRoleSyncError,
  RuntimeRoleSyncService,
  formatRuntimeRoleSyncSummary,
  parseCliArgs,
} from "./runtime-role-sync";

const NOW = 1_779_552_000_000;
const REMOVED_ACTOR_KIND_UPDATE_PERMISSION = "user:actor_kind:update";

test("source role templates do not expose removed actorKind conversion permission", () => {
  assert.equal(
    hasString(Object.values(Permission), REMOVED_ACTOR_KIND_UPDATE_PERMISSION),
    false,
  );
  assert.equal(hasString(ROLE_TEMPLATE_CODES, "COMMERCIAL_FINANCE"), false);

  for (const code of ROLE_TEMPLATE_CODES) {
    const template = getRoleTemplate(code);
    assert.ok(template);
    assert.equal(
      hasString(template.permissions, REMOVED_ACTOR_KIND_UPDATE_PERMISSION),
      false,
      `${code} must not receive actorKind conversion permission`,
    );
  }
});

test("dry-run reports missing user provisioning permission without writing", async () => {
  const fixture = createRuntimeRoleSyncFixture({
    roles: [
      makeTemplateRoleWithoutPermissions({
        code: "ACCESS_ADMIN",
        missingPermissions: [Permission.USER_PROVISION_ACCOUNT],
      }),
    ],
  });

  const summary = await fixture.service.run({
    roleCode: "ACCESS_ADMIN",
    mode: "dry-run",
    mongoDbName: "media-dev",
  });

  assert.deepEqual(summary.missingPermissions, [
    Permission.USER_PROVISION_ACCOUNT,
  ]);
  assert.equal(summary.updateNeeded, true);
  assert.equal(summary.updated, false);
  assert.equal(fixture.roles.replacePermissionsCalls, 0);
});

test("dry-run reports missing lookup permission for REVENUE_FINANCE_OPS", async () => {
  const fixture = createRuntimeRoleSyncFixture({
    roles: [
      makeTemplateRoleWithoutPermissions({
        code: "REVENUE_FINANCE_OPS",
        missingPermissions: [Permission.REVENUE_LEDGER_LOOKUP],
      }),
    ],
  });

  const summary = await fixture.service.run({
    roleCode: "REVENUE_FINANCE_OPS",
    mode: "dry-run",
    mongoDbName: "media-dev",
  });

  assert.deepEqual(summary.missingPermissions, [
    Permission.REVENUE_LEDGER_LOOKUP,
  ]);
  assert.equal(summary.updateNeeded, true);
  assert.equal(summary.updated, false);
  assert.equal(fixture.roles.replacePermissionsCalls, 0);
});

test("dry-run reports missing lookup permission for PRODUCTION_OPS", async () => {
  const fixture = createRuntimeRoleSyncFixture({
    roles: [
      makeTemplateRoleWithoutPermissions({
        code: "PRODUCTION_OPS",
        missingPermissions: [Permission.ORG_UNIT_LOOKUP],
      }),
    ],
  });

  const summary = await fixture.service.run({
    roleCode: "PRODUCTION_OPS",
    mode: "dry-run",
    mongoDbName: "media-dev",
  });

  assert.deepEqual(summary.missingPermissions, [Permission.ORG_UNIT_LOOKUP]);
  assert.equal(summary.updateNeeded, true);
  assert.equal(summary.updated, false);
  assert.equal(fixture.roles.replacePermissionsCalls, 0);
});

test("dry-run reports missing lookup permission for HR_OPERATIONS", async () => {
  const fixture = createRuntimeRoleSyncFixture({
    roles: [
      makeTemplateRoleWithoutPermissions({
        code: "HR_OPERATIONS",
        missingPermissions: [Permission.TALENT_LOOKUP],
      }),
    ],
  });

  const summary = await fixture.service.run({
    roleCode: "HR_OPERATIONS",
    mode: "dry-run",
    mongoDbName: "media-dev",
  });

  assert.deepEqual(summary.missingPermissions, [Permission.TALENT_LOOKUP]);
  assert.equal(summary.updateNeeded, true);
  assert.equal(summary.updated, false);
  assert.equal(fixture.roles.replacePermissionsCalls, 0);
});

test("source manager templates do not include official WorkSchedule mutation permissions", () => {
  for (const code of ["TALENT_GROUP_MANAGER", "ORG_UNIT_MANAGER"] as const) {
    const manager = getRoleTemplate(code);
    assert.ok(manager);
    assert.equal(
      manager.permissions.includes(Permission.WORK_SCHEDULE_READ),
      true,
    );
    assert.equal(
      manager.permissions.includes(Permission.WORK_SCHEDULE_CREATE),
      false,
    );
    assert.equal(
      manager.permissions.includes(Permission.WORK_SCHEDULE_UPDATE),
      false,
    );
    assert.equal(
      manager.permissions.includes(Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE),
      false,
    );
  }
});

test("write adds only missing source-template permissions", async () => {
  const staleFinance = makeTemplateRoleWithoutPermissions({
    code: "REVENUE_FINANCE_OPS",
    missingPermissions: [
      Permission.REVENUE_LEDGER_LOOKUP,
      Permission.DASHBOARD_LITE_READ,
    ],
    extraPermissions: ["legacy.custom.permission"],
  });
  const fixture = createRuntimeRoleSyncFixture({
    roles: [staleFinance],
  });

  const summary = await fixture.service.run({
    roleCode: "REVENUE_FINANCE_OPS",
    mode: "write",
    mongoDbName: "media-dev",
  });

  const finance = fixture.roles.records.get("REVENUE_FINANCE_OPS");
  assert.ok(finance);
  assert.equal(
    finance.permissions.includes(Permission.REVENUE_LEDGER_LOOKUP),
    true,
  );
  assert.equal(
    finance.permissions.includes(Permission.DASHBOARD_LITE_READ),
    true,
  );
  assert.equal(finance.permissions.includes("legacy.custom.permission"), true);
  assert.equal(
    finance.permissions.includes(Permission.CONTRACT_REGISTRY_CREATE),
    false,
  );
  assert.equal(summary.updated, true);
  assert.equal(summary.updateNeeded, false);
  assert.equal(fixture.roles.replacePermissionsCalls, 1);
});

test("write adds only missing source-template permissions for commission ops", async () => {
  const staleCommission = makeTemplateRoleWithoutPermissions({
    code: "COMMISSION_OPS",
    missingPermissions: [
      Permission.COMMISSION_RULE_LOOKUP,
      Permission.COMMISSION_SETTLEMENT_READ,
    ],
    extraPermissions: ["legacy.custom.permission"],
  });
  const fixture = createRuntimeRoleSyncFixture({
    roles: [staleCommission],
  });

  const summary = await fixture.service.run({
    roleCode: "COMMISSION_OPS",
    mode: "write",
    mongoDbName: "media-dev",
  });

  const commission = fixture.roles.records.get("COMMISSION_OPS");
  assert.ok(commission);
  assert.equal(
    commission.permissions.includes(Permission.COMMISSION_RULE_LOOKUP),
    true,
  );
  assert.equal(
    commission.permissions.includes(Permission.COMMISSION_SETTLEMENT_READ),
    true,
  );
  assert.equal(
    commission.permissions.includes("legacy.custom.permission"),
    true,
  );
  assert.equal(
    commission.permissions.includes(Permission.REVENUE_LEDGER_CREATE),
    false,
  );
  assert.equal(summary.updated, true);
  assert.equal(summary.updateNeeded, false);
  assert.equal(fixture.roles.replacePermissionsCalls, 1);
});

test("write leaves non-target roles untouched", async () => {
  const staleAccessAdmin = makeTemplateRoleWithoutPermissions({
    code: "ACCESS_ADMIN",
    missingPermissions: [Permission.USER_PROVISION_ACCOUNT],
    extraPermissions: ["legacy.custom.permission"],
  });
  const viewer = makeRole({
    id: "viewer-role",
    code: "VIEWER_AUDITOR",
    permissions: getRoleTemplate("VIEWER_AUDITOR")?.permissions ?? [],
  });
  const fixture = createRuntimeRoleSyncFixture({
    roles: [staleAccessAdmin, viewer],
  });
  const viewerBefore = [
    ...(fixture.roles.records.get("VIEWER_AUDITOR")?.permissions ?? []),
  ];

  const summary = await fixture.service.run({
    roleCode: "ACCESS_ADMIN",
    mode: "write",
    mongoDbName: "media-dev",
  });

  const accessAdmin = fixture.roles.records.get("ACCESS_ADMIN");
  assert.ok(accessAdmin);
  assert.equal(
    accessAdmin.permissions.includes(Permission.USER_PROVISION_ACCOUNT),
    true,
  );
  assert.equal(
    accessAdmin.permissions.includes("legacy.custom.permission"),
    true,
  );
  assert.equal(
    fixture.roles.records
      .get("VIEWER_AUDITOR")
      ?.permissions.includes(Permission.USER_PROVISION_ACCOUNT),
    false,
  );
  assert.deepEqual(
    fixture.roles.records.get("VIEWER_AUDITOR")?.permissions,
    viewerBefore,
  );
  assert.equal(summary.updated, true);
  assert.equal(summary.updateNeeded, false);
  assert.equal(fixture.roles.replacePermissionsCalls, 1);
});

test("rerun is idempotent after write", async () => {
  const fixture = createRuntimeRoleSyncFixture({
    roles: [
      makeTemplateRoleWithoutPermissions({
        code: "PRODUCTION_OPS",
        missingPermissions: [Permission.EVENT_LOOKUP],
      }),
    ],
  });

  const first = await fixture.service.run({
    roleCode: "PRODUCTION_OPS",
    mode: "write",
    mongoDbName: "media-dev",
  });
  const second = await fixture.service.run({
    roleCode: "PRODUCTION_OPS",
    mode: "write",
    mongoDbName: "media-dev",
  });

  assert.equal(first.updated, true);
  assert.equal(second.updated, false);
  assert.deepEqual(second.missingPermissions, []);
  assert.equal(fixture.roles.replacePermissionsCalls, 1);
});

test("write does not add broad read permission unless source template has it", async () => {
  const fixture = createRuntimeRoleSyncFixture({
    roles: [
      makeTemplateRoleWithoutPermissions({
        code: "PRODUCTION_OPS",
        missingPermissions: [Permission.EVENT_LOOKUP],
      }),
    ],
  });

  const summary = await fixture.service.run({
    roleCode: "PRODUCTION_OPS",
    mode: "write",
    mongoDbName: "media-dev",
  });

  const production = fixture.roles.records.get("PRODUCTION_OPS");
  assert.ok(production);
  assert.equal(
    getRoleTemplate("PRODUCTION_OPS")?.permissions.includes(
      Permission.CONTRACT_REGISTRY_READ,
    ),
    false,
  );
  assert.equal(
    production.permissions.includes(Permission.CONTRACT_REGISTRY_READ),
    false,
  );
  assert.equal(summary.updated, true);
});

test("CLI write mode requires explicit confirm flag and env file", () => {
  assert.throws(
    () => parseCliArgs([]),
    runtimeSyncErrorWithCode("RUNTIME_ROLE_SYNC_ROLES_REQUIRED"),
  );
  assert.equal(parseCliArgs(["--roles", "REVENUE_FINANCE_OPS"]).mode, "dry-run");
  assert.deepEqual(
    parseCliArgs([
      "--env-file",
      ".env.dev",
      "--roles",
      "REVENUE_FINANCE_OPS,PRODUCTION_OPS,HR_OPERATIONS",
      "--dry-run",
    ]).roleCodes,
    ["REVENUE_FINANCE_OPS", "PRODUCTION_OPS", "HR_OPERATIONS"],
  );
  assert.equal(
    parseCliArgs([
      "--env-file",
      ".env.dev",
      "--roles",
      "REVENUE_FINANCE_OPS",
      "--confirm-runtime-role-sync",
    ]).mode,
    "write",
  );
  assert.throws(
    () => parseCliArgs(["--confirm-runtime-role-sync"]),
    runtimeSyncErrorWithCode("RUNTIME_ROLE_SYNC_ENV_FILE_REQUIRED_FOR_WRITE"),
  );
  assert.throws(
    () =>
      parseCliArgs([
        "--env-file",
        ".env.local",
        "--roles",
        "REVENUE_FINANCE_OPS",
        "--confirm-runtime-role-sync",
      ]),
    runtimeSyncErrorWithCode("RUNTIME_ROLE_SYNC_ENV_FILE_MUST_BE_DEV"),
  );
  assert.throws(
    () => parseCliArgs(["--roles", "COMMERCIAL_FINANCE"]),
    runtimeSyncErrorWithCode("RUNTIME_ROLE_SYNC_UNSUPPORTED_ROLE"),
  );
  assert.throws(
    () => parseCliArgs(["--roles", "NOT_A_ROLE"]),
    runtimeSyncErrorWithCode("RUNTIME_ROLE_SYNC_UNSUPPORTED_ROLE"),
  );
});

test("formatted output does not include secret-looking values", async () => {
  const fixture = createRuntimeRoleSyncFixture({
    roles: [
      makeTemplateRoleWithoutPermissions({
        code: "ACCESS_ADMIN",
        missingPermissions: [Permission.USER_PROVISION_ACCOUNT],
      }),
    ],
  });

  const summary = await fixture.service.run({
    roleCode: "ACCESS_ADMIN",
    mode: "dry-run",
    mongoDbName: "media-dev",
  });
  const output = formatRuntimeRoleSyncSummary(summary);

  assert.doesNotMatch(output, /mongodb:\/\//iu);
  assert.doesNotMatch(output, /auth0\|/iu);
  assert.doesNotMatch(output, /password|secret|token|cookie|ticket/iu);
});

test("invalid role code rejects and does not touch repository", async () => {
  const fixture = createRuntimeRoleSyncFixture({
    roles: [
      makeTemplateRoleWithoutPermissions({
        code: "ACCESS_ADMIN",
        missingPermissions: [Permission.USER_PROVISION_ACCOUNT],
      }),
    ],
  });

  await assert.rejects(
    () =>
      fixture.service.run({
        roleCode: "NOT_A_ROLE",
        mode: "dry-run",
        mongoDbName: "media-dev",
      }),
    runtimeSyncErrorWithCode("RUNTIME_ROLE_SYNC_UNSUPPORTED_ROLE"),
  );
  assert.equal(fixture.roles.findByCodeCalls, 0);
  assert.equal(fixture.roles.replacePermissionsCalls, 0);
});

test("legacy ADMIN_FULL role code rejects before repository access", async () => {
  const fixture = createRuntimeRoleSyncFixture();

  await assert.rejects(
    () =>
      fixture.service.run({
        roleCode: "ADMIN_FULL",
        mode: "dry-run",
        mongoDbName: "media-dev",
      }),
    runtimeSyncErrorWithCode("RUNTIME_ROLE_SYNC_UNSUPPORTED_ROLE"),
  );
  assert.equal(fixture.roles.findByCodeCalls, 0);
  assert.equal(fixture.roles.replacePermissionsCalls, 0);
  await assert.rejects(
    () =>
      fixture.service.run({
        roleCode: "ADMIN_FULL",
        mode: "write",
        mongoDbName: "media-dev",
      }),
    runtimeSyncErrorWithCode("RUNTIME_ROLE_SYNC_UNSUPPORTED_ROLE"),
  );
  assert.equal(fixture.roles.records.size, 0);
});

test("runtime role sync package script does not embed confirm flag", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    readonly scripts?: Record<string, string>;
  };

  assert.equal(
    packageJson.scripts?.["role:sync-runtime"],
    "ts-node -r tsconfig-paths/register src/tools/smoke/runtime-role-sync.ts",
  );
  assert.doesNotMatch(
    packageJson.scripts?.["role:sync-runtime"] ?? "",
    /confirm-runtime-role-sync/u,
  );
});

function createRuntimeRoleSyncFixture(
  params: {
    readonly roles?: readonly RoleRecord[];
  } = {},
) {
  const roles = new FakeRuntimeRoleRepository(params.roles ?? []);
  const service = new RuntimeRoleSyncService({
    roleRepository: roles,
    now: () => NOW,
  });

  return { roles, service };
}

class FakeRuntimeRoleRepository {
  readonly records = new Map<string, RoleRecord>();
  findByCodeCalls = 0;
  replacePermissionsCalls = 0;

  constructor(roles: readonly RoleRecord[]) {
    for (const role of roles) {
      this.records.set(role.code, role);
    }
  }

  async findByCode(code: string): Promise<RoleRecord | null> {
    this.findByCodeCalls += 1;
    return this.records.get(code) ?? null;
  }

  async replacePermissions(input: {
    readonly roleId: string;
    readonly roleCode: RoleTemplateCode;
    readonly permissions: readonly string[];
    readonly updatedAt: number;
  }): Promise<RoleRecord | null> {
    this.replacePermissionsCalls += 1;
    const role = [...this.records.values()].find(
      (candidate) =>
        candidate.id === input.roleId &&
        candidate.code === input.roleCode &&
        candidate.state === "ACTIVE",
    );
    if (!role) {
      return null;
    }

    const updated = {
      ...role,
      permissions: [...input.permissions],
      updatedAt: input.updatedAt,
    };
    this.records.set(updated.code, updated);
    return updated;
  }
}

function makeTemplateRoleWithoutPermissions(params: {
  readonly code: RoleTemplateCode;
  readonly missingPermissions: readonly Permission[];
  readonly extraPermissions?: readonly string[];
}): RoleRecord {
  const template = getRoleTemplate(params.code);
  assert.ok(template);

  return makeRole({
    id: `${params.code.toLowerCase()}-role`,
    code: params.code,
    permissions: [
      ...template.permissions.filter(
        (permission) => !params.missingPermissions.includes(permission),
      ),
      ...(params.extraPermissions ?? []),
    ],
  });
}

function makeRole(params: {
  readonly id: string;
  readonly code: string;
  readonly permissions: readonly string[];
}): RoleRecord {
  const template = getRoleTemplate(params.code);
  return {
    id: params.id,
    code: params.code,
    name: template?.name ?? params.code,
    description: template?.description ?? null,
    state: "ACTIVE",
    permissions: [...params.permissions],
    delegationBand: params.code === "ADMIN_FULL" ? "PRIVILEGED" : "LIMITED",
    maxDelegatableBand: params.code === "ADMIN_FULL" ? "PRIVILEGED" : "NONE",
    ...(template ? { templateCode: template.code } : {}),
    ...(template ? { templateVersion: template.version } : {}),
    templateAppliedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    activatedAt: 1,
    archivedAt: null,
  };
}

function runtimeSyncErrorWithCode(code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof RuntimeRoleSyncError);
    assert.equal(error.code, code);
    return true;
  };
}

function hasString(values: readonly string[], value: string): boolean {
  return values.includes(value);
}
