import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
import { PeopleReadinessSnapshot } from "./domain/people-readiness.types";
import { PeopleReadinessAdminService, generateIssues } from "./admin/admin.people-readiness.service";
import { adminPeopleReadinessRoutes } from "./admin/admin.people-readiness.routes";
import {
  EmploymentTermsReadinessFacts,
  evaluateEmploymentTermsReadiness,
} from "@modules/employment-terms/domain/employment-terms-readiness";
import { EmploymentTermsRecord } from "@modules/employment-terms/domain/employment-terms.types";
import {
  PEOPLE_READINESS_CATEGORIES,
  PEOPLE_READINESS_ISSUE_CODES,
} from "./domain/people-readiness.types";

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
  ["authLinkage", "subject", "email", "phone", "attendance"].forEach((field) =>
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
  const employmentTerms = await service.listIssues(actor, {
    category: "EMPLOYMENT_TERMS_READY",
  });
  const missingTerms = await service.listIssues(actor, {
    issueCode: "ACTIVE_PROFILE_MISSING_EMPLOYMENT_TERMS",
  });

  assert.equal(summary.totalIssueCount, Object.values(summary.countsByIssueCode).reduce((a, b) => a + b, 0));
  assert.equal(blockers.items.length, 2);
  assert.equal(blockers.totalCount, blockers.items.length + next.items.length);
  assert.equal(account.items.every((item) => item.category === "ACCOUNT_LOGIN_READY"), true);
  assert.equal(specific.items.length, 1);
  assert.equal(specific.items[0]?.issueCode, "ACTIVE_USER_WITHOUT_EMPLOYMENT_PROFILE");
  assert.equal(employmentTerms.items.length, missingTerms.items.length);
  assert.equal(
    employmentTerms.items.every((item) => item.category === "EMPLOYMENT_TERMS_READY"),
    true,
  );
  assert.equal(
    summary.countsByCategory.EMPLOYMENT_TERMS_READY,
    employmentTerms.totalCount,
  );
  assert.equal(
    summary.countsByIssueCode.ACTIVE_PROFILE_MISSING_EMPLOYMENT_TERMS,
    missingTerms.totalCount,
  );
  assert.equal(summary.dataCoverage.exactForSupportedIssueCodes, true);
});

test("People Readiness exposes the Employment Terms category and exactly five HRET issue codes", () => {
  assert.equal(PEOPLE_READINESS_CATEGORIES.includes("EMPLOYMENT_TERMS_READY"), true);
  assert.deepEqual(
    PEOPLE_READINESS_ISSUE_CODES.filter((code) =>
      code === "ACTIVE_PROFILE_MISSING_EMPLOYMENT_TERMS"
      || code.startsWith("EMPLOYMENT_TERMS_"),
    ),
    [
      "ACTIVE_PROFILE_MISSING_EMPLOYMENT_TERMS",
      "EMPLOYMENT_TERMS_PENDING_APPROVAL",
      "EMPLOYMENT_TERMS_EXPIRED",
      "EMPLOYMENT_TERMS_MISSING_BASE_SALARY",
      "EMPLOYMENT_TERMS_OVERLAP",
    ],
  );
  assert.equal(PEOPLE_READINESS_ISSUE_CODES.includes("PAYROLL_ELIGIBLE_PROFILE_NOT_READY" as never), false);
  assert.equal(PEOPLE_READINESS_ISSUE_CODES.includes("TERMINATED_PROFILE_NEEDS_FINAL_SETTLEMENT_MARKER" as never), false);
});

test("People Readiness classifies Employment Terms with one explicit precedence row per operational profile", () => {
  const profileId = "ep-hret";
  const cases: Array<{
    name: string;
    facts: EmploymentTermsReadinessFacts;
    code: string | null;
    severity?: string;
  }> = [
    {
      name: "overlap",
      facts: facts({ hasOverlap: true, hasCurrentCandidateMissingBaseSalary: true }),
      code: "EMPLOYMENT_TERMS_OVERLAP",
    },
    {
      name: "missing salary",
      facts: facts({ hasCurrentCandidateMissingBaseSalary: true, hasPendingApproval: true }),
      code: "EMPLOYMENT_TERMS_MISSING_BASE_SALARY",
    },
    {
      name: "pending blocker",
      facts: facts({ hasPendingApproval: true }),
      code: "EMPLOYMENT_TERMS_PENDING_APPROVAL",
      severity: "BLOCKER",
    },
    {
      name: "pending warning",
      facts: facts({ hasPendingApproval: true, hasCurrentValidSource: true }),
      code: "EMPLOYMENT_TERMS_PENDING_APPROVAL",
      severity: "WARNING",
    },
    {
      name: "expired",
      facts: facts({ hasExpiredApprovedSource: true }),
      code: "EMPLOYMENT_TERMS_EXPIRED",
    },
    {
      name: "missing",
      facts: facts({}),
      code: "ACTIVE_PROFILE_MISSING_EMPLOYMENT_TERMS",
    },
    {
      name: "ready",
      facts: facts({ hasCurrentValidSource: true }),
      code: null,
    },
  ];

  for (const item of cases) {
    const issues = generateIssues(
      hretSnapshot(profileId, "ACTIVE"),
      now,
      new Map([[profileId, item.facts]]),
    ).filter((issue) => issue.category === "EMPLOYMENT_TERMS_READY");
    assert.equal(issues.length, item.code ? 1 : 0, item.name);
    assert.equal(issues[0]?.issueCode ?? null, item.code, item.name);
    if (item.severity) assert.equal(issues[0]?.severity, item.severity, item.name);
  }
});

