import { Db, MongoClient } from "mongodb";
import { AuditContext } from "@core/audit/audit.context";
import { AuditGuard } from "@core/audit/audit.guard";
import { MongoAuditLogger } from "@core/audit/mongo.audit.logger";
import { MongoAuthoritativeAdminMutationBridge } from "@core/application/mongo-authoritative-admin-mutation.bridge";
import { MongoAuditWriteRepository } from "@infra/mongo/audit/audit.write.repository";
import { NativeMongoHolidayCalendarRepository } from "@infra/mongo/work-schedule/holiday-calendar.repository";
import { NativeMongoWorkShiftCodeSequenceRepository } from "@infra/mongo/work-schedule/work-schedule-code-sequence.repository";
import { NativeMongoWorkPatternRepository } from "@infra/mongo/work-schedule/work-pattern.repository";
import { createEmploymentProfileInfra } from "@infra/providers/employment-profile.infra";
import { createEventAssignmentInfra } from "@infra/providers/event-assignment.infra";
import { createContractRegistryInfra } from "@infra/providers/contract-registry.infra";
import { createTalentKpiInfra } from "@infra/providers/talent-kpi.infra";
import { createRevenueLedgerInfra } from "@infra/providers/revenue-ledger.infra";
import { createCommissionRevenueShareInfra } from "@infra/providers/commission.infra";
import { createOrgUnitInfra } from "@infra/providers/org-unit.infra";
import { createPlatformAccountInfra } from "@infra/providers/platform-account.infra";
import { createStudioResourceInfra } from "@infra/providers/studio-resource.infra";
import { createTalentGroupInfra } from "@infra/providers/talent-group.infra";
import { createTalentInfra } from "@infra/providers/talent.infra";
import { EmploymentProfileAdminService } from "@modules/employment-profile/admin/admin.employment-profile.service";
import { EventAssignmentAdminService } from "@modules/event-assignment/admin/admin.event-assignment.service";
import { ContractRegistryAdminService } from "@modules/contract-registry/admin/admin.contract-registry.service";
import { TalentKpiAdminService } from "@modules/talent-kpi/admin/admin.talent-kpi.service";
import { RevenueLedgerAdminService } from "@modules/revenue-ledger/admin/admin.revenue-ledger.service";
import { CommissionAdminService } from "@modules/commission/admin/admin.commission.service";
import { OrgUnitAdminService } from "@modules/org-unit/admin/admin.org-unit.service";
import { PlatformAccountAdminService } from "@modules/platform-account/admin/admin.platform-account.service";
import { StudioResourceAdminService } from "@modules/studio-resource/admin/admin.studio-resource.service";
import { TalentGroupAdminService } from "@modules/talent-group/admin/admin.talent-group.service";
import { TalentAdminService } from "@modules/talent/admin/admin.talent.service";
import { HolidayCalendarAdminService } from "@modules/work-schedule/admin/admin.holiday-calendar.service";
import { WorkPatternAdminService } from "@modules/work-schedule/admin/admin.work-pattern.service";
import type {
  CatalogFixtureServices,
  ExistingFixtureRecord,
  FixtureModule,
  FixturePayload,
} from "./seed-smoke-fixtures";
import {
  createPhaseAServiceBackedFixtureServices,
  PhaseAFixtureLookup,
} from "./seed-smoke-fixtures.adapter";

export interface PhaseARuntimeFixtureServiceOptions {
  readonly mongoUri: string;
  readonly mongoDbName: string;
  readonly mongoMaxPoolSize?: number;
}

