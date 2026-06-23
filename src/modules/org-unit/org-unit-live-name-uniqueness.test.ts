import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientSession, MongoServerError } from "mongodb";
import { Actor } from "@core/actor/actor";
import type {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import type { BusinessCodeSequenceRepository } from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { OrgUnitAdminService } from "@modules/org-unit/admin/admin.org-unit.service";
import { OrgUnitConflictError } from "@modules/org-unit/domain/org-unit.errors";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import type {
  FindLiveSiblingByNormalizedNameInput,
  OrgUnitRepository,
  RewriteOrgUnitHierarchyInput,
  TransitionOrgUnitStatusInput,
  UpdateOrgUnitProfileInput,
} from "@modules/org-unit/domain/org-unit.repository";
import type { OrgUnitRecord } from "@modules/org-unit/domain/org-unit.types";

class MemoryOrgUnitRepository
  implements OrgUnitRepository
{
  readonly records: OrgUnitRecord[] = [];

  async insert(
    orgUnit: OrgUnitRecord,
  ): Promise<OrgUnitRecord> {
    if (
      this.records.some(
        (record) => record.code === orgUnit.code,
      ) ||
      this.records.some(
        (record) =>
          record.status !== "ARCHIVED" &&
          orgUnit.status !== "ARCHIVED" &&
          record.parentOrgUnitId ===
            orgUnit.parentOrgUnitId &&
          record.normalizedName ===
            orgUnit.normalizedName,
      )
    ) {
      throw new MongoServerError({
        code: 11000,
        message: "duplicate key",
      });
    }

    this.records.push(orgUnit);
    return orgUnit;
  }

  async findById(
    orgUnitId: string,
  ): Promise<OrgUnitRecord | null> {
    return (
      this.records.find(
        (record) => record.id === orgUnitId,
      ) ?? null
    );
  }

  async findByCode(
    code: string,
  ): Promise<OrgUnitRecord | null> {
    return (
      this.records.find(
        (record) => record.code === code,
      ) ?? null
    );
  }

  async findMaxGeneratedCodeSequence(): Promise<number> {
    return 0;
  }

  async findLiveSiblingByNormalizedName(
    input: FindLiveSiblingByNormalizedNameInput,
  ): Promise<OrgUnitRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.status !== "ARCHIVED" &&
          record.parentOrgUnitId ===
            input.parentOrgUnitId &&
          record.normalizedName ===
            input.normalizedName &&
          record.id !== input.excludeOrgUnitId,
      ) ?? null
    );
  }

  async updateProfile(
    input: UpdateOrgUnitProfileInput,
  ): Promise<OrgUnitRecord | null> {
    const current = await this.findById(input.orgUnitId);

    if (!current) {
      return null;
    }

    const updated: OrgUnitRecord = {
      ...current,
      name: input.name ?? current.name,
      normalizedName:
        input.normalizedName ?? current.normalizedName,
      description:
        input.description === undefined
          ? current.description
          : input.description,
      displayOrder:
        input.displayOrder ?? current.displayOrder,
      externalRef:
        input.externalRef === undefined
          ? current.externalRef
          : input.externalRef,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async rewriteHierarchy(
    input: RewriteOrgUnitHierarchyInput,
  ): Promise<OrgUnitRecord | null> {
    const current = await this.findById(input.orgUnitId);

    if (!current) {
      return null;
    }

    const updated: OrgUnitRecord = {
      ...current,
      parentOrgUnitId: input.parentOrgUnitId,
      ancestorChain: [...input.ancestorChain],
      depth: input.depth,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);

    for (const descendant of input.descendants) {
      const record = await this.findById(
        descendant.orgUnitId,
      );
      if (record) {
        this.replace({
          ...record,
          ancestorChain: [
            ...descendant.ancestorChain,
          ],
          depth: descendant.depth,
          updatedAt: descendant.updatedAt,
        });
      }
    }

    return updated;
  }

  async transitionStatus(
    input: TransitionOrgUnitStatusInput,
  ): Promise<OrgUnitRecord | null> {
    const current = await this.findById(input.orgUnitId);

    if (
      !current ||
      !input.fromStatuses.includes(current.status)
    ) {
      return null;
    }

    const updated: OrgUnitRecord = {
      ...current,
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async listDescendants(
    orgUnitId: string,
  ): Promise<readonly OrgUnitRecord[]> {
    return this.records.filter((record) =>
      record.ancestorChain.includes(orgUnitId),
    );
  }

  async hasDescendantWithStatuses(): Promise<boolean> {
    return false;
  }

  async hasNonArchivedDescendants(): Promise<boolean> {
    return false;
  }

  private replace(updated: OrgUnitRecord): void {
    const index = this.records.findIndex(
      (record) => record.id === updated.id,
    );

    if (index >= 0) {
      this.records[index] = updated;
    }
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

const sequenceRepository = {
  async ensureAtLeast() {},
  async allocateNext() {
    return 1;
  },
} as unknown as BusinessCodeSequenceRepository;

function createActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.ORG_UNIT_CREATE,
      Permission.ORG_UNIT_MANAGE_LIFECYCLE,
    ],
    scopeGrants: {},
    isActive: true,
  });
}

function createService(
  repository: MemoryOrgUnitRepository,
): OrgUnitAdminService {
  return new OrgUnitAdminService(
    repository,
    sequenceRepository,
    {
      async hasNonArchivedProfilesAssignedToOrgUnit() {
        return false;
      },
    },
    {
      async hasActiveOwnedPlatformAccountsForOrgUnit() {
        return false;
      },
      async hasNonArchivedOwnedPlatformAccountsForOrgUnit() {
        return false;
      },
    },
    audit,
    mutationBridge,
    createOrgUnitStructuredAuthority(repository),
    {
      info() {},
      warn() {},
      error() {},
      debug() {},
    } as never,
  );
}

function createOrgUnitStructuredAuthority(
  repository: MemoryOrgUnitRepository,
): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(userId: string) {
      return [
        {
          assignment: {
            assignmentId: "assignment-org-unit-name-test",
            roleId: "role-org-unit-name-test",
            userId,
            structuredScopeGrants: repository.records.map((record) => ({
              scopeType: "managedOrgUnit" as const,
              targetId: record.id,
            })),
            state: "ACTIVE" as const,
            effectiveAt: 0,
            expiresAt: null,
            revokedAt: null,
            reason: null,
            createdAt: 0,
            updatedAt: 0,
          },
          role: {
            id: "role-org-unit-name-test",
            state: "ACTIVE",
            permissions: [Permission.ORG_UNIT_MANAGE_LIFECYCLE],
          },
        },
      ];
    },
  });
}

