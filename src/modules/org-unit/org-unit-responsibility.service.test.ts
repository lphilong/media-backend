import assert from "node:assert/strict";
import test from "node:test";
import {
  ClientSession,
  Collection,
  Db,
  Document as MongoDocument,
  Filter,
  FindOptions,
  Sort,
} from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { ResponsibilityAdminService } from "@modules/responsibility/admin/admin.responsibility.service";
import {
  ResponsibilityAssignmentView,
} from "@modules/responsibility/domain/responsibility.types";
import { OrgUnitResponsibilityAdminService } from "@modules/org-unit/admin/admin.org-unit-responsibility.service";
import { NativeMongoOrgUnitManagerAssignmentRepository } from "@infra/mongo/kpi/org-unit-manager-assignment.repository";
import {
  OrgUnitConflictError,
  OrgUnitNotFoundError,
  OrgUnitStateError,
  OrgUnitValidationError,
} from "@modules/org-unit/domain/org-unit.errors";
import {
  FindLiveSiblingByNormalizedNameInput,
  OrgUnitRepository,
  RewriteOrgUnitHierarchyInput,
  TransitionOrgUnitStatusInput,
  UpdateOrgUnitProfileInput,
} from "@modules/org-unit/domain/org-unit.repository";
import { OrgUnitRecord, OrgUnitStatus } from "@modules/org-unit/domain/org-unit.types";
import {
  OrgUnitManagerAssignmentRepository,
  OrgUnitManagerEmploymentProfileCandidate,
  RevokeOrgUnitManagerAssignmentInput,
  UpdateOrgUnitManagerAssignmentInput,
} from "@modules/kpi/domain/org-unit-manager-assignment.repository";
import {
  OrgUnitManagerAssignment,
  OrgUnitManagerRole,
  TalentGroupManagerAssignment,
} from "@modules/kpi/domain/kpi.types";
import { resolveManagedUnitAuthority } from "@modules/kpi/domain/managed-unit-authority";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";

const NOW = 1_800_000_000_000;

test("Org Unit responsibilities list returns safe manager summaries", async () => {
  const harness = createHarness();
  harness.assignmentRepository.assignments.push(
    activeAssignment({ role: "DEPARTMENT_OWNER" }),
    activeAssignment({
      id: "assignment-2",
      managerEmploymentProfileId: "ep-2",
      role: "UNIT_OPERATOR",
      includeDescendants: true,
      isPrimary: false,
    }),
  );

  const result = await harness.service.listResponsibilities(createActor(), {
    orgUnitId: "org-1",
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.orgUnitRef.code, "OU-000001");
  assert.equal(result.items[0]?.managerRef.code, "EP-000001");
  assert.equal(result.items[0]?.managerRef.title, "Operations Lead");
  assert.equal("linkedUserRef" in result.items[0]!, false);
});

test("Org Unit responsibility create supports all accepted roles", async () => {
  const harness = createHarness();

  for (const role of [
    "DEPARTMENT_OWNER",
    "UNIT_MANAGER",
    "UNIT_OPERATOR",
  ] satisfies OrgUnitManagerRole[]) {
    const result = await runWithTrace(() =>
      harness.service.createResponsibility(createActor(), {
        orgUnitId: "org-1",
        managerEmploymentProfileId: `ep-${role}`,
        role,
        includeDescendants: role !== "UNIT_MANAGER",
        isPrimary: role === "DEPARTMENT_OWNER",
      }),
    );

    assert.equal(result.role, role);
    assert.equal(result.actionMask.length, 0);
  }

  assert.equal(harness.assignmentRepository.assignments.length, 3);
  assert.equal(harness.audit.records.length, 3);
});

test("Org Unit responsibility rejects invalid role and missing Org Unit", async () => {
  const harness = createHarness();

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createResponsibility(createActor(), {
        orgUnitId: "org-1",
        managerEmploymentProfileId: "ep-1",
        role: "MANAGER",
      }),
    ),
    OrgUnitValidationError,
  );

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createResponsibility(createActor(), {
        orgUnitId: "missing-org",
        managerEmploymentProfileId: "ep-1",
        role: "UNIT_MANAGER",
      }),
    ),
    OrgUnitNotFoundError,
  );
});

test("Org Unit responsibility rejects inactive Org Unit and inactive manager profile", async () => {
  const harness = createHarness();

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createResponsibility(createActor(), {
        orgUnitId: "org-inactive",
        managerEmploymentProfileId: "ep-1",
        role: "UNIT_MANAGER",
      }),
    ),
    OrgUnitStateError,
  );

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createResponsibility(createActor(), {
        orgUnitId: "org-1",
        managerEmploymentProfileId: "ep-terminated",
        role: "UNIT_MANAGER",
      }),
    ),
    OrgUnitValidationError,
  );
});

