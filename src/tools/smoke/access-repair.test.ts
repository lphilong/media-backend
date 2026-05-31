import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ActorScopeGrants } from "@core/actor/actor";
import {
  getRoleTemplate,
  RoleTemplateCode,
} from "@modules/role/domain/role-template.catalog";
import {
  AccessRepairError,
  AccessRepairService,
  formatAccessRepairSummary,
  parseCliArgs,
} from "./access-repair";

const NOW = 1_779_552_000_000;

test("dry-run reports missing TEAM_MANAGER managedGroup event scope without writing", async () => {
  const fixture = createAccessRepairFixture({
    roles: [makeRole("TEAM_MANAGER")],
    assignments: [
      {
        assignmentId: "assignment-team-manager",
        roleId: "role-team-manager",
        userId: "user-team-manager",
        scopeGrants: {
          workSchedule: ["self", "team", "department"],
          kpi: ["managedGroup"],
        },
      },
    ],
    users: [
      {
        id: "user-team-manager",
        actorKind: "ADMIN",
        accountStatus: "ACTIVE",
        displayName: "Team Manager",
        email: "team.manager@example.test",
        authSubject: "auth0|team-manager",
      },
    ],
  });

  const summary = await fixture.service.run({
    roleCodes: ["TEAM_MANAGER"],
    mode: "dry-run",
    mongoDbName: "media-dev",
  });
  const assignment = summary.roleSummaries[0]?.assignments[0];

  assert.deepEqual(assignment?.missingScopeGrants, {
    eventAssignment: ["managedGroup"],
  });
  assert.equal(assignment?.scopeRepairNeeded, true);
  assert.equal(assignment?.updated, false);
  assert.equal(fixture.repository.updateCalls.length, 0);
  assert.equal(summary.authSecurityVersionBumped, false);
});

test("write union-adds missing PRODUCTION_OPS global scopes and bumps auth version", async () => {
  const fixture = createAccessRepairFixture({
    roles: [makeRole("PRODUCTION_OPS")],
    assignments: [
      {
        assignmentId: "assignment-production",
        roleId: "role-production-ops",
        userId: "user-production",
        scopeGrants: {
          workSchedule: ["department"],
        },
      },
    ],
    users: [
      {
        id: "user-production",
        actorKind: "ADMIN",
        accountStatus: "ACTIVE",
        displayName: "Production Ops",
      },
    ],
    linkedEmploymentProfiles: [
      {
        id: "employment-production",
        employeeCode: "EMP-000002",
        displayName: "Production Ops",
        legalName: "Production Ops",
        orgUnitId: "org-production",
        employmentStatus: "ACTIVE",
        linkedUserId: "user-production",
      },
    ],
  });

  const summary = await fixture.service.run({
    roleCodes: ["PRODUCTION_OPS"],
    mode: "write",
    userId: "user-production",
    mongoDbName: "media-dev",
  });
  const assignment = summary.roleSummaries[0]?.assignments[0];
  const updatedScopeGrants = fixture.repository.updateCalls[0]?.scopeGrants;

  assert.equal(assignment?.updated, true);
  assert.deepEqual(assignment?.missingScopeGrants, {
    workSchedule: ["global"],
    eventAssignment: ["global"],
  });
  assert.deepEqual(Object.keys(updatedScopeGrants ?? {}).sort(), [
    "eventAssignment",
    "workSchedule",
  ]);
  assert.deepEqual(
    new Set(updatedScopeGrants?.workSchedule),
    new Set(["department", "global"]),
  );
  assert.deepEqual(new Set(updatedScopeGrants?.eventAssignment), new Set([
    "global",
  ]));
  assert.equal(fixture.repository.authVersionBumps, 1);
  assert.equal(summary.authSecurityVersionBumped, true);
});

