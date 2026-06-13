import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoServerError, type ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import type {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import {
  utcMonthBucketFromTimestamp,
  utcYearBucketFromTimestamp,
} from "@core/business-code/business-code-bucket";
import type {
  BusinessCodePolicy,
  BusinessCodeSequenceRepository,
} from "@core/business-code/business-code-sequence.repository";
import { parseGeneratedBusinessCodeSequence } from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { ContractRegistryAdminService } from "@modules/contract-registry/admin/admin.contract-registry.service";
import { CONTRACT_RECORD_CONTRACT_CODE_UNIQ_INDEX_NAME } from "@infra/mongo/contract-registry/contract-registry.index";
import { ContractRegistryConflictError } from "@modules/contract-registry/domain/contract-registry.errors";
import type { ContractRecord } from "@modules/contract-registry/domain/contract-registry.types";
import { EventAssignmentAdminService } from "@modules/event-assignment/admin/admin.event-assignment.service";
import { EVENT_UNIQ_CODE_INDEX_NAME } from "@infra/mongo/event-assignment/event-assignment.index";
import { EventAssignmentConflictError } from "@modules/event-assignment/domain/event-assignment.errors";
import type {
  EventAssignmentRecord,
  EventRecord,
} from "@modules/event-assignment/domain/event-assignment.types";
import { TalentKpiAdminService } from "@modules/talent-kpi/admin/admin.talent-kpi.service";
import { TALENT_KPI_RECORD_UNIQ_CODE_INDEX_NAME } from "@infra/mongo/talent-kpi/talent-kpi.index";
import { TalentKpiConflictError } from "@modules/talent-kpi/domain/talent-kpi.errors";
import type {
  TalentKpiMetricValue,
  TalentKpiRecord,
} from "@modules/talent-kpi/domain/talent-kpi.types";
import { RevenueLedgerAdminService } from "@modules/revenue-ledger/admin/admin.revenue-ledger.service";
import { REVENUE_ENTRY_UNIQ_CODE_INDEX_NAME } from "@infra/mongo/revenue-ledger/revenue-ledger.index";
import { RevenueLedgerConflictError } from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import type { RevenueEntry } from "@modules/revenue-ledger/domain/revenue-ledger.types";

const mutationBridge: AuthoritativeAdminMutationBridge = {
  async execute(_params, mutate) {
    const controls: AuthoritativeMutationControls = {
      markAuthSecurityTruthChanged() {},
      markExplicitNoOpSuccess() {},
    };
    return mutate({} as ClientSession, controls);
  },
};

const audit = {
  async record() {},
} as unknown as AuditGuard;

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
} as never;

class MemoryBusinessCodeSequenceRepository
  implements BusinessCodeSequenceRepository
{
  readonly values = new Map<string, number>();

  async allocateNext(
    moduleKey: string,
    bucket: string,
  ): Promise<number> {
    const key = `${moduleKey}:${bucket}`;
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }

  async ensureAtLeast(
    moduleKey: string,
    bucket: string,
    minimumValue: number,
  ): Promise<void> {
    const key = `${moduleKey}:${bucket}`;
    const current = this.values.get(key) ?? 0;

    if (minimumValue > current) {
      this.values.set(key, minimumValue);
    }
  }
}

test("Phase 2B UTC bucket helpers are timezone independent", () => {
  assert.equal(
    utcMonthBucketFromTimestamp(
      Date.UTC(2024, 2, 31, 23, 30),
    ),
    "202403",
  );
  assert.equal(
    utcMonthBucketFromTimestamp(
      Date.UTC(2024, 3, 1, 0, 30),
    ),
    "202404",
  );
  assert.equal(
    utcYearBucketFromTimestamp(
      Date.UTC(2024, 11, 31, 23, 59),
    ),
    "2024",
  );
  assert.equal(
    utcYearBucketFromTimestamp(
      Date.UTC(2025, 0, 1, 0, 0),
    ),
    "2025",
  );
});