test("Org Unit responsibility rejects effectiveTo before effectiveFrom and duplicate active overlap", async () => {
  const harness = createHarness();
  harness.assignmentRepository.assignments.push(activeAssignment({}));

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createResponsibility(createActor(), {
        orgUnitId: "org-1",
        managerEmploymentProfileId: "ep-2",
        role: "UNIT_MANAGER",
        effectiveFrom: NOW,
        effectiveTo: NOW - 1,
      }),
    ),
    OrgUnitValidationError,
  );

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createResponsibility(createActor(), {
        orgUnitId: "org-1",
        managerEmploymentProfileId: "ep-1",
        role: "UNIT_MANAGER",
        effectiveFrom: NOW - 100,
      }),
    ),
    OrgUnitConflictError,
  );
});

test("Org Unit responsibility update edits safe metadata and revoke deactivates", async () => {
  const harness = createHarness();
  harness.assignmentRepository.assignments.push(activeAssignment({}));

  const updated = await runWithTrace(() =>
    harness.service.updateResponsibility(createActor(), {
      orgUnitId: "org-1",
      assignmentId: "assignment-1",
      role: "DEPARTMENT_OWNER",
      includeDescendants: true,
      effectiveTo: NOW + 10_000,
      isPrimary: false,
    }),
  );

  assert.equal(updated.role, "DEPARTMENT_OWNER");
  assert.equal(updated.includeDescendants, true);
  assert.equal(updated.isPrimary, false);
  assert.equal(updated.effectiveTo, NOW + 10_000);

  const revoked = await runWithTrace(() =>
    harness.service.revokeResponsibility(createActor(), {
      orgUnitId: "org-1",
      assignmentId: "assignment-1",
      reason: "responsibility no longer applies",
    }),
  );

  assert.equal(revoked.status, "INACTIVE");
  assert.equal(revoked.effectiveTo, NOW);
  assert.equal(
    harness.audit.records[harness.audit.records.length - 1]?.metadata.reason,
    "responsibility no longer applies",
  );
});

test("Org Unit responsibility is visible to managed unit authority, while role template and reporting manager alone are not", async () => {
  const harness = createHarness();
  const actor = new Actor({
    id: "manager-user",
    type: "admin",
    context: "ADMIN",
    roles: ["TEAM_MANAGER"],
    permissions: [Permission.KPI_READ_PROGRESS],
    scopeGrants: { kpi: ["managedGroup"] },
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });

  const emptyAuthority = await resolveManagedUnitAuthority(actor, {
    subjectReadonlyAccess: {
      findActiveEmploymentProfileByLinkedUserId: async () => ({
        employmentProfileId: "ep-1",
      }),
    },
    managedScopeReader: harness.assignmentRepository,
  }, { asOf: NOW });

  assert.deepEqual(emptyAuthority?.scope.orgUnitIds, []);

  await runWithTrace(() =>
    harness.service.createResponsibility(createActor(), {
      orgUnitId: "org-1",
      managerEmploymentProfileId: "ep-1",
      role: "UNIT_MANAGER",
    }),
  );

  const authority = await resolveManagedUnitAuthority(actor, {
    subjectReadonlyAccess: {
      findActiveEmploymentProfileByLinkedUserId: async () => ({
        employmentProfileId: "ep-1",
      }),
    },
    managedScopeReader: harness.assignmentRepository,
  }, { asOf: NOW });

  assert.deepEqual(authority?.scope.orgUnitIds, ["org-1"]);
  assert.equal(authority?.scope.orgUnitScopes[0]?.role, "UNIT_MANAGER");
});

