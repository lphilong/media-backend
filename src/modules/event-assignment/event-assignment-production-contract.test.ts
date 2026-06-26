import assert from "node:assert/strict";
import test from "node:test";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { bindTraceId } from "@core/trace/trace.context";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { EventAssignmentAdminService } from "./admin/admin.event-assignment.service";
import {
  EventAssignmentOverlapConflictError,
  EventAssignmentStateError,
  EventAssignmentValidationError,
} from "./domain/event-assignment.errors";
import {
  EventCompletionEvidenceRef,
  EventRecord,
  StudioBookingRecord,
} from "./domain/event-assignment.types";
import {
  EVENT_COMPLETION_EVIDENCE_NOTE_MAX_LENGTH,
  EVENT_COMPLETION_EVIDENCE_REF_LABEL_MAX_LENGTH,
  EVENT_COMPLETION_EVIDENCE_REF_REFERENCE_ID_MAX_LENGTH,
  EVENT_COMPLETION_EVIDENCE_REF_URL_MAX_LENGTH,
} from "./shared/event-assignment.contracts";

const bridge: AuthoritativeAdminMutationBridge = {
  async execute(_params, mutate) {
    const controls: AuthoritativeMutationControls = {
      markAuthSecurityTruthChanged() {},
      markExplicitNoOpSuccess() {},
    };
    return mutate({} as ClientSession, controls);
  },
};

const audit = { async record() {} } as unknown as AuditGuard;
const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
} as never;

test("Event production contract requires an active EmploymentProfile owner and rejects legacy statuses", async () => {
  await bindTraceId("event-production-owner", async () => {
    const repository = new MemoryEventRepository();
    const service = createService(repository);

    await assert.rejects(
      service.createEvent(actor(), {
        title: "Missing owner",
        ownerEmploymentProfileId: "",
        assignments: [talentAssignment()],
        eventStartAt: 10,
        eventEndAt: 20,
      }),
      EventAssignmentValidationError,
    );
    await assert.rejects(
      service.createEvent(actor(), {
        title: "Legacy",
        ownerEmploymentProfileId: "ep-owner",
        status: "SCHEDULED",
        assignments: [talentAssignment()],
        eventStartAt: 10,
        eventEndAt: 20,
      }),
      EventAssignmentValidationError,
    );

    const created = await service.createEvent(actor(), {
      eventCode: "EVT-PROD-1",
      title: "Production event",
      ownerEmploymentProfileId: "ep-owner",
      status: "PLANNED",
      assignments: [talentAssignment()],
      eventStartAt: 10,
      eventEndAt: 20,
    });

    assert.equal(created.ownerEmploymentProfileId, "ep-owner");
    assert.equal(created.status, "PLANNED");
    assert.deepEqual(created.studioResourceIds, []);
  });
});

test("Event lifecycle is explicit and cancellation requires a reason", async () => {
  await bindTraceId("event-production-lifecycle", async () => {
    const repository = new MemoryEventRepository();
    repository.events.push(eventRecord("event-draft", "DRAFT"));
    repository.events.push(eventRecord("event-planned", "PLANNED"));
    repository.events.push(eventRecord("event-confirmed", "CONFIRMED"));
    const service = createService(repository);

    assert.equal(
      (await service.planEvent(actor(), { eventId: "event-draft" })).status,
      "PLANNED",
    );
    assert.equal(
      (await service.confirmEvent(actor(), { eventId: "event-planned" }))
        .status,
      "CONFIRMED",
    );
    await assert.rejects(
      service.completeEvent(actor(), {
        eventId: "event-confirmed",
        evidenceNote: "",
      }),
      EventAssignmentValidationError,
    );

    const completed = await service.completeEvent(actor(), {
      eventId: "event-confirmed",
      evidenceNote: "Delivered livestream recap and handoff summary.",
      evidenceRefs: [
        {
          type: "URL",
          label: "Delivery evidence",
          url: "https://example.com/evidence/event-confirmed",
        },
        {
          type: "EXTERNAL_REFERENCE",
          label: "Partner ticket",
          referenceId: "EXT-123",
        },
      ],
    });

    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.completedByActorId, "admin-1");
    assert.equal(typeof completed.completedAt, "number");
    assert.equal(
      completed.completionEvidence?.evidenceNote,
      "Delivered livestream recap and handoff summary.",
    );
    assert.deepEqual(
      completed.completionEvidence?.evidenceRefs.map((ref) => ref.type),
      ["URL", "EXTERNAL_REFERENCE"],
    );

    await assert.rejects(
      service.completeEvent(actor(), {
        eventId: "event-draft",
        evidenceNote: "Attempted completion.",
      }),
      EventAssignmentStateError,
    );
    await assert.rejects(
      service.cancelEvent(actor(), {
        eventId: "event-draft",
        reason: "",
      }),
      EventAssignmentValidationError,
    );
  });
});