test("Phase 2B modules generate, trim, preserve, retry, and keep business codes immutable", async (t) => {
  await bindTraceId("trace-phase-2b", async () => {
    const actor = createActor();

    await t.test("event assignment", async () => {
      const repo = new MemoryEventRepository();
      const service = new EventAssignmentAdminService(
        repo as never,
        new MemoryBusinessCodeSequenceRepository(),
        { async findById() { return { id: "ep-1", employmentStatus: "ACTIVE" }; } } as never,
        { async findById() { return { id: "talent-1", operationalStatus: "ACTIVE" }; } } as never,
        { async findById() { return { id: "tg-1", status: "ACTIVE" }; } } as never,
        { async findById() { return { id: "studio-1", operationalStatus: "ACTIVE" }; } } as never,
        { async findById() { return { id: "platform-1", operationalStatus: "ACTIVE", livestreamEnabled: true, contentPublishingEnabled: true }; } } as never,
        audit,
        mutationBridge,
        logger,
      );

      const omitted = await service.createEvent(
        actor,
        createEventCommand(undefined, "omitted"),
      );
      const nulled = await service.createEvent(
        actor,
        createEventCommand(null, "null"),
      );
      const blank = await service.createEvent(
        actor,
        createEventCommand("   ", "blank"),
      );
      const custom = await service.createEvent(
        actor,
        createEventCommand("  EVT-CUSTOM  ", "custom"),
      );

      assert.equal(omitted.eventCode, "EVT-202403-000001");
      assert.equal(nulled.eventCode, "EVT-202403-000002");
      assert.equal(blank.eventCode, "EVT-202403-000003");
      assert.equal(custom.eventCode, "EVT-CUSTOM");
      assert.equal(custom.externalRef, "EVENT-CUSTOM-REF");
      await assert.rejects(
        service.createEvent(
          actor,
          createEventCommand("EVT-CUSTOM", "duplicate"),
        ),
        EventAssignmentConflictError,
      );

      repo.seed("EVT-202403-000004");
      const retried = await service.createEvent(
        actor,
        createEventCommand(undefined, "retry"),
      );
      assert.equal(retried.eventCode, "EVT-202403-000005");

      const rescheduled = await service.rescheduleEvent(actor, {
        eventId: retried.id,
        newEventStartAt: Date.UTC(2024, 4, 1, 10),
        newEventEndAt: Date.UTC(2024, 4, 1, 12),
        reason: "Production schedule changed",
      });
      assert.equal(rescheduled.eventCode, retried.eventCode);
    });

    await t.test("contract registry", async () => {
      const repo = new MemoryContractRepository();
      const service = new ContractRegistryAdminService(
        repo as never,
        { async hasUnresolvedByContractRecordId() { return false; } } as never,
        new MemoryBusinessCodeSequenceRepository(),
        { async findById() { return { id: "ep-1", employmentStatus: "ACTIVE" }; } } as never,
        { async findById() { return { id: "talent-1", operationalStatus: "ACTIVE" }; } } as never,
        audit,
        mutationBridge,
        logger,
      );

      const omitted = await service.createContractRecord(
        actor,
        createContractCommand(undefined, "omitted"),
      );
      const nulled = await service.createContractRecord(
        actor,
        createContractCommand(null, "null"),
      );
      const blank = await service.createContractRecord(
        actor,
        createContractCommand("   ", "blank"),
      );
      const custom = await service.createContractRecord(
        actor,
        createContractCommand("  CON-CUSTOM  ", "custom"),
      );

      assert.equal(omitted.contractCode, "CON-2024-000001");
      assert.equal(nulled.contractCode, "CON-2024-000002");
      assert.equal(blank.contractCode, "CON-2024-000003");
      assert.equal(custom.contractCode, "CON-CUSTOM");
      assert.equal(custom.fileReferenceId, "file-custom");
      await assert.rejects(
        service.createContractRecord(
          actor,
          createContractCommand("CON-CUSTOM", "duplicate"),
        ),
        ContractRegistryConflictError,
      );

      repo.seed("CON-2024-000004");
      const retried =
        await service.createContractRecord(
          actor,
          createContractCommand(undefined, "retry"),
        );
      assert.equal(retried.contractCode, "CON-2024-000005");

      const updated =
        await service.updateContractRecordDraftCore(actor, {
          contractRecordId: retried.id,
          effectiveStartDate: "2025-01-01",
        });
      assert.equal(updated.contractCode, retried.contractCode);
    });

    await t.test("talent KPI", async () => {
      const repo = new MemoryTalentKpiRepository();
      const service = new TalentKpiAdminService(
        repo as never,
        new MemoryBusinessCodeSequenceRepository(),
        { async findById() { return { id: "talent-1" }; } } as never,
        { async findById() { return { id: "platform-1" }; } } as never,
        {
          async findById() { return { id: "event-1", status: "COMPLETED", platformAccountIds: ["platform-1"] }; },
          async hasActiveTalentAssignment() { return true; },
        } as never,
        audit,
        mutationBridge,
        logger,
      );

      const omitted = await service.createTalentKpiRecord(
        actor,
        createKpiCommand(undefined, "omitted"),
      );
      const nulled = await service.createTalentKpiRecord(
        actor,
        createKpiCommand(null, "null"),
      );
      const blank = await service.createTalentKpiRecord(
        actor,
        createKpiCommand("   ", "blank"),
      );
      const custom = await service.createTalentKpiRecord(
        actor,
        createKpiCommand("  KPI-CUSTOM  ", "custom"),
      );

      assert.equal(omitted.kpiRecordCode, "KPI-202403-000001");
      assert.equal(nulled.kpiRecordCode, "KPI-202403-000002");
      assert.equal(blank.kpiRecordCode, "KPI-202403-000003");
      assert.equal(custom.kpiRecordCode, "KPI-CUSTOM");
      assert.equal(
        repo.metricsByRecord.get(custom.id)?.[0]?.metricCode,
        "CONTENT_PUBLISH_COUNT",
      );
      await assert.rejects(
        service.createTalentKpiRecord(
          actor,
          createKpiCommand("KPI-CUSTOM", "duplicate"),
        ),
        TalentKpiConflictError,
      );

      repo.seed("KPI-202403-000004");
      const retried = await service.createTalentKpiRecord(
        actor,
        createKpiCommand(undefined, "retry"),
      );
      assert.equal(retried.kpiRecordCode, "KPI-202403-000005");

      const updated =
        await service.updateTalentKpiDraftCore(actor, {
          talentKpiRecordId: retried.id,
          periodStartAt: Date.UTC(2024, 4, 1),
          periodEndAt: Date.UTC(2024, 4, 1, 1),
        });
      assert.equal(updated.kpiRecordCode, retried.kpiRecordCode);
    });

    await t.test("revenue ledger", async () => {
      const repo = new MemoryRevenueRepository();
      const service = new RevenueLedgerAdminService(
        repo as never,
        new MemoryBusinessCodeSequenceRepository(),
        { async findById() { return { id: "talent-1" }; } } as never,
        { async findById() { return { id: "platform-1" }; } } as never,
        {
          async findById() { return { id: "event-1", status: "COMPLETED", platformAccountIds: ["platform-1"] }; },
          async hasActiveTalentAssignment() { return true; },
        } as never,
        { async findFinalizedSettlementReferenceByRevenueEntryId() { return null; } } as never,
        audit,
        mutationBridge,
        logger,
      );

      const omitted = await service.createRevenueEntry(
        actor,
        createRevenueCommand(undefined, "omitted"),
      );
      const nulled = await service.createRevenueEntry(
        actor,
        createRevenueCommand(null, "null"),
      );
      const blank = await service.createRevenueEntry(
        actor,
        createRevenueCommand("   ", "blank"),
      );
      const custom = await service.createRevenueEntry(
        actor,
        createRevenueCommand("  REV-CUSTOM  ", "custom"),
      );

      assert.equal(
        omitted.revenueEntryCode,
        "REV-202403-000001",
      );
      assert.equal(
        nulled.revenueEntryCode,
        "REV-202403-000002",
      );
      assert.equal(
        blank.revenueEntryCode,
        "REV-202403-000003",
      );
      assert.equal(custom.revenueEntryCode, "REV-CUSTOM");
      assert.equal(custom.currencyCode, "USD");
      await assert.rejects(
        service.createRevenueEntry(
          actor,
          createRevenueCommand("REV-CUSTOM", "duplicate"),
        ),
        RevenueLedgerConflictError,
      );

      repo.seed("REV-202403-000004");
      const retried = await service.createRevenueEntry(
        actor,
        createRevenueCommand(undefined, "retry"),
      );
      assert.equal(
        retried.revenueEntryCode,
        "REV-202403-000005",
      );

      const updated =
        await service.updateRevenueEntryDraftCore(actor, {
          revenueEntryId: retried.id,
          recognizedAt: Date.UTC(2024, 4, 1),
        });
      assert.equal(
        updated.revenueEntryCode,
        retried.revenueEntryCode,
      );
    });
  });
});