test("Native Mongo Org Unit manager assignment repository writes, updates, hydrates defaults, and revokes canonically", async () => {
  const fake = createNativeAssignmentFakeDb();
  const repository = new NativeMongoOrgUnitManagerAssignmentRepository(fake.db);

  const created = await repository.insertAssignment(
    activeAssignment({
      id: "assignment-native",
      role: "DEPARTMENT_OWNER",
      effectiveFrom: NOW - 5_000,
      isPrimary: false,
    }),
  );

  assert.equal(created.id, "assignment-native");
  assert.deepEqual(fake.assignmentDocs[0], {
    _id: "assignment-native",
    orgUnitId: "org-1",
    managerEmploymentProfileId: "ep-1",
    role: "DEPARTMENT_OWNER",
    includeDescendants: false,
    actionMask: [],
    effectiveFrom: NOW - 5_000,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: false,
    createdAt: NOW - 1_000,
    createdByActorId: "seed",
    updatedAt: NOW - 1_000,
    updatedByActorId: "seed",
  });

  fake.assignmentDocs.push(
    {
      _id: "assignment-defaults",
      orgUnitId: "org-1",
      managerEmploymentProfileId: "ep-2",
      role: "UNIT_MANAGER",
      effectiveFrom: NOW - 1_000,
      effectiveTo: null,
      status: "ACTIVE",
      createdAt: NOW - 1_000,
      createdByActorId: "seed",
      updatedAt: NOW - 1_000,
      updatedByActorId: "seed",
    },
    {
      _id: "assignment-inactive",
      orgUnitId: "org-1",
      managerEmploymentProfileId: "ep-1",
      role: "UNIT_MANAGER",
      includeDescendants: true,
      actionMask: ["future-metadata"],
      effectiveFrom: NOW - 1_000,
      effectiveTo: NOW + 10_000,
      status: "INACTIVE",
      isPrimary: true,
      createdAt: NOW - 1_000,
      createdByActorId: "seed",
      updatedAt: NOW - 1_000,
      updatedByActorId: "seed",
    },
    {
      _id: "assignment-expired",
      orgUnitId: "org-1",
      managerEmploymentProfileId: "ep-1",
      role: "UNIT_OPERATOR",
      includeDescendants: false,
      actionMask: [],
      effectiveFrom: NOW - 10_000,
      effectiveTo: NOW - 1,
      status: "ACTIVE",
      isPrimary: false,
      createdAt: NOW - 10_000,
      createdByActorId: "seed",
      updatedAt: NOW - 10_000,
      updatedByActorId: "seed",
    },
    {
      _id: "assignment-other-org",
      orgUnitId: "org-2",
      managerEmploymentProfileId: "ep-1",
      role: "UNIT_MANAGER",
      includeDescendants: false,
      actionMask: [],
      effectiveFrom: NOW - 1_000,
      effectiveTo: null,
      status: "ACTIVE",
      isPrimary: false,
      createdAt: NOW - 1_000,
      createdByActorId: "seed",
      updatedAt: NOW - 1_000,
      updatedByActorId: "seed",
    },
  );

  const listed = await repository.listAssignmentsByOrgUnitId("org-1");
  assert.deepEqual(
    listed.map((assignment) => assignment.id).sort(),
    [
      "assignment-defaults",
      "assignment-expired",
      "assignment-inactive",
      "assignment-native",
    ].sort(),
  );
  const defaulted = listed.find(
    (assignment) => assignment.id === "assignment-defaults",
  );
  assert.ok(defaulted);
  assert.equal(defaulted.includeDescendants, false);
  assert.deepEqual(defaulted.actionMask, []);
  assert.equal(defaulted.isPrimary, false);
  assert.equal(defaulted.status, "ACTIVE");
  assert.equal(defaulted.effectiveFrom, NOW - 1_000);
  assert.equal(defaulted.effectiveTo, null);

  const activeBeforeUpdate =
    await repository.listActiveByManagerEmploymentProfileId("ep-1", NOW);
  assert.deepEqual(
    activeBeforeUpdate.map((assignment) => assignment.id).sort(),
    ["assignment-native", "assignment-other-org"].sort(),
  );

  const updated = await repository.updateAssignment({
    assignmentId: "assignment-native",
    role: "UNIT_OPERATOR",
    includeDescendants: true,
    effectiveFrom: NOW - 4_000,
    effectiveTo: NOW + 4_000,
    isPrimary: true,
    updatedAt: NOW + 1,
    updatedByActorId: "admin-user",
  });

  assert.ok(updated);
  assert.equal(updated.role, "UNIT_OPERATOR");
  assert.equal(updated.includeDescendants, true);
  assert.equal(updated.effectiveFrom, NOW - 4_000);
  assert.equal(updated.effectiveTo, NOW + 4_000);
  assert.equal(updated.isPrimary, true);
  assert.equal(updated.updatedAt, NOW + 1);
  assert.equal(updated.updatedByActorId, "admin-user");
  assert.deepEqual(
    fake.assignmentDocs.find((doc) => doc._id === "assignment-native"),
    {
      _id: "assignment-native",
      orgUnitId: "org-1",
      managerEmploymentProfileId: "ep-1",
      role: "UNIT_OPERATOR",
      includeDescendants: true,
      actionMask: [],
      effectiveFrom: NOW - 4_000,
      effectiveTo: NOW + 4_000,
      status: "ACTIVE",
      isPrimary: true,
      createdAt: NOW - 1_000,
      createdByActorId: "seed",
      updatedAt: NOW + 1,
      updatedByActorId: "admin-user",
    },
  );

  assert.equal(
    await repository.updateAssignment({
      assignmentId: "assignment-inactive",
      role: "UNIT_MANAGER",
      updatedAt: NOW + 2,
      updatedByActorId: "admin-user",
    }),
    null,
  );

  const activeByOrg = await repository.listActiveByOrgUnitId("org-1", NOW);
  assert.deepEqual(
    activeByOrg.map((assignment) => assignment.id).sort(),
    ["assignment-defaults", "assignment-native"].sort(),
  );
  const activeByRole =
    await repository.listActiveByManagerEmploymentProfileIdAndRole(
      "ep-1",
      "UNIT_OPERATOR",
      NOW,
    );
  assert.deepEqual(
    activeByRole.map((assignment) => assignment.id),
    ["assignment-native"],
  );

  const docCountBeforeRevoke = fake.assignmentDocs.length;
  const revoked = await repository.revokeAssignment({
    assignmentId: "assignment-native",
    effectiveTo: NOW + 3_000,
    updatedAt: NOW + 3,
    updatedByActorId: "admin-user",
  });

  assert.ok(revoked);
  assert.equal(revoked.status, "INACTIVE");
  assert.equal(revoked.effectiveTo, NOW + 3_000);
  assert.equal(revoked.updatedAt, NOW + 3);
  assert.equal(fake.assignmentDocs.length, docCountBeforeRevoke);
  assert.equal(fake.assignmentCollection.deleteCallCount, 0);
  assert.equal(
    await repository.revokeAssignment({
      assignmentId: "assignment-native",
      effectiveTo: NOW + 3_100,
      updatedAt: NOW + 4,
      updatedByActorId: "admin-user",
    }),
    null,
  );

  const activeAfterRevoke =
    await repository.listActiveByManagerEmploymentProfileId("ep-1", NOW);
  assert.deepEqual(
    activeAfterRevoke.map((assignment) => assignment.id),
    ["assignment-other-org"],
  );

  assert.deepEqual(
    await repository.findManagerEmploymentProfileCandidate("ep-1"),
    {
      id: "ep-1",
      employeeCode: "EP-000001",
      legalName: "Alice Nguyen",
      displayName: "Alice",
      jobTitle: "Director",
      employmentStatus: "ACTIVE",
    },
  );
});

