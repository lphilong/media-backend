import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ActorScopeGrants } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import {
  getRoleTemplate,
  RoleTemplateCode,
} from "@modules/role/domain/role-template.catalog";
import {
  RuntimeRoleCleanupError,
  RuntimeRoleCleanupService,
  formatRuntimeRoleCleanupSummary,
  parseCliArgs,
} from "./runtime-role-cleanup";

const NOW = 1_779_552_000_000;

test("dry-run detects TEAM_MANAGER stale WorkSchedule mutation permissions without writing", async () => {
  const fixture = createRuntimeRoleCleanupFixture({
    roles: [makeTeamManagerRoleWithStaleWorkSchedulePermissions()],
  });

  const summary = await fixture.service.run({
    roleCode: "TEAM_MANAGER",
    mode: "dry-run",
    mongoDbName: "media-dev",
  });

  assert.deepEqual(summary.currentPermissionsTargetedForRemoval, [
    Permission.WORK_SCHEDULE_CREATE,
    Permission.WORK_SCHEDULE_UPDATE,
    Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
  ]);
  assert.equal(summary.updateNeeded, true);
  assert.equal(summary.updated, false);
  assert.equal(fixture.repository.replacePermissionsCalls.length, 0);
});

test("cleanup preserves workSchedule.read and non-WorkSchedule permissions", async () => {
  const fixture = createRuntimeRoleCleanupFixture({
    roles: [makeTeamManagerRoleWithStaleWorkSchedulePermissions()],
  });

  const summary = await fixture.service.run({
    roleCode: "TEAM_MANAGER",
    mode: "write",
  });
  const manager = fixture.repository.roles.get("TEAM_MANAGER");

  assert.ok(manager);
  assert.equal(
    manager.permissions.includes(Permission.WORK_SCHEDULE_READ),
    true,
  );
  assert.equal(manager.permissions.includes(Permission.EVENT_READ), true);
  assert.equal(manager.permissions.includes(Permission.TALENT_READ), true);
  assert.equal(
    manager.permissions.includes(Permission.WORK_SCHEDULE_CREATE),
    false,
  );
  assert.deepEqual(summary.currentPermissionsTargetedForRemoval, []);
  assert.equal(summary.rolePermissionsUpdated, true);
});

test("cleanup preserves accepted self/team scopes and removes stale department/global scopes", async () => {
  const fixture = createRuntimeRoleCleanupFixture({
    roles: [makeTeamManagerRoleWithStaleWorkSchedulePermissions()],
    assignments: [
      {
        assignmentId: "assignment-team-manager",
        roleId: "role-team-manager",
        userId: "user-team-manager",
        scopeGrants: {
          workSchedule: ["self", "team", "department", "global"],
          eventAssignment: ["managedGroup"],
          kpi: ["managedGroup"],
        },
      },
    ],
  });

  const dryRun = await fixture.service.run({
    roleCode: "TEAM_MANAGER",
    mode: "dry-run",
  });
  const assignmentPlan = dryRun.assignments[0];

  assert.deepEqual(
    assignmentPlan?.currentScopeGrantsTargetedForRemoval,
    {
      workSchedule: ["department", "global"],
    },
  );
  assert.deepEqual(assignmentPlan?.preservedScopeGrants, {
    workSchedule: ["self", "team"],
    eventAssignment: ["managedGroup"],
    kpi: ["managedGroup"],
  });
  assert.equal(fixture.repository.replaceAssignmentScopeGrantsCalls.length, 0);

  await fixture.service.run({
    roleCode: "TEAM_MANAGER",
    mode: "write",
  });

  assert.deepEqual(
    fixture.repository.assignments.get("assignment-team-manager")?.scopeGrants,
    {
      workSchedule: ["self", "team"],
      eventAssignment: ["managedGroup"],
      kpi: ["managedGroup"],
    },
  );
});

test("cleanup removes stale WorkSchedule scope key when only stale scopes were present", async () => {
  const fixture = createRuntimeRoleCleanupFixture({
    roles: [makeTeamManagerRoleWithStaleWorkSchedulePermissions()],
    assignments: [
      {
        assignmentId: "assignment-stale-only",
        roleId: "role-team-manager",
        userId: "user-team-manager",
        scopeGrants: {
          workSchedule: ["department", "global"],
          kpi: ["managedGroup"],
        },
      },
    ],
  });

  await fixture.service.run({
    roleCode: "TEAM_MANAGER",
    mode: "write",
  });

  assert.deepEqual(
    fixture.repository.assignments.get("assignment-stale-only")?.scopeGrants,
    {
      kpi: ["managedGroup"],
    },
  );
});