test("Event completion rejects invalid evidence references and non-CONFIRMED states", async () => {
  await bindTraceId("event-production-completion-evidence", async () => {
    const repository = new MemoryEventRepository();
    for (const status of [
      "DRAFT",
      "PLANNED",
      "CANCELLED",
      "ARCHIVED",
      "COMPLETED",
    ] as const) {
      repository.events.push(
        eventRecord(`event-${status.toLowerCase()}`, status),
      );
    }
    repository.events.push(
      eventRecord("event-confirmed-invalid-ref", "CONFIRMED"),
    );
    const service = createService(repository);

    await assert.rejects(
      service.completeEvent(actor(), {
        eventId: "event-confirmed-invalid-ref",
        evidenceNote: "Delivered",
        evidenceRefs: [
          {
            type: "URL",
            referenceId: "not-a-url",
          },
        ],
      }),
      EventAssignmentValidationError,
    );

    for (const status of [
      "DRAFT",
      "PLANNED",
      "CANCELLED",
      "ARCHIVED",
      "COMPLETED",
    ] as const) {
      await assert.rejects(
        service.completeEvent(actor(), {
          eventId: `event-${status.toLowerCase()}`,
          evidenceNote: "Delivered",
        }),
        EventAssignmentStateError,
      );
    }
  });
});

test("Event completion bounds evidence text fields and keeps completion metadata backend-owned", async () => {
  await bindTraceId("event-production-completion-evidence-bounds", async () => {
    const repository = new MemoryEventRepository();
    for (const id of [
      "event-note-over-limit",
      "event-url-over-limit",
      "event-reference-over-limit",
      "event-label-over-limit",
      "event-boundary-success",
    ]) {
      repository.events.push(eventRecord(id, "CONFIRMED"));
    }
    const service = createService(repository);

    await assert.rejects(
      service.completeEvent(actor(), {
        eventId: "event-note-over-limit",
        evidenceNote: "n".repeat(EVENT_COMPLETION_EVIDENCE_NOTE_MAX_LENGTH + 1),
      }),
      EventAssignmentValidationError,
    );

    await assert.rejects(
      service.completeEvent(actor(), {
        eventId: "event-url-over-limit",
        evidenceNote: "Delivered.",
        evidenceRefs: [
          {
            type: "URL",
            url: makeEvidenceUrl(
              EVENT_COMPLETION_EVIDENCE_REF_URL_MAX_LENGTH + 1,
            ),
          },
        ],
      }),
      EventAssignmentValidationError,
    );

    await assert.rejects(
      service.completeEvent(actor(), {
        eventId: "event-reference-over-limit",
        evidenceNote: "Delivered.",
        evidenceRefs: [
          {
            type: "INTERNAL_REFERENCE",
            referenceId: "r".repeat(
              EVENT_COMPLETION_EVIDENCE_REF_REFERENCE_ID_MAX_LENGTH + 1,
            ),
          },
        ],
      }),
      EventAssignmentValidationError,
    );

    await assert.rejects(
      service.completeEvent(actor(), {
        eventId: "event-label-over-limit",
        evidenceNote: "Delivered.",
        evidenceRefs: [
          {
            type: "EXTERNAL_REFERENCE",
            label: "l".repeat(
              EVENT_COMPLETION_EVIDENCE_REF_LABEL_MAX_LENGTH + 1,
            ),
            referenceId: "EXT-123",
          },
        ],
      }),
      EventAssignmentValidationError,
    );

    const completed = await service.completeEvent(actor(), {
      eventId: "event-boundary-success",
      evidenceNote: "n".repeat(EVENT_COMPLETION_EVIDENCE_NOTE_MAX_LENGTH),
      evidenceRefs: [
        {
          type: "URL",
          label: "l".repeat(EVENT_COMPLETION_EVIDENCE_REF_LABEL_MAX_LENGTH),
          url: makeEvidenceUrl(EVENT_COMPLETION_EVIDENCE_REF_URL_MAX_LENGTH),
        },
        {
          type: "INTERNAL_REFERENCE",
          referenceId: "r".repeat(
            EVENT_COMPLETION_EVIDENCE_REF_REFERENCE_ID_MAX_LENGTH,
          ),
        },
      ],
      completedAt: 1,
      completedByActorId: "payload-actor",
    } as never);

    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.completedByActorId, "admin-1");
    assert.notEqual(completed.completedAt, 1);
    assert.equal(typeof completed.completedAt, "number");
    assert.equal(
      completed.completionEvidence?.evidenceNote?.length,
      EVENT_COMPLETION_EVIDENCE_NOTE_MAX_LENGTH,
    );
    assert.equal(
      completed.completionEvidence?.evidenceRefs[0]?.label?.length,
      EVENT_COMPLETION_EVIDENCE_REF_LABEL_MAX_LENGTH,
    );
    assert.equal(
      completed.completionEvidence?.evidenceRefs[0]?.url?.length,
      EVENT_COMPLETION_EVIDENCE_REF_URL_MAX_LENGTH,
    );
    assert.equal(
      completed.completionEvidence?.evidenceRefs[1]?.referenceId?.length,
      EVENT_COMPLETION_EVIDENCE_REF_REFERENCE_ID_MAX_LENGTH,
    );
  });
});

