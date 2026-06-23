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
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { TalentGroupManagerAssignmentAdminService } from "@modules/talent-group/admin/admin.talent-group-manager-assignment.service";
import {
  TalentGroupConflictError,
  TalentGroupInvalidTalentReferenceError,
  TalentGroupNotFoundError,
  TalentGroupStateError,
} from "@modules/talent-group/domain/talent-group.errors";
import { TalentGroupRepository } from "@modules/talent-group/domain/talent-group.repository";
import {
  TalentGroupMemberRecord,
  TalentGroupRecord,
} from "@modules/talent-group/domain/talent-group.types";
import {
  RevokeTalentGroupManagerAssignmentInput,
  TalentGroupManagerAssignmentRepository,
  TalentGroupManagerEmploymentProfileCandidate,
} from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import { TalentGroupManagerAssignment } from "@modules/kpi/domain/kpi.types";

const NOW = 1_800_000_000_000;

test("Talent group manager assignment create succeeds with safe DTO and audit", async () => {
  const harness = createHarness();

  const result = await runWithTrace(() =>
    harness.service.createManagerAssignment(createActor(), {
      groupId: "group-1",
      managerEmploymentProfileId: "ep-1",
      reason: "smoke manager setup",
    }),
  );

  assert.equal(result.groupId, "group-1");
  assert.equal(result.managerEmploymentProfileId, "ep-1");
  assert.equal(result.managerHasLinkedAdminUser, true);
  assert.equal(result.groupRef.code, "TG-000001");
  assert.equal(result.managerRef.code, "EP-000001");
  assert.equal(harness.managerRepository.assignments.length, 1);
  assert.equal(harness.audit.records.length, 1);
  assert.equal(harness.audit.records[0]?.metadata.reason, "smoke manager setup");
  assert.equal("authSubject" in result, false);
});

test("Talent group manager assignment rejects duplicate active manager", async () => {
  const harness = createHarness();
  harness.managerRepository.assignments.push(activeAssignment());

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createManagerAssignment(createActor(), {
        groupId: "group-1",
        managerEmploymentProfileId: "ep-1",
      }),
    ),
    TalentGroupConflictError,
  );
});

test("Talent group manager assignment rejects missing or inactive group", async () => {
  const harness = createHarness();

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createManagerAssignment(createActor(), {
        groupId: "missing-group",
        managerEmploymentProfileId: "ep-1",
      }),
    ),
    TalentGroupNotFoundError,
  );

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createManagerAssignment(createActor(), {
        groupId: "group-inactive",
        managerEmploymentProfileId: "ep-1",
      }),
    ),
    TalentGroupStateError,
  );
});

test("Talent group manager assignment rejects missing or inactive employment profile", async () => {
  const harness = createHarness();

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createManagerAssignment(createActor(), {
        groupId: "group-1",
        managerEmploymentProfileId: "missing-ep",
      }),
    ),
    TalentGroupInvalidTalentReferenceError,
  );

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createManagerAssignment(createActor(), {
        groupId: "group-1",
        managerEmploymentProfileId: "ep-inactive",
      }),
    ),
    TalentGroupInvalidTalentReferenceError,
  );
});

test("Talent group manager assignment revoke deactivates and audits", async () => {
  const harness = createHarness();
  harness.managerRepository.assignments.push(activeAssignment());

  const result = await runWithTrace(() =>
    harness.service.revokeManagerAssignment(createActor(), {
      groupId: "group-1",
      assignmentId: "assignment-1",
      reason: "rotation",
    }),
  );

  assert.equal(result.status, "INACTIVE");
  assert.equal(result.effectiveTo, NOW);
  assert.equal(harness.audit.records.length, 1);
  assert.equal(harness.audit.records[0]?.metadata.reason, "rotation");
});