export function createPhaseARuntimeFixtureServices(
  options: PhaseARuntimeFixtureServiceOptions,
): CatalogFixtureServices {
  const client = new MongoClient(options.mongoUri, {
    maxPoolSize: options.mongoMaxPoolSize ?? 10,
    retryReads: true,
    retryWrites: true,
  });
  let connected = false;
  let services: CatalogFixtureServices | null = null;

  async function getServices(): Promise<CatalogFixtureServices> {
    if (services) {
      return services;
    }

    if (!connected) {
      await client.connect();
      connected = true;
    }

    const db = client.db(options.mongoDbName);
    services = composePhaseAServices(client, db);
    return services;
  }

  return {
    async findByExternalRef(module, externalRef, payload) {
      return (await getServices()).findByExternalRef(
        module,
        externalRef,
        payload,
      );
    },

    async create(module, payload, actor) {
      return (await getServices()).create(
        module,
        payload,
        actor,
      );
    },

    async close() {
      if (connected) {
        await client.close();
        connected = false;
      }
    },
  };
}

function composePhaseAServices(
  client: MongoClient,
  db: Db,
): CatalogFixtureServices {
  const bridge = new MongoAuthoritativeAdminMutationBridge(
    client,
    db,
  );
  const auditGuard = new AuditGuard(
    new MongoAuditLogger(new MongoAuditWriteRepository(db)),
    new AuditContext(),
  );
  const orgUnitInfra = createOrgUnitInfra(db);
  const employmentProfileInfra =
    createEmploymentProfileInfra(db);
  const talentInfra = createTalentInfra(db);
  const talentGroupInfra = createTalentGroupInfra(db);
  const platformAccountInfra =
    createPlatformAccountInfra(db);
  const eventAssignmentInfra =
    createEventAssignmentInfra(db);
  const contractRegistryInfra =
    createContractRegistryInfra(db);
  const talentKpiInfra = createTalentKpiInfra(db);
  const revenueLedgerInfra = createRevenueLedgerInfra(db);
  const commissionInfra =
    createCommissionRevenueShareInfra(db);
  const studioResourceInfra = createStudioResourceInfra(db);
  const workPatternRepository =
    new NativeMongoWorkPatternRepository(db);
  const holidayCalendarRepository =
    new NativeMongoHolidayCalendarRepository(db);
  const scheduleCodeSequenceRepository =
    new NativeMongoWorkShiftCodeSequenceRepository(db);

  return createPhaseAServiceBackedFixtureServices({
    lookup: new MongoPhaseAFixtureLookup(db),
    orgUnitService: new OrgUnitAdminService(
      orgUnitInfra.orgUnitRepository,
      orgUnitInfra.businessCodeSequenceRepository,
      orgUnitInfra.orgUnitEmploymentReadonlyAccess,
      orgUnitInfra.orgUnitPlatformAccountReadonlyAccess,
      auditGuard,
      bridge,
    ),
    employmentProfileService:
      new EmploymentProfileAdminService(
        employmentProfileInfra.employmentProfileRepository,
        employmentProfileInfra.businessCodeSequenceRepository,
        employmentProfileInfra.employmentProfileOrgUnitReadonlyAccess,
        employmentProfileInfra.employmentProfileUserReadonlyAccess,
        employmentProfileInfra.employmentProfileTalentReadonlyAccess,
        employmentProfileInfra.employmentProfileWorkScheduleReadonlyAccess,
        employmentProfileInfra.employmentProfileEventAssignmentReadonlyAccess,
        auditGuard,
        bridge,
      ),
    talentService: new TalentAdminService(
      talentInfra.talentRepository,
      talentInfra.businessCodeSequenceRepository,
      talentInfra.talentEmploymentProfileReadonlyAccess,
      talentInfra.talentTalentGroupReadonlyAccess,
      talentInfra.talentPlatformAccountReadonlyAccess,
      talentInfra.talentWorkScheduleReadonlyAccess,
      talentInfra.talentEventAssignmentReadonlyAccess,
      auditGuard,
      bridge,
    ),
    talentGroupService: new TalentGroupAdminService(
      talentGroupInfra.talentGroupRepository,
      talentGroupInfra.businessCodeSequenceRepository,
      talentGroupInfra.talentGroupTalentReadonlyAccess,
      talentGroupInfra.talentGroupPlatformAccountReadonlyAccess,
      talentGroupInfra.talentGroupWorkScheduleReadonlyAccess,
      talentGroupInfra.talentGroupEventAssignmentReadonlyAccess,
      auditGuard,
      bridge,
    ),
    platformAccountService: new PlatformAccountAdminService(
      platformAccountInfra.platformAccountRepository,
      platformAccountInfra.businessCodeSequenceRepository,
      platformAccountInfra.platformAccountOrgUnitReadonlyAccess,
      platformAccountInfra.platformAccountTalentReadonlyAccess,
      platformAccountInfra.platformAccountTalentGroupReadonlyAccess,
      platformAccountInfra.platformAccountEventAssignmentReadonlyAccess,
      auditGuard,
      bridge,
    ),
    studioResourceService: new StudioResourceAdminService(
      studioResourceInfra.studioResourceRepository,
      studioResourceInfra.businessCodeSequenceRepository,
      studioResourceInfra.studioResourceWorkScheduleReadonlyAccess,
      studioResourceInfra.studioResourceEventAssignmentReadonlyAccess,
      auditGuard,
      bridge,
    ),
    workPatternService: new WorkPatternAdminService(
      workPatternRepository,
      scheduleCodeSequenceRepository,
      auditGuard,
      bridge,
    ),
    holidayCalendarService: new HolidayCalendarAdminService(
      holidayCalendarRepository,
      scheduleCodeSequenceRepository,
      auditGuard,
      bridge,
    ),
    eventAssignmentService: new EventAssignmentAdminService(
      eventAssignmentInfra.eventAssignmentRepository,
      eventAssignmentInfra.businessCodeSequenceRepository,
      eventAssignmentInfra.eventAssignmentEmploymentProfileReadonlyAccess,
      eventAssignmentInfra.eventAssignmentTalentReadonlyAccess,
      eventAssignmentInfra.eventAssignmentTalentGroupReadonlyAccess,
      eventAssignmentInfra.eventAssignmentStudioResourceReadonlyAccess,
      eventAssignmentInfra.eventAssignmentPlatformAccountReadonlyAccess,
      auditGuard,
      bridge,
    ),
    contractRegistryService: new ContractRegistryAdminService(
      contractRegistryInfra.contractRegistryRepository,
      contractRegistryInfra.businessCodeSequenceRepository,
      contractRegistryInfra.contractRegistryEmploymentProfileReadonlyAccess,
      contractRegistryInfra.contractRegistryTalentReadonlyAccess,
      auditGuard,
      bridge,
    ),
    talentKpiService: new TalentKpiAdminService(
      talentKpiInfra.talentKpiRepository,
      talentKpiInfra.businessCodeSequenceRepository,
      talentKpiInfra.talentKpiTalentReadonlyAccess,
      talentKpiInfra.talentKpiPlatformAccountReadonlyAccess,
      talentKpiInfra.talentKpiEventReadonlyAccess,
      auditGuard,
      bridge,
    ),
    revenueLedgerService: new RevenueLedgerAdminService(
      revenueLedgerInfra.revenueEntryRepository,
      revenueLedgerInfra.businessCodeSequenceRepository,
      revenueLedgerInfra.revenueLedgerTalentReadonlyAccess,
      revenueLedgerInfra.revenueLedgerPlatformAccountReadonlyAccess,
      revenueLedgerInfra.revenueLedgerEventReadonlyAccess,
      revenueLedgerInfra.revenueLedgerCommissionReadonlyAccess,
      auditGuard,
      bridge,
    ),
    commissionService: new CommissionAdminService(
      commissionInfra.commissionRepository,
      commissionInfra.businessCodeSequenceRepository,
      commissionInfra.commissionEmploymentProfileReadonlyAccess,
      commissionInfra.commissionTalentReadonlyAccess,
      commissionInfra.commissionContractRegistryReadonlyAccess,
      commissionInfra.commissionRevenueLedgerReadonlyAccess,
      auditGuard,
      bridge,
    ),
  });
}