test("HELD bookings report confirmed conflicts while CONFIRMED bookings block overlap", async () => {
  await bindTraceId("event-production-booking", async () => {
    const repository = new MemoryEventRepository();
    repository.events.push(eventRecord("event-planned", "PLANNED"));
    repository.events.push(eventRecord("event-confirmed", "CONFIRMED"));
    repository.overlap = true;
    const service = createService(repository);

    const held = await service.createStudioBooking(actor(), {
      eventId: "event-planned",
      studioResourceId: "studio-1",
      bookingStartAt: 10,
      bookingEndAt: 20,
      status: "HELD",
    });
    assert.equal(held.status, "HELD");
    assert.equal(held.hasConfirmedConflict, true);

    await assert.rejects(
      service.createStudioBooking(actor(), {
        eventId: "event-confirmed",
        studioResourceId: "studio-1",
        bookingStartAt: 10,
        bookingEndAt: 20,
        status: "CONFIRMED",
      }),
      EventAssignmentOverlapConflictError,
    );
  });
});

function createService(repository: MemoryEventRepository) {
  return new EventAssignmentAdminService(
    repository as never,
    {
      async allocateNext() {
        return 1;
      },
      async ensureAtLeast() {},
    } as never,
    {
      async findById(id: string) {
        return {
          id,
          employmentStatus: id === "ep-inactive" ? "INACTIVE" : "ACTIVE",
        };
      },
    } as never,
    {
      async findById(id: string) {
        return { id, operationalStatus: "ACTIVE" };
      },
    } as never,
    {
      async findById(id: string) {
        return { id, status: "ACTIVE" };
      },
    } as never,
    {
      async findById(id: string) {
        return { id, operationalStatus: "ACTIVE" };
      },
    } as never,
    {
      async findById(id: string) {
        return {
          id,
          operationalStatus: "ACTIVE",
          livestreamEnabled: true,
          contentPublishingEnabled: true,
        };
      },
    } as never,
    audit,
    bridge,
    createStructuredAuthority(),
    logger,
  );
}

function createStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(userId: string) {
      if (userId !== "admin-1") {
        return [];
      }
      return [
        {
          assignment: {
            assignmentId: "event-assignment-scope",
            roleId: "event-role",
            userId,
            structuredScopeGrants: [
              { scopeType: "assignedEvent", targetId: "event-draft" },
              { scopeType: "assignedEvent", targetId: "event-planned" },
              { scopeType: "assignedEvent", targetId: "event-confirmed" },
              {
                scopeType: "assignedEvent",
                targetId: "event-confirmed-invalid-ref",
              },
              { scopeType: "assignedEvent", targetId: "event-cancelled" },
              { scopeType: "assignedEvent", targetId: "event-archived" },
              { scopeType: "assignedEvent", targetId: "event-completed" },
              {
                scopeType: "assignedEvent",
                targetId: "event-note-over-limit",
              },
              {
                scopeType: "assignedEvent",
                targetId: "event-url-over-limit",
              },
              {
                scopeType: "assignedEvent",
                targetId: "event-reference-over-limit",
              },
              {
                scopeType: "assignedEvent",
                targetId: "event-label-over-limit",
              },
              {
                scopeType: "assignedEvent",
                targetId: "event-boundary-success",
              },
              { scopeType: "assignedStudioResource", targetId: "studio-1" },
            ],
            state: "ACTIVE",
            effectiveAt: 0,
            expiresAt: null,
            revokedAt: null,
            reason: null,
            createdAt: 0,
            updatedAt: 0,
          },
          role: {
            id: "event-role",
            state: "ACTIVE",
            permissions: [
              "event.update",
              "event.manageAssignments",
              "event.manageLifecycle",
            ],
          },
        },
      ];
    },
  });
}