test("Employment Terms readiness evaluator accepts zero salary and rejects negative or malformed salary", () => {
  const current = termsRecord({
    id: "current",
    effectiveFrom: now - 86_400_000,
    baseSalaryAmount: 0,
  });
  assert.deepEqual(evaluateEmploymentTermsReadiness([current], now), facts({
    hasCurrentValidSource: true,
  }));

  const negative = {
    ...current,
    id: "negative",
    baseSalaryAmount: -1,
  };
  assert.equal(
    evaluateEmploymentTermsReadiness([negative], now).hasCurrentCandidateMissingBaseSalary,
    true,
  );

  const malformed = {
    ...current,
    id: "malformed",
    baseSalaryAmount: Number.NaN,
  };
  assert.equal(
    evaluateEmploymentTermsReadiness([malformed], now).hasCurrentCandidateMissingBaseSalary,
    true,
  );
});

test("Employment Terms readiness evaluator detects overlap and ignores payrollEligible false alone", () => {
  const current = termsRecord({
    id: "current",
    effectiveFrom: now - 86_400_000,
  });
  const overlap = termsRecord({
    id: "overlap",
    effectiveFrom: now,
    effectiveTo: now + 86_400_000,
  });
  assert.equal(evaluateEmploymentTermsReadiness([current, overlap], now).hasOverlap, true);

  const notPayrollEligible = termsRecord({
    id: "not-eligible",
    payrollEligible: false,
  });
  const notEligibleFacts = evaluateEmploymentTermsReadiness([notPayrollEligible], now);
  assert.deepEqual(notEligibleFacts, facts({ hasOnlyNonPayrollEligibleTerms: true }));
  assert.equal(
    generateIssues(
      hretSnapshot("ep-not-eligible", "ACTIVE"),
      now,
      new Map([["ep-not-eligible", notEligibleFacts]]),
    ).some((issue) => issue.category === "EMPLOYMENT_TERMS_READY"),
    false,
  );
});

test("Employment Terms pending readiness only considers payroll-eligible source candidates", () => {
  const profileId = "ep-pending";
  const nonPayrollPending = termsRecord({
    id: "pending-not-eligible",
    employmentProfileId: profileId,
    status: "PENDING_APPROVAL",
    payrollEligible: false,
    approvedBy: null,
    approvedAt: null,
  });
  const nonPayrollFacts = evaluateEmploymentTermsReadiness([nonPayrollPending], now);
  assert.deepEqual(nonPayrollFacts, facts({ hasOnlyNonPayrollEligibleTerms: true }));
  assert.equal(
    generateIssues(
      hretSnapshot(profileId, "ACTIVE"),
      now,
      new Map([[profileId, nonPayrollFacts]]),
    ).some((issue) => issue.category === "EMPLOYMENT_TERMS_READY"),
    false,
  );

  const payrollPending = {
    ...nonPayrollPending,
    id: "pending-eligible",
    payrollEligible: true,
  };
  const pendingFacts = evaluateEmploymentTermsReadiness([payrollPending], now);
  assert.equal(pendingFacts.hasPendingApproval, true);
  const blocker = generateIssues(
    hretSnapshot(profileId, "ACTIVE"),
    now,
    new Map([[profileId, pendingFacts]]),
  ).find((issue) => issue.category === "EMPLOYMENT_TERMS_READY");
  assert.equal(blocker?.issueCode, "EMPLOYMENT_TERMS_PENDING_APPROVAL");
  assert.equal(blocker?.severity, "BLOCKER");

  const current = termsRecord({
    id: "current",
    employmentProfileId: profileId,
    effectiveFrom: now - 86_400_000,
  });
  const warningFacts = evaluateEmploymentTermsReadiness([current, payrollPending], now);
  const warning = generateIssues(
    hretSnapshot(profileId, "ACTIVE"),
    now,
    new Map([[profileId, warningFacts]]),
  ).find((issue) => issue.category === "EMPLOYMENT_TERMS_READY");
  assert.equal(warning?.issueCode, "EMPLOYMENT_TERMS_PENDING_APPROVAL");
  assert.equal(warning?.severity, "WARNING");
});