test("Phase 2B code unique indexes remain declared", () => {
  assert.equal(EVENT_UNIQ_CODE_INDEX_NAME, "uniq_event_code");
  assert.equal(
    CONTRACT_RECORD_CONTRACT_CODE_UNIQ_INDEX_NAME,
    "uniq_contract_record_contract_code",
  );
  assert.equal(
    TALENT_KPI_RECORD_UNIQ_CODE_INDEX_NAME,
    "uniq_talent_kpi_record_kpi_record_code",
  );
  assert.equal(
    REVENUE_ENTRY_UNIQ_CODE_INDEX_NAME,
    "uniq_revenue_entry_revenue_entry_code",
  );
});

function createActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.EVENT_CREATE,
      Permission.EVENT_UPDATE,
      Permission.CONTRACT_REGISTRY_CREATE,
      Permission.CONTRACT_REGISTRY_UPDATE,
      Permission.TALENT_KPI_CREATE,
      Permission.TALENT_KPI_UPDATE,
      Permission.REVENUE_LEDGER_CREATE,
      Permission.REVENUE_LEDGER_UPDATE,
    ],
    scopeGrants: {
      eventAssignment: ["global"],
      contractRegistry: ["global"],
      talentKpi: ["global"],
      revenueLedger: ["global"],
    },
    isActive: true,
  });
}