test("EmploymentProfile diagnostic reports manual linkage and safe candidates", async () => {
  const fixture = createAccessRepairFixture({
    roles: [makeRole("HR_OPERATIONS")],
    assignments: [
      {
        assignmentId: "assignment-hr",
        roleId: "role-hr-operations",
        userId: "user-hr",
        scopeGrants: {
          workSchedule: ["department"],
        },
      },
    ],
    users: [
      {
        id: "user-hr",
        actorKind: "ADMIN",
        accountStatus: "ACTIVE",
        displayName: "HR Operations",
        email: "hr.ops@example.test",
        authSubject: "auth0|hr-ops",
      },
    ],
    candidates: [
      {
        id: "employment-hr",
        employeeCode: "EMP-000003",
        displayName: "HR Operations",
        legalName: "HR Operations",
        orgUnitId: "org-hr",
        employmentStatus: "ACTIVE",
        linkedUserId: null,
      },
    ],
  });

  const summary = await fixture.service.run({
    roleCodes: ["HR_OPERATIONS"],
    mode: "dry-run",
  });
  const assignment = summary.roleSummaries[0]?.assignments[0];

  assert.equal(
    assignment?.employmentProfileLinkageStatus,
    "manual-linkage-required",
  );
  assert.equal(assignment?.user?.email, "hr***@example.test");
  assert.equal(assignment?.user?.authSubject, "auth0|[redacted]");
  assert.deepEqual(assignment?.employmentProfileCandidates, [
    {
      id: "employment-hr",
      employeeCode: "EMP-000003",
      displayName: "HR Operations",
      orgUnitId: "org-hr",
      employmentStatus: "ACTIVE",
    },
  ]);
});

test("write mode requires explicit target and .env.dev", () => {
  assert.equal(
    parseCliArgs(["--roles", "TEAM_MANAGER"]).mode,
    "dry-run",
  );
  assert.deepEqual(
    parseCliArgs([
      "--env-file",
      ".env.dev",
      "--roles",
      "TEAM_MANAGER,PRODUCTION_OPS",
      "--role",
      "HR_OPERATIONS",
      "--dry-run",
    ]).roleCodes,
    ["TEAM_MANAGER", "PRODUCTION_OPS", "HR_OPERATIONS"],
  );
  assert.throws(
    () =>
      parseCliArgs([
        "--env-file",
        ".env.dev",
        "--roles",
        "TEAM_MANAGER",
        "--confirm-access-repair",
      ]),
    accessRepairErrorWithCode("ACCESS_REPAIR_WRITE_TARGET_REQUIRED"),
  );
  assert.throws(
    () =>
      parseCliArgs([
        "--env-file",
        ".env.local",
        "--roles",
        "TEAM_MANAGER",
        "--user-id",
        "user-1",
        "--confirm-access-repair",
      ]),
    accessRepairErrorWithCode("ACCESS_REPAIR_ENV_FILE_MUST_BE_DEV"),
  );
  assert.equal(
    parseCliArgs([
      "--env-file",
      ".env.dev",
      "--roles",
      "TEAM_MANAGER",
      "--assignment-id",
      "assignment-1",
      "--confirm-access-repair",
    ]).mode,
    "write",
  );
});

test("formatted access repair summary masks sensitive auth fields", async () => {
  const fixture = createAccessRepairFixture({
    roles: [makeRole("TEAM_MANAGER")],
    assignments: [
      {
        assignmentId: "assignment-team-manager",
        roleId: "role-team-manager",
        userId: "user-team-manager",
        scopeGrants: {},
      },
    ],
    users: [
      {
        id: "user-team-manager",
        actorKind: "ADMIN",
        accountStatus: "ACTIVE",
        displayName: "Team Manager",
        email: "team.manager@example.test",
        authSubject: "auth0|team-manager",
      },
    ],
  });

  const output = formatAccessRepairSummary(
    await fixture.service.run({
      roleCodes: ["TEAM_MANAGER"],
      mode: "dry-run",
    }),
  );

  assert.doesNotMatch(output, /team\.manager@example\.test/u);
  assert.doesNotMatch(output, /auth0\|team-manager/u);
});

test("access repair package script does not embed confirm flag", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    readonly scripts?: Record<string, string>;
  };

  assert.equal(
    packageJson.scripts?.["access:repair"],
    "ts-node -r tsconfig-paths/register src/tools/smoke/access-repair.ts",
  );
  assert.doesNotMatch(
    packageJson.scripts?.["access:repair"] ?? "",
    /confirm-access-repair/u,
  );
});