test("People Readiness does not generate HRET issues for terminated profiles", () => {
  const issues = generateIssues(
    hretSnapshot("ep-terminated", "TERMINATED"),
    now,
    new Map([["ep-terminated", facts({})]]),
  );
  assert.equal(
    issues.some((issue) => issue.category === "EMPLOYMENT_TERMS_READY"),
    false,
  );
  assert.equal(
    issues.some((issue) => issue.issueCode === "TERMINATED_PROFILE_NEEDS_FINAL_SETTLEMENT_MARKER" as never),
    false,
  );
});

test("Employment Terms readiness issue DTO is privacy-safe and uses the anchored EmploymentProfile repair target", () => {
  const issue = generateIssues(
    hretSnapshot("ep-private", "ACTIVE"),
    now,
    new Map([["ep-private", facts({ hasCurrentCandidateMissingBaseSalary: true })]]),
  ).find((item) => item.category === "EMPLOYMENT_TERMS_READY");
  assert.ok(issue);
  assert.deepEqual(issue.relatedEntities, []);
  assert.equal(issue.metadata, undefined);
  assert.deepEqual(issue.repairTarget, {
    targetType: "EMPLOYMENT_PROFILE",
    targetId: "ep-private",
    suggestedSurface: "/employment-profiles/ep-private#employment-terms",
    suggestedAction: "Review Employment Terms",
  });
  const serialized = JSON.stringify(issue);
  [
    "baseSalaryAmount",
    "allowances",
    "currencyCode",
    "sourceNote",
    "approvedBy",
    "createdBy",
    "termsCode",
    "termsId",
  ].forEach((field) => assert.equal(serialized.includes(field), false, field));
});

test("People Readiness uses one request-wide HCM business date and one bulk provider call", async () => {
  const timestamp = Date.UTC(2026, 5, 6, 18, 30);
  const data = hretSnapshot("ep-date", "ACTIVE");
  const calls: Array<{ ids: readonly string[]; asOfDate: number }> = [];
  const service = new PeopleReadinessAdminService(
    { async getSnapshot() { return data; } },
    {
      async getReadinessFacts(ids, asOfDate) {
        calls.push({ ids, asOfDate });
        return new Map([["ep-date", facts({})]]);
      },
    },
    () => timestamp,
  );

  await service.getSummary(allowedActor());
  assert.deepEqual(calls, [{
    ids: ["ep-date"],
    asOfDate: Date.UTC(2026, 5, 7),
  }]);
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
  return new PeopleReadinessAdminService(
    { async getSnapshot() { return data; } },
    { async getReadinessFacts() { return new Map(); } },
    () => now,
  );
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

function facts(
  overrides: Partial<EmploymentTermsReadinessFacts>,
): EmploymentTermsReadinessFacts {
  return {
    hasOnlyNonPayrollEligibleTerms: false,
    hasPendingApproval: false,
    hasCurrentValidSource: false,
    hasExpiredApprovedSource: false,
    hasCurrentCandidateMissingBaseSalary: false,
    hasOverlap: false,
    ...overrides,
  };
}

function hretSnapshot(
  id: string,
  employmentStatus: string,
): PeopleReadinessSnapshot {
  return {
    users: [],
    employmentProfiles: [{
      id,
      employeeCode: id.toUpperCase(),
      displayName: "Employment Terms Person",
      orgUnitId: "ou-hret",
      linkedUserId: null,
      employmentStatus,
    }],
    talents: [],
    orgUnits: [{
      id: "ou-hret",
      code: "OU-HRET",
      name: "Employment Terms Unit",
      type: "TEAM",
      status: "ACTIVE",
    }],
    talentGroups: [],
    talentGroupMembers: [],
    orgUnitManagerAssignments: [],
    talentGroupManagerAssignments: [],
  };
}

function termsRecord(
  overrides: Partial<EmploymentTermsRecord>,
): EmploymentTermsRecord {
  return {
    id: "terms-1",
    termsCode: "HRET-2026-000001",
    employmentProfileId: "ep-hret",
    status: "APPROVED",
    effectiveFrom: now,
    effectiveTo: null,
    baseSalaryAmount: 1,
    currencyCode: "VND",
    payFrequency: "MONTHLY",
    allowances: [],
    payrollEligible: true,
    sourceNote: null,
    createdBy: "creator",
    createdAt: now,
    updatedBy: "updater",
    updatedAt: now,
    submittedBy: "submitter",
    submittedAt: now,
    approvedBy: "approver",
    approvedAt: now,
    cancelledBy: null,
    cancelledAt: null,
    supersedesTermsId: null,
    supersededByTermsId: null,
    version: 1,
    ...overrides,
  };
}