function createHarness(): {
  readonly service: OrgUnitResponsibilityAdminService;
  readonly assignmentRepository: InMemoryOrgUnitManagerAssignmentRepository;
  readonly audit: RecordingAudit;
} {
  const orgUnitRepository = new InMemoryOrgUnitRepository();
  const assignmentRepository = new InMemoryOrgUnitManagerAssignmentRepository();
  const audit = new RecordingAudit();
  const service = new OrgUnitResponsibilityAdminService(
    orgUnitRepository,
    assignmentRepository,
    audit as unknown as AuditGuard,
    new ImmediateMutationBridge(),
    createOrgUnitStructuredAuthority(),
    new FakeResponsibilityService(
      assignmentRepository,
    ) as unknown as ResponsibilityAdminService,
    () => NOW,
  );
  return { service, assignmentRepository, audit };
}

function createOrgUnitStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(userId: string) {
      return [
        {
          assignment: {
            assignmentId: "assignment-org-unit-test",
            roleId: "role-org-unit-test",
            userId,
            structuredScopeGrants: [
              { scopeType: "managedOrgUnit" as const, targetId: "org-1" },
              {
                scopeType: "managedOrgUnit" as const,
                targetId: "org-inactive",
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
            id: "role-org-unit-test",
            state: "ACTIVE",
            permissions: [
              Permission.ORG_UNIT_READ,
              Permission.ORG_UNIT_UPDATE,
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
    permissions: [Permission.ORG_UNIT_READ, Permission.ORG_UNIT_UPDATE],
    scopeGrants: {},
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
}

function runWithTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId("trace-org-unit-responsibility", fn);
}

function activeAssignment(
  overrides: Partial<OrgUnitManagerAssignment>,
): OrgUnitManagerAssignment {
  return {
    id: "assignment-1",
    orgUnitId: "org-1",
    managerEmploymentProfileId: "ep-1",
    role: "UNIT_MANAGER",
    includeDescendants: false,
    actionMask: [],
    effectiveFrom: NOW - 1_000,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: true,
    createdAt: NOW - 1_000,
    createdByActorId: "seed",
    updatedAt: NOW - 1_000,
    updatedByActorId: "seed",
    ...overrides,
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

class InMemoryOrgUnitRepository implements OrgUnitRepository {
  private readonly orgUnits = new Map<string, OrgUnitRecord>([
    ["org-1", orgUnit({ id: "org-1", status: "ACTIVE" })],
    ["org-inactive", orgUnit({ id: "org-inactive", status: "INACTIVE" })],
  ]);

  async findById(orgUnitId: string): Promise<OrgUnitRecord | null> {
    return this.orgUnits.get(orgUnitId) ?? null;
  }

  async insert(): Promise<OrgUnitRecord> {
    throw new Error("Not implemented");
  }
  async findByCode(): Promise<OrgUnitRecord | null> {
    throw new Error("Not implemented");
  }
  async findMaxGeneratedCodeSequence(): Promise<number> {
    throw new Error("Not implemented");
  }
  async findLiveSiblingByNormalizedName(
    _input: FindLiveSiblingByNormalizedNameInput,
  ): Promise<OrgUnitRecord | null> {
    throw new Error("Not implemented");
  }
  async updateProfile(
    _input: UpdateOrgUnitProfileInput,
  ): Promise<OrgUnitRecord | null> {
    throw new Error("Not implemented");
  }
  async rewriteHierarchy(
    _input: RewriteOrgUnitHierarchyInput,
  ): Promise<OrgUnitRecord | null> {
    throw new Error("Not implemented");
  }
  async transitionStatus(
    _input: TransitionOrgUnitStatusInput,
  ): Promise<OrgUnitRecord | null> {
    throw new Error("Not implemented");
  }
  async listDescendants(): Promise<readonly OrgUnitRecord[]> {
    throw new Error("Not implemented");
  }
  async hasDescendantWithStatuses(): Promise<boolean> {
    throw new Error("Not implemented");
  }
  async hasNonArchivedDescendants(): Promise<boolean> {
    throw new Error("Not implemented");
  }
}

function orgUnit(overrides: {
  readonly id: string;
  readonly status: OrgUnitStatus;
}): OrgUnitRecord {
  return {
    id: overrides.id,
    code: "OU-000001",
    searchCode: "ou-000001",
    name: "Operations",
    normalizedName: "operations",
    type: "DEPARTMENT",
    status: overrides.status,
    parentOrgUnitId: null,
    ancestorChain: [],
    depth: 0,
    displayOrder: 1,
    description: null,
    externalRef: null,
    createdAt: NOW - 10_000,
    updatedAt: NOW - 10_000,
  };
}

class InMemoryOrgUnitManagerAssignmentRepository
  implements OrgUnitManagerAssignmentRepository
{
  readonly assignments: OrgUnitManagerAssignment[] = [];

  private readonly candidates = new Map<
    string,
    OrgUnitManagerEmploymentProfileCandidate
  >([
    candidate("ep-1", "ACTIVE", "Operations Lead"),
    candidate("ep-2", "ON_LEAVE", "Department Owner"),
    candidate("ep-DEPARTMENT_OWNER", "ACTIVE", "Department Owner"),
    candidate("ep-UNIT_MANAGER", "ACTIVE", "Unit Manager"),
    candidate("ep-UNIT_OPERATOR", "ACTIVE", "Unit Operator"),
    candidate("ep-terminated", "TERMINATED", "Former Manager"),
  ]);

  async insertAssignment(
    assignment: OrgUnitManagerAssignment,
  ): Promise<OrgUnitManagerAssignment> {
    this.assignments.push(assignment);
    return assignment;
  }

  async listAssignmentsByOrgUnitId(
    orgUnitId: string,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) => assignment.orgUnitId === orgUnitId,
    );
  }

  async listActiveByManagerEmploymentProfileId(
    managerEmploymentProfileId: string,
    asOf: number,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) =>
        assignment.managerEmploymentProfileId === managerEmploymentProfileId &&
        isActiveAt(assignment, asOf),
    );
  }

  async listActiveByManagerEmploymentProfileIdAndRole(
    managerEmploymentProfileId: string,
    role: OrgUnitManagerRole,
    asOf: number,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) =>
        assignment.managerEmploymentProfileId === managerEmploymentProfileId &&
        assignment.role === role &&
        isActiveAt(assignment, asOf),
    );
  }

  async listActiveByOrgUnitId(
    orgUnitId: string,
    asOf: number,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) => assignment.orgUnitId === orgUnitId && isActiveAt(assignment, asOf),
    );
  }

  async findAssignmentById(
    assignmentId: string,
  ): Promise<OrgUnitManagerAssignment | null> {
    return (
      this.assignments.find((assignment) => assignment.id === assignmentId) ??
      null
    );
  }

  async updateAssignment(
    input: UpdateOrgUnitManagerAssignmentInput,
  ): Promise<OrgUnitManagerAssignment | null> {
    const index = this.assignments.findIndex(
      (assignment) => assignment.id === input.assignmentId && assignment.status === "ACTIVE",
    );
    if (index < 0) {
      return null;
    }
    const current = this.assignments[index] as OrgUnitManagerAssignment;
    const updated: OrgUnitManagerAssignment = {
      ...current,
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.includeDescendants !== undefined
        ? { includeDescendants: input.includeDescendants }
        : {}),
      ...(input.effectiveFrom !== undefined
        ? { effectiveFrom: input.effectiveFrom }
        : {}),
      ...(input.effectiveTo !== undefined ? { effectiveTo: input.effectiveTo } : {}),
      ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    this.assignments[index] = updated;
    return updated;
  }

  async revokeAssignment(
    input: RevokeOrgUnitManagerAssignmentInput,
  ): Promise<OrgUnitManagerAssignment | null> {
    return this.updateAssignment({
      assignmentId: input.assignmentId,
      effectiveTo: input.effectiveTo,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    }).then((updated) => {
      if (!updated) {
        return null;
      }
      const revoked = { ...updated, status: "INACTIVE" as const };
      const index = this.assignments.findIndex(
        (assignment) => assignment.id === input.assignmentId,
      );
      this.assignments[index] = revoked;
      return revoked;
    });
  }

  async findManagerEmploymentProfileCandidate(
    employmentProfileId: string,
  ): Promise<OrgUnitManagerEmploymentProfileCandidate | null> {
    return this.candidates.get(employmentProfileId) ?? null;
  }

  readCandidate(
    employmentProfileId: string,
  ): OrgUnitManagerEmploymentProfileCandidate | null {
    return this.candidates.get(employmentProfileId) ?? null;
  }

  async resolveManagedScopeByResponsibleEmploymentProfile(input: {
    readonly responsibleEmploymentProfileId: string;
    readonly asOf: number;
  }): Promise<{
    readonly talentGroupIds: readonly string[];
    readonly orgUnitIds: readonly string[];
    readonly orgUnitScopes: readonly {
      readonly orgUnitId: string;
      readonly role: string | null;
      readonly includeDescendants: boolean;
      readonly actionMask: readonly string[];
      readonly isPrimary: boolean;
    }[];
  }> {
    const assignments = await this.listActiveByManagerEmploymentProfileId(
      input.responsibleEmploymentProfileId,
      input.asOf,
    );
    const orgUnitScopes = assignments.map((assignment) => ({
      orgUnitId: assignment.orgUnitId,
      role: assignment.role,
      includeDescendants: assignment.includeDescendants,
      actionMask: assignment.actionMask,
      isPrimary: assignment.isPrimary,
    }));
    return {
      talentGroupIds: [],
      orgUnitIds: [...new Set(orgUnitScopes.map((scope) => scope.orgUnitId))],
      orgUnitScopes,
    };
  }
}