test("cleanup rejects non-TEAM_MANAGER roles before touching the repository", async () => {
  const fixture = createRuntimeRoleCleanupFixture({
    roles: [makeRole("PRODUCTION_OPS")],
  });

  await assert.rejects(
    () =>
      fixture.service.run({
        roleCode: "PRODUCTION_OPS",
        mode: "dry-run",
      }),
    runtimeCleanupErrorWithCode("RUNTIME_ROLE_CLEANUP_UNSUPPORTED_ROLE"),
  );
  assert.equal(fixture.repository.findByCodeCalls.length, 0);
  assert.equal(fixture.repository.replacePermissionsCalls.length, 0);
});

test("cleanup rejects unapproved permission removal allowlists", async () => {
  const fixture = createRuntimeRoleCleanupFixture(
    {
      roles: [makeTeamManagerRoleWithStaleWorkSchedulePermissions()],
    },
    {
      permissionRemovalAllowlist: [Permission.WORK_SCHEDULE_READ],
    },
  );

  await assert.rejects(
    () =>
      fixture.service.run({
        roleCode: "TEAM_MANAGER",
        mode: "dry-run",
      }),
    runtimeCleanupErrorWithCode(
      "RUNTIME_ROLE_CLEANUP_UNAPPROVED_PERMISSION_REMOVAL",
    ),
  );
  assert.equal(fixture.repository.findByCodeCalls.length, 0);
  assert.equal(fixture.repository.replacePermissionsCalls.length, 0);
});

test("dry-run does not mutate permissions or scope grants", async () => {
  const role = makeTeamManagerRoleWithStaleWorkSchedulePermissions();
  const assignment = {
    assignmentId: "assignment-team-manager",
    roleId: "role-team-manager",
    userId: "user-team-manager",
    scopeGrants: {
      workSchedule: ["self", "team", "department", "global"],
    },
  } satisfies FakeAssignment;
  const fixture = createRuntimeRoleCleanupFixture({
    roles: [role],
    assignments: [assignment],
  });
  const permissionsBefore = [...role.permissions];
  const scopesBefore = { ...assignment.scopeGrants };

  await fixture.service.run({
    roleCode: "TEAM_MANAGER",
    mode: "dry-run",
  });

  assert.deepEqual(
    fixture.repository.roles.get("TEAM_MANAGER")?.permissions,
    permissionsBefore,
  );
  assert.deepEqual(
    fixture.repository.assignments.get("assignment-team-manager")
      ?.scopeGrants,
    scopesBefore,
  );
  assert.equal(fixture.repository.replacePermissionsCalls.length, 0);
  assert.equal(fixture.repository.replaceAssignmentScopeGrantsCalls.length, 0);
});

test("write mode rejects invalid assignment scopeGrants before any mutation", async () => {
  const role = makeTeamManagerRoleWithStaleWorkSchedulePermissions();
  const assignment = {
    assignmentId: "assignment-unsafe-scope-grants",
    roleId: "role-team-manager",
    userId: "user-team-manager",
    scopeGrants: {
      workSchedule: "global",
    } as unknown as ActorScopeGrants,
  } satisfies FakeAssignment;
  const fixture = createRuntimeRoleCleanupFixture({
    roles: [role],
    assignments: [assignment],
  });
  const permissionsBefore = [...role.permissions];
  const scopeGrantsBefore = assignment.scopeGrants;

  await assert.rejects(
    () =>
      fixture.service.run({
        roleCode: "TEAM_MANAGER",
        mode: "write",
      }),
    /scopeGrants\.workSchedule must be an array of strings/u,
  );

  assert.deepEqual(
    fixture.repository.roles.get("TEAM_MANAGER")?.permissions,
    permissionsBefore,
  );
  assert.equal(
    fixture.repository.assignments.get("assignment-unsafe-scope-grants")
      ?.scopeGrants,
    scopeGrantsBefore,
  );
  assert.equal(fixture.repository.replacePermissionsCalls.length, 0);
  assert.equal(fixture.repository.replaceAssignmentScopeGrantsCalls.length, 0);
});