function actor(): Actor {
  return new Actor({
    id: "admin-1",
    type: "admin",
    context: "ADMIN",
    accountContexts: ["ADMIN_CONSOLE"],
    roles: [],
    permissions: [
      "event.create",
      "event.update",
      "event.manageAssignments",
      "event.manageLifecycle",
    ],
    scopeGrants: { eventAssignment: ["global"] },
    isActive: true,
  });
}

function talentAssignment() {
  return {
    assignmentKind: "TALENT" as const,
    assignmentTalentId: "talent-1",
  };
}

function eventRecord(id: string, status: EventRecord["status"]): EventRecord {
  return {
    id,
    eventCode: id.toUpperCase(),
    title: id,
    normalizedTitle: id,
    ownerEmploymentProfileId: "ep-owner",
    studioResourceIds: [],
    platformAccountIds: [],
    status,
    eventStartAt: 10,
    eventEndAt: 20,
    description: null,
    externalRef: null,
    createdByActorId: "admin-1",
    updatedByActorId: "admin-1",
    plannedAt: status === "PLANNED" ? 1 : null,
    plannedByActorId: status === "PLANNED" ? "admin-1" : null,
    confirmedAt: status === "CONFIRMED" ? 1 : null,
    confirmedByActorId: status === "CONFIRMED" ? "admin-1" : null,
    completedAt: status === "COMPLETED" ? 1 : null,
    completedByActorId: status === "COMPLETED" ? "admin-1" : null,
    completionEvidenceNote:
      status === "COMPLETED" ? "Already delivered." : null,
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

function makeEvidenceUrl(length: number): string {
  const prefix = "https://example.com/";
  return `${prefix}${"a".repeat(length - prefix.length)}`;
}

class MemoryEventRepository {
  readonly events: EventRecord[] = [];
  readonly bookings: StudioBookingRecord[] = [];
  overlap = false;

  async findEventById(id: string) {
    return this.events.find((item) => item.id === id) ?? null;
  }
  async findEventByEventCode(code: string) {
    return this.events.find((item) => item.eventCode === code) ?? null;
  }
  async findMaxGeneratedEventCodeSequence() {
    return 0;
  }
  async insertEvent(event: EventRecord) {
    this.events.push(event);
    return event;
  }
  async insertAssignments() {
    return [];
  }
  async listAssignmentsByEventId() {
    return [
      {
        id: "assignment-1",
        eventId: "event",
        assignmentKind: "TALENT",
        assignmentEmploymentProfileId: null,
        assignmentTalentId: "talent-1",
        assignmentTalentGroupId: null,
        assignmentStatus: "ACTIVE",
        createdAt: 1,
        updatedAt: 1,
        removedAt: null,
      },
    ];
  }
  async hasLiveOverlappingAssignmentEvent() {
    return false;
  }
  async hasLiveOverlappingPlatformEvent() {
    return false;
  }
  async transitionEventStatus(input: {
    eventId: string;
    toStatus: EventRecord["status"];
    updatedAt: number;
    actorId: string;
    reason?: string;
    completionEvidenceNote?: string;
    completionEvidenceRefs?: readonly EventCompletionEvidenceRef[];
  }) {
    const index = this.events.findIndex((item) => item.id === input.eventId);
    if (index < 0) return null;
    const updated: EventRecord = {
      ...this.events[index],
      status: input.toStatus,
      updatedAt: input.updatedAt,
      updatedByActorId: input.actorId,
      completedAt:
        input.toStatus === "COMPLETED"
          ? input.updatedAt
          : this.events[index].completedAt,
      completedByActorId:
        input.toStatus === "COMPLETED"
          ? input.actorId
          : this.events[index].completedByActorId,
      completionEvidenceNote:
        input.toStatus === "COMPLETED"
          ? (input.completionEvidenceNote ?? null)
          : this.events[index].completionEvidenceNote,
      completionEvidenceRefs:
        input.toStatus === "COMPLETED"
          ? [...(input.completionEvidenceRefs ?? [])]
          : this.events[index].completionEvidenceRefs,
      cancellationReason:
        input.toStatus === "CANCELLED"
          ? (input.reason ?? null)
          : this.events[index].cancellationReason,
    };
    this.events[index] = updated;
    return updated;
  }
  async listStudioBookingsByEventId(eventId: string) {
    return this.bookings.filter((item) => item.eventId === eventId);
  }
  async transitionStudioBookingsByEvent() {}
  async hasOverlappingStudioBooking() {
    return this.overlap;
  }
  async lockStudioResourceBooking() {}
  async insertStudioBooking(booking: StudioBookingRecord) {
    this.bookings.push(booking);
    return booking;
  }
  async syncEventStudioResourceIdsFromBookings(eventId: string) {
    return this.findEventById(eventId);
  }
}