function createEventCommand(
  eventCode: string | null | undefined,
  suffix: string,
) {
  return {
    eventCode,
    title: `Event ${suffix}`,
    ownerEmploymentProfileId: "ep-1",
    status: "PLANNED",
    assignments: [
      {
        assignmentKind: "TALENT",
        assignmentTalentId: "talent-1",
      },
    ],
    platformAccountIds: ["platform-1"],
    eventStartAt: Date.UTC(2024, 2, 31, 23, 30),
    eventEndAt: Date.UTC(2024, 3, 1, 1, 30),
    description: null,
    externalRef:
      suffix === "custom" ? "EVENT-CUSTOM-REF" : null,
  };
}

function createContractCommand(
  contractCode: string | null | undefined,
  suffix: string,
) {
  return {
    contractCode,
    title: `Contract ${suffix}`,
    contractKind: "TALENT_SERVICE",
    linkedEntityKind: "TALENT",
    linkedEmploymentProfileId: null,
    linkedTalentId: "talent-1",
    ownerEmploymentProfileId: "ep-1",
    confidentialityTier: "INTERNAL",
    effectiveStartDate: "2024-12-31",
    effectiveEndDate: null,
    fileReferenceId:
      suffix === "custom" ? "file-custom" : null,
    fileDisplayName:
      suffix === "custom" ? "Custom.pdf" : null,
    description: null,
    externalRef: null,
  };
}

function createKpiCommand(
  kpiRecordCode: string | null | undefined,
  suffix: string,
) {
  return {
    kpiRecordCode,
    title: `KPI ${suffix}`,
    subjectTalentId: "talent-1",
    attributionPlatformAccountId: "platform-1",
    attributionEventId: "event-1",
    measurementSource: "MANUAL",
    periodStartAt: Date.UTC(2024, 2, 31, 23),
    periodEndAt: Date.UTC(2024, 3, 1, 0),
    metrics: [
      {
        metricCode: "CONTENT_PUBLISH_COUNT",
        numericValue: 1,
      },
    ],
    description: null,
    externalRef: null,
  };
}

function createRevenueCommand(
  revenueEntryCode: string | null | undefined,
  suffix: string,
) {
  return {
    revenueEntryCode,
    title: `Revenue ${suffix}`,
    subjectTalentId: "talent-1",
    attributionPlatformAccountId: "platform-1",
    attributionEventId: "event-1",
    revenueKind: "PLATFORM_CONTENT",
    entrySource: "MANUAL",
    currencyCode: "USD",
    recognizedAmount: 123.45,
    recognizedAt: Date.UTC(2024, 2, 31, 23),
    description: null,
    externalRef: null,
  };
}

