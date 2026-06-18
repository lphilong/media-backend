import assert from "node:assert/strict";
import test from "node:test";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { EventAssignmentAdminService } from "@modules/event-assignment/admin/admin.event-assignment.service";
import { EventAssignmentPermissionScopeError } from "@modules/event-assignment/domain/event-assignment.errors";
import {
  EventRecord,
  StudioBookingRecord,
} from "@modules/event-assignment/domain/event-assignment.types";
import { PlatformAccountAdminQueryService } from "@modules/platform-account/admin/admin.platform-account.query-service";
import { PlatformAccountAdminService } from "@modules/platform-account/admin/admin.platform-account.service";
import { PlatformAccountPermissionScopeError } from "@modules/platform-account/domain/platform-account.errors";
import {
  PlatformAccountRecord,
  PlatformAccountDetailView,
} from "@modules/platform-account/domain/platform-account.types";
import { StudioResourceAdminQueryService } from "@modules/studio-resource/admin/admin.studio-resource.query-service";
import { StudioResourceAdminService } from "@modules/studio-resource/admin/admin.studio-resource.service";
import { StudioResourcePermissionScopeError } from "@modules/studio-resource/domain/studio-resource.errors";
import {
  StudioResourceDetailView,
  StudioResourceRecord,
} from "@modules/studio-resource/domain/studio-resource.types";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityService,
} from "@modules/role/domain/structured-scope-authority";
import { RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";

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

test("Studio Resource exact detail and update require assignedStudioResource", async () => {
  await bindTraceId("auth-3c-4-studio", async () => {
    const repository = new MemoryStudioResourceRepository([
      studioResource("studio-1"),
    ]);
    const authority = structuredAuthority([
      assignment(
        [Permission.STUDIO_RESOURCE_READ],
        [{ scopeType: "assignedStudioResource", targetId: "studio-1" }],
      ),
      assignment(
        [Permission.STUDIO_RESOURCE_UPDATE],
        [{ scopeType: "assignedStudioResource", targetId: "studio-1" }],
      ),
    ]);
    const queryService = new StudioResourceAdminQueryService(
      repository,
      authority,
    );
    const service = createStudioResourceService(repository, authority);

    assert.equal(
      (
        await queryService.getStudioResourceDetail(actor(), {
          studioResourceId: "studio-1",
        })
      ).id,
      "studio-1",
    );
    assert.equal(
      (
        await service.updateStudioResourceCore(actor(), {
          studioResourceId: "studio-1",
          name: "Updated Studio",
        })
      ).name,
      "Updated Studio",
    );

    const denied = new StudioResourceAdminQueryService(
      repository,
      structuredAuthority([
        assignment(
          [Permission.STUDIO_RESOURCE_READ],
          [{ scopeType: "assignedStudioResource", targetId: "studio-other" }],
        ),
      ]),
    );
    await assert.rejects(
      denied.getStudioResourceDetail(actor(), {
        studioResourceId: "studio-1",
      }),
      StudioResourcePermissionScopeError,
    );
  });
});

test("Studio Resource permission without matching scope and scope without permission deny", async () => {
  await bindTraceId("auth-3c-4-studio-deny", async () => {
    const repository = new MemoryStudioResourceRepository([
      studioResource("studio-1"),
    ]);

    await assert.rejects(
      createStudioResourceService(
        repository,
        structuredAuthority([
          assignment(
            [Permission.STUDIO_RESOURCE_UPDATE],
            [{ scopeType: "assignedStudioResource", targetId: "studio-other" }],
          ),
        ]),
      ).updateStudioResourceCore(actor(), {
        studioResourceId: "studio-1",
        name: "Denied",
      }),
      StudioResourcePermissionScopeError,
    );

    await assert.rejects(
      createStudioResourceService(
        repository,
        structuredAuthority([
          assignment(
            [Permission.STUDIO_RESOURCE_READ],
            [{ scopeType: "assignedStudioResource", targetId: "studio-1" }],
          ),
        ]),
      ).updateStudioResourceCore(actor(), {
        studioResourceId: "studio-1",
        name: "Denied",
      }),
      StudioResourcePermissionScopeError,
    );
  });
});

test("Platform Account exact detail update and capabilities require assignedPlatformAccount", async () => {
  await bindTraceId("auth-3c-4-platform", async () => {
    const repository = new MemoryPlatformAccountRepository([
      platformAccount("platform-1"),
    ]);
    const authority = structuredAuthority([
      assignment(
        [Permission.PLATFORM_ACCOUNT_READ],
        [{ scopeType: "assignedPlatformAccount", targetId: "platform-1" }],
      ),
      assignment(
        [Permission.PLATFORM_ACCOUNT_UPDATE],
        [{ scopeType: "assignedPlatformAccount", targetId: "platform-1" }],
      ),
      assignment(
        [Permission.PLATFORM_ACCOUNT_MANAGE_CAPABILITIES],
        [{ scopeType: "assignedPlatformAccount", targetId: "platform-1" }],
      ),
    ]);
    const queryService = new PlatformAccountAdminQueryService(
      repository,
      authority,
    );
    const service = createPlatformAccountService(repository, authority);

    assert.equal(
      (
        await queryService.getPlatformAccountDetail(actor(), {
          platformAccountId: "platform-1",
        })
      ).id,
      "platform-1",
    );
    assert.equal(
      (
        await service.updatePlatformAccountCore(actor(), {
          platformAccountId: "platform-1",
          displayName: "Updated Channel",
        })
      ).displayName,
      "Updated Channel",
    );
    const capabilities = await service.updatePlatformAccountCapabilities(
      actor(),
      {
        platformAccountId: "platform-1",
        livestreamEnabled: true,
        contentPublishingEnabled: false,
        monetizationEnabled: false,
      },
    );
    assert.equal(capabilities.contentPublishingEnabled, false);
    assert.equal(capabilities.monetizationEnabled, false);

    const denied = new PlatformAccountAdminQueryService(
      repository,
      structuredAuthority([
        assignment(
          [Permission.PLATFORM_ACCOUNT_READ],
          [
            {
              scopeType: "assignedPlatformAccount",
              targetId: "platform-other",
            },
          ],
        ),
      ]),
    );
    await assert.rejects(
      denied.getPlatformAccountDetail(actor(), {
        platformAccountId: "platform-1",
      }),
      PlatformAccountPermissionScopeError,
    );
  });
});

test("Platform Account permission without matching scope and scope without permission deny", async () => {
  await bindTraceId("auth-3c-4-platform-deny", async () => {
    const repository = new MemoryPlatformAccountRepository([
      platformAccount("platform-1"),
    ]);

    await assert.rejects(
      createPlatformAccountService(
        repository,
        structuredAuthority([
          assignment(
            [Permission.PLATFORM_ACCOUNT_UPDATE],
            [
              {
                scopeType: "assignedPlatformAccount",
                targetId: "platform-other",
              },
            ],
          ),
        ]),
      ).updatePlatformAccountCore(actor(), {
        platformAccountId: "platform-1",
        displayName: "Denied",
      }),
      PlatformAccountPermissionScopeError,
    );

    await assert.rejects(
      createPlatformAccountService(
        repository,
        structuredAuthority([
          assignment(
            [Permission.PLATFORM_ACCOUNT_READ],
            [{ scopeType: "assignedPlatformAccount", targetId: "platform-1" }],
          ),
        ]),
      ).updatePlatformAccountCore(actor(), {
        platformAccountId: "platform-1",
        displayName: "Denied",
      }),
      PlatformAccountPermissionScopeError,
    );
  });
});

test("Event mutation allows exact assignedEvent and denies mismatched or legacy global scope", async () => {
  await bindTraceId("auth-3c-4-event-mutation", async () => {
    const repository = new MemoryEventRepository([
      eventRecord("event-1", "DRAFT"),
    ]);
    const allowed = createEventService(
      repository,
      structuredAuthority([
        assignment(
          [Permission.EVENT_UPDATE],
          [{ scopeType: "assignedEvent", targetId: "event-1" }],
        ),
      ]),
    );

    assert.equal(
      (
        await allowed.updateEventCore(actor(), {
          eventId: "event-1",
          title: "Updated Event",
        })
      ).title,
      "Updated Event",
    );

    for (const authority of [
      structuredAuthority([
        assignment(
          [Permission.EVENT_UPDATE],
          [{ scopeType: "assignedEvent", targetId: "event-other" }],
        ),
      ]),
      legacyGlobalAuthority([Permission.EVENT_UPDATE]),
    ]) {
      await assert.rejects(
        createEventService(repository, authority).updateEventCore(actor(), {
          eventId: "event-1",
          title: "Denied Event",
        }),
        EventAssignmentPermissionScopeError,
      );
    }
  });
});

test("Event booking mutation requires exact assignedEvent and assignedStudioResource", async () => {
  await bindTraceId("auth-3c-4-event-booking", async () => {
    const repository = new MemoryEventRepository([
      eventRecord("event-booking", "PLANNED"),
    ]);
    const allowed = createEventService(
      repository,
      structuredAuthority([
        assignment(
          [Permission.EVENT_UPDATE],
          [
            { scopeType: "assignedEvent", targetId: "event-booking" },
            {
              scopeType: "assignedStudioResource",
              targetId: "studio-booking",
            },
          ],
        ),
      ]),
    );

    assert.equal(
      (
        await allowed.createStudioBooking(actor(), {
          eventId: "event-booking",
          studioResourceId: "studio-booking",
          bookingStartAt: 10,
          bookingEndAt: 20,
          status: "HELD",
        })
      ).status,
      "HELD",
    );

    for (const authority of [
      structuredAuthority([
        assignment(
          [Permission.EVENT_UPDATE],
          [{ scopeType: "assignedEvent", targetId: "event-booking" }],
        ),
      ]),
      structuredAuthority([
        assignment(
          [Permission.EVENT_UPDATE],
          [
            { scopeType: "assignedEvent", targetId: "event-booking" },
            {
              scopeType: "assignedStudioResource",
              targetId: "studio-other",
            },
          ],
        ),
      ]),
      legacyGlobalAuthority([Permission.EVENT_UPDATE]),
    ]) {
      await assert.rejects(
        createEventService(repository, authority).createStudioBooking(actor(), {
          eventId: "event-booking",
          studioResourceId: "studio-booking",
          bookingStartAt: 30,
          bookingEndAt: 40,
          status: "HELD",
        }),
        EventAssignmentPermissionScopeError,
      );
    }
  });
});

test("Event platform replacement requires assignedPlatformAccount for every target", async () => {
  await bindTraceId("auth-3c-4-event-platforms", async () => {
    const repository = new MemoryEventRepository([
      eventRecord("event-platforms", "DRAFT"),
    ]);
    const allowed = createEventService(
      repository,
      structuredAuthority([
        assignment(
          [Permission.EVENT_UPDATE],
          [
            { scopeType: "assignedEvent", targetId: "event-platforms" },
            {
              scopeType: "assignedPlatformAccount",
              targetId: "platform-1",
            },
            {
              scopeType: "assignedPlatformAccount",
              targetId: "platform-2",
            },
          ],
        ),
      ]),
    );

    assert.deepEqual(
      (
        await allowed.updateEventPlatformAccounts(actor(), {
          eventId: "event-platforms",
          newPlatformAccountIds: ["platform-1", "platform-2"],
        })
      ).platformAccountIds,
      ["platform-1", "platform-2"],
    );

    const oneMissing = createEventService(
      repository,
      structuredAuthority([
        assignment(
          [Permission.EVENT_UPDATE],
          [
            { scopeType: "assignedEvent", targetId: "event-platforms" },
            {
              scopeType: "assignedPlatformAccount",
              targetId: "platform-1",
            },
          ],
        ),
      ]),
    );
    await assert.rejects(
      oneMissing.updateEventPlatformAccounts(actor(), {
        eventId: "event-platforms",
        newPlatformAccountIds: ["platform-1", "platform-3"],
      }),
      EventAssignmentPermissionScopeError,
    );
    assert.deepEqual(
      (await repository.findEventById("event-platforms"))?.platformAccountIds,
      ["platform-1", "platform-2"],
    );

    await assert.rejects(
      createEventService(
        repository,
        legacyGlobalAuthority([Permission.EVENT_UPDATE]),
      ).updateEventPlatformAccounts(actor(), {
        eventId: "event-platforms",
        newPlatformAccountIds: ["platform-1"],
      }),
      EventAssignmentPermissionScopeError,
    );
  });
});

test("Studio Resource availability and lifecycle require exact assignedStudioResource", async () => {
  await bindTraceId("auth-3c-4-studio-transitions", async () => {
    const repository = new MemoryStudioResourceRepository([
      studioResource("studio-availability"),
      studioResource("studio-lifecycle"),
    ]);
    const allowed = createStudioResourceService(
      repository,
      structuredAuthority([
        assignment(
          [
            Permission.STUDIO_RESOURCE_MANAGE_AVAILABILITY,
            Permission.STUDIO_RESOURCE_MANAGE_LIFECYCLE,
          ],
          [
            {
              scopeType: "assignedStudioResource",
              targetId: "studio-availability",
            },
            {
              scopeType: "assignedStudioResource",
              targetId: "studio-lifecycle",
            },
          ],
        ),
      ]),
    );

    assert.equal(
      (
        await allowed.markStudioResourceOutOfService(actor(), {
          studioResourceId: "studio-availability",
        })
      ).operationalStatus,
      "OUT_OF_SERVICE",
    );
    assert.equal(
      (
        await allowed.deactivateStudioResource(actor(), {
          studioResourceId: "studio-lifecycle",
        })
      ).operationalStatus,
      "INACTIVE",
    );

    await assert.rejects(
      createStudioResourceService(
        repository,
        structuredAuthority([
          assignment(
            [Permission.STUDIO_RESOURCE_MANAGE_AVAILABILITY],
            [
              {
                scopeType: "assignedStudioResource",
                targetId: "studio-other",
              },
            ],
          ),
        ]),
      ).restoreStudioResourceToActive(actor(), {
        studioResourceId: "studio-availability",
      }),
      StudioResourcePermissionScopeError,
    );
    await assert.rejects(
      createStudioResourceService(
        repository,
        structuredAuthority([
          assignment(
            [Permission.STUDIO_RESOURCE_MANAGE_LIFECYCLE],
            [
              {
                scopeType: "assignedStudioResource",
                targetId: "studio-other",
              },
            ],
          ),
        ]),
      ).activateStudioResource(actor(), {
        studioResourceId: "studio-lifecycle",
      }),
      StudioResourcePermissionScopeError,
    );
    await assert.rejects(
      createStudioResourceService(
        repository,
        legacyGlobalAuthority([
          Permission.STUDIO_RESOURCE_MANAGE_AVAILABILITY,
        ]),
      ).restoreStudioResourceToActive(actor(), {
        studioResourceId: "studio-availability",
      }),
      StudioResourcePermissionScopeError,
    );
  });
});

test("Platform Account ownership and lifecycle require exact assignedPlatformAccount", async () => {
  await bindTraceId("auth-3c-4-platform-transitions", async () => {
    const repository = new MemoryPlatformAccountRepository([
      platformAccount("platform-owner"),
      platformAccount("platform-lifecycle"),
    ]);
    const allowed = createPlatformAccountService(
      repository,
      structuredAuthority([
        assignment(
          [
            Permission.PLATFORM_ACCOUNT_MANAGE_OWNERSHIP,
            Permission.PLATFORM_ACCOUNT_MANAGE_LIFECYCLE,
          ],
          [
            {
              scopeType: "assignedPlatformAccount",
              targetId: "platform-owner",
            },
            {
              scopeType: "assignedPlatformAccount",
              targetId: "platform-lifecycle",
            },
          ],
        ),
      ]),
    );

    assert.equal(
      (
        await allowed.transferPlatformAccountOwnership(actor(), {
          platformAccountId: "platform-owner",
          ownerKind: "TALENT",
          ownerTalentId: "talent-2",
        })
      ).ownerTalentId,
      "talent-2",
    );
    assert.equal(
      (
        await allowed.deactivatePlatformAccount(actor(), {
          platformAccountId: "platform-lifecycle",
        })
      ).operationalStatus,
      "INACTIVE",
    );

    await assert.rejects(
      createPlatformAccountService(
        repository,
        structuredAuthority([
          assignment(
            [Permission.PLATFORM_ACCOUNT_MANAGE_OWNERSHIP],
            [
              {
                scopeType: "assignedPlatformAccount",
                targetId: "platform-other",
              },
            ],
          ),
        ]),
      ).transferPlatformAccountOwnership(actor(), {
        platformAccountId: "platform-owner",
        ownerKind: "TALENT_GROUP",
        ownerTalentGroupId: "group-2",
      }),
      PlatformAccountPermissionScopeError,
    );
    await assert.rejects(
      createPlatformAccountService(
        repository,
        structuredAuthority([
          assignment(
            [Permission.PLATFORM_ACCOUNT_MANAGE_LIFECYCLE],
            [
              {
                scopeType: "assignedPlatformAccount",
                targetId: "platform-other",
              },
            ],
          ),
        ]),
      ).activatePlatformAccount(actor(), {
        platformAccountId: "platform-lifecycle",
      }),
      PlatformAccountPermissionScopeError,
    );
    await assert.rejects(
      createPlatformAccountService(
        repository,
        legacyGlobalAuthority([
          Permission.PLATFORM_ACCOUNT_MANAGE_OWNERSHIP,
        ]),
      ).transferPlatformAccountOwnership(actor(), {
        platformAccountId: "platform-owner",
        ownerKind: "TALENT_GROUP",
        ownerTalentGroupId: "group-2",
      }),
      PlatformAccountPermissionScopeError,
    );
  });
});

function actor(): Actor {
  return new Actor({
    id: "admin-1",
    type: "admin",
    context: "ADMIN",
    roles: ["ADMIN_FULL"],
    permissions: [
      Permission.STUDIO_RESOURCE_READ,
      Permission.STUDIO_RESOURCE_UPDATE,
      Permission.STUDIO_RESOURCE_MANAGE_AVAILABILITY,
      Permission.STUDIO_RESOURCE_MANAGE_LIFECYCLE,
      Permission.PLATFORM_ACCOUNT_READ,
      Permission.PLATFORM_ACCOUNT_UPDATE,
      Permission.PLATFORM_ACCOUNT_MANAGE_OWNERSHIP,
      Permission.PLATFORM_ACCOUNT_MANAGE_LIFECYCLE,
      Permission.PLATFORM_ACCOUNT_MANAGE_CAPABILITIES,
      Permission.EVENT_UPDATE,
    ],
    scopeGrants: {
      eventAssignment: ["global"],
      workSchedule: ["global"],
    },
    isActive: true,
  });
}

function legacyGlobalAuthority(
  permissions: readonly Permission[],
): StructuredScopeAuthorityService {
  return structuredAuthority([
    assignment(permissions, [{ scopeType: "global" }]),
  ]);
}

function structuredAuthority(
  records: readonly StructuredScopeAuthorityAssignment[],
): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(userId: string) {
      return records.filter((record) => record.assignment.userId === userId);
    },
  });
}

