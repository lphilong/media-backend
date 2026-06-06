import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientSession, MongoServerError } from "mongodb";
import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import type {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import type { OrgUnitManagerAssignmentRepository } from "@modules/kpi/domain/org-unit-manager-assignment.repository";
import type { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import { WorkScheduleAvailabilityBatchAdminService } from "./admin/admin.work-schedule-availability-batch.service";
import { adminWorkScheduleAvailabilityBatchRoutes } from "./admin/admin.work-schedule-availability-batch.routes";
import { adminManagerWorkspaceRoutes } from "../manager-workspace/admin/admin.manager-workspace.routes";
import type { WorkScheduleCodeSequenceRepository } from "./domain/work-schedule-code-sequence.repository";
import type { WorkScheduleEmploymentProfileReadonlyAccess } from "./domain/work-schedule-employment-profile-readonly-access";
import type { WorkScheduleOrgUnitReadonlyAccess } from "./domain/work-schedule-org-unit-readonly-access";
import type { WorkScheduleTalentGroupReadonlyAccess } from "./domain/work-schedule-talent-group-readonly-access";
import {
  WorkScheduleConflictError,
  WorkSchedulePermissionScopeError,
  WorkScheduleStateError,
  WorkScheduleValidationError,
} from "./domain/work-schedule.errors";
import type {
  PendingDuplicateWorkScheduleAvailabilityLineInput,
  TransitionWorkScheduleAvailabilityLineInput,
  UpdateWorkScheduleAvailabilityLineApplyStateInput,
  UpdateWorkScheduleAvailabilityBatchDerivedInput,
  WorkScheduleAvailabilityBatchListInput,
  WorkScheduleAvailabilityBatchRepository,
} from "./domain/work-schedule-availability.repository";
import type {
  WorkScheduleAvailabilityBatchRecord,
  WorkScheduleAvailabilityLineRecord,
} from "./domain/work-schedule-availability.types";
import {
  exposeAdminAvailabilityBatch,
  exposeManagerAvailabilityBatch,
} from "./shared/work-schedule-availability.exposure";

const NOW = Date.parse("2026-06-06T00:00:00+07:00");

class MemoryAvailabilityRepository
  implements WorkScheduleAvailabilityBatchRepository
{
  readonly batches: WorkScheduleAvailabilityBatchRecord[] = [];
  readonly lines: WorkScheduleAvailabilityLineRecord[] = [];

  async insertBatchWithLines(
    batch: WorkScheduleAvailabilityBatchRecord,
    lines: readonly WorkScheduleAvailabilityLineRecord[],
  ) {
    this.batches.push(batch);
    this.lines.push(...lines);
    return batch;
  }

  async findBatchById(batchId: string) {
    return this.batches.find((batch) => batch.id === batchId) ?? null;
  }

  async findBatchByClientToken(
    submittedByEmploymentProfileId: string,
    clientToken: string,
  ) {
    return (
      this.batches.find(
        (batch) =>
          batch.submittedByEmploymentProfileId ===
            submittedByEmploymentProfileId &&
          batch.clientToken === clientToken,
      ) ?? null
    );
  }

  async listBatches(input: WorkScheduleAvailabilityBatchListInput) {
    let items = [...this.batches];
    for (const [key, value] of Object.entries(input)) {
      if (
        value !== undefined &&
        !["limit", "cursor"].includes(key)
      ) {
        items = items.filter(
          (item) =>
            item[key as keyof WorkScheduleAvailabilityBatchRecord] === value,
        );
      }
    }
    return { items: items.slice(0, input.limit) };
  }

  async listLinesByBatchId(batchId: string) {
    return this.lines
      .filter((line) => line.batchId === batchId)
      .sort((a, b) => a.lineNo - b.lineNo);
  }

  async findLineById(batchId: string, lineId: string) {
    return (
      this.lines.find(
        (line) => line.batchId === batchId && line.id === lineId,
      ) ?? null
    );
  }

  async listLinesByIds(lineIds: readonly string[]) {
    const ids = new Set(lineIds);
    return this.lines.filter((line) => ids.has(line.id));
  }

  async findPendingDuplicateLine(
    input: PendingDuplicateWorkScheduleAvailabilityLineInput,
  ) {
    return (
      this.lines.find(
        (line) =>
          line.status === "PENDING" &&
          Object.entries(input).every(
            ([key, value]) =>
              line[key as keyof WorkScheduleAvailabilityLineRecord] === value,
          ),
      ) ?? null
    );
  }

  async transitionLineStatus(
    input: TransitionWorkScheduleAvailabilityLineInput,
  ) {
    const current = await this.findLineById(input.batchId, input.lineId);
    if (!current || current.status !== input.fromStatus) {
      return null;
    }
    const updated: WorkScheduleAvailabilityLineRecord = {
      ...current,
      status: input.toStatus,
      updatedAt: input.updatedAt,
      adminDecisionNote:
        input.adminDecisionNote ?? current.adminDecisionNote,
      rejectionReason: input.rejectionReason ?? current.rejectionReason,
      cancellationReason:
        input.cancellationReason ?? current.cancellationReason,
      approvedAt: input.approvedAt ?? current.approvedAt,
      approvedByActorId:
        input.approvedByActorId ?? current.approvedByActorId,
      rejectedAt: input.rejectedAt ?? current.rejectedAt,
      rejectedByActorId:
        input.rejectedByActorId ?? current.rejectedByActorId,
      cancelledAt: input.cancelledAt ?? current.cancelledAt,
      cancelledByActorId:
        input.cancelledByActorId ?? current.cancelledByActorId,
    };
    this.replaceLine(updated);
    return updated;
  }

  async updateBatchDerived(
    input: UpdateWorkScheduleAvailabilityBatchDerivedInput,
  ) {
    const current = await this.findBatchById(input.batchId);
    if (!current) {
      return null;
    }
    const updated: WorkScheduleAvailabilityBatchRecord = {
      ...current,
      status: input.status,
      lineCounts: input.lineCounts,
      updatedAt: input.updatedAt,
      cancelledAt: input.cancelledAt ?? current.cancelledAt,
      resolvedAt: input.resolvedAt ?? current.resolvedAt,
    };
    this.replaceBatch(updated);
    return updated;
  }

  async updateLineApplyState(
    input: UpdateWorkScheduleAvailabilityLineApplyStateInput,
  ) {
    const current = await this.findLineById(input.batchId, input.lineId);
    if (
      !current ||
      !input.fromApplyStatuses.includes(current.applyStatus)
    ) {
      return null;
    }
    const updated: WorkScheduleAvailabilityLineRecord = {
      ...current,
      applyStatus: input.applyStatus,
      appliedRosterId:
        input.appliedRosterId === undefined
          ? current.appliedRosterId
          : input.appliedRosterId,
      appliedRosterExceptionId:
        input.appliedRosterExceptionId === undefined
          ? current.appliedRosterExceptionId
          : input.appliedRosterExceptionId,
      appliedRosterExceptionIds:
        input.appliedRosterExceptionIds === undefined
          ? current.appliedRosterExceptionIds
          : [...input.appliedRosterExceptionIds],
      appliedAt:
        input.appliedAt === undefined ? current.appliedAt : input.appliedAt,
      appliedByActorId:
        input.appliedByActorId === undefined
          ? current.appliedByActorId
          : input.appliedByActorId,
      updatedAt: input.updatedAt,
    };
    this.replaceLine(updated);
    return updated;
  }

  private replaceBatch(updated: WorkScheduleAvailabilityBatchRecord): void {
    const index = this.batches.findIndex((item) => item.id === updated.id);
    this.batches[index] = updated;
  }

  private replaceLine(updated: WorkScheduleAvailabilityLineRecord): void {
    const index = this.lines.findIndex((item) => item.id === updated.id);
    this.lines[index] = updated;
  }
}

class AtomicDuplicateAvailabilityRepository extends MemoryAvailabilityRepository {
  override async findPendingDuplicateLine() {
    return null;
  }

  override async insertBatchWithLines(
    batch: WorkScheduleAvailabilityBatchRecord,
    lines: readonly WorkScheduleAvailabilityLineRecord[],
  ) {
    if (
      lines.some((line) =>
        this.lines.some(
          (existing) =>
            existing.status === "PENDING" &&
            existing.pendingDuplicateKey === line.pendingDuplicateKey,
        ),
      )
    ) {
      throw new MongoServerError({
        code: 11000,
        message: "duplicate pendingDuplicateKey",
        keyPattern: { pendingDuplicateKey: 1 },
      });
    }
    return super.insertBatchWithLines(batch, lines);
  }
}

class MemoryCodeSequenceRepository
  implements WorkScheduleCodeSequenceRepository
{
  private value = 0;
  async allocateNext() {
    return ++this.value;
  }
  async allocateNextWorkPatternCode() {
    return ++this.value;
  }
  async allocateNextHolidayCalendarCode() {
    return ++this.value;
  }
  async allocateNextMonthlyRosterCode() {
    return ++this.value;
  }
  async allocateNextWorkScheduleRequestCode() {
    return ++this.value;
  }
  async allocateNextWorkScheduleAvailabilityCode() {
    return ++this.value;
  }
}

const profiles: Record<
  string,
  {
    readonly employmentStatus: "ACTIVE" | "SUSPENDED";
    readonly orgUnitId: string;
    readonly managerEmploymentProfileId: string | null;
    readonly linkedUserId: string | null;
    readonly displayName: string;
  }
> = {
  "ep-manager": {
    employmentStatus: "ACTIVE",
    orgUnitId: "org-manager",
    managerEmploymentProfileId: null,
    linkedUserId: "manager-user",
    displayName: "Manager",
  },
  "ep-other-manager": {
    employmentStatus: "ACTIVE",
    orgUnitId: "org-manager",
    managerEmploymentProfileId: null,
    linkedUserId: "other-manager-user",
    displayName: "Other Manager",
  },
  "ep-org": {
    employmentStatus: "ACTIVE",
    orgUnitId: "org-managed",
    managerEmploymentProfileId: null,
    linkedUserId: null,
    displayName: "Org Member",
  },
  "ep-descendant": {
    employmentStatus: "ACTIVE",
    orgUnitId: "org-child",
    managerEmploymentProfileId: null,
    linkedUserId: null,
    displayName: "Descendant Member",
  },
  "ep-reporting": {
    employmentStatus: "ACTIVE",
    orgUnitId: "org-other",
    managerEmploymentProfileId: "ep-manager",
    linkedUserId: null,
    displayName: "Reporting Member",
  },
  "ep-tg": {
    employmentStatus: "ACTIVE",
    orgUnitId: "org-other",
    managerEmploymentProfileId: null,
    linkedUserId: null,
    displayName: "TalentGroup Member",
  },
  "ep-inactive": {
    employmentStatus: "SUSPENDED",
    orgUnitId: "org-other",
    managerEmploymentProfileId: null,
    linkedUserId: null,
    displayName: "Inactive Member",
  },
};

const employmentAccess: WorkScheduleEmploymentProfileReadonlyAccess = {
  async findById(id: string) {
    const profile = profiles[id];
    return profile
      ? {
          id,
          ...profile,
          ref: {
            id,
            code: id.toUpperCase(),
            displayName: profile.displayName,
            status: profile.employmentStatus,
          },
        }
      : null;
  },
  async findByLinkedUserId(linkedUserId: string) {
    const match = Object.entries(profiles).find(
      ([, profile]) => profile.linkedUserId === linkedUserId,
    );
    return match ? this.findById(match[0]) : null;
  },
  async listIdsByManagerEmploymentProfileId() {
    return ["ep-reporting"];
  },
  async listIdsByActiveTalentGroupIds() {
    return ["ep-tg"];
  },
  async listIdsByOrgUnitId(orgUnitId: string) {
    return orgUnitId === "org-managed" ? ["ep-org"] : [];
  },
  async listByOrgUnitId(orgUnitId: string) {
    return orgUnitId === "org-managed"
      ? [(await this.findById("ep-org"))!]
      : orgUnitId === "org-child"
        ? [(await this.findById("ep-descendant"))!]
        : [];
  },
  async listTalentGroupMemberEmploymentProfileResolutions(groupId: string) {
    if (groupId !== "group-managed") {
      return [];
    }
    return [
      {
        memberId: "member-active",
        groupId,
        talentId: "talent-active",
        membershipStatus: "ACTIVE",
        talentOperationalStatus: "ACTIVE",
        linkedEmploymentProfileId: "ep-tg",
        employmentProfile: await this.findById("ep-tg"),
      },
      {
        memberId: "member-unlinked",
        groupId,
        talentId: "talent-unlinked",
        membershipStatus: "ACTIVE",
        talentOperationalStatus: "ACTIVE",
        linkedEmploymentProfileId: null,
        employmentProfile: null,
      },
      {
        memberId: "member-inactive-talent",
        groupId,
        talentId: "talent-inactive",
        membershipStatus: "ACTIVE",
        talentOperationalStatus: "SUSPENDED",
        linkedEmploymentProfileId: "ep-org",
        employmentProfile: await this.findById("ep-org"),
      },
      {
        memberId: "member-inactive-profile",
        groupId,
        talentId: "talent-profile-inactive",
        membershipStatus: "ACTIVE",
        talentOperationalStatus: "ACTIVE",
        linkedEmploymentProfileId: "ep-inactive",
        employmentProfile: await this.findById("ep-inactive"),
      },
    ];
  },
};

const orgUnitAccess: WorkScheduleOrgUnitReadonlyAccess = {
  async findById(id: string) {
    return ["org-managed", "org-child"].includes(id)
      ? {
          id,
          type: "TEAM",
          status: "ACTIVE",
          ref: { id, code: id.toUpperCase(), name: id, status: "ACTIVE" },
        }
      : null;
  },
};

const talentGroupAccess: WorkScheduleTalentGroupReadonlyAccess = {
  async findById(id: string) {
    return id === "group-managed"
      ? {
          id,
          status: "ACTIVE",
          ref: {
            id,
            code: "GROUP-MANAGED",
            name: "Managed Group",
            status: "ACTIVE",
          },
        }
      : null;
  },
};

const orgAssignments: Pick<
  OrgUnitManagerAssignmentRepository,
  "listActiveByManagerEmploymentProfileId"
> = {
  async listActiveByManagerEmploymentProfileId(managerId: string) {
    return managerId === "ep-manager"
      ? [
          {
            id: "org-assignment",
            orgUnitId: "org-managed",
            managerEmploymentProfileId: managerId,
            role: "UNIT_MANAGER",
            includeDescendants: false,
            actionMask: [],
            effectiveFrom: 1,
            effectiveTo: null,
            status: "ACTIVE",
            isPrimary: true,
            createdAt: 1,
            createdByActorId: "seed",
            updatedAt: 1,
            updatedByActorId: "seed",
          },
        ]
      : [];
  },
};

const groupAssignments: Pick<
  TalentGroupManagerAssignmentRepository,
  "listActiveAssignmentsByManagerEmploymentProfile"
> = {
  async listActiveAssignmentsByManagerEmploymentProfile(managerId: string) {
    return managerId === "ep-manager"
      ? [
          {
            id: "group-assignment",
            groupId: "group-managed",
            managerEmploymentProfileId: managerId,
            role: "MANAGER",
            effectiveFrom: 1,
            effectiveTo: null,
            status: "ACTIVE",
            isPrimary: true,
            createdAt: 1,
            createdByActorId: "seed",
            updatedAt: 1,
            updatedByActorId: "seed",
          },
        ]
      : [];
  },
};

const mutationBridge: AuthoritativeAdminMutationBridge = {
  async execute(_params, mutate) {
    const controls: AuthoritativeMutationControls = {
      markAuthSecurityTruthChanged() {},
      markExplicitNoOpSuccess() {},
    };
    return mutate({} as ClientSession, controls);
  },
};

const audit = { async record() {} } as unknown as AuditGuard;

function createService(repository = new MemoryAvailabilityRepository()) {
  return {
    repository,
    service: new WorkScheduleAvailabilityBatchAdminService(
      repository,
      new MemoryCodeSequenceRepository(),
      employmentAccess,
      orgUnitAccess,
      talentGroupAccess,
      groupAssignments,
      orgAssignments,
      audit,
      mutationBridge,
      () => NOW,
    ),
  };
}

function managerActor(id = "manager-user"): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    roles: ["TEAM_MANAGER"],
    permissions: [Permission.WORK_SCHEDULE_READ],
    scopeGrants: { workSchedule: ["team"] },
    isActive: true,
  });
}