class MongoPhaseAFixtureLookup implements PhaseAFixtureLookup {
  constructor(private readonly db: Db) {}

  async findByExternalRef(
    module: FixtureModule,
    externalRef: string,
    payload?: FixturePayload,
  ): Promise<ExistingFixtureRecord | null> {
    switch (module) {
      case "org-unit":
        return this.findOrgUnit(externalRef);
      case "employment-profile":
        return this.findEmploymentProfile(externalRef);
      case "talent":
        return this.findTalent(externalRef);
      case "talent-group":
        return this.findTalentGroup(externalRef);
      case "talent-group-member":
        return this.findTalentGroupMember(externalRef, payload);
      case "platform-account":
        return this.findPlatformAccount(externalRef);
      case "studio-resource":
        return this.findStudioResource(externalRef);
      case "work-pattern":
        return this.findWorkPattern(externalRef);
      case "holiday-calendar":
        return this.findHolidayCalendar(externalRef);
      case "holiday-calendar-entry":
        return this.findHolidayCalendarEntry(externalRef);
      case "event-assignment":
        return this.findEvent(externalRef);
      case "contract-registry":
        return this.findContractRecord(externalRef);
      case "talent-kpi":
        return this.findTalentKpiRecord(externalRef);
      case "revenue-ledger":
        return this.findRevenueEntry(externalRef);
      case "commission-rule":
        return this.findCommissionRule(externalRef);
      default:
        return null;
    }
  }

