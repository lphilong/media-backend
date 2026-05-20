import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { AuditContext } from "@core/audit/audit.context";
import { Permission } from "@core/permission/permission.enum";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { STUDIO_RESOURCE_CLASSES } from "@modules/studio-resource/domain/studio-resource.types";
import type {
  ExistingFixtureRecord,
  FixtureModule,
  FixturePayload,
} from "./seed-smoke-fixtures";
import {
  buildCatalogFixtures,
  createSmokeFixtureActor,
  runCatalogFixtures,
} from "./seed-smoke-fixtures";
import {
  createPhaseAServiceBackedFixtureServices,
  PhaseAFixtureLookup,
  SMOKE_PHASE_A_PERMISSIONS,
  SMOKE_PHASE_A_SCOPE_GRANTS,
} from "./seed-smoke-fixtures.adapter";
import type { CreateOrgUnitCommand } from "@modules/org-unit/shared/org-unit.contracts";
import type { CreateEmploymentProfileCommand } from "@modules/employment-profile/shared/employment-profile.contracts";
import type { CreateStudioResourceCommand } from "@modules/studio-resource/shared/studio-resource.contracts";
import type { CreateTalentCommand } from "@modules/talent/shared/talent.contracts";
import type {
  AddTalentGroupMemberCommand,
  CreateTalentGroupCommand,
} from "@modules/talent-group/shared/talent-group.contracts";
import type { CreatePlatformAccountCommand } from "@modules/platform-account/shared/platform-account.contracts";
import type {
  AddHolidayCalendarEntryCommand,
  CreateHolidayCalendarCommand,
  CreateWorkPatternCommand,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import type { CreateEventCommand } from "@modules/event-assignment/shared/event-assignment.contracts";
import type {
  ActivateContractRecordCommand,
  CreateContractRecordCommand,
} from "@modules/contract-registry/shared/contract-registry.contracts";
import type { CreateTalentKpiRecordCommand } from "@modules/talent-kpi/shared/talent-kpi.contracts";
import type { CreateRevenueEntryCommand } from "@modules/revenue-ledger/shared/revenue-ledger.contracts";
import type { CreateCommissionRuleCommand } from "@modules/commission/shared/commission.contracts";

const NOW = Date.UTC(2026, 0, 15, 9, 0, 0);

class FakeLookup implements PhaseAFixtureLookup {
  readonly lookups: string[] = [];

  constructor(
    private readonly existing = new Map<
      string,
      ExistingFixtureRecord
    >(),
  ) {}

  async findByExternalRef(
    module: FixtureModule,
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    this.lookups.push(`${module}:${externalRef}`);
    return this.existing.get(`${module}:${externalRef}`) ?? null;
  }
}

class FakePhaseAServices {
  readonly lookup: FakeLookup;
  readonly orgUnitCreates: CreateOrgUnitCommand[] = [];
  readonly employmentProfileCreates: CreateEmploymentProfileCommand[] =
    [];
  readonly talentCreates: CreateTalentCommand[] = [];
  readonly talentGroupCreates: CreateTalentGroupCommand[] = [];
  readonly talentGroupMemberAdds: AddTalentGroupMemberCommand[] =
    [];
  readonly platformAccountCreates: CreatePlatformAccountCommand[] =
    [];
  readonly studioResourceCreates: CreateStudioResourceCommand[] =
    [];
  readonly workPatternCreates: CreateWorkPatternCommand[] = [];
  readonly holidayCalendarCreates: CreateHolidayCalendarCommand[] =
    [];
  readonly holidayCalendarEntryAdds: AddHolidayCalendarEntryCommand[] =
    [];
  readonly eventCreates: CreateEventCommand[] = [];
  readonly contractCreates: CreateContractRecordCommand[] = [];
  readonly contractActivations: ActivateContractRecordCommand[] =
    [];
  readonly talentKpiCreates: CreateTalentKpiRecordCommand[] =
    [];
  readonly revenueEntryCreates: CreateRevenueEntryCommand[] =
    [];
  readonly commissionRuleCreates: CreateCommissionRuleCommand[] =
    [];
  readonly traceIds: string[] = [];
  readonly auditScopeChecks: string[] = [];

  constructor(
    existing = new Map<string, ExistingFixtureRecord>(),
  ) {
    this.lookup = new FakeLookup(existing);
  }

  services() {
    return createPhaseAServiceBackedFixtureServices({
      lookup: this.lookup,
      orgUnitService: {
        createOrgUnit: async (
          _actor: Actor,
          command: CreateOrgUnitCommand,
        ) => {
          this.recordContext("org-unit");
          this.orgUnitCreates.push(command);
          return {
            id: `id:org-unit:${this.orgUnitCreates.length}`,
          };
        },
      },
      employmentProfileService: {
        createEmploymentProfile: async (
          _actor: Actor,
          command: CreateEmploymentProfileCommand,
        ) => {
          this.recordContext("employment-profile");
          this.employmentProfileCreates.push(command);
          return {
            id: `id:employment-profile:${this.employmentProfileCreates.length}`,
          };
        },
      },
      talentService: {
        createTalent: async (
          _actor: Actor,
          command: CreateTalentCommand,
        ) => {
          this.recordContext("talent");
          this.talentCreates.push(command);
          return {
            id: `id:talent:${this.talentCreates.length}`,
          };
        },
      },
      talentGroupService: {
        createTalentGroup: async (
          _actor: Actor,
          command: CreateTalentGroupCommand,
        ) => {
          this.recordContext("talent-group");
          this.talentGroupCreates.push(command);
          return {
            id: `id:talent-group:${this.talentGroupCreates.length}`,
          };
        },
        addTalentGroupMember: async (
          _actor: Actor,
          command: AddTalentGroupMemberCommand,
        ) => {
          this.recordContext("talent-group-member");
          this.talentGroupMemberAdds.push(command);
          return {
            id: `id:talent-group-member:${this.talentGroupMemberAdds.length}`,
          };
        },
      },
      platformAccountService: {
        createPlatformAccount: async (
          _actor: Actor,
          command: CreatePlatformAccountCommand,
        ) => {
          this.recordContext("platform-account");
          this.platformAccountCreates.push(command);
          return {
            id: `id:platform-account:${this.platformAccountCreates.length}`,
          };
        },
      },
      studioResourceService: {
        createStudioResource: async (
          _actor: Actor,
          command: CreateStudioResourceCommand,
        ) => {
          this.recordContext("studio-resource");
          this.studioResourceCreates.push(command);
          return {
            id: `id:studio-resource:${this.studioResourceCreates.length}`,
          };
        },
      },
      workPatternService: {
        createWorkPattern: async (
          _actor: Actor,
          command: CreateWorkPatternCommand,
        ) => {
          this.recordContext("work-pattern");
          this.workPatternCreates.push(command);
          return {
            workPatternId: `id:work-pattern:${this.workPatternCreates.length}`,
          };
        },
      },
      holidayCalendarService: {
        createHolidayCalendar: async (
          _actor: Actor,
          command: CreateHolidayCalendarCommand,
        ) => {
          this.recordContext("holiday-calendar");
          this.holidayCalendarCreates.push(command);
          return {
            holidayCalendarId: `id:holiday-calendar:${this.holidayCalendarCreates.length}`,
          };
        },
        addHolidayCalendarEntry: async (
          _actor: Actor,
          command: AddHolidayCalendarEntryCommand,
        ) => {
          this.recordContext("holiday-calendar-entry");
          this.holidayCalendarEntryAdds.push(command);
          return {
            holidayCalendarId: command.holidayCalendarId,
            entries: [
              {
                holidayCalendarEntryId: `id:holiday-calendar-entry:${this.holidayCalendarEntryAdds.length}`,
                externalRef: command.externalRef ?? null,
              },
            ],
          };
        },
      },
      eventAssignmentService: {
        createEvent: async (
          _actor: Actor,
          command: CreateEventCommand,
        ) => {
          this.recordContext("event-assignment");
          this.eventCreates.push(command);
          return {
            id: `id:event-assignment:${this.eventCreates.length}`,
          };
        },
      },
      contractRegistryService: {
        createContractRecord: async (
          _actor: Actor,
          command: CreateContractRecordCommand,
        ) => {
          this.recordContext("contract-registry");
          this.contractCreates.push(command);
          return {
            id: `id:contract-registry:${this.contractCreates.length}`,
          };
        },
        activateContractRecord: async (
          _actor: Actor,
          command: ActivateContractRecordCommand,
        ) => {
          this.contractActivations.push(command);
          return { id: command.contractRecordId };
        },
      },
      talentKpiService: {
        createTalentKpiRecord: async (
          _actor: Actor,
          command: CreateTalentKpiRecordCommand,
        ) => {
          this.recordContext("talent-kpi");
          this.talentKpiCreates.push(command);
          return {
            id: `id:talent-kpi:${this.talentKpiCreates.length}`,
          };
        },
      },
      revenueLedgerService: {
        createRevenueEntry: async (
          _actor: Actor,
          command: CreateRevenueEntryCommand,
        ) => {
          this.recordContext("revenue-ledger");
          this.revenueEntryCreates.push(command);
          return {
            id: `id:revenue-ledger:${this.revenueEntryCreates.length}`,
          };
        },
      },
      commissionService: {
        createCommissionRule: async (
          _actor: Actor,
          command: CreateCommissionRuleCommand,
        ) => {
          this.recordContext("commission-rule");
          this.commissionRuleCreates.push(command);
          return {
            id: `id:commission-rule:${this.commissionRuleCreates.length}`,
          };
        },
      },
    });
  }

  private recordContext(module: string): void {
    const audit = new AuditContext();
    audit.assertScope();
    this.auditScopeChecks.push(module);
    this.traceIds.push(getTraceIdOrThrow());
  }
}

test("Phase A synthetic actor is a normal admin with exact permissions and scope grants", () => {
  const actor = createSmokeFixtureActor();
  const canonical = new Set(Object.values(Permission));

  assert.equal(actor.type, "admin");
  assert.notEqual(actor.type, "system");
  assert.equal(actor.context, "ADMIN");
  assert.equal(actor.id, "smoke-fixture-actor");
  assert.equal(actor.isActive, true);
  assert.deepEqual(actor.permissions, SMOKE_PHASE_A_PERMISSIONS);
  assert.deepEqual(actor.permissions, [
    Permission.ORG_UNIT_READ,
    Permission.ORG_UNIT_CREATE,
    Permission.ORG_UNIT_UPDATE,
    Permission.STUDIO_RESOURCE_READ,
    Permission.STUDIO_RESOURCE_CREATE,
    Permission.STUDIO_RESOURCE_UPDATE,
    Permission.WORK_SCHEDULE_READ,
    Permission.WORK_SCHEDULE_CREATE,
    Permission.WORK_SCHEDULE_UPDATE,
    Permission.EMPLOYMENT_PROFILE_CREATE,
    Permission.TALENT_CREATE,
    Permission.TALENT_GROUP_CREATE,
    Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
    Permission.PLATFORM_ACCOUNT_CREATE,
    Permission.EVENT_CREATE,
    Permission.CONTRACT_REGISTRY_CREATE,
    Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE,
    Permission.TALENT_KPI_CREATE,
    Permission.REVENUE_LEDGER_CREATE,
    Permission.COMMISSION_RULE_CREATE,
  ]);
  assert.deepEqual(
    actor.scopeGrants,
    SMOKE_PHASE_A_SCOPE_GRANTS,
  );
  assert.deepEqual(actor.scopeGrants, {
    workSchedule: ["global"],
    eventAssignment: ["global"],
    contractRegistry: ["global"],
    talentKpi: ["global"],
    revenueLedger: ["global"],
    commission: ["global"],
  });
  for (const permission of actor.permissions) {
    assert.equal(canonical.has(permission as Permission), true);
  }
});

test("adapter applies trace and audit wrappers to service creates", async () => {
  const fake = new FakePhaseAServices();

  await runCatalogFixtures(fake.services(), {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(fake.auditScopeChecks.length, 68);
  assert.equal(fake.traceIds.length, 68);
  assert.equal(
    fake.traceIds.every((traceId) =>
      traceId.startsWith(
        "smoke-fixture-catalog:smoke-fixture-actor:",
      ),
    ),
    true,
  );
});

test("Org Unit adapter omits generated code, resolves parent ID, and uses externalRef lookup", async () => {
  const fake = new FakePhaseAServices();

  await runCatalogFixtures(fake.services(), {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(fake.orgUnitCreates.length, 4);
  assert.equal("code" in fake.orgUnitCreates[0], false);
  assert.equal(fake.orgUnitCreates[0].externalRef, "SMOKE:catalog:org-unit:root");
  assert.equal(fake.orgUnitCreates[0].type, "BUSINESS_UNIT");
  assert.equal(fake.orgUnitCreates[0].parentOrgUnitId, null);
  assert.match(
    String(fake.orgUnitCreates[1].parentOrgUnitId),
    /^id:org-unit:/u,
  );
  assert.equal(
    fake.lookup.lookups.includes(
      "org-unit:SMOKE:catalog:org-unit:root",
    ),
    true,
  );
});

test("Studio Resource adapter omits resourceCode and keeps valid resource classes", async () => {
  const fake = new FakePhaseAServices();

  await runCatalogFixtures(fake.services(), {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(fake.studioResourceCreates.length, 5);
  const classes = fake.studioResourceCreates.map(
    (command) => command.resourceClass,
  );
  assert.deepEqual(classes, [
    "SPACE",
    "EQUIPMENT",
    "EQUIPMENT",
    "KIT",
    "SPACE",
  ]);
  assert.equal(
    classes.every((resourceClass) =>
      STUDIO_RESOURCE_CLASSES.includes(resourceClass),
    ),
    true,
  );
  assert.equal(fake.studioResourceCreates[0].maxOccupancy, 8);
  assert.equal(fake.studioResourceCreates[1].maxOccupancy, null);
  assert.equal(fake.studioResourceCreates[2].maxOccupancy, null);
  assert.equal(fake.studioResourceCreates[3].maxOccupancy, null);
  assert.equal(fake.studioResourceCreates[4].maxOccupancy, 8);
  assert.equal(
    fake.studioResourceCreates.some(
      (command) => "resourceCode" in command,
    ),
    false,
  );
});

test("Work Pattern adapter omits patternCode, uses safe weekdays and does not call roster workflows", async () => {
  const fake = new FakePhaseAServices();

  await runCatalogFixtures(fake.services(), {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(fake.workPatternCreates.length, 2);
  assert.equal(
    fake.workPatternCreates.some(
      (command) => "patternCode" in command,
    ),
    false,
  );
  assert.deepEqual(fake.workPatternCreates[0].workingDays, [
    "MON",
    "TUE",
    "WED",
    "THU",
    "FRI",
  ]);
  assert.equal(fake.workPatternCreates[0].timezone, "Asia/Ho_Chi_Minh");
  assert.equal(fake.workPatternCreates[0].startLocalTime, "09:00");
  assert.equal(fake.workPatternCreates[0].workingMinutes, 480);
});

test("Holiday Calendar adapter creates a safe draft calendar and one entry", async () => {
  const fake = new FakePhaseAServices();

  await runCatalogFixtures(fake.services(), {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(fake.holidayCalendarCreates.length, 1);
  assert.equal(
    "calendarCode" in fake.holidayCalendarCreates[0],
    false,
  );
  assert.equal(fake.holidayCalendarCreates[0].scopeType, "GLOBAL");
  assert.equal(fake.holidayCalendarCreates[0].timezone, "Asia/Ho_Chi_Minh");
  assert.equal(fake.holidayCalendarEntryAdds.length, 1);
  assert.match(
    fake.holidayCalendarEntryAdds[0].holidayCalendarId,
    /^id:holiday-calendar:/u,
  );
  assert.equal(fake.holidayCalendarEntryAdds[0].date, "2026-01-01");
  assert.equal(fake.holidayCalendarEntryAdds[0].entryType, "HOLIDAY");
});

test("Phase B adapter uses service-backed creates with identity-safe payloads", async () => {
  const fake = new FakePhaseAServices();

  await runCatalogFixtures(fake.services(), {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(fake.employmentProfileCreates.length, 12);
  assert.equal(
    fake.employmentProfileCreates.every(
      (command) => command.linkedUserId === null,
    ),
    true,
  );
  assert.equal(
    fake.employmentProfileCreates.some(
      (command) => "employeeCode" in command,
    ),
    false,
  );

  assert.equal(fake.talentCreates.length, 8);
  assert.equal(
    fake.talentCreates.some((command) => "talentCode" in command),
    false,
  );
  assert.equal(
    fake.talentCreates
      .filter((command) => command.talentOrigin === "EXTERNAL")
      .every(
        (command) => command.linkedEmploymentProfileId === null,
      ),
    true,
  );

  assert.equal(fake.talentGroupCreates.length, 2);
  assert.equal(
    fake.talentGroupCreates.some(
      (command) => "groupCode" in command,
    ),
    false,
  );

  assert.equal(fake.talentGroupMemberAdds.length, 8);
  assert.equal(
    new Set(
      fake.talentGroupMemberAdds.map(
        (command) => `${command.groupId}:${command.talentId}`,
      ),
    ).size,
    fake.talentGroupMemberAdds.length,
  );

  assert.equal(fake.platformAccountCreates.length, 6);
  assert.equal(
    fake.platformAccountCreates.some(
      (command) => "accountCode" in command,
    ),
    false,
  );
  for (const command of fake.platformAccountCreates) {
    const ownerRefs = [
      command.ownerOrgUnitId,
      command.ownerTalentId,
      command.ownerTalentGroupId,
    ].filter((value) => value !== null);
    assert.equal(ownerRefs.length, 1);
  }
});

test("Phase B relationship order is enforced before dependent creates", async () => {
  const fake = new FakePhaseAServices();

  await runCatalogFixtures(fake.services(), {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  const modules = fake.auditScopeChecks;
  assert.equal(
    modules.indexOf("org-unit") <
      modules.indexOf("employment-profile"),
    true,
  );
  assert.equal(
    modules.indexOf("employment-profile") <
      modules.indexOf("talent"),
    true,
  );
  assert.equal(
    modules.indexOf("talent") <
      modules.indexOf("talent-group-member"),
    true,
  );
  assert.equal(
    modules.indexOf("talent-group") <
      modules.indexOf("talent-group-member"),
    true,
  );
  assert.equal(
    modules.indexOf("talent-group") <
      modules.indexOf("platform-account"),
    true,
  );
});

test("Phase C adapter uses service-backed creates with safe payloads", async () => {
  const fake = new FakePhaseAServices();

  await runCatalogFixtures(fake.services(), {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(fake.eventCreates.length, 4);
  assert.equal(
    fake.eventCreates.some((command) => "eventCode" in command),
    false,
  );
  assert.equal(
    fake.eventCreates.every(
      (command) =>
        command.assignments.length === 1 &&
        command.assignments[0].assignmentKind === "TALENT" &&
        command.assignments[0].assignmentTalentId !== null,
    ),
    true,
  );

  assert.equal(fake.contractCreates.length, 4);
  assert.equal(
    fake.contractCreates.some(
      (command) => "contractCode" in command,
    ),
    false,
  );
  assert.equal(fake.contractActivations.length, 4);
  assert.equal(
    fake.contractCreates.every(
      (command) =>
        command.linkedEntityKind === "TALENT" &&
        command.linkedEmploymentProfileId === null &&
        command.linkedTalentId !== null &&
        command.fileReferenceId === null &&
        command.fileDisplayName === null,
    ),
    true,
  );

  assert.equal(fake.talentKpiCreates.length, 4);
  assert.equal(
    fake.talentKpiCreates.some(
      (command) => "kpiRecordCode" in command,
    ),
    false,
  );
  assert.deepEqual(fake.talentKpiCreates[0].metrics, [
    { metricCode: "ENGAGEMENT_COUNT", numericValue: 100 },
    { metricCode: "EVENT_APPEARANCE_COUNT", numericValue: 1 },
  ]);

  assert.equal(fake.revenueEntryCreates.length, 5);
  assert.equal(
    fake.revenueEntryCreates.some(
      (command) => "revenueEntryCode" in command,
    ),
    false,
  );
  assert.equal(
    fake.revenueEntryCreates.every(
      (command) =>
        command.entrySource === "MANUAL" &&
        command.currencyCode === "VND" &&
        command.recognizedAmount > 0 &&
        !("finalizedAt" in command) &&
        !("reconciledAt" in command) &&
        !("voidedAt" in command),
    ),
    true,
  );

  assert.equal(fake.commissionRuleCreates.length, 2);
  assert.equal(
    fake.commissionRuleCreates.some(
      (command) => "ruleCode" in command,
    ),
    false,
  );
  assert.equal(
    fake.commissionRuleCreates.every(
      (command) =>
        command.settlementBasis ===
          "RECOGNIZED_GROSS_REVENUE" &&
        command.beneficiaryKind === "TALENT" &&
        command.beneficiaryEmploymentProfileId === null &&
        command.effectiveStartDate === Date.UTC(2026, 0, 15),
    ),
    true,
  );
});

test("Phase C relationship order follows source references", async () => {
  const fake = new FakePhaseAServices();

  await runCatalogFixtures(fake.services(), {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  const modules = fake.auditScopeChecks;
  assert.equal(
    modules.indexOf("platform-account") <
      modules.indexOf("event-assignment"),
    true,
  );
  assert.equal(
    modules.indexOf("talent") <
      modules.indexOf("contract-registry"),
    true,
  );
  assert.equal(
    modules.indexOf("event-assignment") <
      modules.indexOf("talent-kpi"),
    true,
  );
  assert.equal(
    modules.indexOf("event-assignment") <
      modules.indexOf("revenue-ledger"),
    true,
  );
  assert.equal(
    modules.indexOf("contract-registry") <
      modules.indexOf("commission-rule"),
    true,
  );
});

test("Phase C modules run while identity and deferred modules remain skipped", async () => {
  for (const mode of ["dry-run", "write"] as const) {
    const fake = new FakePhaseAServices();
    const result = await runCatalogFixtures(fake.services(), {
      mode,
      profile: "catalog",
      prefix: "SMOKE",
      size: 12,
      dbNameClass: "smoke-like",
      now: NOW,
    });

    assert.equal(result.summaries["identity-user"].skipped, 1);
    assert.equal(result.summaries["employment-profile"].create, 12);
    assert.equal(result.summaries["talent"].create, 8);
    assert.equal(result.summaries["talent-group"].create, 2);
    assert.equal(result.summaries["talent-group-member"].create, 8);
    assert.equal(result.summaries["platform-account"].create, 6);
    assert.equal(result.summaries["event-assignment"].create, 4);
    assert.equal(result.summaries["contract-registry"].create, 4);
    assert.equal(result.summaries["talent-kpi"].create, 4);
    assert.equal(result.summaries["revenue-ledger"].create, 5);
    assert.equal(result.summaries["commission-rule"].create, 2);
    assert.equal(
      result.summaries["commission-settlement"].skipped,
      1,
    );
    assert.equal(result.summaries["dashboard-lite"].skipped, 1);
  }
});

test("dry-run performs lookups but no service create calls", async () => {
  const fake = new FakePhaseAServices();

  await runCatalogFixtures(fake.services(), {
    mode: "dry-run",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(fake.lookup.lookups.length, 68);
  assert.equal(totalCreates(fake), 0);
});

test("write mode with fake services creates Phase A, Phase B, and Phase C records", async () => {
  const fake = new FakePhaseAServices();

  await runCatalogFixtures(fake.services(), {
    mode: "write",
    profile: "catalog",
    prefix: "SMOKE",
    size: 12,
    dbNameClass: "smoke-like",
    now: NOW,
  });

  assert.equal(totalCreates(fake), 68);
  assert.equal(fake.orgUnitCreates.length, 4);
  assert.equal(fake.employmentProfileCreates.length, 12);
  assert.equal(fake.talentCreates.length, 8);
  assert.equal(fake.talentGroupCreates.length, 2);
  assert.equal(fake.talentGroupMemberAdds.length, 8);
  assert.equal(fake.platformAccountCreates.length, 6);
  assert.equal(fake.studioResourceCreates.length, 5);
  assert.equal(fake.workPatternCreates.length, 2);
  assert.equal(fake.holidayCalendarCreates.length, 1);
  assert.equal(fake.holidayCalendarEntryAdds.length, 1);
  assert.equal(fake.eventCreates.length, 4);
  assert.equal(fake.contractCreates.length, 4);
  assert.equal(fake.contractActivations.length, 4);
  assert.equal(fake.talentKpiCreates.length, 4);
  assert.equal(fake.revenueEntryCreates.length, 5);
  assert.equal(fake.commissionRuleCreates.length, 2);
});

test("exact existing Phase A fixtures no-op and divergent existing fixtures fail closed", async () => {
  const exact = new Map<string, ExistingFixtureRecord>();
  exact.set("org-unit:SMOKE:catalog:org-unit:root", {
    id: "existing-org-root",
    externalRef: "SMOKE:catalog:org-unit:root",
    payload: stablePayload({
      externalRef: "SMOKE:catalog:org-unit:root",
      name: "Smoke Studios",
      type: "BUSINESS_UNIT",
      parentOrgUnitId: null,
      displayOrder: 10,
      description: "Smoke catalog root org unit",
    }),
  });
  const exactFake = new FakePhaseAServices(exact);
  const exactResult = await runCatalogFixtures(
    exactFake.services(),
    {
      mode: "write",
      profile: "catalog",
      prefix: "SMOKE",
      size: 12,
      dbNameClass: "smoke-like",
      now: NOW,
    },
  );

  assert.equal(exactResult.summaries["org-unit"].noOp, 1);
  assert.equal(
    exactFake.orgUnitCreates.some(
      (command) =>
        command.externalRef === "SMOKE:catalog:org-unit:root",
    ),
    false,
  );

  const divergent = new Map<string, ExistingFixtureRecord>();
  divergent.set("org-unit:SMOKE:catalog:org-unit:root", {
    id: "existing-org-root",
    externalRef: "SMOKE:catalog:org-unit:root",
    payload: stablePayload({
      externalRef: "SMOKE:catalog:org-unit:root",
      name: "Divergent Smoke Studios",
      type: "BUSINESS_UNIT",
      parentOrgUnitId: null,
      displayOrder: 10,
      description: "Smoke catalog root org unit",
    }),
  });

  await assert.rejects(
    runCatalogFixtures(
      new FakePhaseAServices(divergent).services(),
      {
        mode: "dry-run",
        profile: "catalog",
        prefix: "SMOKE",
        size: 12,
        dbNameClass: "smoke-like",
        now: NOW,
      },
    ),
    /Existing smoke fixture diverges/u,
  );
});

test("adapter source avoids forbidden runtime, identity, workflow, and destructive calls", () => {
  const source = readAdapterSources();

  for (const token of [
    "create" + "App",
    "start" + "HttpRuntime",
    "start" + "SystemRuntime",
    "module" + "Registrar",
    "init" + "Indexes",
    "connect" + "Redis",
    "LOCAL_" + "MOCK_AUTH",
    "mock-" + "access-token",
    "Auth" + "0",
    "SECOND_" + "ADMIN_AUTH0_SUB",
    "auth" + "Linkage",
    "delete" + "Many",
    "drop" + "Database",
    "drop" + "Collection",
    "bulk" + "Write",
    "update" + "Many",
    "findOne" + "AndUpdate",
    "delete" + "One",
    "update" + "One",
    ".on" + "ly(",
    "test.on" + "ly",
    "describe.on" + "ly",
    ".s" + "kip(",
    "test.s" + "kip",
    "describe.s" + "kip",
    "fix" + "me",
    "to" + "do",
  ]) {
    assert.equal(source.includes(token), false, token);
  }

  for (const token of [
    "pub" + "lish",
    "final" + "ize",
    "recon" + "cile",
    "app" + "rove",
    "pay" + "roll",
    "pay" + "out",
    "pre" + "view",
    "monthly" + "Roster",
    "work" + "Shift",
    "commission" + "Settlement",
  ]) {
    assert.equal(source.includes(token), false, token);
  }
});

test("catalog fixture payloads keep generated fields and source metadata out of Phase A payloads", () => {
  const fixtures = buildCatalogFixtures({
    prefix: "SMOKE",
    size: 12,
    now: NOW,
  }).filter((fixture) =>
    [
      "org-unit",
      "studio-resource",
      "work-pattern",
      "holiday-calendar",
      "holiday-calendar-entry",
    ].includes(fixture.module),
  );

  for (const fixture of fixtures) {
    const keys = new Set(deepKeys(fixture.payload));
    for (const key of [
      "code",
      "resourceCode",
      "patternCode",
      "calendarCode",
      "rosterCode",
      "shiftCode",
      "source" + "Metadata",
    ]) {
      assert.equal(keys.has(key), false, `${fixture.module}:${key}`);
    }
  }
});

function totalCreates(fake: FakePhaseAServices): number {
  return (
    fake.orgUnitCreates.length +
    fake.employmentProfileCreates.length +
    fake.talentCreates.length +
    fake.talentGroupCreates.length +
    fake.talentGroupMemberAdds.length +
    fake.platformAccountCreates.length +
    fake.studioResourceCreates.length +
    fake.workPatternCreates.length +
    fake.holidayCalendarCreates.length +
    fake.holidayCalendarEntryAdds.length +
    fake.eventCreates.length +
    fake.contractCreates.length +
    fake.talentKpiCreates.length +
    fake.revenueEntryCreates.length +
    fake.commissionRuleCreates.length
  );
}

function stablePayload(
  value: Record<string, unknown>,
): FixturePayload {
  return Object.freeze({ ...value });
}

function deepKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => deepKeys(entry));
  }

  if (value === null || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => [
    key,
    ...deepKeys(child),
  ]);
}

function readAdapterSources(): string {
  return [
    "seed-smoke-fixtures.adapter.ts",
    "seed-smoke-fixtures.composition.ts",
  ]
    .map((file) =>
      readFileSync(`${__dirname}/${file}`, "utf8"),
    )
    .join("\n");
}