function opsActor(): Actor {
  return new Actor({
    id: "ops-user",
    type: "admin",
    context: "ADMIN",
    roles: ["PRODUCTION_OPS"],
    permissions: [
      Permission.WORK_SCHEDULE_READ,
      Permission.WORK_SCHEDULE_UPDATE,
    ],
    scopeGrants: { workSchedule: ["global"] },
    isActive: true,
  });
}

function adminActor(
  permissions: readonly Permission[],
  scopes: readonly ("team" | "global")[],
  roles: readonly string[] = ["PRODUCTION_OPS"],
): Actor {
  return new Actor({
    id: "authority-test-user",
    type: "admin",
    context: "ADMIN",
    roles,
    permissions,
    scopeGrants: { workSchedule: scopes },
    isActive: true,
  });
}

let token = 0;
function payload(
  overrides: Record<string, unknown> = {},
) {
  token += 1;
  return {
    periodMonth: "2026-06",
    targetType: "ORG_UNIT",
    targetMode: "EXACT_ONLY",
    targetOrgUnitId: "org-managed",
    clientToken: `availability-client-${token}`,
    note: "Planning availability intake",
    lines: [
      {
        memberEmploymentProfileId: "ep-org",
        availabilityType: "UNAVAILABLE_FULL_DAY",
        taxonomyCode: "AUTHORIZED_LEAVE",
        availabilityDate: "2026-06-15",
        reason: "Approved personal leave planning signal",
      },
    ],
    ...overrides,
  };
}

function withTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId("availability-test", fn);
}

function listRouteInventory(router: unknown): string[] {
  const layers = (
    router as {
      stack?: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
        };
      }>;
    }
  ).stack ?? [];

  return layers
    .flatMap((layer) => {
      if (!layer.route) {
        return [];
      }
      return Object.entries(layer.route.methods)
        .filter(([, enabled]) => enabled)
        .map(([method]) => `${method.toUpperCase()} ${layer.route?.path}`);
    })
    .sort();
}

function mountRouteInventory(router: unknown, prefix: string): string[] {
  return listRouteInventory(router).map((entry) => {
    const separator = entry.indexOf(" ");
    const method = entry.slice(0, separator);
    const path = entry.slice(separator + 1);
    return `${method} ${prefix}${path === "/" ? "" : path}`;
  });
}

test("availability manager and Admin route composition registers the accepted endpoints", () => {
  const controller = { execute() {} } as never;

  assert.deepEqual(
    mountRouteInventory(
      adminManagerWorkspaceRoutes(controller),
      "/admin/manager-workspace",
    ).filter((entry) => entry.includes("/availability-batches")),
    [
      "GET /admin/manager-workspace/work-schedule/availability-batches",
      "GET /admin/manager-workspace/work-schedule/availability-batches/:batchId",
      "POST /admin/manager-workspace/work-schedule/availability-batches",
      "POST /admin/manager-workspace/work-schedule/availability-batches/:batchId/cancel",
      "POST /admin/manager-workspace/work-schedule/availability-batches/:batchId/lines/:lineId/cancel",
    ],
  );

  assert.deepEqual(
    mountRouteInventory(
      adminWorkScheduleAvailabilityBatchRoutes(controller),
      "/admin/work-schedule/availability-batches",
    ),
    [
      "GET /admin/work-schedule/availability-batches",
      "GET /admin/work-schedule/availability-batches/:batchId",
      "POST /admin/work-schedule/availability-batches/:batchId/approve-lines",
      "POST /admin/work-schedule/availability-batches/:batchId/cancel-lines",
      "POST /admin/work-schedule/availability-batches/:batchId/reject-lines",
    ],
  );
});

