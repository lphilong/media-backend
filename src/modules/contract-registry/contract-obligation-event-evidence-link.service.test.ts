import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { EventAssignmentRepository } from "@modules/event-assignment/domain/event-assignment.repository";
import { EventRecord } from "@modules/event-assignment/domain/event-assignment.types";
import { ContractObligationEventEvidenceLinkAdminService } from "./admin/admin.contract-obligation-event-evidence-link.service";
import { ContractObligationAdminService } from "./admin/admin.contract-obligation.service";
import {
  ContractObligationEventEvidenceLinkRepository,
  RemoveContractObligationEventEvidenceLinkInput,
} from "./domain/contract-obligation-event-evidence-link.repository";
import { ContractObligationEventEvidenceLink } from "./domain/contract-obligation-event-evidence-link.types";
import {
  ContractObligationRepository,
  TransitionContractObligationInput,
  UpdateContractObligationMetadataInput,
} from "./domain/contract-obligation.repository";
import { ContractObligation } from "./domain/contract-obligation.types";
import {
  ContractObligationSelfAcceptanceError,
  ContractObligationStateError,
  ContractObligationValidationError,
} from "./domain/contract-registry.errors";
import { ContractRegistryRepository } from "./domain/contract-registry.repository";
import { ContractRecord } from "./domain/contract-registry.types";

const session = {} as ClientSession;
const audit = { async record() {} } as unknown as AuditGuard;
const bridge: AuthoritativeAdminMutationBridge = {
  async execute(_params, mutate) {
    return mutate(session, {
      markAuthSecurityTruthChanged() {},
      markExplicitNoOpSuccess() {},
    } as AuthoritativeMutationControls);
  },
};

test("CR-3B links completed Event completion evidence to OPEN obligation with immutable snapshot", async () => {
  await bindTraceId("cr-3b-link-snapshot", async () => {
    const harness = createHarness();
    const actor = adminActor("linker");

    const link = await harness.linkService.link(actor, {
      contractObligationId: "obligation-1",
      eventId: "event-1",
      linkReason: "Supports obligation delivery",
    });

    assert.equal(link.status, "ACTIVE");
    assert.equal(link.contractObligationId, "obligation-1");
    assert.equal(link.contractRecordId, "contract-1");
    assert.equal(link.eventId, "event-1");
    assert.equal(link.snapshot.eventCode, "EVT-1");
    assert.equal(link.snapshot.eventTitle, "Completed event");
    assert.equal(link.snapshot.eventStatus, "COMPLETED");
    assert.equal(link.snapshot.eventCompletedAt, 4);
    assert.equal(link.snapshot.eventCompletedByActorId, "event-owner");
    assert.equal(
      link.snapshot.completionEvidenceNote,
      "Completion note",
    );
    assert.deepEqual(link.snapshot.completionEvidenceRefs, [
      {
        type: "URL",
        label: "Completion proof",
        url: "https://example.com/proof",
        referenceId: null,
      },
    ]);
    assert.equal(
      link.boundaryMetadata.supportingEvidenceOnly,
      true,
    );
    assert.equal(
      harness.obligations.records[0].status,
      "OPEN",
    );
    assert.equal(
      harness.events.records.get("event-1")?.title,
      "Completed event",
    );

    await assert.rejects(
      () =>
        harness.linkService.link(actor, {
          contractObligationId: "obligation-1",
          eventId: "event-1",
          linkReason: "Duplicate active link",
        }),
      ContractObligationStateError,
    );

    const event = harness.events.records.get("event-1");
    assert.notEqual(event, undefined);
    harness.events.records.set("event-1", {
      ...event!,
      title: "Later changed title",
      updatedAt: 99,
      completionEvidenceNote: "Later changed note",
    });

    const stored = await harness.links.findById(link.id);
    assert.equal(stored?.snapshot.eventTitle, "Completed event");
    assert.equal(
      stored?.snapshot.completionEvidenceNote,
      "Completion note",
    );
  });
});