function createAccessRepairFixture(params: {
  readonly roles?: readonly FakeRole[];
  readonly assignments?: readonly FakeAssignment[];
  readonly users?: readonly FakeUser[];
  readonly linkedEmploymentProfiles?: readonly FakeEmploymentProfile[];
  readonly candidates?: readonly FakeEmploymentProfile[];
}) {
  const repository = new FakeAccessRepairRepository(params);
  const service = new AccessRepairService(repository as never, () => NOW);

  return { repository, service };
}

interface FakeRole {
  readonly id: string;
  readonly code: RoleTemplateCode;
  readonly state: "ACTIVE";
  readonly permissions: readonly string[];
}

interface FakeAssignment {
  readonly assignmentId: string;
  readonly roleId: string;
  readonly userId: string;
  readonly scopeGrants?: ActorScopeGrants;
}

interface FakeUser {
  readonly id: string;
  readonly actorKind: "ADMIN" | "STAFF";
  readonly accountStatus: string;
  readonly displayName: string;
  readonly email?: string;
  readonly authSubject?: string;
}

interface FakeEmploymentProfile {
  readonly id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly orgUnitId: string;
  readonly employmentStatus: string;
  readonly linkedUserId: string | null;
}

class FakeAccessRepairRepository {
  readonly updateCalls: Array<{
    readonly assignmentId: string;
    readonly roleId: string;
    readonly userId: string;
    readonly scopeGrants: ActorScopeGrants;
    readonly updatedAt: number;
  }> = [];
  authVersionBumps = 0;

  private readonly roles = new Map<string, FakeRole>();
  private readonly assignments = new Map<string, FakeAssignment>();
  private readonly users = new Map<string, FakeUser>();

  constructor(
    private readonly params: {
      readonly roles?: readonly FakeRole[];
      readonly assignments?: readonly FakeAssignment[];
      readonly users?: readonly FakeUser[];
      readonly linkedEmploymentProfiles?: readonly FakeEmploymentProfile[];
      readonly candidates?: readonly FakeEmploymentProfile[];
    },
  ) {
    for (const role of params.roles ?? []) {
      this.roles.set(role.code, role);
    }
    for (const assignment of params.assignments ?? []) {
      this.assignments.set(assignment.assignmentId, assignment);
    }
    for (const user of params.users ?? []) {
      this.users.set(user.id, user);
    }
  }

  async findActiveRoleByCode(code: RoleTemplateCode) {
    return this.roles.get(code) ?? null;
  }

  async listActiveAssignments(input: {
    readonly roleId: string;
    readonly userId?: string;
    readonly assignmentId?: string;
  }) {
    return [...this.assignments.values()].filter(
      (assignment) =>
        assignment.roleId === input.roleId &&
        (!input.userId || assignment.userId === input.userId) &&
        (!input.assignmentId ||
          assignment.assignmentId === input.assignmentId),
    );
  }

  async findUserById(userId: string) {
    return this.users.get(userId) ?? null;
  }

  async findActiveEmploymentProfileByLinkedUserId(userId: string) {
    return (
      this.params.linkedEmploymentProfiles?.find(
        (profile) =>
          profile.linkedUserId === userId &&
          profile.employmentStatus === "ACTIVE",
      ) ?? null
    );
  }

  async listEmploymentProfileCandidatesForUser(_user: FakeUser) {
    return this.params.candidates ?? [];
  }

  async updateAssignmentScopeGrants(input: {
    readonly assignmentId: string;
    readonly roleId: string;
    readonly userId: string;
    readonly scopeGrants: ActorScopeGrants;
    readonly updatedAt: number;
  }) {
    this.updateCalls.push(input);
    const current = this.assignments.get(input.assignmentId);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      scopeGrants: input.scopeGrants,
    };
    this.assignments.set(input.assignmentId, updated);
    return updated;
  }

  async bumpAuthSecurityVersion(): Promise<void> {
    this.authVersionBumps += 1;
  }
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

function accessRepairErrorWithCode(code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof AccessRepairError);
    assert.equal(error.code, code);
    return true;
  };
}