class FakeResponsibilityService {
  private readonly revokedReasons = new Map<string, string>();

  constructor(private readonly repository: InMemoryOrgUnitManagerAssignmentRepository) {}

  async getSummaryForSubject(
    _actor: Actor,
    subjectType: string,
    subjectId: string,
  ): Promise<{ readonly items: readonly ResponsibilityAssignmentView[] }> {
    if (subjectType !== "ORG_UNIT") {
      return { items: [] };
    }
    const assignments = await this.repository.listActiveByOrgUnitId(
      subjectId,
      NOW,
    );
    return { items: assignments.map((assignment) => this.toView(assignment)) };
  }

  async createOrgUnitResponsibility(
    _actor: Actor,
    command: {
      readonly orgUnitId: string;
      readonly managerEmploymentProfileId: string;
      readonly role?: string;
      readonly includeDescendants?: boolean;
      readonly effectiveFrom?: number | string | null;
      readonly effectiveTo?: number | string | null;
      readonly isPrimary?: boolean;
    },
  ): Promise<ResponsibilityAssignmentView> {
    if (command.orgUnitId === "org-inactive") {
      throw new OrgUnitStateError("Managed subject must be active");
    }
    const candidate =
      await this.repository.findManagerEmploymentProfileCandidate(
        command.managerEmploymentProfileId,
      );
    if (!candidate || !["ACTIVE", "ON_LEAVE"].includes(candidate.employmentStatus)) {
      throw new OrgUnitValidationError("Responsible employment profile is invalid");
    }
    const effectiveFrom =
      typeof command.effectiveFrom === "number" ? command.effectiveFrom : NOW;
    const effectiveTo =
      typeof command.effectiveTo === "number" ? command.effectiveTo : null;
    const existing =
      await this.repository.listActiveByManagerEmploymentProfileId(
        command.managerEmploymentProfileId,
        NOW,
      );
    if (existing.some((assignment) => assignment.orgUnitId === command.orgUnitId)) {
      throw new OrgUnitConflictError("Duplicate active responsibility");
    }
    const assignment = await this.repository.insertAssignment({
      id: `assignment-${this.repository.assignments.length + 1}`,
      orgUnitId: command.orgUnitId,
      managerEmploymentProfileId: command.managerEmploymentProfileId,
      role: (command.role ?? "UNIT_MANAGER") as OrgUnitManagerRole,
      includeDescendants: command.includeDescendants ?? false,
      actionMask: [],
      effectiveFrom,
      effectiveTo,
      status: "ACTIVE",
      isPrimary: command.isPrimary ?? false,
      createdAt: NOW,
      createdByActorId: "admin-user",
      updatedAt: NOW,
      updatedByActorId: "admin-user",
    });
    return this.toView(assignment);
  }