test("CR-3B link rejects ineligible Events, obligations, and contracts", async () => {
  await bindTraceId("cr-3b-link-eligibility", async () => {
    const actor = adminActor("linker");

    for (const status of [
      "DRAFT",
      "DELIVERED",
      "ACCEPTED",
      "REJECTED",
      "CANCELLED",
      "ARCHIVED",
    ] as const) {
      const harness = createHarness({
        obligation: obligationRecord({ status }),
      });
      await assert.rejects(
        () =>
          harness.linkService.link(actor, {
            contractObligationId: "obligation-1",
            eventId: "event-1",
            linkReason: "Wrong obligation status",
          }),
        ContractObligationStateError,
      );
    }

    const plannedEventHarness = createHarness({
      event: eventRecord({ status: "PLANNED" }),
    });
    await assert.rejects(
      () =>
        plannedEventHarness.linkService.link(actor, {
          contractObligationId: "obligation-1",
          eventId: "event-1",
          linkReason: "Wrong Event status",
        }),
      ContractObligationStateError,
    );

    const missingEvidenceHarness = createHarness({
      event: eventRecord({
        completionEvidenceNote: null,
      }),
    });
    await assert.rejects(
      () =>
        missingEvidenceHarness.linkService.link(actor, {
          contractObligationId: "obligation-1",
          eventId: "event-1",
          linkReason: "Missing persisted evidence",
        }),
      ContractObligationStateError,
    );

    const inactiveContractHarness = createHarness({
      contract: contractRecord({ status: "DRAFT" }),
    });
    await assert.rejects(
      () =>
        inactiveContractHarness.linkService.link(actor, {
          contractObligationId: "obligation-1",
          eventId: "event-1",
          linkReason: "Inactive contract",
        }),
      /Only ACTIVE TALENT_SERVICE or TALENT_MANAGEMENT/u,
    );
  });
});

test("CR-3B soft remove preserves snapshot and relink creates a new active snapshot", async () => {
  await bindTraceId("cr-3b-remove-relink", async () => {
    const harness = createHarness();
    const actor = adminActor("linker");

    const first = await harness.linkService.link(actor, {
      contractObligationId: "obligation-1",
      eventId: "event-1",
      linkReason: "Initial support",
    });

    await assert.rejects(
      () =>
        harness.linkService.remove(actor, {
          linkId: first.id,
          removeReason: " ",
        }),
      ContractObligationValidationError,
    );

    const removed = await harness.linkService.remove(actor, {
      linkId: first.id,
      removeReason: "Replaced with newer snapshot",
    });
    assert.equal(removed.status, "REMOVED");
    assert.equal(removed.removedByActorId, "linker");
    assert.equal(
      removed.snapshot.completionEvidenceNote,
      "Completion note",
    );

    const event = harness.events.records.get("event-1");
    assert.notEqual(event, undefined);
    harness.events.records.set("event-1", {
      ...event!,
      title: "New evidence title",
      updatedAt: 101,
      completionEvidenceNote: "New completion note",
    });

    const second = await harness.linkService.link(actor, {
      contractObligationId: "obligation-1",
      eventId: "event-1",
      linkReason: "New snapshot after removal",
    });
    assert.notEqual(second.id, first.id);
    assert.equal(second.status, "ACTIVE");
    assert.equal(second.snapshot.eventTitle, "New evidence title");
    assert.equal(
      second.snapshot.completionEvidenceNote,
      "New completion note",
    );

    const deliveredHarness = createHarness({
      obligation: obligationRecord({ status: "DELIVERED" }),
    });
    deliveredHarness.links.records.push(linkRecord());
    await assert.rejects(
      () =>
        deliveredHarness.linkService.remove(actor, {
          linkId: "link-1",
          removeReason: "Cannot remove after delivery",
        }),
      ContractObligationStateError,
    );
  });
});

test("CR-3B delivery can select active Event evidence links without auto-acceptance", async () => {
  await bindTraceId("cr-3b-delivery-selection", async () => {
    const harness = createHarness();
    const maker = adminActor("maker");
    const reviewer = adminActor("reviewer");

    const activeLink = await harness.linkService.link(maker, {
      contractObligationId: "obligation-1",
      eventId: "event-1",
      linkReason: "Delivery proof",
    });

    const delivered = await harness.obligationService.deliver(
      maker,
      {
        obligationId: "obligation-1",
        eventEvidenceLinkIds: [activeLink.id],
      },
    );
    assert.equal(delivered.status, "DELIVERED");
    assert.deepEqual(delivered.latestEvidenceRefs, []);
    assert.deepEqual(delivered.latestEventEvidenceLinkIds, [
      activeLink.id,
    ]);
    assert.equal(delivered.acceptedAt, null);

    await assert.rejects(
      () =>
        harness.obligationService.accept(maker, {
          obligationId: "obligation-1",
        }),
      ContractObligationSelfAcceptanceError,
    );

    const accepted = await harness.obligationService.accept(
      reviewer,
      {
        obligationId: "obligation-1",
      },
    );
    assert.equal(accepted.status, "ACCEPTED");
  });
});