  private async findEmploymentProfile(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("employment_profiles")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        externalRef,
        legalName: doc.legalName,
        displayName: doc.displayName,
        employmentKind: doc.employmentKind,
        jobTitle: doc.jobTitle,
        orgUnitId: doc.orgUnitId,
        managerEmploymentProfileId:
          doc.managerEmploymentProfileId ?? null,
        linkedUserId: doc.linkedUserId ?? null,
        contractStatus: doc.contractStatus,
        employmentStartDate: doc.employmentStartDate,
        titleDescription: doc.titleDescription ?? null,
      }),
    };
  }

  private async findTalent(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("talents")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        externalRef,
        stageName: doc.stageName,
        legalName: doc.legalName,
        talentOrigin: doc.talentOrigin,
        managerEmploymentProfileId:
          doc.managerEmploymentProfileId ?? null,
        linkedEmploymentProfileId:
          doc.linkedEmploymentProfileId ?? null,
        commercialParticipationStatus:
          doc.commercialParticipationStatus,
        livestreamEligible: doc.livestreamEligible,
        eventEligible: doc.eventEligible,
        displayShortName: doc.displayShortName ?? null,
        profileSummary: doc.profileSummary ?? null,
      }),
    };
  }

  private async findTalentGroup(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("talent_groups")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        externalRef,
        name: doc.name,
        shortName: doc.shortName ?? null,
        displayOrder: doc.displayOrder,
        description: doc.description ?? null,
      }),
    };
  }

  private async findTalentGroupMember(
    externalRef: string,
    payload: FixturePayload | undefined,
  ): Promise<ExistingFixtureRecord | null> {
    const groupId = readLookupString(payload, "groupId");
    const talentId = readLookupString(payload, "talentId");
    if (!groupId || !talentId) {
      return null;
    }

    const doc = await this.db
      .collection("talent_group_members")
      .findOne({
        groupId,
        talentId,
        membershipStatus: { $ne: "REMOVED" },
      });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        groupId: doc.groupId,
        talentId: doc.talentId,
        lineupOrder: doc.lineupOrder,
        membershipStatus: doc.membershipStatus,
      }),
    };
  }

  private async findPlatformAccount(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("platform_accounts")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        externalRef,
        platform: doc.platform,
        platformSurfaceType: doc.platformSurfaceType,
        displayName: doc.displayName,
        handle: doc.handle ?? null,
        externalPlatformId: doc.externalPlatformId ?? null,
        profileUrl: doc.profileUrl ?? null,
        ownerKind: doc.ownerKind,
        ownerOrgUnitId: doc.ownerOrgUnitId ?? null,
        ownerTalentId: doc.ownerTalentId ?? null,
        ownerTalentGroupId: doc.ownerTalentGroupId ?? null,
        livestreamEnabled: doc.livestreamEnabled,
        contentPublishingEnabled:
          doc.contentPublishingEnabled,
        monetizationEnabled: doc.monetizationEnabled,
        description: doc.description ?? null,
      }),
    };
  }

  private async findOrgUnit(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("org_units")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        externalRef,
        name: doc.name,
        type: doc.type,
        parentOrgUnitId: doc.parentOrgUnitId ?? null,
        displayOrder: doc.displayOrder,
        description: doc.description ?? null,
      }),
    };
  }

  private async findStudioResource(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("studio_resources")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        externalRef,
        name: doc.name,
        resourceClass: doc.resourceClass,
        shortName: doc.shortName ?? null,
        locationLabel: doc.locationLabel ?? null,
        description: doc.description ?? null,
        maxOccupancy: doc.maxOccupancy ?? null,
      }),
    };
  }

  private async findWorkPattern(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("work_patterns")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        externalRef,
        name: doc.name,
        timezone: doc.timezone,
        startLocalTime: doc.startLocalTime,
        workingMinutes: doc.workingMinutes,
        breakMinutes: doc.breakMinutes,
        workingDays: doc.workingDays,
        description: doc.description ?? null,
      }),
    };
  }

  private async findHolidayCalendar(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("work_holiday_calendars")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        externalRef,
        name: doc.name,
        scopeType: doc.scopeType,
        timezone: doc.timezone,
        description: doc.description ?? null,
      }),
    };
  }

  private async findHolidayCalendarEntry(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("work_holiday_calendars")
      .findOne({
        entries: {
          $elemMatch: {
            externalRef,
            status: "ACTIVE",
          },
        },
      });
    if (!doc || !Array.isArray(doc.entries)) {
      return null;
    }

    const entry = doc.entries.find(
      (candidate: Record<string, unknown>) =>
        candidate.externalRef === externalRef &&
        candidate.status === "ACTIVE",
    );
    if (!entry) {
      return null;
    }

    return {
      id: String(entry.holidayCalendarEntryId),
      externalRef,
      payload: stablePayload({
        externalRef,
        holidayCalendarId: readDocumentId(doc),
        date: entry.date,
        entryType: entry.entryType,
        name: entry.name,
        description: entry.description ?? null,
      }),
    };
  }

  private async findEvent(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("events")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    const eventId = readDocumentId(doc);
    const assignments = await this.db
      .collection("event_assignments")
      .find({
        eventId,
        assignmentStatus: "ACTIVE",
      })
      .sort({ assignmentKind: 1, _id: 1 })
      .toArray();

    return {
      id: eventId,
      externalRef,
      payload: stablePayload({
        externalRef,
        title: doc.title,
        assignments: assignments.map((assignment) => ({
          assignmentKind: assignment.assignmentKind,
          assignmentEmploymentProfileId:
            assignment.assignmentEmploymentProfileId ?? null,
          assignmentTalentId:
            assignment.assignmentTalentId ?? null,
          assignmentTalentGroupId:
            assignment.assignmentTalentGroupId ?? null,
        })),
        studioResourceIds: doc.studioResourceIds ?? [],
        platformAccountIds: doc.platformAccountIds ?? [],
        eventStartAt: doc.eventStartAt,
        eventEndAt: doc.eventEndAt,
        description: doc.description ?? null,
      }),
    };
  }

  private async findContractRecord(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("contract_records")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        externalRef,
        title: doc.title,
        contractKind: doc.contractKind,
        linkedEntityKind: doc.linkedEntityKind,
        linkedEmploymentProfileId:
          doc.linkedEmploymentProfileId ?? null,
        linkedTalentId: doc.linkedTalentId ?? null,
        ownerEmploymentProfileId:
          doc.ownerEmploymentProfileId,
        confidentialityTier: doc.confidentialityTier,
        effectiveStartDate: toCanonicalDateString(
          doc.effectiveStartDate,
        ),
        effectiveEndDate:
          doc.effectiveEndDate === null ||
          doc.effectiveEndDate === undefined
            ? null
            : toCanonicalDateString(doc.effectiveEndDate),
        fileReferenceId: doc.fileReferenceId ?? null,
        fileDisplayName: doc.fileDisplayName ?? null,
        status: doc.status,
        description: doc.description ?? null,
      }),
    };
  }

  private async findTalentKpiRecord(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("talent_kpi_records")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    const recordId = readDocumentId(doc);
    const metrics = await this.db
      .collection("talent_kpi_metric_values")
      .find({ kpiRecordId: recordId })
      .sort({ metricCode: 1 })
      .toArray();

    return {
      id: recordId,
      externalRef,
      payload: stablePayload({
        externalRef,
        title: doc.title,
        subjectTalentId: doc.subjectTalentId,
        attributionPlatformAccountId:
          doc.attributionPlatformAccountId ?? null,
        attributionEventId: doc.attributionEventId ?? null,
        measurementSource: doc.measurementSource,
        periodStartAt: doc.periodStartAt,
        periodEndAt: doc.periodEndAt,
        metrics: metrics.map((metric) => ({
          metricCode: metric.metricCode,
          numericValue: metric.numericValue,
        })),
        description: doc.description ?? null,
      }),
    };
  }

  private async findRevenueEntry(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("revenue_entries")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        externalRef,
        title: doc.title,
        subjectTalentId: doc.subjectTalentId,
        attributionPlatformAccountId:
          doc.attributionPlatformAccountId ?? null,
        attributionEventId: doc.attributionEventId ?? null,
        revenueKind: doc.revenueKind,
        entrySource: doc.entrySource,
        currencyCode: doc.currencyCode,
        recognizedAmount: doc.recognizedAmount,
        recognizedAt: doc.recognizedAt,
        description: doc.description ?? null,
      }),
    };
  }

  private async findCommissionRule(
    externalRef: string,
  ): Promise<ExistingFixtureRecord | null> {
    const doc = await this.db
      .collection("commission_rules")
      .findOne({ externalRef });
    if (!doc) {
      return null;
    }

    return {
      id: readDocumentId(doc),
      externalRef,
      payload: stablePayload({
        externalRef,
        title: doc.title,
        settlementKind: doc.settlementKind,
        beneficiaryKind: doc.beneficiaryKind,
        beneficiaryEmploymentProfileId:
          doc.beneficiaryEmploymentProfileId ?? null,
        beneficiaryTalentId: doc.beneficiaryTalentId ?? null,
        sourceContractRecordId: doc.sourceContractRecordId,
        settlementBasis: doc.settlementBasis,
        ratePercent: doc.ratePercent,
        appliesToRevenueKinds:
          doc.appliesToRevenueKinds ?? [],
        effectiveStartDate: doc.effectiveStartDate,
        effectiveEndDate: doc.effectiveEndDate ?? null,
        description: doc.description ?? null,
      }),
    };
  }
}

function readDocumentId(doc: {
  readonly _id?: unknown;
}): string {
  return String(doc._id);
}

function readLookupString(
  payload: FixturePayload | undefined,
  field: string,
): string | null {
  const value = payload?.[field];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function stablePayload(
  value: Record<string, unknown>,
): FixturePayload {
  return Object.freeze({ ...value });
}

function toCanonicalDateString(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value);
  }

  return new Date(value).toISOString().slice(0, 10);
}