  async getAssignment(
    _actor: Actor,
    assignmentId: string,
  ): Promise<ResponsibilityAssignmentView> {
    const assignment = await this.repository.findAssignmentById(assignmentId);
    if (!assignment) {
      throw new OrgUnitNotFoundError(assignmentId);
    }
    return this.toView(assignment);
  }

  async updateAssignment(
    _actor: Actor,
    command: {
      readonly assignmentId: string;
      readonly responsibilityRole?: string | null;
      readonly includeDescendants?: boolean | null;
      readonly effectiveAt?: number;
      readonly expiresAt?: number | null;
      readonly isPrimary?: boolean;
    },
  ): Promise<ResponsibilityAssignmentView> {
    const updated = await this.repository.updateAssignment({
      assignmentId: command.assignmentId,
      role: command.responsibilityRole as OrgUnitManagerRole | undefined,
      includeDescendants: command.includeDescendants ?? undefined,
      effectiveFrom: command.effectiveAt,
      effectiveTo: command.expiresAt,
      isPrimary: command.isPrimary,
      updatedAt: NOW,
      updatedByActorId: "admin-user",
    });
    if (!updated) {
      throw new OrgUnitNotFoundError(command.assignmentId);
    }
    return this.toView(updated);
  }

  async revokeAssignment(
    _actor: Actor,
    command: { readonly assignmentId: string; readonly reason: string },
  ): Promise<ResponsibilityAssignmentView> {
    this.revokedReasons.set(command.assignmentId, command.reason);
    const revoked = await this.repository.revokeAssignment({
      assignmentId: command.assignmentId,
      effectiveTo: NOW,
      updatedAt: NOW,
      updatedByActorId: "admin-user",
    });
    if (!revoked) {
      throw new OrgUnitNotFoundError(command.assignmentId);
    }
    return this.toView(revoked, this.revokedReasons.get(command.assignmentId));
  }