test("CR-3B delivery rejects removed links and links from other obligations", async () => {
  await bindTraceId("cr-3b-delivery-rejects-invalid-links", async () => {
    const maker = adminActor("maker");

    const removedHarness = createHarness();
    const removedLink = await removedHarness.linkService.link(
      maker,
      {
        contractObligationId: "obligation-1",
        eventId: "event-1",
        linkReason: "Temporary proof",
      },
    );
    await removedHarness.linkService.remove(maker, {
      linkId: removedLink.id,
      removeReason: "No longer supports delivery",
    });
    await assert.rejects(
      () =>
        removedHarness.obligationService.deliver(maker, {
          obligationId: "obligation-1",
          eventEvidenceLinkIds: [removedLink.id],
        }),
      ContractObligationValidationError,
    );

    const otherObligationHarness = createHarness();
    otherObligationHarness.obligations.records.push(
      obligationRecord({ id: "obligation-2" }),
    );
    const otherLink = await otherObligationHarness.linkService.link(
      maker,
      {
        contractObligationId: "obligation-2",
        eventId: "event-1",
        linkReason: "Other obligation support",
      },
    );
    await assert.rejects(
      () =>
        otherObligationHarness.obligationService.deliver(maker, {
          obligationId: "obligation-1",
          eventEvidenceLinkIds: [otherLink.id],
        }),
      ContractObligationValidationError,
    );
  });
});

test("CR-3B event owner or responsible owner identity does not grant link authority", async () => {
  await bindTraceId("cr-3b-no-inferred-authority", async () => {
    const harness = createHarness();
    const eventOwnerWithoutPermission = adminActor(
      "event-owner",
      [Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_READ],
    );

    await assert.rejects(
      () =>
        harness.linkService.link(eventOwnerWithoutPermission, {
          contractObligationId: "obligation-1",
          eventId: "event-1",
          linkReason: "Owner relationship is not authority",
        }),
      /PERMISSION|permission|denied/u,
    );
  });
});

function createHarness(overrides: {
  readonly contract?: ContractRecord;
  readonly obligation?: ContractObligation;
  readonly event?: EventRecord;
} = {}) {
  const contracts = new MemoryContractRepository(
    overrides.contract ?? contractRecord(),
  );
  const obligations = new MemoryObligationRepository(
    overrides.obligation ?? obligationRecord(),
  );
  const links = new MemoryEventEvidenceLinkRepository();
  const events = new MemoryEventRepository(
    overrides.event ?? eventRecord(),
  );
  const linkService =
    new ContractObligationEventEvidenceLinkAdminService(
      links,
      obligations,
      contracts as unknown as ContractRegistryRepository,
      events as unknown as EventAssignmentRepository,
      audit,
      bridge,
    );
  const obligationService = new ContractObligationAdminService(
    obligations,
    links,
    contracts as unknown as ContractRegistryRepository,
    new MemoryCodeSequenceRepository(),
    {
      async findById(id: string) {
        return id === "owner-1"
          ? { id, employmentStatus: "ACTIVE" as const }
          : null;
      },
    },
    audit,
    bridge,
  );
  return {
    contracts,
    obligations,
    links,
    events,
    linkService,
    obligationService,
  };
}

function adminActor(
  id: string,
  permissions: readonly Permission[] = [
    Permission.CONTRACT_OBLIGATION_READ,
    Permission.CONTRACT_OBLIGATION_DELIVER,
    Permission.CONTRACT_OBLIGATION_REVIEW,
    Permission.CONTRACT_OBLIGATION_MANAGE_LIFECYCLE,
    Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_READ,
    Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK,
    Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_REMOVE,
  ],
): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    accountContexts: ["ADMIN_CONSOLE"],
    roles: [],
    permissions,
    scopeGrants: {
      contractRegistry: ["global"],
    },
    isActive: true,
  });
}