function duplicateKey(): MongoServerError {
  return new MongoServerError({
    message: "duplicate key",
    code: 11000,
  });
}

function maxGenerated(
  records: readonly string[],
  policy: Pick<BusinessCodePolicy, "prefix" | "width">,
): number {
  return records.reduce((max, code) => {
    const sequence =
      parseGeneratedBusinessCodeSequence(code, policy);
    return sequence === null
      ? max
      : Math.max(max, sequence);
  }, 0);
}

class MemoryEventRepository {
  readonly records: EventRecord[] = [];
  readonly assignments: EventAssignmentRecord[] = [];

  seed(eventCode: string): void {
    this.records.push({
      ...createBaseEventRecord(eventCode),
      id: `seed-${eventCode}`,
    });
  }

  async insertEvent(event: EventRecord): Promise<EventRecord> {
    if (
      this.records.some(
        (item) => item.eventCode === event.eventCode,
      )
    ) {
      throw duplicateKey();
    }
    this.records.push(event);
    return event;
  }

  async insertAssignments(
    assignments: readonly EventAssignmentRecord[],
  ): Promise<readonly EventAssignmentRecord[]> {
    this.assignments.push(...assignments);
    return assignments;
  }

  async findEventById(
    eventId: string,
  ): Promise<EventRecord | null> {
    return this.records.find((item) => item.id === eventId) ?? null;
  }

  async findEventByEventCode(
    eventCode: string,
  ): Promise<EventRecord | null> {
    return this.records.find((item) => item.eventCode === eventCode) ?? null;
  }

  async findMaxGeneratedEventCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
  ): Promise<number> {
    return maxGenerated(
      this.records.map((item) => item.eventCode),
      policy,
    );
  }

  async updateEventCore(): Promise<EventRecord | null> {
    return null;
  }

  async rescheduleEvent(input: {
    readonly eventId: string;
    readonly eventStartAt: number;
    readonly eventEndAt: number;
    readonly updatedAt: number;
  }): Promise<EventRecord | null> {
    const record = await this.findEventById(input.eventId);
    if (!record) {
      return null;
    }
    Object.assign(record, {
      eventStartAt: input.eventStartAt,
      eventEndAt: input.eventEndAt,
      updatedAt: input.updatedAt,
    });
    return record;
  }

  async replaceEventStudioResources(): Promise<EventRecord | null> {
    return null;
  }

  async replaceEventPlatformAccounts(): Promise<EventRecord | null> {
    return null;
  }

  async touchEvent(): Promise<EventRecord | null> {
    return null;
  }

  async transitionEventStatus(): Promise<EventRecord | null> {
    return null;
  }

  async listAssignmentsByEventId(
    eventId: string,
  ): Promise<readonly EventAssignmentRecord[]> {
    return this.assignments.filter(
      (item) => item.eventId === eventId,
    );
  }

  async markAssignmentsRemoved(): Promise<void> {}
  async hasLiveOverlappingAssignmentEvent(): Promise<boolean> { return false; }
  async hasLiveOverlappingResourceEvent(): Promise<boolean> { return false; }
  async hasLiveOverlappingPlatformEvent(): Promise<boolean> { return false; }
}