test("manager submits multi-line OrgUnit availability with policy/apply defaults and 50-line boundary", async () => {
  const { service, repository } = createService();
  const lines = Array.from({ length: 50 }, (_, index) => ({
    memberEmploymentProfileId: "ep-org",
    availabilityType:
      index % 2 === 0 ? "UNAVAILABLE_FULL_DAY" : "PREFERRED_TIME",
    taxonomyCode: index % 2 === 0 ? "SICK_LEAVE" : "SHIFT_CHANGE",
    availabilityDate: `2026-06-${String((index % 20) + 1).padStart(2, "0")}`,
    ...(index % 2 === 1
      ? {
          preferredStartLocalTime: "09:00",
          preferredEndLocalTime: "12:00",
        }
      : {}),
    reason: `Availability planning reason number ${index + 1}`,
  }));
  const result = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      payload({ lines }),
    ),
  );

  assert.equal(result.lineCounts.total, 50);
  assert.equal(result.status, "PENDING");
  assert.equal(result.lines[0]?.policyEvaluationStatus, "NOT_EVALUATED");
  assert.equal(result.lines[0]?.applyStatus, "NOT_APPLIED");
  assert.equal(repository.batches.length, 1);

  await assert.rejects(
    withTrace(() =>
      service.submitManagerBatch(
        managerActor(),
        payload({ lines: [...lines, { ...lines[0], reason: "Line 51 reason" }] }),
      ),
    ),
    WorkScheduleValidationError,
  );
});