test("CLI defaults to dry-run and write mode requires explicit confirmation flag", () => {
  assert.equal(
    parseCliArgs(["--env-file", ".env.dev", "--role", "TEAM_MANAGER"]).mode,
    "dry-run",
  );
  assert.equal(
    parseCliArgs([
      "--env-file",
      ".env.dev",
      "--role",
      "TEAM_MANAGER",
      "--dry-run",
    ]).mode,
    "dry-run",
  );
  assert.equal(
    parseCliArgs([
      "--env-file",
      ".env.dev",
      "--role",
      "TEAM_MANAGER",
      "--confirm-runtime-role-cleanup",
    ]).mode,
    "write",
  );
  assert.throws(
    () => parseCliArgs(["--role", "TEAM_MANAGER"]),
    runtimeCleanupErrorWithCode("RUNTIME_ROLE_CLEANUP_ENV_FILE_REQUIRED"),
  );
  assert.throws(
    () =>
      parseCliArgs([
        "--env-file",
        ".env.local",
        "--role",
        "TEAM_MANAGER",
      ]),
    runtimeCleanupErrorWithCode("RUNTIME_ROLE_CLEANUP_ENV_FILE_MUST_BE_DEV"),
  );
  assert.throws(
    () =>
      parseCliArgs([
        "--env-file",
        ".env.dev",
        "--role",
        "TEAM_MANAGER",
        "--dry-run",
        "--confirm-runtime-role-cleanup",
      ]),
    runtimeCleanupErrorWithCode("RUNTIME_ROLE_CLEANUP_CLI_MODE_CONFLICT"),
  );
});

test("CLI accepts only exact .env.dev path", () => {
  assert.equal(
    parseCliArgs(["--env-file", ".env.dev", "--role", "TEAM_MANAGER"])
      .envFile,
    ".env.dev",
  );

  for (const envFile of [
    "../.env.dev",
    "./../.env.dev",
    "config/.env.dev",
    "D:\\media\\backend\\.env.dev",
    ".env.local",
  ]) {
    assert.throws(
      () =>
        parseCliArgs(["--env-file", envFile, "--role", "TEAM_MANAGER"]),
      runtimeCleanupErrorWithCode("RUNTIME_ROLE_CLEANUP_ENV_FILE_MUST_BE_DEV"),
    );
  }
});

test("CLI rejects multiple roles and non-TEAM_MANAGER roles", () => {
  assert.throws(
    () =>
      parseCliArgs([
        "--env-file",
        ".env.dev",
        "--roles",
        "TEAM_MANAGER,PRODUCTION_OPS",
      ]),
    runtimeCleanupErrorWithCode(
      "RUNTIME_ROLE_CLEANUP_MULTIPLE_ROLES_FORBIDDEN",
    ),
  );
  assert.throws(
    () =>
      parseCliArgs([
        "--env-file",
        ".env.dev",
        "--role",
        "TEAM_MANAGER,PRODUCTION_OPS",
      ]),
    runtimeCleanupErrorWithCode(
      "RUNTIME_ROLE_CLEANUP_MULTIPLE_ROLES_FORBIDDEN",
    ),
  );
  assert.throws(
    () =>
      parseCliArgs([
        "--env-file",
        ".env.dev",
        "--role",
        "HR_OPERATIONS",
      ]),
    runtimeCleanupErrorWithCode("RUNTIME_ROLE_CLEANUP_UNSUPPORTED_ROLE"),
  );
});

test("missing role is reported and does not create a role", async () => {
  const fixture = createRuntimeRoleCleanupFixture();

  const summary = await fixture.service.run({
    roleCode: "TEAM_MANAGER",
    mode: "write",
    mongoDbName: "media-dev",
  });

  assert.equal(summary.roleExists, false);
  assert.equal(summary.created, false);
  assert.equal(summary.updateNeeded, false);
  assert.equal(summary.updated, false);
  assert.equal(fixture.repository.roles.size, 0);
  assert.equal(fixture.repository.replacePermissionsCalls.length, 0);
  assert.equal(fixture.repository.replaceAssignmentScopeGrantsCalls.length, 0);
});

