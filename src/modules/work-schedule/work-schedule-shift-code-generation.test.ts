import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoServerError, type ClientSession } from "mongodb";
import type { Request } from "express";
import { bindCommand } from "@app/base/command.middleware";
import { Actor } from "@core/actor/actor";
import type {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { WorkScheduleAdminController } from "@modules/work-schedule/admin/admin.work-schedule.controller";
import { WorkScheduleAdminQueryService } from "@modules/work-schedule/admin/admin.work-schedule.query-service";
import { WorkScheduleAdminService } from "@modules/work-schedule/admin/admin.work-schedule.service";
import type { WorkShiftCodeSequenceRepository } from "@modules/work-schedule/domain/work-schedule-code-sequence.repository";
import {
  WorkScheduleConflictError,
  WorkSchedulePermissionScopeError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import type {
  ReassignWorkShiftSubjectInput,
  ReplaceWorkShiftResourcesInput,
  RescheduleWorkShiftInput,
  TransitionWorkShiftStatusInput,
  UpdateWorkShiftCoreInput,
  WorkShiftOverlapResourceCheckInput,
  WorkShiftOverlapSubjectCheckInput,
  WorkShiftRepository,
} from "@modules/work-schedule/domain/work-schedule.repository";
import type { WorkShiftRecord } from "@modules/work-schedule/domain/work-schedule.types";
import {
  WorkScheduleAdminDetailExposure,
  WorkScheduleAdminListExposure,
} from "@modules/work-schedule/shared/work-schedule.exposure";
import { createWorkScheduleBootstrapRegistrar } from "@modules/work-schedule/shared/work-schedule.bootstrap";
import { NativeMongoWorkShiftReadRepository } from "@infra/mongo/work-schedule/work-schedule.read-repository";

class WorkScheduleControllerHarness extends WorkScheduleAdminController {
  async invoke(req: Request, actor: Actor): Promise<unknown> {
    return this.handle(req, actor, "ADMIN");
  }
}

class MemoryWorkShiftRepository implements WorkShiftRepository {
  readonly records: WorkShiftRecord[] = [];

  constructor(seed: readonly WorkShiftRecord[] = []) {
    this.records.push(...seed);
  }

  async insert(workShift: WorkShiftRecord): Promise<WorkShiftRecord> {
    if (
      this.records.some(
        (record) => record.shiftCode === workShift.shiftCode,
      )
    ) {
      throw new MongoServerError({
        message: "duplicate key",
        code: 11000,
      });
    }

    this.records.push(workShift);
    return workShift;
  }

  async findById(workShiftId: string): Promise<WorkShiftRecord | null> {
    return (
      this.records.find((record) => record.id === workShiftId) ?? null
    );
  }

  async findByShiftCode(shiftCode: string): Promise<WorkShiftRecord | null> {
    return (
      this.records.find((record) => record.shiftCode === shiftCode) ??
      null
    );
  }

  async updateCore(
    input: UpdateWorkShiftCoreInput,
  ): Promise<WorkShiftRecord | null> {
    const current = await this.findById(input.workShiftId);
    if (!current) {
      return null;
    }

    const updated = {
      ...current,
      title: input.title ?? current.title,
      normalizedTitle:
        input.normalizedTitle ?? current.normalizedTitle,
      description:
        input.description === undefined
          ? current.description
          : input.description,
      externalRef:
        input.externalRef === undefined
          ? current.externalRef
          : input.externalRef,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async reschedule(
    input: RescheduleWorkShiftInput,
  ): Promise<WorkShiftRecord | null> {
    const current = await this.findById(input.workShiftId);
    if (!current) {
      return null;
    }
    const updated = {
      ...current,
      shiftStartAt: input.shiftStartAt,
      shiftEndAt: input.shiftEndAt,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async reassignSubject(
    input: ReassignWorkShiftSubjectInput,
  ): Promise<WorkShiftRecord | null> {
    const current = await this.findById(input.workShiftId);
    if (!current) {
      return null;
    }
    const updated = {
      ...current,
      subjectKind: input.subjectKind,
      subjectEmploymentProfileId:
        input.subjectEmploymentProfileId,
      subjectTalentId: input.subjectTalentId,
      subjectTalentGroupId: input.subjectTalentGroupId,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async replaceResources(
    input: ReplaceWorkShiftResourcesInput,
  ): Promise<WorkShiftRecord | null> {
    const current = await this.findById(input.workShiftId);
    if (!current) {
      return null;
    }
    const updated = {
      ...current,
      studioResourceIds: [...input.studioResourceIds],
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async transitionStatus(
    input: TransitionWorkShiftStatusInput,
  ): Promise<WorkShiftRecord | null> {
    const current = await this.findById(input.workShiftId);
    if (
      !current ||
      !input.fromStatuses.includes(current.status)
    ) {
      return null;
    }
    const updated = {
      ...current,
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async hasActiveOverlappingSubjectShift(
    _input: WorkShiftOverlapSubjectCheckInput,
  ): Promise<boolean> {
    return false;
  }

  async hasActiveOverlappingResourceShift(
    _input: WorkShiftOverlapResourceCheckInput,
  ): Promise<boolean> {
    return false;
  }

  async listActiveEmploymentProfileShiftsForWindow() {
    return [];
  }

  async summarizeGeneratedByRoster(monthlyRosterId: string) {
    const generated = this.records.filter(
      (record) =>
        record.sourceType === "ROSTER_GENERATED" &&
        record.sourceRosterId === monthlyRosterId,
    );

    return {
      workShiftIds: generated.map((record) => record.id),
      generatedWorkShiftCount: generated.length,
      changeTimeCount: generated.filter(
        (record) =>
          record.sourceExceptionId !== null &&
          record.sourceRosterSlotKey === "STANDARD",
      ).length,
      addSpecialShiftCount: generated.filter(
        (record) =>
          record.sourceRosterSlotKey?.startsWith(
            "ADD_SPECIAL_SHIFT:",
          ) ?? false,
      ).length,
    };
  }

  private replace(updated: WorkShiftRecord): void {
    const index = this.records.findIndex(
      (record) => record.id === updated.id,
    );
    if (index >= 0) {
      this.records[index] = updated;
    }
  }
}

class MemoryWorkShiftCodeSequenceRepository
  implements WorkShiftCodeSequenceRepository
{
  readonly values = new Map<string, number>();

  async allocateNext(dateBucket: string): Promise<number> {
    const next = (this.values.get(dateBucket) ?? 0) + 1;
    this.values.set(dateBucket, next);
    return next;
  }
}

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

function createAdminActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.WORK_SCHEDULE_CREATE,
      Permission.WORK_SCHEDULE_UPDATE,
    ],
    scopeGrants: {
      workSchedule: ["global"],
    },
    isActive: true,
  });
}

function createGlobalDispatcherActor(): Actor {
  return new Actor({
    id: "production-ops-user-1",
    type: "admin",
    context: "ADMIN",
    roles: ["PRODUCTION_OPS"],
    permissions: [
      Permission.WORK_SCHEDULE_CREATE,
      Permission.WORK_SCHEDULE_UPDATE,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    ],
    scopeGrants: {
      workSchedule: ["global"],
    },
    isActive: true,
  });
}

function createStaleTeamManagerActor(): Actor {
  return new Actor({
    id: "team-manager-user-1",
    type: "admin",
    context: "ADMIN",
    roles: ["TEAM_MANAGER"],
    permissions: [
      Permission.WORK_SCHEDULE_READ,
      Permission.WORK_SCHEDULE_CREATE,
      Permission.WORK_SCHEDULE_UPDATE,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    ],
    scopeGrants: {
      workSchedule: ["self", "team", "department"],
    },
    isActive: true,
  });
}

function createHrReadActor(): Actor {
  return new Actor({
    id: "hr-user-1",
    type: "admin",
    context: "ADMIN",
    roles: ["HR_OPERATIONS"],
    permissions: [Permission.WORK_SCHEDULE_READ],
    scopeGrants: {
      workSchedule: ["department"],
    },
    isActive: true,
  });
}

function createReadActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [Permission.WORK_SCHEDULE_READ],
    scopeGrants: {
      workSchedule: ["global"],
    },
    isActive: true,
  });
}

function createService(params?: {
  readonly repository?: MemoryWorkShiftRepository;
  readonly sequenceRepository?: MemoryWorkShiftCodeSequenceRepository;
}): WorkScheduleAdminService {
  return new WorkScheduleAdminService(
    params?.repository ?? new MemoryWorkShiftRepository(),
    params?.sequenceRepository ??
      new MemoryWorkShiftCodeSequenceRepository(),
    {
      async findById(employmentProfileId: string) {
        return {
          id: employmentProfileId,
          employmentStatus: "ACTIVE",
          orgUnitId: "org-1",
          managerEmploymentProfileId: null,
          linkedUserId: null,
        };
      },
      async findByLinkedUserId() {
        return null;
      },
      async listIdsByManagerEmploymentProfileId() {
        return [];
      },
      async listIdsByActiveTalentGroupIds() {
        return [];
      },
      async listIdsByOrgUnitId() {
        return [];
      },
      async listByOrgUnitId() {
        return [];
      },
    },
    {
      async findById(talentId: string) {
        return {
          id: talentId,
          operationalStatus: "ACTIVE",
        };
      },
    },
    {
      async findById(groupId: string) {
        return {
          id: groupId,
          status: "ACTIVE",
        };
      },
    },
    {
      async findById(resourceId: string) {
        return {
          id: resourceId,
          operationalStatus: "ACTIVE",
        };
      },
    },
    audit,
    mutationBridge,
    {
      info() {},
      warn() {},
      error() {},
      debug() {},
    } as never,
  );
}

function createPayload(
  params: Partial<{
    readonly shiftCode: string | null;
    readonly subjectEmploymentProfileId: string;
    readonly shiftStartAt: number;
    readonly shiftEndAt: number;
  }> = {},
) {
  return {
    shiftCode: params.shiftCode,
    title: "Morning shift",
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId:
      params.subjectEmploymentProfileId ?? "ep-1",
    shiftStartAt:
      params.shiftStartAt ??
      Date.UTC(2026, 4, 4, 1, 0, 0),
    shiftEndAt:
      params.shiftEndAt ??
      Date.UTC(2026, 4, 4, 2, 0, 0),
    studioResourceIds: ["studio-1"],
  };
}

function seedRecord(shiftCode: string): WorkShiftRecord {
  return {
    id: `seed-${shiftCode}`,
    shiftCode,
    normalizedShiftCode: shiftCode.toLowerCase(),
    title: "Seed",
    normalizedTitle: "seed",
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId: "ep-seed",
    subjectTalentId: null,
    subjectTalentGroupId: null,
    studioResourceIds: [],
    status: "ACTIVE",
    shiftStartAt: Date.UTC(2026, 4, 4, 0, 0, 0),
    shiftEndAt: Date.UTC(2026, 4, 4, 1, 0, 0),
    description: null,
    externalRef: null,
    sourceType: "MANUAL",
    sourceRosterId: null,
    sourcePatternId: null,
    sourceExceptionId: null,
    sourceGenerationRunId: null,
    sourceRosterMonth: null,
    sourceDepartmentOrgUnitId: null,
    sourceRosterLocalDate: null,
    sourceRosterSlotKey: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("Work Schedule official mutations require global dispatcher scope even with stale mutation grants", async (t) => {
  const actor = createStaleTeamManagerActor();

  async function assertBlocked(
    operation: () => Promise<unknown>,
  ): Promise<void> {
    await assert.rejects(
      operation(),
      WorkSchedulePermissionScopeError,
    );
  }

  await t.test("create is blocked", async () => {
    await assertBlocked(() =>
      createService().createWorkShift(
        actor,
        createPayload({ shiftCode: undefined }),
      ),
    );
  });

  await t.test("update core is blocked", async () => {
    await assertBlocked(() =>
      createService({
        repository: new MemoryWorkShiftRepository([
          seedRecord("STALEUPDATE001"),
        ]),
      }).updateWorkShiftCore(actor, {
        workShiftId: "seed-STALEUPDATE001",
        title: "Blocked",
      }),
    );
  });

  await t.test("reschedule is blocked", async () => {
    await assertBlocked(() =>
      createService({
        repository: new MemoryWorkShiftRepository([
          seedRecord("STALERESCHEDULE001"),
        ]),
      }).rescheduleWorkShift(actor, {
        workShiftId: "seed-STALERESCHEDULE001",
        newShiftStartAt: Date.UTC(2026, 4, 4, 3),
        newShiftEndAt: Date.UTC(2026, 4, 4, 4),
      }),
    );
  });

  await t.test("reassign subject is blocked", async () => {
    await assertBlocked(() =>
      createService({
        repository: new MemoryWorkShiftRepository([
          seedRecord("STALEREASSIGN001"),
        ]),
      }).reassignWorkShiftSubject(actor, {
        workShiftId: "seed-STALEREASSIGN001",
        newSubjectKind: "EMPLOYMENT_PROFILE",
        newSubjectEmploymentProfileId: "ep-2",
      }),
    );
  });

  await t.test("update resources is blocked", async () => {
    await assertBlocked(() =>
      createService({
        repository: new MemoryWorkShiftRepository([
          seedRecord("STALERESOURCE001"),
        ]),
      }).updateWorkShiftResources(actor, {
        workShiftId: "seed-STALERESOURCE001",
        newStudioResourceIds: ["studio-2"],
      }),
    );
  });

  await t.test("cancel is blocked", async () => {
    await assertBlocked(() =>
      createService({
        repository: new MemoryWorkShiftRepository([
          seedRecord("STALECANCEL001"),
        ]),
      }).cancelWorkShift(actor, {
        workShiftId: "seed-STALECANCEL001",
      }),
    );
  });

  await t.test("archive is blocked", async () => {
    await assertBlocked(() =>
      createService({
        repository: new MemoryWorkShiftRepository([
          {
            ...seedRecord("STALEARCHIVE001"),
            status: "CANCELLED",
          },
        ]),
      }).archiveWorkShift(actor, {
        workShiftId: "seed-STALEARCHIVE001",
      }),
    );
  });
});

test("Work Schedule official mutations allow global dispatcher authority", async () => {
  const repository = new MemoryWorkShiftRepository([
    seedRecord("GLOBALUPDATE001"),
    seedRecord("GLOBALCANCEL001"),
    {
      ...seedRecord("GLOBALARCHIVE001"),
      status: "CANCELLED",
    },
  ]);
  const service = createService({ repository });
  const actor = createGlobalDispatcherActor();

  await bindTraceId("trace-work-shift-global-authority", async () => {
    const created = await service.createWorkShift(
      actor,
      createPayload({
        shiftCode: undefined,
        subjectEmploymentProfileId: "ep-global-create",
      }),
    );
    const updated = await service.updateWorkShiftCore(actor, {
      workShiftId: "seed-GLOBALUPDATE001",
      title: "Updated by ops",
    });
    const cancelled = await service.cancelWorkShift(actor, {
      workShiftId: "seed-GLOBALCANCEL001",
    });
    const archived = await service.archiveWorkShift(actor, {
      workShiftId: "seed-GLOBALARCHIVE001",
    });

    assert.equal(created.shiftCode, "WS-20260504-0001");
    assert.equal(updated.title, "Updated by ops");
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(archived.status, "ARCHIVED");
  });
});

test("Work Schedule HR read-only department actor cannot official-mutate", async () => {
  await assert.rejects(
    createService().createWorkShift(
      createHrReadActor(),
      createPayload({ shiftCode: undefined }),
    ),
    /Missing permission workSchedule\.create/u,
  );
});

test("Work Schedule create generates shiftCode when omitted", async () => {
  const service = createService();
  const actor = createAdminActor();

  await bindTraceId("trace-work-shift-generate-1", async () => {
    const created = await service.createWorkShift(
      actor,
      createPayload({ shiftCode: undefined }),
    );

    assert.equal(created.shiftCode, "WS-20260504-0001");
    assert.match(created.shiftCode, /^WS-\d{8}-\d{4}$/u);
    assert.equal(created.sourceType, "MANUAL");
    assert.equal(created.sourceRosterId, null);
    assert.equal(created.sourcePatternId, null);
    assert.equal(created.sourceExceptionId, null);
    assert.equal(created.sourceGenerationRunId, null);
    assert.equal(created.sourceRosterMonth, null);
    assert.equal(created.sourceDepartmentOrgUnitId, null);
    assert.equal(created.sourceRosterLocalDate, null);
    assert.equal(created.sourceRosterSlotKey, null);
  });
});

test("Work Schedule create generates shiftCode when shiftCode is null", async () => {
  const service = createService();
  const actor = createAdminActor();

  await bindTraceId("trace-work-shift-generate-null", async () => {
    const created = await service.createWorkShift(
      actor,
      createPayload({ shiftCode: null }),
    );

    assert.equal(created.shiftCode, "WS-20260504-0001");
    assert.match(created.shiftCode, /^WS-\d{8}-\d{4}$/u);
  });
});

test("Work Schedule create generates shiftCode when shiftCode is blank", async () => {
  const service = createService();
  const actor = createAdminActor();

  await bindTraceId("trace-work-shift-generate-blank", async () => {
    const empty = await service.createWorkShift(
      actor,
      createPayload({
        shiftCode: "",
        subjectEmploymentProfileId: "ep-empty",
      }),
    );
    const whitespace = await service.createWorkShift(
      actor,
      createPayload({
        shiftCode: "   ",
        subjectEmploymentProfileId: "ep-whitespace",
      }),
    );

    assert.equal(empty.shiftCode, "WS-20260504-0001");
    assert.equal(whitespace.shiftCode, "WS-20260504-0002");
  });
});

test("Work Schedule generated shiftCode sequences are per UTC date bucket", async () => {
  const repository = new MemoryWorkShiftRepository();
  const sequenceRepository =
    new MemoryWorkShiftCodeSequenceRepository();
  const service = createService({
    repository,
    sequenceRepository,
  });
  const actor = createAdminActor();

  await bindTraceId("trace-work-shift-generate-seq", async () => {
    const first = await service.createWorkShift(
      actor,
      createPayload({
        shiftCode: undefined,
        subjectEmploymentProfileId: "ep-1",
        shiftStartAt: Date.UTC(2026, 4, 4, 1),
        shiftEndAt: Date.UTC(2026, 4, 4, 2),
      }),
    );
    const second = await service.createWorkShift(
      actor,
      createPayload({
        shiftCode: undefined,
        subjectEmploymentProfileId: "ep-2",
        shiftStartAt: Date.UTC(2026, 4, 4, 3),
        shiftEndAt: Date.UTC(2026, 4, 4, 4),
      }),
    );
    const nextBucket = await service.createWorkShift(
      actor,
      createPayload({
        shiftCode: undefined,
        subjectEmploymentProfileId: "ep-3",
        shiftStartAt: Date.UTC(2026, 4, 5, 1),
        shiftEndAt: Date.UTC(2026, 4, 5, 2),
      }),
    );

    assert.equal(first.shiftCode, "WS-20260504-0001");
    assert.equal(second.shiftCode, "WS-20260504-0002");
    assert.equal(nextBucket.shiftCode, "WS-20260505-0001");
  });
});

test("Work Schedule explicit shiftCode remains backward compatible and duplicate explicit code fails", async () => {
  const repository = new MemoryWorkShiftRepository([
    seedRecord("EXISTING001"),
  ]);
  const service = createService({ repository });
  const actor = createAdminActor();

  await bindTraceId("trace-work-shift-explicit", async () => {
    const created = await service.createWorkShift(
      actor,
      createPayload({
        shiftCode: "CUSTOM001",
        subjectEmploymentProfileId: "ep-1",
      }),
    );

    assert.equal(created.shiftCode, "CUSTOM001");

    await assert.rejects(
      service.createWorkShift(
        actor,
        createPayload({
          shiftCode: "EXISTING001",
          subjectEmploymentProfileId: "ep-2",
        }),
      ),
      WorkScheduleConflictError,
    );
  });
});

test("Work Schedule generated shiftCode retries bounded duplicate-key collisions", async () => {
  const repository = new MemoryWorkShiftRepository([
    seedRecord("WS-20260504-0001"),
  ]);
  const service = createService({ repository });
  const actor = createAdminActor();

  await bindTraceId("trace-work-shift-generate-collision", async () => {
    const created = await service.createWorkShift(
      actor,
      createPayload({
        shiftCode: undefined,
        subjectEmploymentProfileId: "ep-2",
      }),
    );

    assert.equal(created.shiftCode, "WS-20260504-0002");
  });
});

test("Work Schedule update payloads cannot change shiftCode", async () => {
  const controller = new WorkScheduleControllerHarness(
    {
      updateWorkShiftCore: async () => {
        throw new Error("service should not be called");
      },
    } as never,
  );
  const req = {
    body: {
      title: "Updated",
      shiftCode: "NEWCODE",
    },
    params: {
      workShiftId: "shift-1",
    },
    query: {},
  } as unknown as Request;
  bindCommand(req, "WORK_SHIFT_UPDATE_CORE");

  await assert.rejects(
    controller.invoke(req, createAdminActor()),
    WorkScheduleValidationError,
  );
});

test("Work Schedule manual mutation payloads reject roster source metadata", async (t) => {
  const sourceMetadata = {
    sourceType: "ROSTER_GENERATED",
    sourceRosterId: "roster-1",
    sourcePatternId: "pattern-1",
    sourceExceptionId: "exception-1",
    sourceGenerationRunId: "run-1",
    sourceRosterMonth: "2026-05",
    sourceDepartmentOrgUnitId: "org-1",
    sourceRosterLocalDate: "2026-05-04",
    sourceRosterSlotKey: "STANDARD",
  };
  const serviceShouldNotBeCalled = {
    createWorkShift: async () => {
      throw new Error("service should not be called");
    },
    updateWorkShiftCore: async () => {
      throw new Error("service should not be called");
    },
    rescheduleWorkShift: async () => {
      throw new Error("service should not be called");
    },
    reassignWorkShiftSubject: async () => {
      throw new Error("service should not be called");
    },
    updateWorkShiftResources: async () => {
      throw new Error("service should not be called");
    },
    cancelWorkShift: async () => {
      throw new Error("service should not be called");
    },
    archiveWorkShift: async () => {
      throw new Error("service should not be called");
    },
  } as never;

  async function assertRejected(params: {
    readonly command: string;
    readonly body: Record<string, unknown>;
  }): Promise<void> {
    const controller = new WorkScheduleControllerHarness(
      serviceShouldNotBeCalled,
    );
    const req = {
      body: params.body,
      params: {
        workShiftId: "shift-1",
      },
      query: {},
    } as unknown as Request;
    bindCommand(req, params.command);

    await assert.rejects(
      controller.invoke(req, createAdminActor()),
      WorkScheduleValidationError,
    );
  }

  await t.test("create rejects source metadata", async () => {
    await assertRejected({
      command: "WORK_SHIFT_CREATE",
      body: {
        ...createPayload({ shiftCode: undefined }),
        ...sourceMetadata,
      },
    });
  });

  await t.test("update core rejects source metadata", async () => {
    await assertRejected({
      command: "WORK_SHIFT_UPDATE_CORE",
      body: {
        title: "Updated",
        ...sourceMetadata,
      },
    });
  });

  await t.test("reschedule rejects source metadata", async () => {
    await assertRejected({
      command: "WORK_SHIFT_RESCHEDULE",
      body: {
        newShiftStartAt: Date.UTC(2026, 4, 4, 3),
        newShiftEndAt: Date.UTC(2026, 4, 4, 4),
        ...sourceMetadata,
      },
    });
  });

  await t.test("reassign subject rejects source metadata", async () => {
    await assertRejected({
      command: "WORK_SHIFT_REASSIGN_SUBJECT",
      body: {
        newSubjectKind: "EMPLOYMENT_PROFILE",
        newSubjectEmploymentProfileId: "ep-2",
        ...sourceMetadata,
      },
    });
  });

  await t.test("replace resources rejects source metadata", async () => {
    await assertRejected({
      command: "WORK_SHIFT_UPDATE_RESOURCES",
      body: {
        newStudioResourceIds: ["studio-2"],
        ...sourceMetadata,
      },
    });
  });

  await t.test("cancel rejects source metadata", async () => {
    await assertRejected({
      command: "WORK_SHIFT_CANCEL",
      body: sourceMetadata,
    });
  });

  await t.test("archive rejects source metadata", async () => {
    await assertRejected({
      command: "WORK_SHIFT_ARCHIVE",
      body: sourceMetadata,
    });
  });
});

test("Work Schedule legacy stored shift without source metadata maps to MANUAL", async () => {
  const legacyDocument = {
    _id: "legacy-shift-1",
    shiftCode: "LEGACY001",
    normalizedShiftCode: "legacy001",
    title: "Legacy shift",
    normalizedTitle: "legacy shift",
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId: "ep-1",
    subjectTalentId: null,
    subjectTalentGroupId: null,
    studioResourceIds: [],
    status: "ACTIVE",
    shiftStartAt: Date.UTC(2026, 4, 4, 1),
    shiftEndAt: Date.UTC(2026, 4, 4, 2),
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const repository = new NativeMongoWorkShiftReadRepository({
    collection(collectionName: string) {
      if (collectionName !== "work_shifts") {
        return {
          find: () => ({
            toArray: async () => [],
          }),
        };
      }

      return {
        findOne: async () => legacyDocument,
      };
    },
  } as never);

  const detail =
    await repository.getWorkShiftDetail("legacy-shift-1");

  assert.equal(detail?.sourceType, "MANUAL");
  assert.equal(detail?.sourceRosterId, null);
  assert.equal(detail?.sourcePatternId, null);
  assert.equal(detail?.sourceExceptionId, null);
  assert.equal(detail?.sourceGenerationRunId, null);
  assert.equal(detail?.sourceRosterMonth, null);
  assert.equal(detail?.sourceDepartmentOrgUnitId, null);
  assert.equal(detail?.sourceRosterLocalDate, null);
  assert.equal(detail?.sourceRosterSlotKey, null);
});

test("Work Schedule list and detail exposures include source metadata read-only", () => {
  const record = seedRecord("SOURCE001");
  const list = WorkScheduleAdminListExposure.expose({
    id: record.id,
    shiftCode: record.shiftCode,
    title: record.title,
    subjectKind: record.subjectKind,
    subjectEmploymentProfileId:
      record.subjectEmploymentProfileId,
    subjectTalentId: record.subjectTalentId,
    subjectTalentGroupId:
      record.subjectTalentGroupId,
    status: record.status,
    shiftStartAt: record.shiftStartAt,
    shiftEndAt: record.shiftEndAt,
    sourceType: record.sourceType,
    sourceRosterId: record.sourceRosterId,
    sourceRosterMonth: record.sourceRosterMonth,
    sourceRosterLocalDate:
      record.sourceRosterLocalDate,
    sourceRosterSlotKey: record.sourceRosterSlotKey,
    createdAt: record.createdAt,
  });
  const detail = WorkScheduleAdminDetailExposure.expose({
    id: record.id,
    shiftCode: record.shiftCode,
    title: record.title,
    subjectKind: record.subjectKind,
    subjectEmploymentProfileId:
      record.subjectEmploymentProfileId,
    subjectTalentId: record.subjectTalentId,
    subjectTalentGroupId:
      record.subjectTalentGroupId,
    studioResourceIds: record.studioResourceIds,
    status: record.status,
    shiftStartAt: record.shiftStartAt,
    shiftEndAt: record.shiftEndAt,
    description: record.description,
    externalRef: record.externalRef,
    sourceType: record.sourceType,
    sourceRosterId: record.sourceRosterId,
    sourcePatternId: record.sourcePatternId,
    sourceExceptionId: record.sourceExceptionId,
    sourceGenerationRunId:
      record.sourceGenerationRunId,
    sourceRosterMonth: record.sourceRosterMonth,
    sourceDepartmentOrgUnitId:
      record.sourceDepartmentOrgUnitId,
    sourceRosterLocalDate:
      record.sourceRosterLocalDate,
    sourceRosterSlotKey: record.sourceRosterSlotKey,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });

  assert.equal(list.sourceType, "MANUAL");
  assert.equal(list.sourceRosterId, null);
  assert.equal(list.sourceRosterMonth, null);
  assert.equal(list.sourceRosterLocalDate, null);
  assert.equal(list.sourceRosterSlotKey, null);
  assert.equal(detail.sourceType, "MANUAL");
  assert.equal(detail.sourceRosterId, null);
  assert.equal(detail.sourcePatternId, null);
  assert.equal(detail.sourceExceptionId, null);
  assert.equal(detail.sourceGenerationRunId, null);
  assert.equal(detail.sourceRosterMonth, null);
  assert.equal(detail.sourceDepartmentOrgUnitId, null);
  assert.equal(detail.sourceRosterLocalDate, null);
  assert.equal(detail.sourceRosterSlotKey, null);
});

test("Work Schedule list source filters are parsed and passed to read repository", async () => {
  let captured:
    | {
        sourceType?: string;
        sourceRosterId?: string;
        sourceDepartmentOrgUnitId?: string;
        sourceRosterMonth?: string;
      }
    | undefined;
  const service = new WorkScheduleAdminQueryService(
    {
      listWorkShifts: async (input: unknown) => {
        captured = input as typeof captured;
        return { items: [] };
      },
    } as never,
    {
      async findById() {
        return null;
      },
      async findByLinkedUserId() {
        return null;
      },
      async listIdsByManagerEmploymentProfileId() {
        return [];
      },
      async listIdsByActiveTalentGroupIds() {
        return [];
      },
      async listIdsByOrgUnitId() {
        return [];
      },
      async listByOrgUnitId() {
        return [];
      },
    },
  );

  await service.listWorkShifts(createReadActor(), {
    sourceType: "roster_generated",
    sourceRosterId: "roster-1",
    sourceDepartmentOrgUnitId: "org-1",
    sourceRosterMonth: "2026-05",
  });

  assert.equal(captured?.sourceType, "ROSTER_GENERATED");
  assert.equal(captured?.sourceRosterId, "roster-1");
  assert.equal(
    captured?.sourceDepartmentOrgUnitId,
    "org-1",
  );
  assert.equal(captured?.sourceRosterMonth, "2026-05");
});

test("Work Schedule team read scope resolves active managed group memberships", async () => {
  let capturedScopeIds: readonly string[] | undefined;
  let capturedGroupIds: readonly string[] | undefined;
  const service = new WorkScheduleAdminQueryService(
    {
      listWorkShifts: async (input: {
        readonly scopeEmploymentProfileIds?: readonly string[];
      }) => {
        capturedScopeIds = input.scopeEmploymentProfileIds;
        return { items: [] };
      },
    } as never,
    {
      async findById() {
        return null;
      },
      async findByLinkedUserId(linkedUserId: string) {
        return linkedUserId === "team-manager-user-1"
          ? {
              id: "manager-profile-1",
              employmentStatus: "ACTIVE",
              orgUnitId: "org-1",
              managerEmploymentProfileId: null,
              linkedUserId,
            }
          : null;
      },
      async listIdsByManagerEmploymentProfileId() {
        throw new Error(
          "managerEmploymentProfileId must not authorize team schedules",
        );
      },
      async listIdsByActiveTalentGroupIds(groupIds: readonly string[]) {
        capturedGroupIds = groupIds;
        return ["ep-managed-1", "ep-managed-2"];
      },
      async listIdsByOrgUnitId() {
        return [];
      },
      async listByOrgUnitId() {
        return [];
      },
    },
    {
      async listActiveAssignmentsByManagerEmploymentProfile(
        managerEmploymentProfileId: string,
      ) {
        assert.equal(managerEmploymentProfileId, "manager-profile-1");
        return [
          {
            id: "assignment-1",
            groupId: "group-managed",
            managerEmploymentProfileId,
            role: "MANAGER",
            effectiveFrom: 1,
            effectiveTo: null,
            status: "ACTIVE",
            isPrimary: true,
            createdAt: 1,
            createdByActorId: "admin-user-1",
            updatedAt: 1,
            updatedByActorId: "admin-user-1",
          },
        ];
      },
    },
  );

  await service.listWorkShifts(createStaleTeamManagerActor(), {
    scope: "team",
  });

  assert.deepEqual(capturedGroupIds, ["group-managed"]);
  assert.deepEqual(capturedScopeIds, [
    "ep-managed-1",
    "ep-managed-2",
  ]);
});

test("Work Schedule read repository applies source metadata filters", async () => {
  let capturedQuery: unknown;
  const repository = new NativeMongoWorkShiftReadRepository({
    collection() {
      return {
        find(query: unknown) {
          capturedQuery = query;
          return {
            sort() {
              return {
                limit() {
                  return {
                    toArray: async () => [],
                  };
                },
              };
            },
          };
        },
      };
    },
  } as never);

  await repository.listWorkShifts({
    sourceType: "MANUAL",
    sourceRosterId: "roster-1",
    sourceDepartmentOrgUnitId: "org-1",
    sourceRosterMonth: "2026-05",
    limit: 20,
  });

  assert.deepEqual(capturedQuery, {
    $and: [
      {
        status: {
          $ne: "ARCHIVED",
        },
      },
      {
        $or: [
          {
            sourceType: "MANUAL",
          },
          {
            sourceType: {
              $exists: false,
            },
          },
          {
            sourceType: null,
          },
        ],
      },
      {
        sourceRosterId: "roster-1",
      },
      {
        sourceDepartmentOrgUnitId: "org-1",
      },
      {
        sourceRosterMonth: "2026-05",
      },
    ],
  });
});

test("Work Schedule bootstrap keeps generated-shift unique index partial to roster-generated shifts", async () => {
  const indexesByCollection = new Map<
    string,
    Array<{
      name: string;
      key: Record<string, number>;
      unique?: boolean;
      partialFilterExpression?: Record<string, unknown>;
    }>
  >();

  const db = {
    collection(name: string) {
      const indexes = indexesByCollection.get(name) ?? [];
      indexesByCollection.set(name, indexes);

      return {
        find() {
          return {
            async *[Symbol.asyncIterator]() {},
          };
        },
        async createIndex(
          key: Record<string, number>,
          options: {
            name: string;
            unique?: boolean;
            partialFilterExpression?: Record<
              string,
              unknown
            >;
          },
        ) {
          indexes.push({
            name: options.name,
            key,
            unique: options.unique,
            partialFilterExpression:
              options.partialFilterExpression,
          });
          return options.name;
        },
        async indexes() {
          return indexes;
        },
      };
    },
  };
  const registrar =
    createWorkScheduleBootstrapRegistrar();

  assert.ok(registrar.initIndexes);
  assert.ok(registrar.assertReadiness);
  await registrar.initIndexes(db as never);
  await registrar.assertReadiness(db as never);

  const generatedIndex = indexesByCollection
    .get("work_shifts")
    ?.find(
      (index) =>
        index.name ===
        "uniq_work_shift_roster_generated_subject_date_slot",
    );

  assert.deepEqual(generatedIndex?.key, {
    sourceRosterId: 1,
    subjectEmploymentProfileId: 1,
    sourceRosterLocalDate: 1,
    sourceRosterSlotKey: 1,
  });
  assert.equal(generatedIndex?.unique, true);
  assert.deepEqual(
    generatedIndex?.partialFilterExpression,
    {
      sourceType: "ROSTER_GENERATED",
    },
  );
  assert.notDeepEqual(
    generatedIndex?.partialFilterExpression,
    {
      sourceType: "MANUAL",
    },
  );
});
