import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
import { PeopleReadinessSnapshot } from "./domain/people-readiness.types";
import { PeopleReadinessAdminService, generateIssues } from "./admin/admin.people-readiness.service";
import { adminPeopleReadinessRoutes } from "./admin/admin.people-readiness.routes";

const now = Date.UTC(2026, 5, 7);

test("People Readiness generates exact supported issues with deterministic safe DTOs", () => {
  const first = generateIssues(snapshot(), now);
  const second = generateIssues(snapshot(), now + 1);
  const codes = new Set(first.map((item) => item.issueCode));

  [
    "ACTIVE_USER_WITHOUT_EMPLOYMENT_PROFILE",
    "EMPLOYMENT_PROFILE_REQUIRES_LOGIN_BUT_MISSING_ACTIVE_USER",
    "EMPLOYMENT_PROFILE_LINKED_USER_INACTIVE",
    "EMPLOYMENT_PROFILE_NOT_ACTIVE_FOR_OPERATIONS",
    "EMPLOYMENT_PROFILE_MISSING_ORG_UNIT",
    "EMPLOYMENT_PROFILE_IN_INACTIVE_ORG_UNIT",
    "INTERNAL_TALENT_MISSING_EMPLOYMENT_PROFILE",
    "INTERNAL_TALENT_LINKED_PROFILE_NOT_ACTIVE",
    "EXTERNAL_TALENT_HAS_EMPLOYMENT_PROFILE_LINK",
    "TALENTGROUP_ACTIVE_MEMBER_MISSING_EMPLOYMENT_PROFILE",
    "TALENTGROUP_ACTIVE_MEMBER_LINKED_PROFILE_NOT_ACTIVE",
    "TALENTGROUP_ACTIVE_MEMBER_TALENT_NOT_ACTIVE",
    "TALENTGROUP_HAS_NO_OPERATIONAL_MEMBERS",
    "ORGUNIT_HAS_NO_ACTIVE_EMPLOYMENT_PROFILES",
    "ORGUNIT_MANAGER_ASSIGNMENT_MANAGER_NOT_PROFILE_READY",
    "ORGUNIT_MANAGER_ASSIGNMENT_MANAGER_NOT_LOGIN_READY",
    "TALENTGROUP_MANAGER_ASSIGNMENT_MANAGER_NOT_PROFILE_READY",
    "TALENTGROUP_MANAGER_ASSIGNMENT_MANAGER_NOT_LOGIN_READY",
    "SELF_SERVICE_PROFILE_NOT_ACTIVE",
  ].forEach((code) => assert.equal(codes.has(code as never), true, code));

  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
  assert.equal(
    first.find(
      (item) =>
        item.issueCode === "INTERNAL_TALENT_LINKED_PROFILE_NOT_ACTIVE",
    )?.primaryEntity.displayName,
    "Inactive Person",
  );
  const serialized = JSON.stringify(first);
  ["authLinkage", "subject", "email", "phone", "payroll", "attendance"].forEach((field) =>
    assert.equal(serialized.includes(field), false, field),
  );
});

test("People Readiness summary, filters, and cursor pagination use the same exact issue set", async () => {
  const service = serviceWith(snapshot());
  const actor = allowedActor();
  const summary = await service.getSummary(actor);
  const blockers = await service.listIssues(actor, { severity: "BLOCKER", limit: "2" });
  const next = await service.listIssues(actor, {
    severity: "BLOCKER",
    limit: "100",
    cursor: blockers.nextCursor ?? undefined,
  });
  const account = await service.listIssues(actor, { category: "ACCOUNT_LOGIN_READY" });
  const specific = await service.listIssues(actor, {
    issueCode: "ACTIVE_USER_WITHOUT_EMPLOYMENT_PROFILE",
  });

  assert.equal(summary.totalIssueCount, Object.values(summary.countsByIssueCode).reduce((a, b) => a + b, 0));
  assert.equal(blockers.items.length, 2);
  assert.equal(blockers.totalCount, blockers.items.length + next.items.length);
  assert.equal(account.items.every((item) => item.category === "ACCOUNT_LOGIN_READY"), true);
  assert.equal(specific.items.length, 1);
  assert.equal(specific.items[0]?.issueCode, "ACTIVE_USER_WITHOUT_EMPLOYMENT_PROFILE");
  assert.equal(summary.dataCoverage.exactForSupportedIssueCodes, true);
});

test("People Readiness rejects unsupported filters, limits, and cursors", async () => {
  const service = serviceWith(snapshot());
  const actor = allowedActor();

  await assert.rejects(
    () => service.listIssues(actor, { category: "PAYROLL_READY" }),
    /Unsupported category/,
  );
  await assert.rejects(
    () => service.listIssues(actor, { entityType: "ROLE" }),
    /Unsupported entityType/,
  );
  await assert.rejects(
    () => service.listIssues(actor, { limit: "101" }),
    /limit must be an integer from 1 to 100/,
  );
  await assert.rejects(
    () => service.listIssues(actor, { cursor: "not-a-cursor" }),
    /cursor is invalid/,
  );
});