function contractRecord(
  overrides: Partial<ContractRecord> = {},
): ContractRecord {
  return {
    id: "contract-1",
    contractCode: "CON-1",
    title: "Commercial contract",
    normalizedTitle: "commercial contract",
    contractKind: "TALENT_SERVICE",
    linkedEntityKind: "TALENT",
    linkedEmploymentProfileId: null,
    linkedTalentId: "talent-1",
    ownerEmploymentProfileId: "owner-1",
    confidentialityTier: "INTERNAL",
    status: "ACTIVE",
    effectiveStartDate: Date.UTC(2026, 0, 1),
    effectiveEndDate: null,
    fileReferenceId: null,
    fileDisplayName: null,
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function obligationRecord(
  overrides: Partial<ContractObligation> = {},
): ContractObligation {
  return {
    id: "obligation-1",
    code: "OBL-1",
    contractRecordId: "contract-1",
    obligationType: "DELIVERABLE",
    title: "Publish campaign output",
    description: null,
    dueDate: null,
    responsibleOwnerEmploymentProfileId: "owner-1",
    evidencePolicy: "REQUIRED",
    status: "OPEN",
    latestDeliveryNote: null,
    latestEvidenceRefs: [],
    latestEventEvidenceLinkIds: [],
    latestDeliveredByActorId: null,
    latestDeliveredAt: null,
    latestReviewedByActorId: null,
    latestReviewedAt: null,
    acceptedByActorId: null,
    acceptedAt: null,
    rejectedByActorId: null,
    rejectedAt: null,
    rejectionReason: null,
    statusHistory: [
      {
        fromStatus: null,
        toStatus: "OPEN",
        actorId: "maker",
        occurredAt: 1,
        reason: null,
      },
    ],
    createdByActorId: "maker",
    createdAt: 1,
    updatedByActorId: "maker",
    updatedAt: 1,
    ...overrides,
  };
}

function eventRecord(
  overrides: Partial<EventRecord> = {},
): EventRecord {
  return {
    id: "event-1",
    eventCode: "EVT-1",
    title: "Completed event",
    normalizedTitle: "completed event",
    ownerEmploymentProfileId: "owner-1",
    studioResourceIds: [],
    platformAccountIds: [],
    status: "COMPLETED",
    eventStartAt: 1,
    eventEndAt: 2,
    description: null,
    externalRef: null,
    createdByActorId: "creator",
    updatedByActorId: "event-owner",
    plannedAt: 1,
    plannedByActorId: "planner",
    confirmedAt: 2,
    confirmedByActorId: "confirmer",
    completedAt: 4,
    completedByActorId: "event-owner",
    completionEvidenceNote: "Completion note",
    completionEvidenceRefs: [
      {
        type: "URL",
        label: "Completion proof",
        url: "https://example.com/proof",
        referenceId: null,
      },
    ],
    cancelledAt: null,
    cancelledByActorId: null,
    cancellationReason: null,
    lastRescheduledAt: null,
    lastRescheduledByActorId: null,
    lastRescheduleReason: null,
    createdAt: 1,
    updatedAt: 5,
    ...overrides,
  };
}

function linkRecord(
  overrides: Partial<ContractObligationEventEvidenceLink> = {},
): ContractObligationEventEvidenceLink {
  return {
    id: "link-1",
    contractObligationId: "obligation-1",
    contractRecordId: "contract-1",
    eventId: "event-1",
    status: "ACTIVE",
    linkedByActorId: "linker",
    linkedAt: 10,
    linkReason: "Support",
    removedByActorId: null,
    removedAt: null,
    removeReason: null,
    snapshot: {
      eventId: "event-1",
      eventCode: "EVT-1",
      eventTitle: "Completed event",
      eventStatus: "COMPLETED",
      eventUpdatedAt: 5,
      eventCompletedAt: 4,
      eventCompletedByActorId: "event-owner",
      completionEvidenceNote: "Completion note",
      completionEvidenceRefs: [],
    },
    actionHistory: [
      {
        action: "LINKED",
        actorId: "linker",
        occurredAt: 10,
        reason: "Support",
      },
    ],
    createdByActorId: "linker",
    createdAt: 10,
    updatedByActorId: "linker",
    updatedAt: 10,
    ...overrides,
  };
}

class MemoryContractRepository {
  readonly records: ContractRecord[];

  constructor(record: ContractRecord) {
    this.records = [record];
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }
}

class MemoryEventRepository {
  readonly records = new Map<string, EventRecord>();

  constructor(record: EventRecord) {
    this.records.set(record.id, record);
  }

  async findEventById(id: string) {
    return this.records.get(id) ?? null;
  }
}

class MemoryObligationRepository
  implements ContractObligationRepository
{
  readonly records: ContractObligation[];

  constructor(record: ContractObligation) {
    this.records = [record];
  }

  async insert(record: ContractObligation) {
    this.records.push(record);
    return record;
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findByCode(code: string) {
    return this.records.find((record) => record.code === code) ?? null;
  }

  async findMaxGeneratedCodeSequence() {
    return this.records.length;
  }

  async updateMetadata(
    input: UpdateContractObligationMetadataInput,
  ) {
    const index = this.records.findIndex(
      (record) =>
        record.id === input.obligationId &&
        input.fromStatuses.includes(record.status),
    );
    if (index < 0) return null;
    const updated: ContractObligation = {
      ...this.records[index],
      ...input,
      id: this.records[index].id,
      status: this.records[index].status,
    };
    this.records[index] = updated;
    return updated;
  }

  async transitionStatus(
    input: TransitionContractObligationInput,
  ) {
    const index = this.records.findIndex(
      (record) =>
        record.id === input.obligationId &&
        input.fromStatuses.includes(record.status),
    );
    if (index < 0) return null;
    const current = this.records[index];
    const updated: ContractObligation = {
      ...current,
      ...input,
      id: current.id,
      status: input.toStatus,
      statusHistory: [
        ...current.statusHistory,
        input.transition,
      ],
      latestEvidenceRefs:
        input.latestEvidenceRefs ??
        current.latestEvidenceRefs,
      latestEventEvidenceLinkIds:
        input.latestEventEvidenceLinkIds ??
        current.latestEventEvidenceLinkIds,
    };
    this.records[index] = updated;
    return updated;
  }

  async hasUnresolvedByContractRecordId(
    contractRecordId: string,
  ) {
    return this.records.some(
      (record) =>
        record.contractRecordId === contractRecordId &&
        ["DRAFT", "OPEN", "DELIVERED", "REJECTED"].includes(
          record.status,
        ),
    );
  }
}

class MemoryEventEvidenceLinkRepository
  implements ContractObligationEventEvidenceLinkRepository
{
  readonly records: ContractObligationEventEvidenceLink[] = [];

  async insert(record: ContractObligationEventEvidenceLink) {
    if (
      this.records.some(
        (existing) =>
          existing.contractObligationId ===
            record.contractObligationId &&
          existing.eventId === record.eventId &&
          existing.status === "ACTIVE",
      )
    ) {
      throw new ContractObligationStateError(
        "Duplicate active link",
      );
    }
    this.records.push(record);
    return record;
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findActiveByObligationAndEvent(
    contractObligationId: string,
    eventId: string,
  ) {
    return (
      this.records.find(
        (record) =>
          record.contractObligationId === contractObligationId &&
          record.eventId === eventId &&
          record.status === "ACTIVE",
      ) ?? null
    );
  }

  async listActiveByIdsForObligation(
    contractObligationId: string,
    linkIds: readonly string[],
  ) {
    const ids = new Set(linkIds);
    return this.records.filter(
      (record) =>
        ids.has(record.id) &&
        record.contractObligationId === contractObligationId &&
        record.status === "ACTIVE",
    );
  }

  async softRemove(
    input: RemoveContractObligationEventEvidenceLinkInput,
  ) {
    const index = this.records.findIndex(
      (record) =>
        record.id === input.linkId &&
        record.status === "ACTIVE",
    );
    if (index < 0) return null;
    const current = this.records[index];
    const updated: ContractObligationEventEvidenceLink = {
      ...current,
      status: "REMOVED",
      removedByActorId: input.removedByActorId,
      removedAt: input.removedAt,
      removeReason: input.removeReason,
      actionHistory: [
        ...current.actionHistory,
        input.action,
      ],
      updatedByActorId: input.updatedByActorId,
      updatedAt: input.updatedAt,
    };
    this.records[index] = updated;
    return updated;
  }
}

class MemoryCodeSequenceRepository {
  async allocateNext() {
    return 1;
  }

  async ensureAtLeast() {}
}