test("validation rejects invalid period, target shape, unsupported types/taxonomy, bad reason, and date mismatch", async () => {
  const { service } = createService();
  const invalidPayloads = [
    payload({ periodMonth: "" }),
    payload({ periodMonth: "2026-09" }),
    payload({ targetType: "COMPANY" }),
    payload({ targetTalentGroupId: "group-managed" }),
    payload({
      lines: [
        {
          memberEmploymentProfileId: "ep-org",
          availabilityType: "EXTRA_SHIFT_AVAILABLE",
          taxonomyCode: "OTHER",
          availabilityDate: "2026-06-15",
          reason: "Unsupported future availability type",
        },
      ],
    }),
    payload({
      lines: [
        {
          memberEmploymentProfileId: "ep-org",
          availabilityType: "UNAVAILABLE_FULL_DAY",
          taxonomyCode: "UNAUTHORIZED_ABSENCE",
          availabilityDate: "2026-06-15",
          reason: "Unauthorized absence is not manager taxonomy",
        },
      ],
    }),
    payload({
      lines: [
        {
          memberEmploymentProfileId: "ep-org",
          availabilityType: "PREFERRED_TIME",
          taxonomyCode: "SHIFT_CHANGE",
          availabilityDate: "2026-06-15",
          preferredStartLocalTime: "12:00",
          preferredEndLocalTime: "09:00",
          reason: "Preferred time must have valid ordering",
        },
      ],
    }),
    payload({
      lines: [
        {
          memberEmploymentProfileId: "ep-org",
          availabilityType: "UNAVAILABLE_FULL_DAY",
          taxonomyCode: "SICK_LEAVE",
          availabilityDate: "2026-07-01",
          reason: "Date must remain inside batch month",
        },
      ],
    }),
    payload({
      lines: [
        {
          memberEmploymentProfileId: "ep-org",
          availabilityType: "OTHER_AVAILABILITY_NOTE",
          taxonomyCode: "OTHER",
          availabilityDate: "2026-06-15",
          reason: "short",
        },
      ],
    }),
  ];

  for (const input of invalidPayloads) {
    await assert.rejects(
      withTrace(() =>
        service.submitManagerBatch(managerActor(), input as never),
      ),
      WorkScheduleValidationError,
    );
  }
});