  private toView(
    assignment: OrgUnitManagerAssignment,
    revokedReason: string | undefined = undefined,
  ): ResponsibilityAssignmentView {
    const candidate = this.repository.readCandidate(
      assignment.managerEmploymentProfileId,
    );
    return {
      id: assignment.id,
      subjectType: "ORG_UNIT",
      subjectId: assignment.orgUnitId,
      responsibleEmploymentProfileId: assignment.managerEmploymentProfileId,
      responsibilityType: "ORG_UNIT_MANAGER",
      responsibilityRole: assignment.role,
      includeDescendants: assignment.includeDescendants,
      actionMask: assignment.actionMask,
      isPrimary: assignment.isPrimary,
      status: assignment.status === "ACTIVE" ? "ACTIVE" : "REVOKED",
      effectiveAt: assignment.effectiveFrom,
      expiresAt: assignment.effectiveTo,
      revokedAt: assignment.status === "ACTIVE" ? null : assignment.effectiveTo,
      reason: null,
      createdBy: assignment.createdByActorId,
      createdAt: assignment.createdAt,
      updatedBy: assignment.updatedByActorId,
      updatedAt: assignment.updatedAt,
      revokedBy: assignment.status === "ACTIVE" ? null : assignment.updatedByActorId,
      revokedReason: revokedReason ?? null,
      reviewNeeded: false,
      reviewReason: null,
      subjectRef: {
        id: assignment.orgUnitId,
        code: "OU-000001",
        name: "Operations",
        status: "ACTIVE",
      },
      responsibleEmploymentProfileRef: candidate
        ? {
            id: candidate.id,
            code: candidate.employeeCode,
            displayName: candidate.displayName,
            name: candidate.legalName,
            title: candidate.jobTitle,
            status: candidate.employmentStatus,
          }
        : { id: assignment.managerEmploymentProfileId },
    };
  }
}

function candidate(
  id: string,
  employmentStatus: string,
  jobTitle: string,
): [string, OrgUnitManagerEmploymentProfileCandidate] {
  return [
    id,
    {
      id,
      employeeCode: id === "ep-1" ? "EP-000001" : id.toUpperCase(),
      displayName: `${id} Display`,
      legalName: `${id} Legal`,
      jobTitle,
      employmentStatus,
    },
  ];
}

class EmptyTalentGroupManagerRepository
  implements Pick<TalentGroupManagerAssignmentRepository, "listActiveAssignmentsByManagerEmploymentProfile">
{
  async listActiveAssignmentsByManagerEmploymentProfile(): Promise<
    readonly TalentGroupManagerAssignment[]
  > {
    return [];
  }
}