function assignment(
  permissions: readonly string[],
  structuredScopeGrants: readonly RoleAssignmentScopeGrant[],
): StructuredScopeAuthorityAssignment {
  return {
    assignment: {
      assignmentId: cryptoSafeId(permissions.join(":")),
      roleId: cryptoSafeId(`role:${permissions.join(":")}`),
      userId: "admin-1",
      structuredScopeGrants,
      state: "ACTIVE",
      effectiveAt: 0,
      expiresAt: null,
      revokedAt: null,
      reason: null,
      createdAt: 0,
      updatedAt: 0,
    },
    role: {
      id: cryptoSafeId(`role:${permissions.join(":")}`),
      state: "ACTIVE",
      permissions,
    },
  };
}

function createStudioResourceService(
  repository: MemoryStudioResourceRepository,
  authority: StructuredScopeAuthorityService,
): StudioResourceAdminService {
  return new StudioResourceAdminService(
    repository,
    businessCodeSequenceRepository(),
    {
      async hasLiveScheduledShiftForStudioResource() {
        return false;
      },
    },
    {
      async hasLiveEventAllocationForStudioResource() {
        return false;
      },
    },
    audit,
    bridge,
    authority,
    logger,
  );
}

function createEventService(
  repository: MemoryEventRepository,
  authority: StructuredScopeAuthorityService,
): EventAssignmentAdminService {
  return new EventAssignmentAdminService(
    repository as never,
    businessCodeSequenceRepository(),
    {
      async findById(id: string) {
        return { id, employmentStatus: "ACTIVE" };
      },
    },
    {
      async findById(id: string) {
        return { id, operationalStatus: "ACTIVE" };
      },
    },
    {
      async findById(id: string) {
        return { id, status: "ACTIVE" };
      },
    },
    {
      async findById(id: string) {
        return { id, operationalStatus: "ACTIVE" };
      },
    },
    {
      async findById(id: string) {
        return {
          id,
          operationalStatus: "ACTIVE",
          livestreamEnabled: true,
          contentPublishingEnabled: true,
        };
      },
    },
    audit,
    bridge,
    authority,
    logger,
  );
}