test("unified target scope accepts exact OrgUnit and eligible TalentGroup members and rejects descendants, reporting, inactive, unlinked, mismatch, and role-name-only", async () => {
  const { service } = createService();
  await withTrace(() =>
    service.submitManagerBatch(managerActor(), payload()),
  );
  await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      payload({
        targetType: "TALENT_GROUP",
        targetOrgUnitId: null,
        targetTalentGroupId: "group-managed",
        lines: [
          {
            memberEmploymentProfileId: "ep-tg",
            availabilityType: "OTHER_AVAILABILITY_NOTE",
            taxonomyCode: "OTHER",
            availabilityDate: "2026-06-20",
            reason: "Advisory availability note for roster planning",
          },
        ],
      }),
    ),
  );

  for (const memberEmploymentProfileId of [
    "ep-descendant",
    "ep-reporting",
    "ep-tg",
  ]) {
    await assert.rejects(
      withTrace(() =>
        service.submitManagerBatch(
          managerActor(),
          payload({
            lines: [
              {
                memberEmploymentProfileId,
                availabilityType: "UNAVAILABLE_FULL_DAY",
                taxonomyCode: "OTHER",
                availabilityDate: "2026-06-22",
                reason: "Member is outside exact selected target scope",
              },
            ],
          }),
        ),
      ),
      WorkSchedulePermissionScopeError,
    );
  }

  for (const memberEmploymentProfileId of ["ep-inactive", "ep-org"]) {
    await assert.rejects(
      withTrace(() =>
        service.submitManagerBatch(
          managerActor(),
          payload({
            targetType: "TALENT_GROUP",
            targetOrgUnitId: null,
            targetTalentGroupId: "group-managed",
            lines: [
              {
                memberEmploymentProfileId,
                availabilityType: "OTHER_AVAILABILITY_NOTE",
                taxonomyCode: "OTHER",
                availabilityDate: "2026-06-23",
                reason: "Ineligible TalentGroup membership is denied",
              },
            ],
          }),
        ),
      ),
      WorkSchedulePermissionScopeError,
    );
  }

  await assert.rejects(
    withTrace(() =>
      service.submitManagerBatch(
        managerActor("other-manager-user"),
        payload(),
      ),
    ),
    WorkSchedulePermissionScopeError,
  );
});

test("duplicate pending line is rejected and OTHER note defaults advisory-only without drafts", async () => {
  const { service, repository } = createService();
  const first = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      payload({
        lines: [
          {
            memberEmploymentProfileId: "ep-org",
            availabilityType: "OTHER_AVAILABILITY_NOTE",
            taxonomyCode: "OTHER",
            availabilityDate: "2026-06-25",
            reason: "General advisory planning note for this member",
          },
        ],
      }),
    ),
  );
  assert.equal(first.lines[0]?.applyStatus, "ADVISORY_ONLY");
  assert.equal(repository.batches[0]?.status, "PENDING");

  await assert.rejects(
    withTrace(() =>
      service.submitManagerBatch(
        managerActor(),
        payload({
          lines: [
            {
              memberEmploymentProfileId: "ep-org",
              availabilityType: "OTHER_AVAILABILITY_NOTE",
              taxonomyCode: "OTHER",
              availabilityDate: "2026-06-25",
              reason: "General advisory planning note for this member",
            },
          ],
        }),
      ),
    ),
    WorkScheduleConflictError,
  );
});

test("partial unique pendingDuplicateKey remains the atomic fallback when lookup races", async () => {
  const repository = new AtomicDuplicateAvailabilityRepository();
  const { service } = createService(repository);
  const first = await withTrace(() =>
    service.submitManagerBatch(managerActor(), payload()),
  );

  assert.match(first.lines[0]?.pendingDuplicateKey ?? "", /^[a-f0-9]{64}$/);
  await assert.rejects(
    withTrace(() =>
      service.submitManagerBatch(managerActor(), payload()),
    ),
    WorkScheduleConflictError,
  );
  assert.equal(repository.batches.length, 1);
});

test("manager cancels own pending line and batch but cannot cancel another manager or terminal line", async () => {
  const { service } = createService();
  const batch = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      payload({
        lines: [
          payload().lines[0],
          {
            ...payload().lines[0],
            availabilityDate: "2026-06-16",
            reason: "Second availability planning signal",
          },
        ],
      }),
    ),
  );
  const listed = await service.listManagerBatches(managerActor(), {
    periodMonth: "2026-06",
  });
  assert.equal(listed.items.length, 1);
  assert.equal(
    (
      await service.getManagerBatchDetail(managerActor(), {
        batchId: batch.id,
      })
    ).id,
    batch.id,
  );
  const afterLine = await withTrace(() =>
    service.cancelManagerLine(managerActor(), {
      batchId: batch.id,
      lineId: batch.lines[0]!.id,
      cancellationReason: "Cancel line because member plan changed",
    }),
  );
  assert.equal(afterLine.lineCounts.cancelled, 1);
  await assert.rejects(
    withTrace(() =>
      service.cancelManagerLine(managerActor(), {
        batchId: batch.id,
        lineId: batch.lines[0]!.id,
        cancellationReason: "Cannot cancel an already cancelled line",
      }),
    ),
    WorkScheduleStateError,
  );
  await assert.rejects(
    withTrace(() =>
      service.cancelManagerLine(managerActor("other-manager-user"), {
        batchId: batch.id,
        lineId: batch.lines[1]!.id,
        cancellationReason: "Other manager must not cancel this line",
      }),
    ),
    WorkSchedulePermissionScopeError,
  );
  await assert.rejects(
    withTrace(() =>
      service.cancelManagerBatch(managerActor("other-manager-user"), {
        batchId: batch.id,
        cancellationReason: "Other manager must not cancel this batch",
      }),
    ),
    WorkSchedulePermissionScopeError,
  );
  await assert.rejects(
    withTrace(() =>
      service.cancelManagerBatch(managerActor(), {
        batchId: batch.id,
        cancellationReason: "",
      }),
    ),
    WorkScheduleValidationError,
  );
  await assert.rejects(
    withTrace(() =>
      service.cancelManagerLine(managerActor(), {
        batchId: batch.id,
        lineId: batch.lines[1]!.id,
        cancellationReason: "",
      }),
    ),
    WorkScheduleValidationError,
  );

  const pending = await withTrace(() =>
    service.submitManagerBatch(managerActor(), payload()),
  );
  const cancelled = await withTrace(() =>
    service.cancelManagerBatch(managerActor(), {
      batchId: pending.id,
      cancellationReason: "Cancel entire availability batch planning signal",
    }),
  );
  assert.equal(cancelled.status, "CANCELLED");
});