function isActiveAt(
  assignment: OrgUnitManagerAssignment,
  asOf: number,
): boolean {
  return (
    assignment.status === "ACTIVE" &&
    assignment.effectiveFrom <= asOf &&
    (assignment.effectiveTo === null || assignment.effectiveTo >= asOf)
  );
}

function createNativeAssignmentFakeDb(): {
  readonly db: Db;
  readonly assignmentDocs: MongoDocument[];
  readonly assignmentCollection: MutableFakeCollection;
} {
  const assignmentDocs: MongoDocument[] = [];
  const assignmentCollection = new MutableFakeCollection(assignmentDocs);
  const employmentProfileCollection = new MutableFakeCollection([
    {
      _id: "ep-1",
      employeeCode: "EP-000001",
      legalName: "Alice Nguyen",
      displayName: "Alice",
      jobTitle: "Director",
      employmentStatus: "ACTIVE",
      hiddenField: "must not project",
    },
  ]);

  return {
    assignmentDocs,
    assignmentCollection,
    db: {
      collection<TSchema extends MongoDocument = MongoDocument>(
        name: string,
      ): Collection<TSchema> {
        if (name === "org_unit_manager_assignments") {
          return assignmentCollection as unknown as Collection<TSchema>;
        }
        if (name === "employment_profiles") {
          return employmentProfileCollection as unknown as Collection<TSchema>;
        }
        throw new Error(`Unexpected fake collection ${name}`);
      },
    } as Db,
  };
}

class MutableFakeCollection {
  deleteCallCount = 0;

  constructor(private readonly docs: MongoDocument[]) {}

  async insertOne(doc: MongoDocument): Promise<{ insertedId: unknown }> {
    this.docs.push({ ...doc });
    return { insertedId: doc._id };
  }

  find(filter: Filter<MongoDocument>, options?: FindOptions<MongoDocument>) {
    let rows = this.docs
      .filter((doc) => matchesFakeFilter(doc, filter as MongoDocument))
      .map((doc) => applyFakeProjection(doc, options?.projection));

    return {
      sort(sort: Sort) {
        rows = [...rows].sort((left, right) =>
          compareFakeDocuments(left, right, sort),
        );
        return this;
      },
      async toArray() {
        return rows.map((doc) => ({ ...doc }));
      },
    };
  }

  async findOne(
    filter: Filter<MongoDocument>,
    options?: FindOptions<MongoDocument>,
  ): Promise<MongoDocument | null> {
    const doc =
      this.docs.find((candidate) =>
        matchesFakeFilter(candidate, filter as MongoDocument),
      ) ?? null;
    return doc ? applyFakeProjection(doc, options?.projection) : null;
  }

  async findOneAndUpdate(
    filter: Filter<MongoDocument>,
    update: { readonly $set?: MongoDocument },
  ): Promise<MongoDocument | null> {
    const doc = this.docs.find((candidate) =>
      matchesFakeFilter(candidate, filter as MongoDocument),
    );
    if (!doc) {
      return null;
    }

    Object.assign(doc, update.$set ?? {});
    return { ...doc };
  }

  async deleteOne(): Promise<never> {
    this.deleteCallCount += 1;
    throw new Error("Physical delete is not allowed in this fake seam");
  }
}

function matchesFakeFilter(doc: MongoDocument, filter: MongoDocument): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") {
      return (condition as readonly MongoDocument[]).some((candidate) =>
        matchesFakeFilter(doc, candidate),
      );
    }

    const value = doc[key];
    if (!isFakeDocument(condition)) {
      return value === condition;
    }

    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === "$lte") {
        return typeof value === "number" && value <= (expected as number);
      }
      if (operator === "$gte") {
        return typeof value === "number" && value >= (expected as number);
      }
      if (operator === "$in") {
        return (expected as readonly unknown[]).includes(value);
      }
      assert.fail(`Unsupported fake Mongo operator ${operator}`);
    });
  });
}

function applyFakeProjection(
  doc: MongoDocument,
  projection: MongoDocument | undefined,
): MongoDocument {
  if (!projection) {
    return { ...doc };
  }

  const output: MongoDocument = {};
  for (const [key, included] of Object.entries(projection)) {
    if (included && key in doc) {
      output[key] = doc[key];
    }
  }
  if (!("_id" in projection) && "_id" in doc) {
    output._id = doc._id;
  }
  return output;
}

function compareFakeDocuments(
  left: MongoDocument,
  right: MongoDocument,
  sort: Sort,
): number {
  for (const [key, direction] of Object.entries(sort)) {
    const compared = compareFakeValues(left[key], right[key]);
    if (compared !== 0) {
      return compared * Number(direction);
    }
  }
  return 0;
}

function compareFakeValues(left: unknown, right: unknown): number {
  if (left === right) {
    return 0;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function isFakeDocument(value: unknown): value is MongoDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