test("Talent group manager assignment list warns when manager lacks active admin user", async () => {
  const harness = createHarness();
  harness.managerRepository.assignments.push({
    ...activeAssignment(),
    id: "assignment-2",
    managerEmploymentProfileId: "ep-unlinked",
  });

  const result = await harness.service.listManagerAssignments(createActor(), {
    groupId: "group-1",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.managerHasLinkedAdminUser, false);
});

test("Talent group manager assignment supports multiple active managers and one primary", async () => {
  const harness = createHarness();

  const first = await runWithTrace(() =>
    harness.service.createManagerAssignment(createActor(), {
      groupId: "group-1",
      managerEmploymentProfileId: "ep-1",
    }),
  );
  const second = await runWithTrace(() =>
    harness.service.createManagerAssignment(createActor(), {
      groupId: "group-1",
      managerEmploymentProfileId: "ep-2",
    }),
  );

  assert.equal(first.isPrimary, true);
  assert.equal(second.isPrimary, false);

  const activeByGroup = await harness.service.listManagerAssignments(
    createActor(),
    {
      groupId: "group-1",
    },
  );
  assert.equal(activeByGroup.items.length, 2);
  assert.deepEqual(
    activeByGroup.items.map(
      (assignment) => assignment.managerEmploymentProfileId,
    ),
    ["ep-1", "ep-2"],
  );
  assert.equal(
    activeByGroup.items.filter((assignment) => assignment.isPrimary).length,
    1,
  );

  const activeByManager =
    await harness.managerRepository.listActiveAssignmentsByManagerEmploymentProfile(
      "ep-2",
      NOW,
    );
  assert.equal(activeByManager.length, 1);
  assert.equal(activeByManager[0]?.id, second.id);

  await runWithTrace(() =>
    harness.service.revokeManagerAssignment(createActor(), {
      groupId: "group-1",
      assignmentId: first.id,
    }),
  );

  const afterRevoke = await harness.service.listManagerAssignments(
    createActor(),
    {
      groupId: "group-1",
    },
  );
  assert.deepEqual(
    afterRevoke.items.map(
      (assignment) => assignment.managerEmploymentProfileId,
    ),
    ["ep-2"],
  );
});

function createHarness(): {
  readonly service: TalentGroupManagerAssignmentAdminService;
  readonly managerRepository: InMemoryManagerAssignmentRepository;
  readonly audit: RecordingAudit;
} {
  const groupRepository = new InMemoryTalentGroupRepository();
  const managerRepository = new InMemoryManagerAssignmentRepository();
  const audit = new RecordingAudit();
  const service = new TalentGroupManagerAssignmentAdminService(
    groupRepository,
    managerRepository,
    audit as unknown as AuditGuard,
    new ImmediateMutationBridge(),
    createTalentGroupStructuredAuthority(),
    () => NOW,
  );
  return { service, managerRepository, audit };
}

function createTalentGroupStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(userId: string) {
      return [
        {
          assignment: {
            assignmentId: "assignment-talent-group-test",
            roleId: "role-talent-group-test",
            userId,
            structuredScopeGrants: [
              {
                scopeType: "managedTalentGroup" as const,
                targetId: "group-1",
              },
              {
                scopeType: "managedTalentGroup" as const,
                targetId: "group-inactive",
              },
            ],
            state: "ACTIVE" as const,
            effectiveAt: 0,
            expiresAt: null,
            revokedAt: null,
            reason: null,
            createdAt: 0,
            updatedAt: 0,
          },
          role: {
            id: "role-talent-group-test",
            state: "ACTIVE",
            permissions: [
              Permission.TALENT_GROUP_READ,
              Permission.TALENT_GROUP_UPDATE,
            ],
          },
        },
      ];
    },
  });
}

function createActor(): Actor {
  return new Actor({
    id: "admin-user",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [Permission.TALENT_GROUP_READ, Permission.TALENT_GROUP_UPDATE],
    scopeGrants: {},
    isActive: true,
  });
}

function runWithTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId("trace-talent-group-manager-assignment", fn);
}