test("write mode only touches TEAM_MANAGER and never PRODUCTION_OPS or HR_OPERATIONS", async () => {
  const fixture = createRuntimeRoleCleanupFixture({
    roles: [
      makeTeamManagerRoleWithStaleWorkSchedulePermissions(),
      makeRole("PRODUCTION_OPS"),
      makeRole("HR_OPERATIONS"),
    ],
    assignments: [
      {
        assignmentId: "assignment-team-manager",
        roleId: "role-team-manager",
        userId: "user-team-manager",
        scopeGrants: {
          workSchedule: ["self", "team", "global"],
        },
      },
      {
        assignmentId: "assignment-production",
        roleId: "role-production-ops",
        userId: "user-production",
        scopeGrants: {
          workSchedule: ["global"],
        },
      },
      {
        assignmentId: "assignment-hr",
        roleId: "role-hr-operations",
        userId: "user-hr",
        scopeGrants: {
          workSchedule: ["department"],
        },
      },
    ],
  });
  const productionBefore = [
    ...(fixture.repository.roles.get("PRODUCTION_OPS")?.permissions ?? []),
  ];
  const hrBefore = [
    ...(fixture.repository.roles.get("HR_OPERATIONS")?.permissions ?? []),
  ];

  await fixture.service.run({
    roleCode: "TEAM_MANAGER",
    mode: "write",
  });

  assert.deepEqual(
    fixture.repository.roles.get("PRODUCTION_OPS")?.permissions,
    productionBefore,
  );
  assert.deepEqual(
    fixture.repository.roles.get("HR_OPERATIONS")?.permissions,
    hrBefore,
  );
  assert.deepEqual(
    fixture.repository.assignments.get("assignment-production")?.scopeGrants,
    {
      workSchedule: ["global"],
    },
  );
  assert.deepEqual(
    fixture.repository.assignments.get("assignment-hr")?.scopeGrants,
    {
      workSchedule: ["department"],
    },
  );
  assert.deepEqual(fixture.repository.replacePermissionsCalls, [
    {
      roleId: "role-team-manager",
      roleCode: "TEAM_MANAGER",
      permissions:
        fixture.repository.roles.get("TEAM_MANAGER")?.permissions ?? [],
      updatedAt: NOW,
    },
  ]);
  assert.deepEqual(
    fixture.repository.replaceAssignmentScopeGrantsCalls.map((call) => ({
      assignmentId: call.assignmentId,
      roleId: call.roleId,
    })),
    [
      {
        assignmentId: "assignment-team-manager",
        roleId: "role-team-manager",
      },
    ],
  );
});

test("formatted cleanup output includes audit fields without secret-looking values", async () => {
  const fixture = createRuntimeRoleCleanupFixture({
    roles: [makeTeamManagerRoleWithStaleWorkSchedulePermissions()],
  });

  const output = formatRuntimeRoleCleanupSummary(
    await fixture.service.run({
      roleCode: "TEAM_MANAGER",
      mode: "dry-run",
      mongoDbName: "media-dev",
    }),
  );

  assert.match(output, /"mongoDbName": "media-dev"/u);
  assert.match(output, /"roleCode": "TEAM_MANAGER"/u);
  assert.match(output, /"currentPermissionsTargetedForRemoval"/u);
  assert.match(output, /"preservedPermissions"/u);
  assert.match(output, /"updateNeeded": true/u);
  assert.match(output, /"updated": false/u);
  assert.doesNotMatch(output, /mongodb:\/\//iu);
  assert.doesNotMatch(output, /auth0\|/iu);
  assert.doesNotMatch(output, /password|secret|token|cookie|ticket/iu);
});

test("runtime role cleanup package script does not embed confirm flag", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    readonly scripts?: Record<string, string>;
  };

  assert.equal(
    packageJson.scripts?.["role:cleanup-runtime"],
    "ts-node -r tsconfig-paths/register src/tools/smoke/runtime-role-cleanup.ts",
  );
  assert.doesNotMatch(
    packageJson.scripts?.["role:cleanup-runtime"] ?? "",
    /confirm-runtime-role-cleanup/u,
  );
});

