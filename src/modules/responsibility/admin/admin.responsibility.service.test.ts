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
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { NativeMongoResponsibilityAssignmentRepository } from "@infra/mongo/responsibility/responsibility.repository";
import { ReferenceSummary } from "@modules/reference-summary";
import { RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import {
  ResponsibilityNotFoundError,
  ResponsibilityPermissionScopeError,
  ResponsibilityValidationError,
} from "@modules/responsibility/domain/responsibility.errors";
import {
  ResponsibilityAssignmentFilters,
  ResponsibilityAssignmentRepository,
  RevokeResponsibilityAssignmentInput,
  UpdateResponsibilityAssignmentInput,
} from "@modules/responsibility/domain/responsibility.repository";
import {
  ResponsibilityAssignmentRecord,
  ResponsibilityAssignmentView,
  ResponsibilitySubjectType,
  ResponsibilityType,
} from "@modules/responsibility/domain/responsibility.types";
import { ResponsibilityAdminService } from "./admin.responsibility.service";

const NOW = 1_800_000_000_000;

test("central responsibility create writes only responsibility assignment state", async () => {
  const repository = new InMemoryResponsibilityRepository();
  const audit = new RecordingAudit();
  const mutationBridge = new RecordingMutationBridge();
  const service = new ResponsibilityAdminService(
    repository,
    audit as unknown as AuditGuard,
    mutationBridge,
    createStructuredAuthority(
      Permission.EMPLOYMENT_PROFILE_MANAGE_MANAGER_ASSIGNMENT,
      [{ scopeType: "global" }],
    ),
    () => NOW,
  );

  const created = await bindTraceId("trace-responsibility-central-create", () =>
    service.createEmploymentReportingManager(
      createActor([Permission.EMPLOYMENT_PROFILE_MANAGE_MANAGER_ASSIGNMENT]),
      {
        employmentProfileId: "ep-target",
        managerEmploymentProfileId: "ep-manager",
      },
    ),
  );

  assert.equal(created.subjectType, "EMPLOYMENT_PROFILE");
  assert.equal(created.subjectId, "ep-target");
  assert.equal(created.responsibilityType, "EMPLOYMENT_REPORTING_MANAGER");
  assert.equal(created.responsibleEmploymentProfileId, "ep-manager");
  assert.equal(repository.records.length, 1);
  assert.equal(audit.records.length, 1);
  assert.equal(mutationBridge.calls.length, 1);
  assert.equal(mutationBridge.authSecurityTruthChanges, 0);
});

test("responsibility read model ignores old direct manager fields", async () => {
  const fake = createResponsibilityFakeDb();
  const repository = new NativeMongoResponsibilityAssignmentRepository(fake.db);

  const talentRows = await repository.listNormalized({
    subjectType: "TALENT",
    responsibilityType: "TALENT_DIRECT_MANAGER",
    asOf: NOW,
  });
  assert.deepEqual(talentRows, []);

  const employmentRows = await repository.listNormalized({
    subjectType: "EMPLOYMENT_PROFILE",
    responsibilityType: "EMPLOYMENT_REPORTING_MANAGER",
    asOf: NOW,
  });
  assert.deepEqual(employmentRows, []);
});

test("inherited Talent responsibility excludes inactive subject lifecycle states", async () => {
  const fake = createResponsibilityFakeDb();
  const repository = new NativeMongoResponsibilityAssignmentRepository(fake.db);

  const active = await repository.listInheritedForTalent("talent-active", NOW);
  assert.equal(active.length, 1);
  assert.equal(active[0]?.id, "central-tg-assignment-1");
  assert.equal(active[0]?.responsibilityType, "TALENT_GROUP_MANAGER");

  for (const talentId of [
    "talent-suspended",
    "talent-inactive",
    "talent-archived",
  ]) {
    assert.deepEqual(await repository.listInheritedForTalent(talentId, NOW), []);
  }
});

test("inherited EmploymentProfile responsibility excludes terminated inactive subject lifecycle states", async () => {
  const fake = createResponsibilityFakeDb();
  const repository = new NativeMongoResponsibilityAssignmentRepository(fake.db);

  const active = await repository.listInheritedForEmploymentProfile("ep-active", NOW);
  assert.equal(active.length, 1);
  assert.equal(active[0]?.id, "central-ou-assignment-1");
  assert.equal(active[0]?.responsibilityType, "ORG_UNIT_MANAGER");

  const onLeave = await repository.listInheritedForEmploymentProfile("ep-on-leave", NOW);
  assert.equal(onLeave.length, 1);

  for (const employmentProfileId of [
    "ep-suspended",
    "ep-terminated",
    "ep-archived",
  ]) {
    assert.deepEqual(
      await repository.listInheritedForEmploymentProfile(employmentProfileId, NOW),
      [],
    );
  }
});

test("central responsibility managed scope resolves groups and descendant org units without old manager collections", async () => {
  const fake = createResponsibilityFakeDb();
  const repository = new NativeMongoResponsibilityAssignmentRepository(fake.db);

  const scope = await repository.resolveManagedScopeByResponsibleEmploymentProfile(
    {
      responsibleEmploymentProfileId: "ep-manager",
      asOf: NOW,
    },
  );

  assert.deepEqual(scope.talentGroupIds, ["group-1"]);
  assert.deepEqual(scope.orgUnitIds, ["org-parent", "org-child"]);
  assert.deepEqual(scope.orgUnitScopes, [
    {
      orgUnitId: "org-parent",
      role: "UNIT_MANAGER",
      includeDescendants: true,
      actionMask: [],
      isPrimary: true,
    },
  ]);
});

test("generic responsibility list filters in the repository to exact structured subjects", async () => {
  const repository = new InMemoryResponsibilityRepository();
  repository.records.push(
    responsibilityRecord("group-allowed", "TALENT_GROUP"),
    responsibilityRecord("group-hidden", "TALENT_GROUP"),
  );
  const service = createResponsibilityService(
    repository,
    Permission.TALENT_GROUP_READ,
    [{ scopeType: "managedTalentGroup", targetId: "group-allowed" }],
  );

  const result = await service.listAssignments(
    createActor([Permission.TALENT_GROUP_READ]),
    { subjectType: "TALENT_GROUP" },
  );

  assert.deepEqual(result.items.map((item) => item.subjectId), ["group-allowed"]);
  assert.deepEqual(repository.lastListFilters?.authorizedSubjects, [
    { subjectType: "TALENT_GROUP", subjectId: "group-allowed" },
  ]);
});

test("generic responsibility detail conceals records outside exact structured scope", async () => {
  const repository = new InMemoryResponsibilityRepository();
  const allowed = responsibilityRecord("group-allowed", "TALENT_GROUP");
  const hidden = responsibilityRecord("group-hidden", "TALENT_GROUP");
  repository.records.push(allowed, hidden);
  const service = createResponsibilityService(
    repository,
    Permission.TALENT_GROUP_READ,
    [{ scopeType: "managedTalentGroup", targetId: "group-allowed" }],
  );
  const actor = createActor([Permission.TALENT_GROUP_READ]);

  assert.equal((await service.getAssignment(actor, allowed.id)).subjectId, "group-allowed");
  await assert.rejects(service.getAssignment(actor, hidden.id), ResponsibilityNotFoundError);
});

test("generic responsibility create requires permission and the same active structured assignment", async () => {
  const repository = new InMemoryResponsibilityRepository();
  const command = {
    subjectType: "TALENT_GROUP",
    subjectId: "group-allowed",
    responsibleEmploymentProfileId: "ep-manager",
    responsibilityType: "TALENT_GROUP_MANAGER",
  };
  const permissionOnly = createResponsibilityService(
    repository,
    Permission.TALENT_GROUP_UPDATE,
    [],
  );
  await assert.rejects(
    bindTraceId("trace-responsibility-permission-only", () =>
      permissionOnly.createAssignment(
        createActor([Permission.TALENT_GROUP_UPDATE]),
        command,
      ),
    ),
    ResponsibilityPermissionScopeError,
  );

  const scopeWithoutPermission = createResponsibilityService(
    repository,
    Permission.TALENT_GROUP_UPDATE,
    [{ scopeType: "managedTalentGroup", targetId: "group-allowed" }],
  );
  await assert.rejects(
    bindTraceId("trace-responsibility-scope-only", () =>
      scopeWithoutPermission.createAssignment(createActor([]), command),
    ),
  );
});

test("generic responsibility rejects inactive role and future, expired, or revoked assignments", async () => {
  const command = {
    subjectType: "TALENT_GROUP",
    subjectId: "group-allowed",
    responsibleEmploymentProfileId: "ep-manager",
    responsibilityType: "TALENT_GROUP_MANAGER",
  };
  const invalidAuthorities = [
    { roleState: "INACTIVE", effectiveAt: 0, expiresAt: null, state: "ACTIVE", revokedAt: null },
    { roleState: "ACTIVE", effectiveAt: NOW + 1, expiresAt: null, state: "ACTIVE", revokedAt: null },
    { roleState: "ACTIVE", effectiveAt: 0, expiresAt: NOW - 1, state: "ACTIVE", revokedAt: null },
    { roleState: "ACTIVE", effectiveAt: 0, expiresAt: null, state: "REVOKED", revokedAt: NOW - 1 },
  ] as const;

  for (const authorityOptions of invalidAuthorities) {
    const service = createResponsibilityService(
      new InMemoryResponsibilityRepository(),
      Permission.TALENT_GROUP_UPDATE,
      [{ scopeType: "managedTalentGroup", targetId: "group-allowed" }],
      authorityOptions,
    );
    await assert.rejects(
      bindTraceId(`trace-responsibility-${authorityOptions.roleState}-${authorityOptions.state}`, () =>
        service.createAssignment(createActor([Permission.TALENT_GROUP_UPDATE]), command),
      ),
      ResponsibilityPermissionScopeError,
    );
  }
});

test("generic responsibility update and revoke enforce exact scope and audit a trimmed required reason", async () => {
  const repository = new InMemoryResponsibilityRepository();
  repository.records.push(responsibilityRecord("group-allowed", "TALENT_GROUP"));
  const audit = new RecordingAudit();
  const service = createResponsibilityService(
    repository,
    Permission.TALENT_GROUP_UPDATE,
    [{ scopeType: "managedTalentGroup", targetId: "group-allowed" }],
    {},
    audit,
  );
  const actor = createActor([Permission.TALENT_GROUP_UPDATE]);
  const assignmentId = repository.records[0]!.id;

  await bindTraceId("trace-responsibility-update", () =>
    service.updateAssignment(actor, { assignmentId, responsibilityRole: "LEAD" }),
  );
  await assert.rejects(
    bindTraceId("trace-responsibility-revoke-blank", () =>
      service.revokeAssignment(actor, { assignmentId, reason: "   " }),
    ),
    ResponsibilityValidationError,
  );
  const revoked = await bindTraceId("trace-responsibility-revoke", () =>
    service.revokeAssignment(actor, {
      assignmentId,
      reason: "  responsibility ended  ",
    }),
  );

  assert.equal(revoked.revokedReason, "responsibility ended");
  assert.equal(
    audit.records[audit.records.length - 1]?.metadata.reason,
    "responsibility ended",
  );
});

function createActor(permissions: readonly Permission[]): Actor {
  return new Actor({
    id: "admin-user",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants: {},
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
}

function createStructuredAuthority(
  permission: Permission,
  grants: readonly RoleAssignmentScopeGrant[],
  options: {
    readonly state?: "ACTIVE" | "REVOKED";
    readonly effectiveAt?: number;
    readonly expiresAt?: number | null;
    readonly revokedAt?: number | null;
    readonly roleState?: string;
  } = {},
): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService(
    {
      async listByUserId(userId) {
        return [
          {
            assignment: {
              assignmentId: `assignment-${userId}`,
              roleId: "role-responsibility-test",
              userId,
              structuredScopeGrants: grants,
              state: options.state ?? "ACTIVE",
              effectiveAt: options.effectiveAt ?? 0,
              expiresAt: options.expiresAt ?? null,
              revokedAt: options.revokedAt ?? null,
              reason: "test authority",
              createdAt: 0,
              updatedAt: 0,
            },
            role: {
              id: "role-responsibility-test",
              state: options.roleState ?? "ACTIVE",
              permissions: [permission],
            },
          },
        ];
      },
    },
    () => NOW,
  );
}

function createResponsibilityService(
  repository: InMemoryResponsibilityRepository,
  permission: Permission,
  grants: readonly RoleAssignmentScopeGrant[],
  authorityOptions: Parameters<typeof createStructuredAuthority>[2] = {},
  audit: RecordingAudit = new RecordingAudit(),
): ResponsibilityAdminService {
  return new ResponsibilityAdminService(
    repository,
    audit as unknown as AuditGuard,
    new RecordingMutationBridge(),
    createStructuredAuthority(permission, grants, authorityOptions),
    () => NOW,
  );
}

function responsibilityRecord(
  subjectId: string,
  subjectType: ResponsibilitySubjectType,
): ResponsibilityAssignmentRecord {
  const responsibilityType: ResponsibilityType =
    subjectType === "TALENT_GROUP"
      ? "TALENT_GROUP_MANAGER"
      : subjectType === "ORG_UNIT"
        ? "ORG_UNIT_MANAGER"
        : subjectType === "TALENT"
          ? "TALENT_DIRECT_MANAGER"
          : "EMPLOYMENT_REPORTING_MANAGER";
  return {
    id: `responsibility-${subjectType}-${subjectId}`,
    subjectType,
    subjectId,
    responsibleEmploymentProfileId: "ep-manager",
    responsibilityType,
    responsibilityRole: "MANAGER",
    includeDescendants: false,
    actionMask: [],
    isPrimary: false,
    status: "ACTIVE",
    effectiveAt: 0,
    expiresAt: null,
    revokedAt: null,
    reason: null,
    createdBy: "seed",
    createdAt: 0,
    updatedBy: "seed",
    updatedAt: 0,
    revokedBy: null,
    revokedReason: null,
    reviewNeeded: false,
    reviewReason: null,
  };
}

class RecordingMutationBridge implements AuthoritativeAdminMutationBridge {
  readonly calls: unknown[] = [];
  authSecurityTruthChanges = 0;

  async execute<T>(
    params: Parameters<AuthoritativeAdminMutationBridge["execute"]>[0],
    fn: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
  ): Promise<T> {
    this.calls.push(params);
    return fn(undefined as unknown as ClientSession, {
      markAuthSecurityTruthChanged: () => {
        this.authSecurityTruthChanges += 1;
      },
      markExplicitNoOpSuccess: () => undefined,
    });
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

class InMemoryResponsibilityRepository implements ResponsibilityAssignmentRepository {
  readonly records: ResponsibilityAssignmentRecord[] = [];
  lastListFilters: ResponsibilityAssignmentFilters | undefined;

  private readonly refs = new Map<string, ReferenceSummary>([
    [
      "TALENT_GROUP:group-allowed",
      {
        id: "group-allowed",
        code: "TG-000001",
        name: "Allowed Group",
        status: "ACTIVE",
      },
    ],
    [
      "TALENT_GROUP:group-hidden",
      {
        id: "group-hidden",
        code: "TG-000002",
        name: "Hidden Group",
        status: "ACTIVE",
      },
    ],
    [
      "EMPLOYMENT_PROFILE:ep-target",
      {
        id: "ep-target",
        code: "EP-000010",
        name: "Target Person",
        status: "ACTIVE",
      },
    ],
    [
      "EMPLOYMENT_PROFILE:ep-manager",
      {
        id: "ep-manager",
        code: "EP-000001",
        name: "Manager Person",
        status: "ACTIVE",
      },
    ],
  ]);

  async insert(
    assignment: ResponsibilityAssignmentRecord,
  ): Promise<ResponsibilityAssignmentRecord> {
    this.records.push(assignment);
    return assignment;
  }

  async listNormalized(
    filters: ResponsibilityAssignmentFilters,
  ): Promise<readonly ResponsibilityAssignmentView[]> {
    this.lastListFilters = filters;
    return Promise.all(
      this.records
        .filter((record) => matchesAssignmentFilter(record, filters))
        .map((record) => this.toView(record)),
    );
  }

  async findNormalizedById(
    assignmentId: string,
  ): Promise<ResponsibilityAssignmentView | null> {
    const record = this.records.find((item) => item.id === assignmentId);
    return record ? this.toView(record) : null;
  }

  async listActiveCentralPrimary(filters: {
    readonly subjectType: ResponsibilitySubjectType;
    readonly subjectId: string;
    readonly responsibilityType: ResponsibilityType;
    readonly excludeAssignmentId?: string;
    readonly asOf: number;
  }): Promise<readonly ResponsibilityAssignmentRecord[]> {
    return this.records.filter(
      (record) =>
        record.id !== filters.excludeAssignmentId &&
        record.subjectType === filters.subjectType &&
        record.subjectId === filters.subjectId &&
        record.responsibilityType === filters.responsibilityType &&
        record.isPrimary &&
        record.status === "ACTIVE" &&
        record.effectiveAt <= filters.asOf &&
        (record.expiresAt === null || record.expiresAt >= filters.asOf),
    );
  }

  async update(
    input: UpdateResponsibilityAssignmentInput,
  ): Promise<ResponsibilityAssignmentRecord | null> {
    const index = this.records.findIndex((record) => record.id === input.assignmentId);
    if (index < 0) return null;
    const updated = { ...this.records[index]!, ...input };
    this.records[index] = updated;
    return updated;
  }

  async revoke(
    input: RevokeResponsibilityAssignmentInput,
  ): Promise<ResponsibilityAssignmentRecord | null> {
    const index = this.records.findIndex(
      (record) => record.id === input.assignmentId && record.status === "ACTIVE",
    );
    if (index < 0) return null;
    const revoked: ResponsibilityAssignmentRecord = {
      ...this.records[index]!,
      status: "REVOKED",
      revokedAt: input.revokedAt,
      revokedBy: input.revokedBy,
      revokedReason: input.revokedReason,
      updatedAt: input.revokedAt,
      updatedBy: input.revokedBy,
    };
    this.records[index] = revoked;
    return revoked;
  }

  async listInheritedForTalent(): Promise<readonly ResponsibilityAssignmentView[]> {
    return [];
  }

  async listInheritedForEmploymentProfile(): Promise<readonly ResponsibilityAssignmentView[]> {
    return [];
  }

  async findSubjectRef(
    subjectType: ResponsibilitySubjectType,
    subjectId: string,
  ): Promise<ReferenceSummary | null> {
    return this.refs.get(`${subjectType}:${subjectId}`) ?? null;
  }

  async findEmploymentProfileRef(
    employmentProfileId: string,
  ): Promise<ReferenceSummary | null> {
    return this.refs.get(`EMPLOYMENT_PROFILE:${employmentProfileId}`) ?? null;
  }

  private async toView(
    record: ResponsibilityAssignmentRecord,
  ): Promise<ResponsibilityAssignmentView> {
    return {
      ...record,
      subjectRef: await this.findSubjectRef(record.subjectType, record.subjectId),
      responsibleEmploymentProfileRef: await this.findEmploymentProfileRef(
        record.responsibleEmploymentProfileId,
      ),
    };
  }
}

function matchesAssignmentFilter(
  record: ResponsibilityAssignmentRecord,
  filters: ResponsibilityAssignmentFilters,
): boolean {
  return (
    (!filters.subjectType || record.subjectType === filters.subjectType) &&
    (!filters.subjectId || record.subjectId === filters.subjectId) &&
    (!filters.responsibilityType ||
      record.responsibilityType === filters.responsibilityType) &&
    (!filters.responsibleEmploymentProfileId ||
      record.responsibleEmploymentProfileId === filters.responsibleEmploymentProfileId) &&
    (!filters.status || record.status === filters.status) &&
    (filters.authorizedSubjects === undefined ||
      filters.authorizedSubjects.some(
        (subject) =>
          subject.subjectType === record.subjectType &&
          (subject.subjectId === undefined || subject.subjectId === record.subjectId),
      )) &&
    (filters.active !== true ||
      (record.status === "ACTIVE" &&
        record.effectiveAt <= filters.asOf &&
        (record.expiresAt === null || record.expiresAt >= filters.asOf)))
  );
}

function createResponsibilityFakeDb(): { readonly db: Db } {
  const docsByCollection = new Map<string, MongoDocument[]>([
    [
      "responsibility_assignments",
      [
        responsibilityAssignmentDoc({
          id: "central-tg-assignment-1",
          subjectType: "TALENT_GROUP",
          subjectId: "group-1",
          responsibilityType: "TALENT_GROUP_MANAGER",
          responsibilityRole: "MANAGER",
          responsibleEmploymentProfileId: "ep-manager",
          includeDescendants: null,
          isPrimary: true,
          effectiveAt: NOW - 1_000,
        }),
        responsibilityAssignmentDoc({
          id: "central-ou-assignment-1",
          subjectType: "ORG_UNIT",
          subjectId: "org-parent",
          responsibilityType: "ORG_UNIT_MANAGER",
          responsibilityRole: "UNIT_MANAGER",
          responsibleEmploymentProfileId: "ep-manager",
          includeDescendants: true,
          isPrimary: true,
          effectiveAt: NOW - 1_000,
        }),
      ],
    ],
    [
      "talent_group_manager_assignments",
      [
        {
          _id: "tg-assignment-1",
          groupId: "group-1",
          managerEmploymentProfileId: "ep-manager",
          role: "MANAGER",
          effectiveFrom: NOW - 1_000,
          effectiveTo: null,
          status: "ACTIVE",
          isPrimary: true,
          createdAt: NOW - 1_000,
          createdByActorId: "seed",
          updatedAt: NOW - 1_000,
          updatedByActorId: "seed",
        },
      ],
    ],
    [
      "org_unit_manager_assignments",
      [
        {
          _id: "ou-assignment-1",
          orgUnitId: "org-parent",
          managerEmploymentProfileId: "ep-manager",
          role: "UNIT_MANAGER",
          includeDescendants: true,
          actionMask: [],
          effectiveFrom: NOW - 1_000,
          effectiveTo: null,
          status: "ACTIVE",
          isPrimary: true,
          createdAt: NOW - 1_000,
          createdByActorId: "seed",
          updatedAt: NOW - 1_000,
          updatedByActorId: "seed",
        },
      ],
    ],
    [
      "talents",
      [
        talentDoc("talent-active", "ACTIVE", null),
        talentDoc("talent-suspended", "SUSPENDED", "ep-manager"),
        talentDoc("talent-inactive", "INACTIVE", null),
        talentDoc("talent-archived", "ARCHIVED", null),
      ],
    ],
    [
      "talent_groups",
      [
        {
          _id: "group-1",
          groupCode: "TG-000001",
          name: "Operations Group",
          status: "ACTIVE",
        },
      ],
    ],
    [
      "talent_group_members",
      [
        membershipDoc("talent-active"),
        membershipDoc("talent-suspended"),
        membershipDoc("talent-inactive"),
        membershipDoc("talent-archived"),
      ],
    ],
    [
      "employment_profiles",
      [
        employmentProfileDoc("ep-manager", "ACTIVE", null),
        employmentProfileDoc("ep-active", "ACTIVE", null),
        employmentProfileDoc("ep-on-leave", "ON_LEAVE", null),
        employmentProfileDoc("ep-suspended", "SUSPENDED", null),
        employmentProfileDoc("ep-terminated", "TERMINATED", "ep-manager"),
        employmentProfileDoc("ep-archived", "ARCHIVED", null),
      ],
    ],
    [
      "org_units",
      [
        {
          _id: "org-child",
          code: "OU-CHILD",
          name: "Child Unit",
          status: "ACTIVE",
          ancestorChain: ["org-parent"],
        },
        {
          _id: "org-parent",
          code: "OU-PARENT",
          name: "Parent Unit",
          status: "ACTIVE",
          ancestorChain: [],
        },
      ],
    ],
  ]);

  return {
    db: {
      collection<TSchema extends MongoDocument = MongoDocument>(
        name: string,
      ): Collection<TSchema> {
        const docs = docsByCollection.get(name);
        if (!docs) {
          throw new Error(`Unexpected fake collection ${name}`);
        }
        return new MutableFakeCollection(docs) as unknown as Collection<TSchema>;
      },
    } as Db,
  };
}

function talentDoc(
  id: string,
  operationalStatus: string,
  managerEmploymentProfileId: string | null,
): MongoDocument {
  return {
    _id: id,
    talentCode: id.toUpperCase(),
    stageName: `${id} Stage`,
    legalName: `${id} Legal`,
    operationalStatus,
    managerEmploymentProfileId,
    updatedAt: NOW - 500,
  };
}

function membershipDoc(talentId: string): MongoDocument {
  return {
    _id: `membership-${talentId}`,
    groupId: "group-1",
    talentId,
    membershipStatus: "ACTIVE",
  };
}

function responsibilityAssignmentDoc(input: {
  readonly id: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly responsibilityType: string;
  readonly responsibilityRole: string;
  readonly responsibleEmploymentProfileId: string;
  readonly includeDescendants: boolean | null;
  readonly isPrimary: boolean;
  readonly effectiveAt: number;
}): MongoDocument {
  return {
    _id: input.id,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    responsibleEmploymentProfileId: input.responsibleEmploymentProfileId,
    responsibilityType: input.responsibilityType,
    responsibilityRole: input.responsibilityRole,
    includeDescendants: input.includeDescendants,
    actionMask: [],
    isPrimary: input.isPrimary,
    status: "ACTIVE",
    effectiveAt: input.effectiveAt,
    expiresAt: null,
    revokedAt: null,
    reason: null,
    createdBy: "central-test",
    createdAt: input.effectiveAt,
    updatedBy: "central-test",
    updatedAt: input.effectiveAt,
    revokedBy: null,
    revokedReason: null,
  };
}

function employmentProfileDoc(
  id: string,
  employmentStatus: string,
  managerEmploymentProfileId: string | null,
): MongoDocument {
  return {
    _id: id,
    employeeCode: id.toUpperCase(),
    displayName: `${id} Display`,
    legalName: `${id} Legal`,
    jobTitle: "Lead",
    employmentStatus,
    orgUnitId: "org-child",
    managerEmploymentProfileId,
  };
}

class MutableFakeCollection {
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
      limit(limit: number) {
        rows = rows.slice(0, limit);
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

  async findOneAndUpdate(): Promise<MongoDocument | null> {
    throw new Error("Not implemented");
  }
}

function matchesFakeFilter(doc: MongoDocument, filter: MongoDocument): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$and") {
      return (condition as readonly MongoDocument[]).every((candidate) =>
        matchesFakeFilter(doc, candidate),
      );
    }
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
      if (operator === "$ne") {
        return value !== expected;
      }
      if (operator === "$in") {
        if (!Array.isArray(expected)) {
          return false;
        }
        return Array.isArray(value)
          ? value.some((entry) => expected.includes(entry))
          : expected.includes(value);
      }
      if (operator === "$type") {
        return expected === "string" ? typeof value === "string" : false;
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
