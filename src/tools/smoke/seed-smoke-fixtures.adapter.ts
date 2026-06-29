import { Actor, ActorScopeGrants } from "@core/actor/actor";
import { runWithAuditContext } from "@core/audit/audit.context";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import type {
  CatalogFixtureServices,
  CreatedFixtureRecord,
  ExistingFixtureRecord,
  FixtureModule,
  FixturePayload,
} from "./seed-smoke-fixtures";
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

export const SMOKE_PHASE_A_ACTOR_ID = "smoke-fixture-actor";

export const SMOKE_PHASE_A_PERMISSIONS: readonly Permission[] =
  Object.freeze([
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

export const SMOKE_PHASE_A_SCOPE_GRANTS: ActorScopeGrants =
  Object.freeze({
    workSchedule: Object.freeze(["global"] as const),
    eventAssignment: Object.freeze(["global"] as const),
    contractRegistry: Object.freeze(["global"] as const),
    talentKpi: Object.freeze(["global"] as const),
    revenueLedger: Object.freeze(["global"] as const),
    commission: Object.freeze(["global"] as const),
  });

export const PHASE_C_FIXTURE_MODULES: ReadonlySet<FixtureModule> =
  new Set<FixtureModule>([
    "org-unit",
    "employment-profile",
    "talent",
    "talent-group",
    "talent-group-member",
    "platform-account",
    "studio-resource",
    "work-pattern",
    "holiday-calendar",
    "holiday-calendar-entry",
    "event-assignment",
    "contract-registry",
    "talent-kpi",
    "revenue-ledger",
    "commission-rule",
  ]);

export const PHASE_B_FIXTURE_MODULES = PHASE_C_FIXTURE_MODULES;

export const PHASE_A_FIXTURE_MODULES = PHASE_C_FIXTURE_MODULES;

export interface PhaseAFixtureLookup {
  findByExternalRef(
    module: FixtureModule,
    externalRef: string,
    payload?: FixturePayload,
  ): Promise<ExistingFixtureRecord | null>;
}

export interface PhaseAOrgUnitService {
  createOrgUnit(
    actor: Actor,
    command: CreateOrgUnitCommand,
  ): Promise<{ readonly id: string }>;
}

export interface PhaseAStudioResourceService {
  createStudioResource(
    actor: Actor,
    command: CreateStudioResourceCommand,
  ): Promise<{ readonly id: string }>;
}

export interface PhaseAWorkPatternService {
  createWorkPattern(
    actor: Actor,
    command: CreateWorkPatternCommand,
  ): Promise<{ readonly workPatternId: string }>;
}

export interface PhaseAHolidayCalendarService {
  createHolidayCalendar(
    actor: Actor,
    command: CreateHolidayCalendarCommand,
  ): Promise<{ readonly holidayCalendarId: string }>;

  addHolidayCalendarEntry(
    actor: Actor,
    command: AddHolidayCalendarEntryCommand,
  ): Promise<{
    readonly holidayCalendarId: string;
    readonly entries: readonly {
      readonly holidayCalendarEntryId: string;
      readonly externalRef: string | null;
    }[];
  }>;
}

export interface PhaseBEmploymentProfileService {
  createEmploymentProfile(
    actor: Actor,
    command: CreateEmploymentProfileCommand,
  ): Promise<{ readonly id: string }>;
}

export interface PhaseBTalentService {
  createTalent(
    actor: Actor,
    command: CreateTalentCommand,
  ): Promise<{ readonly id: string }>;
}

export interface PhaseBTalentGroupService {
  createTalentGroup(
    actor: Actor,
    command: CreateTalentGroupCommand,
  ): Promise<{ readonly id: string }>;

  addTalentGroupMember(
    actor: Actor,
    command: AddTalentGroupMemberCommand,
  ): Promise<{ readonly id: string }>;
}

export interface PhaseBPlatformAccountService {
  createPlatformAccount(
    actor: Actor,
    command: CreatePlatformAccountCommand,
  ): Promise<{ readonly id: string }>;
}

export interface PhaseCEventAssignmentService {
  createEvent(
    actor: Actor,
    command: CreateEventCommand,
  ): Promise<{ readonly id: string }>;
}

export interface PhaseCContractRegistryService {
  createContractRecord(
    actor: Actor,
    command: CreateContractRecordCommand,
  ): Promise<{ readonly id: string }>;

  activateContractRecord(
    actor: Actor,
    command: ActivateContractRecordCommand,
  ): Promise<{ readonly id: string }>;
}

export interface PhaseCTalentKpiService {
  createTalentKpiRecord(
    actor: Actor,
    command: CreateTalentKpiRecordCommand,
  ): Promise<{ readonly id: string }>;
}

export interface PhaseCRevenueLedgerService {
  createRevenueEntry(
    actor: Actor,
    command: CreateRevenueEntryCommand,
  ): Promise<{ readonly id: string }>;
}

export interface PhaseCCommissionService {
  createCommissionRule(
    actor: Actor,
    command: CreateCommissionRuleCommand,
  ): Promise<{ readonly id: string }>;
}

export interface PhaseAFixtureServiceDependencies {
  readonly lookup: PhaseAFixtureLookup;
  readonly orgUnitService: PhaseAOrgUnitService;
  readonly employmentProfileService: PhaseBEmploymentProfileService;
  readonly talentService: PhaseBTalentService;
  readonly talentGroupService: PhaseBTalentGroupService;
  readonly platformAccountService: PhaseBPlatformAccountService;
  readonly studioResourceService: PhaseAStudioResourceService;
  readonly workPatternService: PhaseAWorkPatternService;
  readonly holidayCalendarService: PhaseAHolidayCalendarService;
  readonly eventAssignmentService: PhaseCEventAssignmentService;
  readonly contractRegistryService: PhaseCContractRegistryService;
  readonly talentKpiService: PhaseCTalentKpiService;
  readonly revenueLedgerService: PhaseCRevenueLedgerService;
  readonly commissionService: PhaseCCommissionService;
}

export function createPhaseAServiceBackedFixtureServices(
  deps: PhaseAFixtureServiceDependencies,
): CatalogFixtureServices {
  return {
    async findByExternalRef(module, externalRef, payload) {
      assertPhaseCModule(module);
      return deps.lookup.findByExternalRef(
        module,
        externalRef,
        payload,
      );
    },

    async create(module, payload, actor) {
      assertPhaseCModule(module);

      return runWithSmokeFixtureContext(
        module,
        payload,
        actor,
        async () => createPhaseAFixture(deps, module, payload, actor),
      );
    },
  };
}

async function createPhaseAFixture(
  deps: PhaseAFixtureServiceDependencies,
  module: FixtureModule,
  payload: FixturePayload,
  actor: Actor,
): Promise<CreatedFixtureRecord> {
  switch (module) {
    case "org-unit": {
      const created =
        await deps.orgUnitService.createOrgUnit(
          actor,
          toCreateOrgUnitCommand(payload),
        );
      return { id: created.id };
    }
    case "employment-profile": {
      const created =
        await deps.employmentProfileService.createEmploymentProfile(
          actor,
          toCreateEmploymentProfileCommand(payload),
        );
      return { id: created.id };
    }
    case "talent": {
      const created =
        await deps.talentService.createTalent(
          actor,
          toCreateTalentCommand(payload),
        );
      return { id: created.id };
    }
    case "talent-group": {
      const created =
        await deps.talentGroupService.createTalentGroup(
          actor,
          toCreateTalentGroupCommand(payload),
        );
      return { id: created.id };
    }
    case "talent-group-member": {
      const created =
        await deps.talentGroupService.addTalentGroupMember(
          actor,
          toAddTalentGroupMemberCommand(payload),
        );
      return { id: created.id };
    }
    case "platform-account": {
      const created =
        await deps.platformAccountService.createPlatformAccount(
          actor,
          toCreatePlatformAccountCommand(payload),
        );
      return { id: created.id };
    }
    case "studio-resource": {
      const created =
        await deps.studioResourceService.createStudioResource(
          actor,
          toCreateStudioResourceCommand(payload),
        );
      return { id: created.id };
    }
    case "work-pattern": {
      const created =
        await deps.workPatternService.createWorkPattern(
          actor,
          toCreateWorkPatternCommand(payload),
        );
      return { id: created.workPatternId };
    }
    case "holiday-calendar": {
      const created =
        await deps.holidayCalendarService.createHolidayCalendar(
          actor,
          toCreateHolidayCalendarCommand(payload),
        );
      return { id: created.holidayCalendarId };
    }
    case "holiday-calendar-entry": {
      const externalRef = readRequiredString(
        payload,
        "externalRef",
      );
      const updated =
        await deps.holidayCalendarService.addHolidayCalendarEntry(
          actor,
          toAddHolidayCalendarEntryCommand(payload),
        );
      const entry = updated.entries.find(
        (candidate) => candidate.externalRef === externalRef,
      );
      return {
        id:
          entry?.holidayCalendarEntryId ??
          updated.holidayCalendarId,
      };
    }
    case "event-assignment": {
      const created =
        await deps.eventAssignmentService.createEvent(
          actor,
          toCreateEventCommand(payload),
        );
      return { id: created.id };
    }
    case "contract-registry": {
      const created =
        await deps.contractRegistryService.createContractRecord(
          actor,
          toCreateContractRecordCommand(payload),
        );
      const activated =
        await deps.contractRegistryService.activateContractRecord(
          actor,
          {
            contractRecordId: created.id,
          },
        );
      return { id: activated.id };
    }
    case "talent-kpi": {
      const created =
        await deps.talentKpiService.createTalentKpiRecord(
          actor,
          toCreateTalentKpiRecordCommand(payload),
        );
      return { id: created.id };
    }
    case "revenue-ledger": {
      const created =
        await deps.revenueLedgerService.createRevenueEntry(
          actor,
          toCreateRevenueEntryCommand(payload),
        );
      return { id: created.id };
    }
    case "commission-rule": {
      const created =
        await deps.commissionService.createCommissionRule(
          actor,
          toCreateCommissionRuleCommand(payload),
        );
      return { id: created.id };
    }
    default:
      throw new Error(
        `Unsupported Phase C smoke fixture module: ${module}`,
      );
  }
}

function runWithSmokeFixtureContext<T>(
  module: FixtureModule,
  payload: FixturePayload,
  actor: Actor,
  fn: () => Promise<T>,
): Promise<T> {
  const traceId = buildTraceId(module, payload, actor);
  return bindTraceId(traceId, async () =>
    runWithAuditContext(fn),
  );
}

function toCreateEmploymentProfileCommand(
  payload: FixturePayload,
): CreateEmploymentProfileCommand {
  return {
    legalName: readRequiredString(payload, "legalName"),
    displayName: readRequiredString(payload, "displayName"),
    employmentKind: readRequiredString(
      payload,
      "employmentKind",
    ) as CreateEmploymentProfileCommand["employmentKind"],
    jobTitle: readRequiredString(payload, "jobTitle"),
    orgUnitId: readRequiredString(payload, "orgUnitId"),
    linkedUserId: readNullableString(payload, "linkedUserId"),
    contractStatus: readRequiredString(
      payload,
      "contractStatus",
    ) as CreateEmploymentProfileCommand["contractStatus"],
    employmentStartDate: readRequiredNumber(
      payload,
      "employmentStartDate",
    ),
    externalRef: readRequiredString(payload, "externalRef"),
    titleDescription: readNullableString(
      payload,
      "titleDescription",
    ),
  };
}

function toCreateTalentCommand(
  payload: FixturePayload,
): CreateTalentCommand {
  return {
    stageName: readRequiredString(payload, "stageName"),
    legalName: readRequiredString(payload, "legalName"),
    talentOrigin: readRequiredString(
      payload,
      "talentOrigin",
    ) as CreateTalentCommand["talentOrigin"],
    linkedEmploymentProfileId: readNullableString(
      payload,
      "linkedEmploymentProfileId",
    ),
    commercialParticipationStatus: readRequiredString(
      payload,
      "commercialParticipationStatus",
    ) as CreateTalentCommand["commercialParticipationStatus"],
    livestreamEligible: readRequiredBoolean(
      payload,
      "livestreamEligible",
    ),
    eventEligible: readRequiredBoolean(payload, "eventEligible"),
    displayShortName: readNullableString(
      payload,
      "displayShortName",
    ),
    externalRef: readRequiredString(payload, "externalRef"),
    profileSummary: readNullableString(payload, "profileSummary"),
  };
}

function toCreateTalentGroupCommand(
  payload: FixturePayload,
): CreateTalentGroupCommand {
  return {
    name: readRequiredString(payload, "name"),
    shortName: readNullableString(payload, "shortName"),
    description: readNullableString(payload, "description"),
    displayOrder: readRequiredNumber(payload, "displayOrder"),
    externalRef: readRequiredString(payload, "externalRef"),
  };
}

function toAddTalentGroupMemberCommand(
  payload: FixturePayload,
): AddTalentGroupMemberCommand {
  return {
    groupId: readRequiredString(payload, "groupId"),
    talentId: readRequiredString(payload, "talentId"),
    lineupOrder: readRequiredNumber(payload, "lineupOrder"),
  };
}

function toCreatePlatformAccountCommand(
  payload: FixturePayload,
): CreatePlatformAccountCommand {
  return {
    platform: readRequiredString(
      payload,
      "platform",
    ) as CreatePlatformAccountCommand["platform"],
    platformSurfaceType: readRequiredString(
      payload,
      "platformSurfaceType",
    ) as CreatePlatformAccountCommand["platformSurfaceType"],
    displayName: readRequiredString(payload, "displayName"),
    handle: readNullableString(payload, "handle"),
    externalPlatformId: readNullableString(
      payload,
      "externalPlatformId",
    ),
    profileUrl: readNullableString(payload, "profileUrl"),
    ownerKind: readRequiredString(
      payload,
      "ownerKind",
    ) as CreatePlatformAccountCommand["ownerKind"],
    ownerOrgUnitId: readNullableString(payload, "ownerOrgUnitId"),
    ownerTalentId: readNullableString(payload, "ownerTalentId"),
    ownerTalentGroupId: readNullableString(
      payload,
      "ownerTalentGroupId",
    ),
    livestreamEnabled: readRequiredBoolean(
      payload,
      "livestreamEnabled",
    ),
    contentPublishingEnabled: readRequiredBoolean(
      payload,
      "contentPublishingEnabled",
    ),
    monetizationEnabled: readRequiredBoolean(
      payload,
      "monetizationEnabled",
    ),
    description: readNullableString(payload, "description"),
    externalRef: readRequiredString(payload, "externalRef"),
  };
}

function toCreateEventCommand(
  payload: FixturePayload,
): CreateEventCommand {
  return {
    title: readRequiredString(payload, "title"),
    ownerEmploymentProfileId: readRequiredString(
      payload,
      "ownerEmploymentProfileId",
    ),
    status: "PLANNED",
    assignments: readRequiredObjectArray(
      payload,
      "assignments",
    ).map((assignment) => ({
      assignmentKind: readRequiredString(
        assignment,
        "assignmentKind",
      ) as CreateEventCommand["assignments"][number]["assignmentKind"],
      assignmentEmploymentProfileId: readNullableString(
        assignment,
        "assignmentEmploymentProfileId",
      ),
      assignmentTalentId: readNullableString(
        assignment,
        "assignmentTalentId",
      ),
      assignmentTalentGroupId: readNullableString(
        assignment,
        "assignmentTalentGroupId",
      ),
    })),
    platformAccountIds: readRequiredStringArray(
      payload,
      "platformAccountIds",
    ),
    eventStartAt: readRequiredNumber(payload, "eventStartAt"),
    eventEndAt: readRequiredNumber(payload, "eventEndAt"),
    description: readNullableString(payload, "description"),
    externalRef: readRequiredString(payload, "externalRef"),
  };
}

function toCreateContractRecordCommand(
  payload: FixturePayload,
): CreateContractRecordCommand {
  return {
    title: readRequiredString(payload, "title"),
    contractKind: readRequiredString(
      payload,
      "contractKind",
    ) as CreateContractRecordCommand["contractKind"],
    linkedEntityKind: readRequiredString(
      payload,
      "linkedEntityKind",
    ) as CreateContractRecordCommand["linkedEntityKind"],
    linkedEmploymentProfileId: readNullableString(
      payload,
      "linkedEmploymentProfileId",
    ),
    linkedTalentId: readNullableString(
      payload,
      "linkedTalentId",
    ),
    ownerEmploymentProfileId: readRequiredString(
      payload,
      "ownerEmploymentProfileId",
    ),
    confidentialityTier: readRequiredString(
      payload,
      "confidentialityTier",
    ) as CreateContractRecordCommand["confidentialityTier"],
    effectiveStartDate: readRequiredString(
      payload,
      "effectiveStartDate",
    ),
    effectiveEndDate: readNullableString(
      payload,
      "effectiveEndDate",
    ),
    fileReferenceId: readNullableString(
      payload,
      "fileReferenceId",
    ),
    fileDisplayName: readNullableString(
      payload,
      "fileDisplayName",
    ),
    description: readNullableString(payload, "description"),
    externalRef: readRequiredString(payload, "externalRef"),
  };
}

function toCreateTalentKpiRecordCommand(
  payload: FixturePayload,
): CreateTalentKpiRecordCommand {
  return {
    title: readRequiredString(payload, "title"),
    subjectTalentId: readRequiredString(
      payload,
      "subjectTalentId",
    ),
    attributionPlatformAccountId: readNullableString(
      payload,
      "attributionPlatformAccountId",
    ),
    attributionEventId: readNullableString(
      payload,
      "attributionEventId",
    ),
    measurementSource: readRequiredString(
      payload,
      "measurementSource",
    ) as CreateTalentKpiRecordCommand["measurementSource"],
    periodStartAt: readRequiredNumber(payload, "periodStartAt"),
    periodEndAt: readRequiredNumber(payload, "periodEndAt"),
    metrics: readRequiredObjectArray(payload, "metrics").map(
      (metric) => ({
        metricCode: readRequiredString(
          metric,
          "metricCode",
        ) as CreateTalentKpiRecordCommand["metrics"][number]["metricCode"],
        numericValue: readRequiredNumber(
          metric,
          "numericValue",
        ),
      }),
    ),
    description: readNullableString(payload, "description"),
    externalRef: readRequiredString(payload, "externalRef"),
  };
}

function toCreateRevenueEntryCommand(
  payload: FixturePayload,
): CreateRevenueEntryCommand {
  return {
    title: readRequiredString(payload, "title"),
    subjectTalentId: readRequiredString(
      payload,
      "subjectTalentId",
    ),
    attributionPlatformAccountId: readNullableString(
      payload,
      "attributionPlatformAccountId",
    ),
    attributionEventId: readNullableString(
      payload,
      "attributionEventId",
    ),
    revenueKind: readRequiredString(
      payload,
      "revenueKind",
    ) as CreateRevenueEntryCommand["revenueKind"],
    entrySource: readRequiredString(
      payload,
      "entrySource",
    ) as CreateRevenueEntryCommand["entrySource"],
    currencyCode: readRequiredString(payload, "currencyCode"),
    recognizedAmount: readRequiredNumber(
      payload,
      "recognizedAmount",
    ),
    recognizedAt: readRequiredNumber(payload, "recognizedAt"),
    description: readNullableString(payload, "description"),
    externalRef: readRequiredString(payload, "externalRef"),
  };
}

function toCreateCommissionRuleCommand(
  payload: FixturePayload,
): CreateCommissionRuleCommand {
  return {
    title: readRequiredString(payload, "title"),
    settlementKind: readRequiredString(
      payload,
      "settlementKind",
    ) as CreateCommissionRuleCommand["settlementKind"],
    beneficiaryKind: readRequiredString(
      payload,
      "beneficiaryKind",
    ) as CreateCommissionRuleCommand["beneficiaryKind"],
    beneficiaryEmploymentProfileId: readNullableString(
      payload,
      "beneficiaryEmploymentProfileId",
    ),
    beneficiaryTalentId: readNullableString(
      payload,
      "beneficiaryTalentId",
    ),
    sourceContractRecordId: readRequiredString(
      payload,
      "sourceContractRecordId",
    ),
    settlementBasis: readRequiredString(
      payload,
      "settlementBasis",
    ),
    ratePercent: readRequiredNumber(payload, "ratePercent"),
    appliesToRevenueKinds: readRequiredStringArray(
      payload,
      "appliesToRevenueKinds",
    ),
    effectiveStartDate: readRequiredNumber(
      payload,
      "effectiveStartDate",
    ),
    effectiveEndDate: readNullableNumber(
      payload,
      "effectiveEndDate",
    ),
    description: readNullableString(payload, "description"),
    externalRef: readRequiredString(payload, "externalRef"),
  };
}

function buildTraceId(
  module: FixtureModule,
  payload: FixturePayload,
  actor: Actor,
): string {
  return [
    "smoke-fixture-catalog",
    actor.id,
    module,
    String(payload.externalRef ?? "unknown"),
  ]
    .join(":")
    .replace(/[^a-zA-Z0-9:_-]/gu, "_")
    .slice(0, 180);
}

function toCreateOrgUnitCommand(
  payload: FixturePayload,
): CreateOrgUnitCommand {
  return {
    name: readRequiredString(payload, "name"),
    type: readRequiredString(payload, "type") as CreateOrgUnitCommand["type"],
    parentOrgUnitId: readNullableString(
      payload,
      "parentOrgUnitId",
    ),
    description: readNullableString(payload, "description"),
    displayOrder: readRequiredNumber(payload, "displayOrder"),
    externalRef: readRequiredString(payload, "externalRef"),
  };
}

function toCreateStudioResourceCommand(
  payload: FixturePayload,
): CreateStudioResourceCommand {
  return {
    name: readRequiredString(payload, "name"),
    resourceClass: readRequiredString(
      payload,
      "resourceClass",
    ) as CreateStudioResourceCommand["resourceClass"],
    shortName: readNullableString(payload, "shortName"),
    locationLabel: readNullableString(
      payload,
      "locationLabel",
    ),
    description: readNullableString(payload, "description"),
    externalRef: readRequiredString(payload, "externalRef"),
    maxOccupancy: readNullableNumber(
      payload,
      "maxOccupancy",
    ),
  };
}

function toCreateWorkPatternCommand(
  payload: FixturePayload,
): CreateWorkPatternCommand {
  return {
    name: readRequiredString(payload, "name"),
    timezone: readRequiredString(payload, "timezone"),
    startLocalTime: readRequiredString(
      payload,
      "startLocalTime",
    ),
    workingMinutes: readRequiredNumber(
      payload,
      "workingMinutes",
    ),
    breakMinutes: readRequiredNumber(
      payload,
      "breakMinutes",
    ),
    workingDays: readRequiredStringArray(
      payload,
      "workingDays",
    ),
    description: readNullableString(payload, "description"),
    externalRef: readRequiredString(payload, "externalRef"),
  };
}

function toCreateHolidayCalendarCommand(
  payload: FixturePayload,
): CreateHolidayCalendarCommand {
  return {
    name: readRequiredString(payload, "name"),
    scopeType: readRequiredString(payload, "scopeType"),
    timezone: readRequiredString(payload, "timezone"),
    description: readNullableString(payload, "description"),
    externalRef: readRequiredString(payload, "externalRef"),
  };
}

function toAddHolidayCalendarEntryCommand(
  payload: FixturePayload,
): AddHolidayCalendarEntryCommand {
  return {
    holidayCalendarId: readRequiredString(
      payload,
      "holidayCalendarId",
    ),
    date: readRequiredString(payload, "date"),
    entryType: readRequiredString(payload, "entryType"),
    name: readRequiredString(payload, "name"),
    description: readNullableString(payload, "description"),
    externalRef: readRequiredString(payload, "externalRef"),
  };
}

function assertPhaseCModule(module: FixtureModule): void {
  if (PHASE_C_FIXTURE_MODULES.has(module)) {
    return;
  }

  throw new Error(
    `Smoke fixture module is outside Phase C scope: ${module}`,
  );
}

function readRequiredString(
  payload: FixturePayload,
  field: string,
): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Fixture payload field ${field} is required`);
  }
  return value;
}

function readNullableString(
  payload: FixturePayload,
  field: string,
): string | null {
  const value = payload[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Fixture payload field ${field} must be a string`);
  }
  return value;
}

function readRequiredNumber(
  payload: FixturePayload,
  field: string,
): number {
  const value = payload[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Fixture payload field ${field} must be a number`);
  }
  return value;
}

function readRequiredBoolean(
  payload: FixturePayload,
  field: string,
): boolean {
  const value = payload[field];
  if (typeof value !== "boolean") {
    throw new Error(`Fixture payload field ${field} must be a boolean`);
  }
  return value;
}

function readNullableNumber(
  payload: FixturePayload,
  field: string,
): number | null {
  const value = payload[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Fixture payload field ${field} must be a number`);
  }
  return value;
}

function readRequiredObjectArray(
  payload: FixturePayload,
  field: string,
): readonly FixturePayload[] {
  const value = payload[field];
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) =>
        entry === null ||
        typeof entry !== "object" ||
        Array.isArray(entry),
    )
  ) {
    throw new Error(
      `Fixture payload field ${field} must be an object array`,
    );
  }
  return value as readonly FixturePayload[];
}

function readRequiredStringArray(
  payload: FixturePayload,
  field: string,
): readonly string[] {
  const value = payload[field];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(
      `Fixture payload field ${field} must be a string array`,
    );
  }
  return value;
}