test("manager and Admin decisions reject every requested terminal availability transition", async () => {
  const { service } = createService();

  const approvedBatch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), payload()),
  );
  await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: approvedBatch.id,
      lineIds: [approvedBatch.lines[0]!.id],
    }),
  );
  await assert.rejects(
    withTrace(() =>
      service.cancelManagerLine(managerActor(), {
        batchId: approvedBatch.id,
        lineId: approvedBatch.lines[0]!.id,
        cancellationReason: "Manager cannot cancel an approved line",
      }),
    ),
    WorkScheduleStateError,
  );
  await assert.rejects(
    withTrace(() =>
      service.cancelAdminLines(opsActor(), {
        batchId: approvedBatch.id,
        lineIds: [approvedBatch.lines[0]!.id],
        cancellationReason: "Admin cannot cancel an approved line",
      }),
    ),
    WorkScheduleStateError,
  );
  await assert.rejects(
    withTrace(() =>
      service.rejectAdminLines(opsActor(), {
        batchId: approvedBatch.id,
        lineIds: [approvedBatch.lines[0]!.id],
        rejectionReason: "Admin cannot reject an approved line",
      }),
    ),
    WorkScheduleStateError,
  );

  const rejectedBatch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), payload()),
  );
  await withTrace(() =>
    service.rejectAdminLines(opsActor(), {
      batchId: rejectedBatch.id,
      lineIds: [rejectedBatch.lines[0]!.id],
      rejectionReason: "Reject this availability planning signal",
    }),
  );
  await assert.rejects(
    withTrace(() =>
      service.cancelManagerLine(managerActor(), {
        batchId: rejectedBatch.id,
        lineId: rejectedBatch.lines[0]!.id,
        cancellationReason: "Manager cannot cancel a rejected line",
      }),
    ),
    WorkScheduleStateError,
  );
  await assert.rejects(
    withTrace(() =>
      service.approveAdminLines(opsActor(), {
        batchId: rejectedBatch.id,
        lineIds: [rejectedBatch.lines[0]!.id],
      }),
    ),
    WorkScheduleStateError,
  );

  const cancelledBatch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), payload()),
  );
  await withTrace(() =>
    service.cancelAdminLines(opsActor(), {
      batchId: cancelledBatch.id,
      lineIds: [cancelledBatch.lines[0]!.id],
      cancellationReason: "Cancel this availability planning signal",
    }),
  );
  await assert.rejects(
    withTrace(() =>
      service.cancelManagerLine(managerActor(), {
        batchId: cancelledBatch.id,
        lineId: cancelledBatch.lines[0]!.id,
        cancellationReason: "Manager cannot cancel a cancelled line",
      }),
    ),
    WorkScheduleStateError,
  );
  await assert.rejects(
    withTrace(() =>
      service.approveAdminLines(opsActor(), {
        batchId: cancelledBatch.id,
        lineIds: [cancelledBatch.lines[0]!.id],
      }),
    ),
    WorkScheduleStateError,
  );
  await assert.rejects(
    withTrace(() =>
      service.rejectAdminLines(opsActor(), {
        batchId: cancelledBatch.id,
        lineIds: [cancelledBatch.lines[0]!.id],
        rejectionReason: "Admin cannot reject a cancelled line",
      }),
    ),
    WorkScheduleStateError,
  );
});