function createPlatformAccountService(
  repository: MemoryPlatformAccountRepository,
  authority: StructuredScopeAuthorityService,
): PlatformAccountAdminService {
  return new PlatformAccountAdminService(
    repository,
    businessCodeSequenceRepository(),
    {
      async findById(id: string) {
        return { id, status: "ACTIVE" };
      },
    },
    {
      async findById(id: string) {
        return { id, operationalStatus: "ACTIVE" };
      },
    },
    {
      async findById(id: string) {
        return { id, status: "ACTIVE" };
      },
    },
    {
      async hasLiveEventAllocationForPlatformAccount() {
        return false;
      },
    },
    audit,
    bridge,
    authority,
    logger,
  );
}

function businessCodeSequenceRepository() {
  return {
    async allocateNext() {
      return 1;
    },
    async ensureAtLeast() {},
  } as never;
}

function studioResource(id: string): StudioResourceRecord {
  return {
    id,
    resourceCode: "SR-1",
    name: "Main Studio",
    normalizedName: "main studio",
    shortName: null,
    normalizedShortName: null,
    resourceClass: "SPACE",
    operationalStatus: "ACTIVE",
    locationLabel: null,
    description: null,
    externalRef: null,
    maxOccupancy: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function platformAccount(id: string): PlatformAccountRecord {
  return {
    id,
    accountCode: "PA-1",
    platform: "TIKTOK",
    platformSurfaceType: "ACCOUNT",
    displayName: "Main Channel",
    normalizedDisplayName: "main channel",
    handle: "@main",
    normalizedHandle: "main",
    externalPlatformId: null,
    profileUrl: null,
    normalizedProfileUrl: null,
    ownerKind: "TALENT_GROUP",
    ownerOrgUnitId: null,
    ownerTalentId: null,
    ownerTalentGroupId: "group-1",
    operationalStatus: "ACTIVE",
    livestreamEnabled: true,
    contentPublishingEnabled: true,
    monetizationEnabled: true,
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function eventRecord(id: string, status: EventRecord["status"]): EventRecord {
  return {
    id,
    eventCode: id.toUpperCase(),
    title: "Event",
    normalizedTitle: "event",
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

class MemoryEventRepository {
  readonly bookings: StudioBookingRecord[] = [];

  constructor(private readonly events: EventRecord[]) {}

  async findEventById(id: string) {
    return this.events.find((record) => record.id === id) ?? null;
  }

  async updateEventCore(input: {
    eventId: string;
    title?: string;
    normalizedTitle?: string;
    updatedByActorId: string;
    updatedAt: number;
  }) {
    const index = this.events.findIndex((record) => record.id === input.eventId);
    if (index < 0) return null;
    this.events[index] = {
      ...this.events[index],
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.normalizedTitle === undefined
        ? {}
        : { normalizedTitle: input.normalizedTitle }),
      updatedByActorId: input.updatedByActorId,
      updatedAt: input.updatedAt,
    };
    return this.events[index];
  }

  async hasLiveOverlappingPlatformEvent() {
    return false;
  }

  async replaceEventPlatformAccounts(input: {
    eventId: string;
    platformAccountIds: readonly string[];
    updatedAt: number;
  }) {
    const index = this.events.findIndex((record) => record.id === input.eventId);
    if (index < 0) return null;
    this.events[index] = {
      ...this.events[index],
      platformAccountIds: [...input.platformAccountIds],
      updatedAt: input.updatedAt,
    };
    return this.events[index];
  }

  async lockStudioResourceBooking() {}

  async hasOverlappingStudioBooking() {
    return false;
  }

  async insertStudioBooking(booking: StudioBookingRecord) {
    this.bookings.push(booking);
    return booking;
  }

  async syncEventStudioResourceIdsFromBookings(eventId: string) {
    return this.findEventById(eventId);
  }
}

class MemoryStudioResourceRepository {
  constructor(private readonly records: StudioResourceRecord[]) {}

  async insert(record: StudioResourceRecord) {
    this.records.push(record);
    return record;
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findByResourceCode() {
    return null;
  }

  async findMaxGeneratedCodeSequence() {
    return 0;
  }

  async updateCore(input: { studioResourceId: string; name?: string }) {
    const index = this.records.findIndex(
      (record) => record.id === input.studioResourceId,
    );
    if (index < 0) return null;
    this.records[index] = {
      ...this.records[index],
      ...(input.name
        ? { name: input.name, normalizedName: "updated studio" }
        : {}),
      updatedAt: Date.now(),
    };
    return this.records[index];
  }

  async transitionOperationalStatus(input: {
    studioResourceId: string;
    toStatus: StudioResourceRecord["operationalStatus"];
  }) {
    const index = this.records.findIndex(
      (record) => record.id === input.studioResourceId,
    );
    if (index < 0) return null;
    this.records[index] = {
      ...this.records[index],
      operationalStatus: input.toStatus,
      updatedAt: Date.now(),
    };
    return this.records[index];
  }

  async listStudioResources() {
    return { items: this.records.map(toStudioDetail) };
  }

  async listStudioResourceAvailability() {
    return { items: this.records.map(toStudioDetail) };
  }

  async getStudioResourceDetail(id: string) {
    const record = await this.findById(id);
    return record ? toStudioDetail(record) : null;
  }
}

class MemoryPlatformAccountRepository {
  constructor(private readonly records: PlatformAccountRecord[]) {}

  async insert(record: PlatformAccountRecord) {
    this.records.push(record);
    return record;
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findByAccountCode() {
    return null;
  }

  async findMaxGeneratedCodeSequence() {
    return 0;
  }

  async findLiveByPlatformAndNormalizedHandle() {
    return null;
  }

  async findLiveByPlatformAndExternalPlatformId() {
    return null;
  }

  async findLiveByPlatformAndNormalizedProfileUrl() {
    return null;
  }

  async updateCore(input: { platformAccountId: string; displayName?: string }) {
    const index = this.records.findIndex(
      (record) => record.id === input.platformAccountId,
    );
    if (index < 0) return null;
    this.records[index] = {
      ...this.records[index],
      ...(input.displayName
        ? { displayName: input.displayName, normalizedDisplayName: "updated" }
        : {}),
      updatedAt: Date.now(),
    };
    return this.records[index];
  }

  async transferOwnership(input: {
    platformAccountId: string;
    ownerKind: PlatformAccountRecord["ownerKind"];
    ownerOrgUnitId: string | null;
    ownerTalentId: string | null;
    ownerTalentGroupId: string | null;
  }) {
    const index = this.records.findIndex(
      (record) => record.id === input.platformAccountId,
    );
    if (index < 0) return null;
    this.records[index] = {
      ...this.records[index],
      ownerKind: input.ownerKind,
      ownerOrgUnitId: input.ownerOrgUnitId,
      ownerTalentId: input.ownerTalentId,
      ownerTalentGroupId: input.ownerTalentGroupId,
      updatedAt: Date.now(),
    };
    return this.records[index];
  }

  async transitionOperationalStatus(input: {
    platformAccountId: string;
    toStatus: PlatformAccountRecord["operationalStatus"];
    livestreamEnabled?: boolean;
    contentPublishingEnabled?: boolean;
    monetizationEnabled?: boolean;
  }) {
    const index = this.records.findIndex(
      (record) => record.id === input.platformAccountId,
    );
    if (index < 0) return null;
    this.records[index] = {
      ...this.records[index],
      operationalStatus: input.toStatus,
      ...(input.livestreamEnabled === undefined
        ? {}
        : { livestreamEnabled: input.livestreamEnabled }),
      ...(input.contentPublishingEnabled === undefined
        ? {}
        : { contentPublishingEnabled: input.contentPublishingEnabled }),
      ...(input.monetizationEnabled === undefined
        ? {}
        : { monetizationEnabled: input.monetizationEnabled }),
      updatedAt: Date.now(),
    };
    return this.records[index];
  }

  async updateCapabilities(input: {
    platformAccountId: string;
    livestreamEnabled: boolean;
    contentPublishingEnabled: boolean;
    monetizationEnabled: boolean;
  }) {
    const index = this.records.findIndex(
      (record) => record.id === input.platformAccountId,
    );
    if (index < 0) return null;
    this.records[index] = {
      ...this.records[index],
      livestreamEnabled: input.livestreamEnabled,
      contentPublishingEnabled: input.contentPublishingEnabled,
      monetizationEnabled: input.monetizationEnabled,
      updatedAt: Date.now(),
    };
    return this.records[index];
  }

  async listPlatformAccounts() {
    return { items: this.records.map(toPlatformDetail) };
  }

  async getPlatformAccountDetail(id: string) {
    const record = await this.findById(id);
    return record ? toPlatformDetail(record) : null;
  }
}

function toStudioDetail(
  record: StudioResourceRecord,
): StudioResourceDetailView {
  return {
    id: record.id,
    resourceCode: record.resourceCode,
    name: record.name,
    shortName: record.shortName,
    resourceClass: record.resourceClass,
    operationalStatus: record.operationalStatus,
    locationLabel: record.locationLabel,
    description: record.description,
    externalRef: record.externalRef,
    maxOccupancy: record.maxOccupancy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toPlatformDetail(
  record: PlatformAccountRecord,
): PlatformAccountDetailView {
  return {
    id: record.id,
    accountCode: record.accountCode,
    platform: record.platform,
    platformSurfaceType: record.platformSurfaceType,
    displayName: record.displayName,
    handle: record.handle,
    externalPlatformId: record.externalPlatformId,
    profileUrl: record.profileUrl,
    ownerKind: record.ownerKind,
    ownerOrgUnitId: record.ownerOrgUnitId,
    ownerTalentId: record.ownerTalentId,
    ownerTalentGroupId: record.ownerTalentGroupId,
    operationalStatus: record.operationalStatus,
    livestreamEnabled: record.livestreamEnabled,
    contentPublishingEnabled: record.contentPublishingEnabled,
    monetizationEnabled: record.monetizationEnabled,
    description: record.description,
    externalRef: record.externalRef,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function cryptoSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-");
}