test("People Readiness authority is ADMIN actor plus EmploymentProfile read capability", async () => {
  const service = serviceWith(snapshot());
  await assert.doesNotReject(() => service.getSummary(allowedActor()));
  await assert.rejects(() => service.getSummary(allowedActor({ permissions: [] })), /Missing permission/);
  await assert.rejects(() => service.getSummary(allowedActor({ type: "staff" })), /Admin access requires/);
  await assert.rejects(() => service.getSummary(allowedActor({ roles: ["ADMIN_FULL"], permissions: [] })), /Missing permission/);
  await assert.rejects(() => service.getSummary(allowedActor({
    roles: ["TEAM_MANAGER"],
    permissions: ["kpi.read"],
    scopeGrants: { kpi: ["managedGroup"] },
  })), /Missing permission/);
});

test("People Readiness routes register summary and issues under the module router", () => {
  const noop = { execute() {} } as never;
  const router = adminPeopleReadinessRoutes(noop);
  const paths = (router as unknown as { stack: Array<{ route?: { path?: string } }> })
    .stack.map((layer) => layer.route?.path).filter(Boolean);
  assert.deepEqual(paths, ["/summary", "/issues"]);
});

function serviceWith(data: PeopleReadinessSnapshot): PeopleReadinessAdminService {
  return new PeopleReadinessAdminService({ async getSnapshot() { return data; } }, () => now);
}

function allowedActor(overrides: Partial<ConstructorParameters<typeof Actor>[0]> = {}): Actor {
  return new Actor({
    id: "admin-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: ["employmentProfile.read"],
    scopeGrants: {},
    isActive: true,
    ...overrides,
  });
}

function snapshot(): PeopleReadinessSnapshot {
  return {
    users: [
      { id: "user-orphan", displayName: "Orphan Account", accountStatus: "ACTIVE", actorKind: "STAFF" },
      { id: "user-disabled", displayName: "Disabled Account", accountStatus: "DISABLED", actorKind: "ADMIN" },
      { id: "user-ready", displayName: "Ready Account", accountStatus: "ACTIVE", actorKind: "STAFF" },
    ],
    employmentProfiles: [
      { id: "ep-ready", employeeCode: "EP-READY", displayName: "Ready Person", orgUnitId: "ou-ready", linkedUserId: "user-ready", employmentStatus: "ACTIVE" },
      { id: "ep-inactive", employeeCode: "EP-INACTIVE", displayName: "Inactive Person", orgUnitId: "ou-inactive", linkedUserId: "user-disabled", employmentStatus: "SUSPENDED" },
      { id: "ep-manager-no-login", employeeCode: "EP-MANAGER", displayName: "Manager No Login", orgUnitId: "ou-ready", linkedUserId: null, employmentStatus: "ACTIVE" },
      { id: "ep-no-org", employeeCode: "EP-NO-ORG", displayName: "No Org Person", orgUnitId: null, linkedUserId: null, employmentStatus: "ACTIVE" },
    ],
    talents: [
      { id: "talent-missing", talentCode: "T-MISSING", displayName: "Missing Link", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: null },
      { id: "talent-inactive-profile", talentCode: "T-INACTIVE-P", displayName: "Inactive Profile", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "ep-inactive" },
      { id: "talent-inactive", talentCode: "T-INACTIVE", displayName: "Inactive Talent", talentOrigin: "INTERNAL", operationalStatus: "INACTIVE", linkedEmploymentProfileId: "ep-ready" },
      { id: "talent-external-linked", talentCode: "T-EXTERNAL", displayName: "External Linked", talentOrigin: "EXTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "ep-ready" },
    ],
    orgUnits: [
      { id: "ou-ready", code: "OU-READY", name: "Ready Unit", type: "TEAM", status: "ACTIVE" },
      { id: "ou-empty", code: "OU-EMPTY", name: "Empty Unit", type: "TEAM", status: "ACTIVE" },
      { id: "ou-inactive", code: "OU-INACTIVE", name: "Inactive Unit", type: "TEAM", status: "INACTIVE" },
    ],
    talentGroups: [
      { id: "tg-broken", groupCode: "TG-BROKEN", name: "Broken Group", status: "ACTIVE" },
    ],
    talentGroupMembers: [
      { id: "member-missing", groupId: "tg-broken", talentId: "talent-missing", membershipStatus: "ACTIVE" },
      { id: "member-profile", groupId: "tg-broken", talentId: "talent-inactive-profile", membershipStatus: "ACTIVE" },
      { id: "member-talent", groupId: "tg-broken", talentId: "talent-inactive", membershipStatus: "ACTIVE" },
    ],
    orgUnitManagerAssignments: [
      { id: "ou-assignment", targetId: "ou-ready", managerEmploymentProfileId: "ep-manager-no-login", role: "UNIT_MANAGER", status: "ACTIVE", effectiveFrom: now - 1, effectiveTo: null },
      { id: "ou-assignment-inactive", targetId: "ou-ready", managerEmploymentProfileId: "ep-inactive", role: "UNIT_MANAGER", status: "ACTIVE", effectiveFrom: now - 1, effectiveTo: null },
    ],
    talentGroupManagerAssignments: [
      { id: "tg-assignment", targetId: "tg-broken", managerEmploymentProfileId: "ep-manager-no-login", role: "MANAGER", status: "ACTIVE", effectiveFrom: now - 1, effectiveTo: null },
      { id: "tg-assignment-inactive", targetId: "tg-broken", managerEmploymentProfileId: "ep-inactive", role: "MANAGER", status: "ACTIVE", effectiveFrom: now - 1, effectiveTo: null },
    ],
  };
}
