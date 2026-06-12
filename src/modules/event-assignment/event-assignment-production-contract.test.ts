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
import { EventAssignmentAdminService } from "./admin/admin.event-assignment.service";
import {
  EventAssignmentOverlapConflictError,
  EventAssignmentStateError,
  EventAssignmentValidationError,
} from "./domain/event-assignment.errors";
import {
  EventRecord,
  StudioBookingRecord,
} from "./domain/event-assignment.types";

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
    assert.equal(
      (await service.completeEvent(actor(), { eventId: "event-confirmed" }))
        .status,
      "COMPLETED",
    );
    await assert.rejects(
      service.completeEvent(actor(), { eventId: "event-draft" }),
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
    { async findById(id: string) { return { id, status: "ACTIVE" }; } } as never,
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
    logger,
  );
}

function actor(): Actor {
  return new Actor({
    id: "admin-1",
    type: "admin",
    context: "ADMIN",
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

function eventRecord(
  id: string,
  status: EventRecord["status"],
): EventRecord {
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
    completedAt: null,
    completedByActorId: null,
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
  }) {
    const index = this.events.findIndex((item) => item.id === input.eventId);
    if (index < 0) return null;
    const updated: EventRecord = {
      ...this.events[index],
      status: input.toStatus,
      updatedAt: input.updatedAt,
      updatedByActorId: input.actorId,
      cancellationReason:
        input.toStatus === "CANCELLED"
          ? input.reason ?? null
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