function createRuntimeRoleCleanupFixture(
  params: {
    readonly roles?: readonly FakeRole[];
    readonly assignments?: readonly FakeAssignment[];
  } = {},
  deps: {
    readonly permissionRemovalAllowlist?: readonly string[];
  } = {},
) {
  const repository = new FakeRuntimeRoleCleanupRepository(params);
  const service = new RuntimeRoleCleanupService({
    roleRepository: repository,
    now: () => NOW,
    ...(deps.permissionRemovalAllowlist
      ? { permissionRemovalAllowlist: deps.permissionRemovalAllowlist }
      : {}),
  });

  return { repository, service };
}

interface FakeRole {
  readonly id: string;
  readonly code: string;
  readonly state: "ACTIVE";
  readonly permissions: readonly string[];
}

interface FakeAssignment {
  readonly assignmentId: string;
  readonly roleId: string;
  readonly userId: string;
  readonly scopeGrants?: ActorScopeGrants;
}

class FakeRuntimeRoleCleanupRepository {
  readonly roles = new Map<string, FakeRole>();
  readonly assignments = new Map<string, FakeAssignment>();
  readonly findByCodeCalls: string[] = [];
  readonly replacePermissionsCalls: Array<{
    readonly roleId: string;
    readonly roleCode: "TEAM_MANAGER";
    readonly permissions: readonly string[];
    readonly updatedAt: number;
  }> = [];
  readonly replaceAssignmentScopeGrantsCalls: Array<{
    readonly assignmentId: string;
    readonly roleId: string;
    readonly userId: string;
    readonly scopeGrants: ActorScopeGrants;
    readonly updatedAt: number;
  }> = [];

  constructor(params: {
    readonly roles?: readonly FakeRole[];
    readonly assignments?: readonly FakeAssignment[];
  }) {
    for (const role of params.roles ?? []) {
      this.roles.set(role.code, role);
    }
    for (const assignment of params.assignments ?? []) {
      this.assignments.set(assignment.assignmentId, assignment);
    }
  }

  async findByCode(code: "TEAM_MANAGER"): Promise<FakeRole | null> {
    this.findByCodeCalls.push(code);
    return this.roles.get(code) ?? null;
  }

  async replacePermissions(input: {
    readonly roleId: string;
    readonly roleCode: "TEAM_MANAGER";
    readonly permissions: readonly string[];
    readonly updatedAt: number;
  }): Promise<FakeRole | null> {
    this.replacePermissionsCalls.push(input);
    const role = [...this.roles.values()].find(
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
    };
    this.roles.set(updated.code, updated);
    return updated;
  }

  async listActiveAssignmentsByRoleId(
    roleId: string,
  ): Promise<readonly FakeAssignment[]> {
    return [...this.assignments.values()].filter(
      (assignment) => assignment.roleId === roleId,
    );
  }

  async replaceAssignmentScopeGrants(input: {
    readonly assignmentId: string;
    readonly roleId: string;
    readonly userId: string;
    readonly scopeGrants: ActorScopeGrants;
    readonly updatedAt: number;
  }): Promise<FakeAssignment | null> {
    this.replaceAssignmentScopeGrantsCalls.push(input);
    const current = this.assignments.get(input.assignmentId);
    if (
      !current ||
      current.roleId !== input.roleId ||
      current.userId !== input.userId
    ) {
      return null;
    }

    const updated = {
      ...current,
      scopeGrants: input.scopeGrants,
    };
    this.assignments.set(input.assignmentId, updated);
    return updated;
  }
}

function makeTeamManagerRoleWithStaleWorkSchedulePermissions(): FakeRole {
  const template = getRoleTemplate("TEAM_MANAGER");
  assert.ok(template);

  return {
    id: "role-team-manager",
    code: "TEAM_MANAGER",
    state: "ACTIVE",
    permissions: [
      ...template.permissions,
      Permission.WORK_SCHEDULE_CREATE,
      Permission.WORK_SCHEDULE_UPDATE,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    ],
  };
}

function makeRole(code: RoleTemplateCode): FakeRole {
  const template = getRoleTemplate(code);
  assert.ok(template);

  return {
    id: `role-${code.toLowerCase().replace(/_/gu, "-")}`,
    code,
    state: "ACTIVE",
    permissions: template.permissions,
  };
}

function runtimeCleanupErrorWithCode(code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof RuntimeRoleCleanupError);
    assert.equal(error.code, code);
    return true;
  };
}