async function createOrgUnit(
  service: OrgUnitAdminService,
  params: {
    readonly code: string;
    readonly name: string;
    readonly parentOrgUnitId?: string | null;
  },
) {
  const created = await service.createOrgUnit(createActor(), {
    code: params.code,
    name: params.name,
    type: "DEPARTMENT",
    parentOrgUnitId: params.parentOrgUnitId ?? null,
    displayOrder: 1,
  });
  assert.ok("code" in created);
  return created;
}

test("Org Unit rejects duplicate live normalized sibling names", async () => {
  await bindTraceId(
    "trace-org-unit-live-name-duplicate",
    async () => {
      const repository = new MemoryOrgUnitRepository();
      const service = createService(repository);

      await createOrgUnit(service, {
        code: "OU-A",
        name: "Production",
      });

      await assert.rejects(
        createOrgUnit(service, {
          code: "OU-B",
          name: " production ",
        }),
        OrgUnitConflictError,
      );
    },
  );
});

test("Org Unit allows duplicate normalized names under different parents", async () => {
  await bindTraceId(
    "trace-org-unit-live-name-different-parent",
    async () => {
      const repository = new MemoryOrgUnitRepository();
      const service = createService(repository);

      const parentA = await createOrgUnit(service, {
        code: "OU-PARENT-A",
        name: "Parent A",
      });
      const parentB = await createOrgUnit(service, {
        code: "OU-PARENT-B",
        name: "Parent B",
      });

      const childA = await createOrgUnit(service, {
        code: "OU-CHILD-A",
        name: "Production",
        parentOrgUnitId: parentA.id,
      });
      const childB = await createOrgUnit(service, {
        code: "OU-CHILD-B",
        name: " production ",
        parentOrgUnitId: parentB.id,
      });

      assert.equal(childA.name, "Production");
      assert.equal(childB.name, "production");
    },
  );
});

test("Org Unit excludes archived siblings from live-name uniqueness", async () => {
  await bindTraceId(
    "trace-org-unit-archived-name-excluded",
    async () => {
      const repository = new MemoryOrgUnitRepository();
      const service = createService(repository);
      const actor = createActor();

      const archivedCandidate = await createOrgUnit(
        service,
        {
          code: "OU-ARCHIVED",
          name: "Production",
        },
      );

      await service.archiveOrgUnit(actor, {
        orgUnitId: archivedCandidate.id,
      });

      const liveReplacement = await createOrgUnit(
        service,
        {
          code: "OU-LIVE",
          name: " production ",
        },
      );

      assert.equal(liveReplacement.status, "ACTIVE");
      assert.equal(liveReplacement.name, "production");
    },
  );
});

test("Org Unit allows duplicate archived sibling names", async () => {
  await bindTraceId(
    "trace-org-unit-duplicate-archived-names",
    async () => {
      const repository = new MemoryOrgUnitRepository();
      const service = createService(repository);
      const actor = createActor();

      const first = await createOrgUnit(service, {
        code: "OU-ARCHIVED-A",
        name: "Production",
      });
      await service.archiveOrgUnit(actor, {
        orgUnitId: first.id,
      });

      const second = await createOrgUnit(service, {
        code: "OU-ARCHIVED-B",
        name: " production ",
      });
      await service.archiveOrgUnit(actor, {
        orgUnitId: second.id,
      });

      assert.equal(
        repository.records.filter(
          (record) =>
            record.status === "ARCHIVED" &&
            record.normalizedName === "production",
        ).length,
        2,
      );
    },
  );
});