test("Admin availability queue and decisions require permission plus global scope", async () => {
  const { service } = createService();
  const batch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), payload()),
  );
  const permissionWithoutGlobal = adminActor(
    [Permission.WORK_SCHEDULE_READ, Permission.WORK_SCHEDULE_UPDATE],
    ["team"],
  );
  const globalWithoutRead = adminActor(
    [Permission.WORK_SCHEDULE_UPDATE],
    ["global"],
  );
  const globalWithoutUpdate = adminActor(
    [Permission.WORK_SCHEDULE_READ],
    ["global"],
  );

  for (const read of [
    () => service.listAdminBatches(permissionWithoutGlobal, {}),
    () =>
      service.getAdminBatchDetail(permissionWithoutGlobal, {
        batchId: batch.id,
      }),
  ]) {
    await assert.rejects(read(), WorkSchedulePermissionScopeError);
  }
  for (const read of [
    () => service.listAdminBatches(globalWithoutRead, {}),
    () =>
      service.getAdminBatchDetail(globalWithoutRead, {
        batchId: batch.id,
      }),
  ]) {
    await assert.rejects(read(), SystemInvariantError);
  }

  const decisions = [
    (actor: Actor) =>
      service.approveAdminLines(actor, {
        batchId: batch.id,
        lineIds: [batch.lines[0]!.id],
      }),
    (actor: Actor) =>
      service.rejectAdminLines(actor, {
        batchId: batch.id,
        lineIds: [batch.lines[0]!.id],
        rejectionReason: "Authority denial test rejection reason",
      }),
    (actor: Actor) =>
      service.cancelAdminLines(actor, {
        batchId: batch.id,
        lineIds: [batch.lines[0]!.id],
        cancellationReason: "Authority denial test cancellation reason",
      }),
  ];

  for (const decide of decisions) {
    await assert.rejects(
      decide(permissionWithoutGlobal),
      WorkSchedulePermissionScopeError,
    );
    await assert.rejects(decide(globalWithoutUpdate), SystemInvariantError);
    await assert.rejects(decide(managerActor()), SystemInvariantError);
  }
  await assert.rejects(
    service.listAdminBatches(managerActor(), {}),
    WorkSchedulePermissionScopeError,
  );
});

test("admin queue/read and line decisions update availability status only with derived counts", async () => {
  const { service } = createService();
  const batch = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      payload({
        lines: [
          payload().lines[0],
          {
            ...payload().lines[0],
            availabilityDate: "2026-06-17",
            reason: "Second availability decision line",
          },
          {
            ...payload().lines[0],
            availabilityDate: "2026-06-18",
            reason: "Third availability decision line",
          },
        ],
      }),
    ),
  );
  const listed = await service.listAdminBatches(opsActor(), {
    status: "PENDING",
    periodMonth: "2026-06",
    targetType: "ORG_UNIT",
  });
  assert.equal(listed.items.length, 1);
  assert.equal(
    (await service.getAdminBatchDetail(opsActor(), { batchId: batch.id })).id,
    batch.id,
  );

  const partial = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[0]!.id],
      adminDecisionNote: "Approved planning signal",
    }),
  );
  assert.equal(partial.status, "PARTIALLY_APPROVED");
  assert.equal(partial.lineCounts.approved, 1);
  assert.equal(partial.lines[0]?.applyStatus, "NOT_APPLIED");
  assert.equal(partial.lines[0]?.policyEvaluationStatus, "NOT_EVALUATED");

  const final = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[1]!.id, batch.lines[2]!.id],
    }),
  );
  assert.equal(final.status, "APPROVED");
  assert.equal(final.lineCounts.approved, 3);
  const serialized = JSON.stringify(final);
  assert.equal(serialized.includes("appliedWorkShiftId"), false);
  assert.equal(serialized.includes("rosterException"), false);
});

test("admin reject/cancel require reasons and derive REJECTED and CANCELLED terminal states", async () => {
  const { service } = createService();
  const rejectedBatch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), payload()),
  );
  await assert.rejects(
    withTrace(() =>
      service.rejectAdminLines(opsActor(), {
        batchId: rejectedBatch.id,
        lineIds: [rejectedBatch.lines[0]!.id],
      }),
    ),
    WorkScheduleValidationError,
  );
  const rejected = await withTrace(() =>
    service.rejectAdminLines(opsActor(), {
      batchId: rejectedBatch.id,
      lineIds: [rejectedBatch.lines[0]!.id],
      rejectionReason: "Reject because this planning signal is invalid",
    }),
  );
  assert.equal(rejected.status, "REJECTED");

  const cancelledBatch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), payload()),
  );
  await assert.rejects(
    withTrace(() =>
      service.cancelAdminLines(opsActor(), {
        batchId: cancelledBatch.id,
        lineIds: [cancelledBatch.lines[0]!.id],
      }),
    ),
    WorkScheduleValidationError,
  );
  const cancelled = await withTrace(() =>
    service.cancelAdminLines(opsActor(), {
      batchId: cancelledBatch.id,
      lineIds: [cancelledBatch.lines[0]!.id],
      cancellationReason: "Cancel because the signal is no longer relevant",
    }),
  );
  assert.equal(cancelled.status, "CANCELLED");
});

test("manager and admin DTOs omit raw actor, grant, payroll, and attendance internals", async () => {
  const { service } = createService();
  const batch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), payload()),
  );
  const approved = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[0]!.id],
    }),
  );
  for (const exposed of [
    exposeManagerAvailabilityBatch(approved),
    exposeAdminAvailabilityBatch(approved),
  ]) {
    const serialized = JSON.stringify(exposed);
    assert.equal(serialized.includes("submittedByActorId"), false);
    assert.equal(serialized.includes("approvedByActorId"), false);
    assert.equal(serialized.includes("pendingDuplicateKey"), false);
    assert.equal(serialized.includes("scopeGrants"), false);
    assert.equal(serialized.toLowerCase().includes("payroll"), false);
    assert.equal(serialized.toLowerCase().includes("attendance"), false);
    assert.equal(serialized.includes("ops-user"), false);
  }
});