function activeAssignment(): TalentGroupManagerAssignment {
  return {
    id: "assignment-1",
    groupId: "group-1",
    managerEmploymentProfileId: "ep-1",
    role: "MANAGER",
    effectiveFrom: NOW - 1_000,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: true,
    createdAt: NOW - 1_000,
    createdByActorId: "seed",
    updatedAt: NOW - 1_000,
    updatedByActorId: "seed",
  };
}

class ImmediateMutationBridge implements AuthoritativeAdminMutationBridge {
  async execute<T>(
    _controls: Parameters<AuthoritativeAdminMutationBridge["execute"]>[0],
    fn: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
  ): Promise<T> {
    return fn(
      undefined as unknown as ClientSession,
      {} as AuthoritativeMutationControls,
    );
  }
}

class RecordingAudit {
  readonly records: Array<{
    readonly resourceId: string;
    readonly metadata: Record<string, unknown>;
  }> = [];

  async record(
    _actor: Actor,
    _permission: unknown,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    this.records.push({ resourceId, metadata });
  }
}

class InMemoryTalentGroupRepository implements TalentGroupRepository {
  private readonly groups = new Map<string, TalentGroupRecord>([
    [
      "group-1",
      {
        id: "group-1",
        groupCode: "TG-000001",
        name: "A Team",
        normalizedName: "a team",
        shortName: "A",
        normalizedShortName: "a",
        description: null,
        externalRef: null,
        status: "ACTIVE",
        displayOrder: 1,
        createdAt: NOW - 10_000,
        updatedAt: NOW - 10_000,
      },
    ],
    [
      "group-inactive",
      {
        id: "group-inactive",
        groupCode: "TG-000002",
        name: "B Team",
        normalizedName: "b team",
        shortName: null,
        normalizedShortName: null,
        description: null,
        externalRef: null,
        status: "INACTIVE",
        displayOrder: 2,
        createdAt: NOW - 10_000,
        updatedAt: NOW - 10_000,
      },
    ],
  ]);

  async findGroupById(groupId: string): Promise<TalentGroupRecord | null> {
    return this.groups.get(groupId) ?? null;
  }

  async insertGroup(): Promise<TalentGroupRecord> {
    throw new Error("Not implemented");
  }
  async findGroupByCode(): Promise<TalentGroupRecord | null> {
    throw new Error("Not implemented");
  }
  async findMaxGeneratedCodeSequence(): Promise<number> {
    throw new Error("Not implemented");
  }
  async findLiveGroupByNormalizedName(): Promise<TalentGroupRecord | null> {
    throw new Error("Not implemented");
  }
  async updateGroupCore(): Promise<TalentGroupRecord | null> {
    throw new Error("Not implemented");
  }
  async transitionGroupStatus(): Promise<TalentGroupRecord | null> {
    throw new Error("Not implemented");
  }
  async insertMember(): Promise<TalentGroupMemberRecord> {
    throw new Error("Not implemented");
  }
  async findMemberById(): Promise<TalentGroupMemberRecord | null> {
    throw new Error("Not implemented");
  }
  async findLiveMemberByGroupAndTalent(): Promise<TalentGroupMemberRecord | null> {
    throw new Error("Not implemented");
  }
  async findLiveMemberByGroupAndLineup(): Promise<TalentGroupMemberRecord | null> {
    throw new Error("Not implemented");
  }
  async updateMemberLineup(): Promise<TalentGroupMemberRecord | null> {
    throw new Error("Not implemented");
  }
  async transitionMemberStatus(): Promise<TalentGroupMemberRecord | null> {
    throw new Error("Not implemented");
  }
  async hasActiveMembers(): Promise<boolean> {
    throw new Error("Not implemented");
  }
  async hasNonRemovedMembers(): Promise<boolean> {
    throw new Error("Not implemented");
  }
}