function createBaseEventRecord(
  eventCode: string,
): EventRecord {
  return {
    id: `event-${eventCode}`,
    eventCode,
    title: "Event",
    normalizedTitle: "event",
    ownerEmploymentProfileId: "ep-1",
    studioResourceIds: ["studio-1"],
    platformAccountIds: ["platform-1"],
    status: "PLANNED",
    eventStartAt: Date.UTC(2024, 2, 31, 23),
    eventEndAt: Date.UTC(2024, 3, 1),
    description: null,
    externalRef: null,
    createdByActorId: "actor-1",
    updatedByActorId: "actor-1",
    plannedAt: 1,
    plannedByActorId: "actor-1",
    confirmedAt: null,
    confirmedByActorId: null,
    completedAt: null,
    completedByActorId: null,
    completionEvidenceNote: null,
    completionEvidenceRefs: [],
    cancelledAt: null,
    cancelledByActorId: null,
    cancellationReason: null,
    lastRescheduledAt: null,
    lastRescheduledByActorId: null,
    lastRescheduleReason: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

class MemoryContractRepository {
  readonly records: ContractRecord[] = [];

  seed(contractCode: string): void {
    this.records.push({
      ...createBaseContractRecord(contractCode),
      id: `seed-${contractCode}`,
    });
  }

  async insert(
    record: ContractRecord,
  ): Promise<ContractRecord> {
    if (
      this.records.some(
        (item) => item.contractCode === record.contractCode,
      )
    ) {
      throw duplicateKey();
    }
    this.records.push(record);
    return record;
  }

  async findById(id: string): Promise<ContractRecord | null> {
    return this.records.find((item) => item.id === id) ?? null;
  }

  async findByContractCode(
    code: string,
  ): Promise<ContractRecord | null> {
    return this.records.find((item) => item.contractCode === code) ?? null;
  }

  async findMaxGeneratedContractCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
  ): Promise<number> {
    return maxGenerated(
      this.records.map((item) => item.contractCode),
      policy,
    );
  }

  async updateDraftCore(input: {
    readonly contractRecordId: string;
    readonly effectiveStartDate?: number;
    readonly updatedAt: number;
  }): Promise<ContractRecord | null> {
    const record = await this.findById(input.contractRecordId);
    if (!record) {
      return null;
    }
    if (input.effectiveStartDate !== undefined) {
      Object.assign(record, {
        effectiveStartDate: input.effectiveStartDate,
      });
    }
    Object.assign(record, { updatedAt: input.updatedAt });
    return record;
  }

  async assignOwner(): Promise<ContractRecord | null> { return null; }
  async updateFileReference(): Promise<ContractRecord | null> { return null; }
  async transitionStatus(): Promise<ContractRecord | null> { return null; }
}

function createBaseContractRecord(
  contractCode: string,
): ContractRecord {
  return {
    id: `contract-${contractCode}`,
    contractCode,
    title: "Contract",
    normalizedTitle: "contract",
    contractKind: "EMPLOYMENT",
    linkedEntityKind: "EMPLOYMENT_PROFILE",
    linkedEmploymentProfileId: "ep-1",
    linkedTalentId: null,
    ownerEmploymentProfileId: "ep-1",
    confidentialityTier: "INTERNAL",
    status: "DRAFT",
    effectiveStartDate: Date.UTC(2024, 11, 31),
    effectiveEndDate: null,
    fileReferenceId: null,
    fileDisplayName: null,
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

class MemoryTalentKpiRepository {
  readonly records: TalentKpiRecord[] = [];
  readonly metricsByRecord = new Map<
    string,
    TalentKpiMetricValue[]
  >();

  seed(kpiRecordCode: string): void {
    this.records.push({
      ...createBaseKpiRecord(kpiRecordCode),
      id: `seed-${kpiRecordCode}`,
    });
  }

  async insertRecord(
    record: TalentKpiRecord,
  ): Promise<TalentKpiRecord> {
    if (
      this.records.some(
        (item) =>
          item.kpiRecordCode === record.kpiRecordCode,
      )
    ) {
      throw duplicateKey();
    }
    this.records.push(record);
    return record;
  }

  async insertMetricValues(
    metricValues: readonly TalentKpiMetricValue[],
  ): Promise<readonly TalentKpiMetricValue[]> {
    if (metricValues.length === 0) {
      return [];
    }
    this.metricsByRecord.set(
      metricValues[0]!.kpiRecordId,
      [...metricValues],
    );
    return metricValues;
  }

  async findRecordById(
    id: string,
  ): Promise<TalentKpiRecord | null> {
    return this.records.find((item) => item.id === id) ?? null;
  }

  async findRecordByKpiRecordCode(
    code: string,
  ): Promise<TalentKpiRecord | null> {
    return this.records.find((item) => item.kpiRecordCode === code) ?? null;
  }

  async findMaxGeneratedKpiRecordCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
  ): Promise<number> {
    return maxGenerated(
      this.records.map((item) => item.kpiRecordCode),
      policy,
    );
  }

  async findNonArchivedByMeasurementIdentity(): Promise<TalentKpiRecord | null> {
    return null;
  }

  async updateDraftCore(input: {
    readonly talentKpiRecordId: string;
    readonly periodStartAt?: number;
    readonly periodEndAt?: number;
    readonly updatedAt: number;
  }): Promise<TalentKpiRecord | null> {
    const record = await this.findRecordById(
      input.talentKpiRecordId,
    );
    if (!record) {
      return null;
    }
    if (input.periodStartAt !== undefined) {
      Object.assign(record, {
        periodStartAt: input.periodStartAt,
      });
    }
    if (input.periodEndAt !== undefined) {
      Object.assign(record, {
        periodEndAt: input.periodEndAt,
      });
    }
    Object.assign(record, { updatedAt: input.updatedAt });
    return record;
  }

  async touchDraftRecord(): Promise<TalentKpiRecord | null> { return null; }
  async transitionStatus(): Promise<TalentKpiRecord | null> { return null; }
  async listMetricValuesByRecordId(): Promise<readonly TalentKpiMetricValue[]> { return []; }
  async deleteMetricValuesByRecordId(): Promise<void> {}
}

function createBaseKpiRecord(
  kpiRecordCode: string,
): TalentKpiRecord {
  return {
    id: `kpi-${kpiRecordCode}`,
    kpiRecordCode,
    normalizedKpiRecordCode:
      kpiRecordCode.toLowerCase(),
    title: "KPI",
    normalizedTitle: "kpi",
    subjectTalentId: "talent-1",
    attributionPlatformAccountId: "platform-1",
    attributionEventId: "event-1",
    measurementSource: "MANUAL",
    status: "DRAFT",
    periodStartAt: Date.UTC(2024, 2, 31, 23),
    periodEndAt: Date.UTC(2024, 3, 1),
    publishedAt: null,
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

class MemoryRevenueRepository {
  readonly records: RevenueEntry[] = [];

  seed(revenueEntryCode: string): void {
    this.records.push({
      ...createBaseRevenueEntry(revenueEntryCode),
      id: `seed-${revenueEntryCode}`,
    });
  }

  async insert(record: RevenueEntry): Promise<RevenueEntry> {
    if (
      this.records.some(
        (item) =>
          item.revenueEntryCode ===
          record.revenueEntryCode,
      )
    ) {
      throw duplicateKey();
    }
    this.records.push(record);
    return record;
  }

  async findById(id: string): Promise<RevenueEntry | null> {
    return this.records.find((item) => item.id === id) ?? null;
  }

  async findByRevenueEntryCode(
    code: string,
  ): Promise<RevenueEntry | null> {
    return this.records.find((item) => item.revenueEntryCode === code) ?? null;
  }

  async findMaxGeneratedRevenueEntryCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
  ): Promise<number> {
    return maxGenerated(
      this.records.map((item) => item.revenueEntryCode),
      policy,
    );
  }

  async updateDraftCore(input: {
    readonly revenueEntryId: string;
    readonly recognizedAt?: number;
    readonly updatedAt: number;
  }): Promise<RevenueEntry | null> {
    const record = await this.findById(input.revenueEntryId);
    if (!record) {
      return null;
    }
    if (input.recognizedAt !== undefined) {
      Object.assign(record, {
        recognizedAt: input.recognizedAt,
      });
    }
    Object.assign(record, { updatedAt: input.updatedAt });
    return record;
  }

  async transitionStatus(): Promise<RevenueEntry | null> { return null; }
}

function createBaseRevenueEntry(
  revenueEntryCode: string,
): RevenueEntry {
  return {
    id: `revenue-${revenueEntryCode}`,
    revenueEntryCode,
    title: "Revenue",
    normalizedTitle: "revenue",
    subjectTalentId: "talent-1",
    attributionPlatformAccountId: "platform-1",
    attributionEventId: "event-1",
    revenueKind: "PLATFORM_CONTENT",
    entrySource: "MANUAL",
    status: "DRAFT",
    currencyCode: "USD",
    recognizedAmount: 123.45,
    recognizedAt: Date.UTC(2024, 2, 31, 23),
    finalizedAt: null,
    reconciledAt: null,
    voidedAt: null,
    reconciliationReference: null,
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 1,
  };
}