class InMemoryManagerAssignmentRepository
  implements TalentGroupManagerAssignmentRepository
{
  readonly assignments: TalentGroupManagerAssignment[] = [];

  private readonly candidates = new Map<
    string,
    TalentGroupManagerEmploymentProfileCandidate
  >([
    [
      "ep-1",
      {
        id: "ep-1",
        employeeCode: "EP-000001",
        displayName: "Alice",
        legalName: "Alice Nguyen",
        employmentStatus: "ACTIVE",
        linkedUserId: "user-1",
        linkedUserRef: {
          id: "user-1",
          displayName: "Alice User",
          status: "ACTIVE",
        },
        linkedUserActorKind: "ADMIN",
        linkedUserAccountStatus: "ACTIVE",
      },
    ],
    [
      "ep-2",
      {
        id: "ep-2",
        employeeCode: "EP-000002",
        displayName: "Bao",
        legalName: "Bao Tran",
        employmentStatus: "ACTIVE",
        linkedUserId: null,
        linkedUserRef: null,
        linkedUserActorKind: null,
        linkedUserAccountStatus: null,
      },
    ],
    [
      "ep-unlinked",
      {
        id: "ep-unlinked",
        employeeCode: "EP-000004",
        displayName: "Chi",
        legalName: "Chi Pham",
        employmentStatus: "ACTIVE",
        linkedUserId: null,
        linkedUserRef: null,
        linkedUserActorKind: null,
        linkedUserAccountStatus: null,
      },
    ],
    [
      "ep-inactive",
      {
        id: "ep-inactive",
        employeeCode: "EP-000003",
        displayName: "Inactive",
        legalName: "Inactive Manager",
        employmentStatus: "SUSPENDED",
        linkedUserId: null,
        linkedUserRef: null,
        linkedUserActorKind: null,
        linkedUserAccountStatus: null,
      },
    ],
  ]);

  async insertAssignment(
    assignment: TalentGroupManagerAssignment,
  ): Promise<TalentGroupManagerAssignment> {
    this.assignments.push(assignment);
    return assignment;
  }

  async listActiveAssignmentsByGroup(
    groupId: string,
    asOf: number,
  ): Promise<readonly TalentGroupManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) =>
        assignment.groupId === groupId && isActiveAt(assignment, asOf),
    );
  }

  async findAssignmentById(
    assignmentId: string,
  ): Promise<TalentGroupManagerAssignment | null> {
    return (
      this.assignments.find((assignment) => assignment.id === assignmentId) ??
      null
    );
  }

  async listActiveAssignmentsByManagerEmploymentProfile(
    managerEmploymentProfileId: string,
    asOf: number,
  ): Promise<readonly TalentGroupManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) =>
        assignment.managerEmploymentProfileId ===
          managerEmploymentProfileId && isActiveAt(assignment, asOf),
    );
  }

  async revokeAssignment(
    input: RevokeTalentGroupManagerAssignmentInput,
  ): Promise<TalentGroupManagerAssignment | null> {
    const index = this.assignments.findIndex(
      (assignment) =>
        assignment.id === input.assignmentId &&
        isActiveAt(assignment, input.effectiveTo),
    );
    if (index < 0) {
      return null;
    }

    const current = this.assignments[index] as TalentGroupManagerAssignment;
    const updated: TalentGroupManagerAssignment = {
      ...current,
      status: "INACTIVE",
      effectiveTo: input.effectiveTo,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    this.assignments[index] = updated;
    return updated;
  }

  async findManagerEmploymentProfileCandidate(
    employmentProfileId: string,
  ): Promise<TalentGroupManagerEmploymentProfileCandidate | null> {
    return this.candidates.get(employmentProfileId) ?? null;
  }
}

function isActiveAt(
  assignment: TalentGroupManagerAssignment,
  asOf: number,
): boolean {
  return (
    assignment.status === "ACTIVE" &&
    assignment.effectiveFrom <= asOf &&
    (assignment.effectiveTo === null || assignment.effectiveTo >= asOf)
  );
}
