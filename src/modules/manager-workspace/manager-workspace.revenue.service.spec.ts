import assert from "node:assert/strict";
import test from "node:test";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuditGuard } from "@core/audit/audit.guard";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { bindTraceId } from "@core/trace/trace.context";
import { EmploymentProfileRecord } from "@modules/employment-profile/domain/employment-profile.types";
import { TalentGroupManagerAssignment } from "@modules/kpi/domain/kpi.types";
import { PlatformAccountRecord } from "@modules/platform-account/domain/platform-account.types";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityService,
} from "@modules/role/domain/structured-scope-authority";
import {
  PlatformEarningBatch,
  PlatformEarningLine,
  PlatformEarningRepository,
} from "@modules/revenue-ledger/domain/platform-earning.repository";
import {
  RevenueLedgerInvalidPlatformAttributionError,
  RevenueLedgerNotFoundError,
  RevenueLedgerPermissionScopeError,
} from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import { ManagerWorkspaceRevenueAdminService } from "./admin/admin.manager-workspace-revenue.service";

const now = Date.UTC(2026, 5, 18);
const session = {} as ClientSession;

test("manager revenue lists only actor-owned batches in the assigned TalentGroup", async () => {
  const harness = createHarness();
  harness.repository.batches.set(
    "owned",
    batch({ id: "owned", createdByActorId: "manager-user" }),
  );
  harness.repository.batches.set(
    "other-actor",
    batch({ id: "other-actor", createdByActorId: "other-user" }),
  );
  harness.repository.batches.set(
    "other-group",
    batch({ id: "other-group", talentGroupId: "tg-other" }),
  );

  const result = await harness.service.listBatches(managerActor(), {
    talentGroupId: "tg-managed",
  });

  assert.deepEqual(result.items.map((item) => item.id), ["owned"]);
  await assert.rejects(
    harness.service.getBatch(managerActor(), "other-actor"),
    RevenueLedgerNotFoundError,
  );
  await assert.rejects(
    harness.service.listBatches(managerActor(), {
      talentGroupId: "tg-other",
    }),
    RevenueLedgerPermissionScopeError,
  );
});

test("manager creates drafts only for currently assigned eligible Platform Accounts", async () => {
  const harness = createHarness();

  const created = await withTrace(() =>
    harness.service.createBatch(managerActor(), {
      platform: "TIKTOK",
      platformAccountId: "pa-managed",
      talentGroupId: "tg-managed",
      sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
      periodMonth: "2026-06",
      sourceDateFrom: now,
      sourceDateTo: now,
    }),
  );
  assert.equal(created.status, "DRAFT");

  harness.account = platformAccount({ operationalStatus: "INACTIVE" });
  await assert.rejects(
    withTrace(() =>
      harness.service.createBatch(managerActor(), {
        platform: "TIKTOK",
        platformAccountId: "pa-managed",
        talentGroupId: "tg-managed",
        sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
        periodMonth: "2026-06",
        sourceDateFrom: now,
        sourceDateTo: now,
      }),
    ),
    RevenueLedgerInvalidPlatformAttributionError,
  );

  harness.account = platformAccount({ ownerTalentGroupId: "tg-other" });
  await assert.rejects(
    withTrace(() =>
      harness.service.createBatch(managerActor(), {
        platform: "TIKTOK",
        platformAccountId: "pa-managed",
        talentGroupId: "tg-managed",
        sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
        periodMonth: "2026-06",
        sourceDateFrom: now,
        sourceDateTo: now,
      }),
    ),
    RevenueLedgerInvalidPlatformAttributionError,
  );
});

test("manager revenue requires matching structured TalentGroup and Platform Account scope", async () => {
  const missingTalentGroupScope = createHarness({
    structuredAuthority: structuredAuthority([
      structuredAssignment({
        permission: "revenueLedger.platformEarning.submit",
        scopeType: "assignedPlatformAccount",
        targetId: "pa-managed",
      }),
    ]),
  });
  await assert.rejects(
    missingTalentGroupScope.service.listBatches(managerActor(), {
      talentGroupId: "tg-managed",
    }),
    RevenueLedgerPermissionScopeError,
  );

  const missingPlatformAccountScope = createHarness({
    structuredAuthority: structuredAuthority([
      structuredAssignment({
        permission: "revenueLedger.platformEarning.submit",
        scopeType: "managedTalentGroup",
        targetId: "tg-managed",
      }),
      structuredAssignment({
        permission: "revenueLedger.platformEarning.submit",
        scopeType: "assignedPlatformAccount",
        targetId: "pa-other",
      }),
    ]),
  });
  assert.deepEqual(
    (await missingPlatformAccountScope.service.getScope(managerActor()))
      .platformAccounts,
    [],
  );
  await assert.rejects(
    withTrace(() =>
      missingPlatformAccountScope.service.createBatch(managerActor(), {
        platform: "TIKTOK",
        platformAccountId: "pa-managed",
        talentGroupId: "tg-managed",
        sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
        periodMonth: "2026-06",
        sourceDateFrom: now,
        sourceDateTo: now,
      }),
    ),
    RevenueLedgerPermissionScopeError,
  );
});

test("manager detail, line mutations, and submit fail closed after Platform Account eligibility drifts", async () => {
  const harness = createHarness();
  const draft = batch();
  harness.repository.batches.set(draft.id, draft);

  await withTrace(() =>
    harness.service.addLine(managerActor(), {
      batchId: draft.id,
      sourceDate: now,
      memberTalentId: "talent-member",
      memberEmploymentProfileId: "ep-member",
      rawQuantity: 100,
    }),
  );
  const line = [...harness.repository.lines.values()][0];
  assert.ok(line);

  harness.account = platformAccount({ operationalStatus: "INACTIVE" });
  await assert.rejects(
    harness.service.getBatch(managerActor(), draft.id),
    RevenueLedgerInvalidPlatformAttributionError,
  );
  await assert.rejects(
    harness.service.listLines(managerActor(), { batchId: draft.id }),
    RevenueLedgerInvalidPlatformAttributionError,
  );
  await assert.rejects(
    withTrace(() =>
      harness.service.addLine(managerActor(), {
        batchId: draft.id,
        sourceDate: now,
        memberTalentId: "talent-member",
        memberEmploymentProfileId: "ep-member",
        rawQuantity: 200,
        externalSourceRef: "second",
      }),
    ),
    RevenueLedgerInvalidPlatformAttributionError,
  );
  await assert.rejects(
    withTrace(() =>
      harness.service.updateLine(managerActor(), {
        batchId: draft.id,
        lineId: line.id,
        rawQuantity: 200,
      }),
    ),
    RevenueLedgerInvalidPlatformAttributionError,
  );
  await assert.rejects(
    withTrace(() =>
      harness.service.submitBatch(managerActor(), { batchId: draft.id }),
    ),
    RevenueLedgerInvalidPlatformAttributionError,
  );
});

test("manager revenue DTOs omit Finance-only snapshots and expose no Finance lifecycle methods", async () => {
  const harness = createHarness();
  harness.repository.batches.set(
    "approved",
    batch({
      id: "approved",
      status: "APPROVED",
      conversionSnapshot: {
        sourceUnit: "DIAMOND",
        rawQuantity: 100,
        targetCurrency: "VND",
        appliedRate: 100,
        rateType: "FINANCE_APPROVED",
        rateEffectiveFrom: null,
        rateEffectiveTo: null,
        grossConvertedAmount: 10_000,
        ruleRef: "rule",
        appliedByActorId: "finance",
        appliedAt: now,
        sourceNote: null,
      },
      platformCutSnapshot: {
        platformCutRate: 0.3,
        companyShareRate: 0.7,
        grossConvertedAmount: 10_000,
        platformCutAmount: 3_000,
        companyNetAmount: 7_000,
        targetCurrency: "VND",
        ruleRef: "cut",
        appliedByActorId: "finance",
        appliedAt: now,
        sourceNote: null,
      },
    }),
  );

  const view = await harness.service.getBatch(managerActor(), "approved");
  assert.equal("conversionSnapshot" in view, false);
  assert.equal("platformCutSnapshot" in view, false);
  assert.equal("approvedByActorId" in view, false);
  for (const method of [
    "approveBatch",
    "rejectBatch",
    "voidBatch",
    "archiveBatch",
    "createRevenueEntry",
  ]) {
    assert.equal(method in harness.service, false);
  }
});

function createHarness(input: {
  readonly assignments?: readonly TalentGroupManagerAssignment[];
  readonly structuredAuthority?: StructuredScopeAuthorityService;
} = {}): {
  readonly service: ManagerWorkspaceRevenueAdminService;
  readonly repository: InMemoryPlatformEarningRepository;
  account: PlatformAccountRecord;
} {
  const repository = new InMemoryPlatformEarningRepository();
  const harness = {
    account: platformAccount(),
    repository,
    service: undefined as unknown as ManagerWorkspaceRevenueAdminService,
  };
  harness.service = new ManagerWorkspaceRevenueAdminService(
    {
      async findNonArchivedByLinkedUserId() {
        return managerProfile();
      },
    },
    {
      async listActiveAssignmentsByManagerEmploymentProfile() {
        return input.assignments ?? [managerAssignment()];
      },
    },
    {
      async findById() {
        return harness.account;
      },
    },
    {
      async listPlatformAccounts() {
        return { items: [harness.account] };
      },
    },
    {
      async listTalentGroupMemberEmploymentProfileResolutions() {
        return [
          {
            memberId: "member-1",
            groupId: "tg-managed",
            talentId: "talent-member",
            membershipStatus: "ACTIVE",
            talentOperationalStatus: "ACTIVE",
            linkedEmploymentProfileId: "ep-member",
            employmentProfile: {
              id: "ep-member",
              employmentStatus: "ACTIVE",
              orgUnitId: "ou-1",
              managerEmploymentProfileId: null,
              linkedUserId: null,
              ref: {
                id: "ep-member",
                code: "EP-MEMBER",
                displayName: "Managed Member",
                status: "ACTIVE",
              },
            },
          },
        ];
      },
    },
    repository,
    {
      async allocateNext() {
        return 1;
      },
    } as never,
    {
      async record() {
        return undefined;
      },
    } as unknown as AuditGuard,
    {
      async execute(_params, mutate) {
        return mutate(session, {
          markAuthSecurityTruthChanged() {
            return undefined;
          },
          markExplicitNoOpSuccess() {
            return undefined;
          },
        });
      },
    } satisfies AuthoritativeAdminMutationBridge,
    input.structuredAuthority ?? structuredAuthority(),
    () => now,
  );
  return harness;
}

class InMemoryPlatformEarningRepository implements PlatformEarningRepository {
  readonly batches = new Map<string, PlatformEarningBatch>();
  readonly lines = new Map<string, PlatformEarningLine>();

  async insertBatch(input: Parameters<PlatformEarningRepository["insertBatch"]>[0]) {
    const created = batch({
      ...input,
      sourceUnit: input.sourceUnit,
    });
    this.batches.set(created.id, created);
    return created;
  }

  async findBatchById(batchId: string) {
    return this.batches.get(batchId) ?? null;
  }

  async listBatches(filters: Parameters<PlatformEarningRepository["listBatches"]>[0]) {
    return {
      items: [...this.batches.values()].filter(
        (item) =>
          (!filters.talentGroupId || item.talentGroupId === filters.talentGroupId) &&
          (!filters.createdByActorId ||
            item.createdByActorId === filters.createdByActorId),
      ),
    };
  }

  async updateDraftBatch() {
    return null;
  }

  async transitionBatchStatus(
    input: Parameters<PlatformEarningRepository["transitionBatchStatus"]>[0],
  ) {
    const current = this.batches.get(input.batchId);
    if (!current || !input.fromStatuses.includes(current.status)) return null;
    const updated = {
      ...current,
      ...input,
      status: input.toStatus,
    } as PlatformEarningBatch;
    this.batches.set(updated.id, updated);
    return updated;
  }

  async approveBatch() {
    return null;
  }

  async markRevenueEntryCreated() {
    return null;
  }

  async insertLine(line: PlatformEarningLine) {
    this.lines.set(line.id, line);
    const current = this.batches.get(line.batchId);
    if (current) {
      this.batches.set(current.id, {
        ...current,
        sourceLineCount: current.sourceLineCount + 1,
        rawQuantityTotal: current.rawQuantityTotal + line.rawQuantity,
      });
    }
    return line;
  }

  async findLineById(lineId: string) {
    return this.lines.get(lineId) ?? null;
  }

  async findLineByDuplicateDetectionKey(key: string) {
    return [...this.lines.values()].find(
      (line) => line.duplicateDetectionKey === key,
    ) ?? null;
  }

  async updateDraftLine() {
    return null;
  }

  async listLines(filters: Parameters<PlatformEarningRepository["listLines"]>[0]) {
    return {
      items: [...this.lines.values()].filter(
        (line) => !filters.batchId || line.batchId === filters.batchId,
      ),
    };
  }

  async findLinesByBatchId(batchId: string) {
    return [...this.lines.values()].filter((line) => line.batchId === batchId);
  }
}

function batch(overrides: Partial<PlatformEarningBatch> = {}): PlatformEarningBatch {
  return {
    id: "batch-managed",
    batchCode: "RLEB-202606-00001",
    platform: "TIKTOK",
    platformAccountId: "pa-managed",
    talentGroupId: "tg-managed",
    sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
    sourceUnit: "DIAMOND",
    periodMonth: "2026-06",
    sourceDateFrom: now,
    sourceDateTo: now,
    status: "DRAFT",
    sourceLineCount: 0,
    rawQuantityTotal: 0,
    conversionSnapshot: null,
    platformCutSnapshot: null,
    companyNetAmount: null,
    commissionableBasisAmount: null,
    submittedByActorId: null,
    submittedAt: null,
    reviewedByActorId: null,
    reviewedAt: null,
    approvedByActorId: null,
    approvedAt: null,
    rejectedByActorId: null,
    rejectedAt: null,
    rejectionReason: null,
    voidedByActorId: null,
    voidedAt: null,
    voidReason: null,
    archivedByActorId: null,
    archivedAt: null,
    sourceFingerprint: null,
    revenueEntryId: null,
    revenueEntryCreatedByActorId: null,
    revenueEntryCreatedAt: null,
    createdByActorId: "manager-user",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function platformAccount(
  overrides: Partial<PlatformAccountRecord> = {},
): PlatformAccountRecord {
  return {
    id: "pa-managed",
    accountCode: "PA-001",
    platform: "TIKTOK",
    platformSurfaceType: "ACCOUNT",
    displayName: "Managed live account",
    normalizedDisplayName: "managed live account",
    handle: "@managed",
    normalizedHandle: "@managed",
    externalPlatformId: null,
    profileUrl: null,
    normalizedProfileUrl: null,
    ownerKind: "TALENT_GROUP",
    ownerOrgUnitId: null,
    ownerTalentId: null,
    ownerTalentGroupId: "tg-managed",
    operationalStatus: "ACTIVE",
    livestreamEnabled: true,
    contentPublishingEnabled: true,
    monetizationEnabled: true,
    description: null,
    externalRef: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function managerProfile(): EmploymentProfileRecord {
  return {
    id: "ep-manager",
    employeeCode: "EP-MGR",
    legalName: "Manager",
    normalizedLegalName: "manager",
    displayName: "Manager",
    normalizedDisplayName: "manager",
    employmentKind: "EMPLOYEE",
    jobTitle: "Manager",
    titleDescription: null,
    externalRef: null,
    orgUnitId: "ou-1",
    managerEmploymentProfileId: null,
    recruiterEmploymentProfileId: null,
    hrOwnerEmploymentProfileId: null,
    onboardingOwnerEmploymentProfileId: null,
    sourcedByEmploymentProfileId: null,
    linkedUserId: "manager-user",
    employmentStatus: "ACTIVE",
    contractStatus: "ACTIVE",
    employmentStartDate: now,
    employmentEndDate: null,
    hiredAt: null,
    onboardedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function managerAssignment(): TalentGroupManagerAssignment {
  return {
    id: "assignment-1",
    groupId: "tg-managed",
    managerEmploymentProfileId: "ep-manager",
    role: "MANAGER",
    effectiveFrom: now - 1,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: true,
    createdAt: now,
    createdByActorId: "admin",
    updatedAt: now,
    updatedByActorId: "admin",
  };
}

function managerActor(): Actor {
  return new Actor({
    id: "manager-user",
    type: "admin",
    context: "ADMIN",
    roles: ["TEAM_MANAGER"],
    permissions: ["revenueLedger.platformEarning.submit"],
    scopeGrants: {},
    isActive: true,
  });
}

function structuredAuthority(
  assignments: readonly StructuredScopeAuthorityAssignment[] = [
    structuredAssignment({
      permission: "revenueLedger.platformEarning.submit",
      scopeType: "managedTalentGroup",
      targetId: "tg-managed",
    }),
    structuredAssignment({
      permission: "revenueLedger.platformEarning.submit",
      scopeType: "assignedPlatformAccount",
      targetId: "pa-managed",
    }),
  ],
): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService(
    {
      async listByUserId(userId) {
        return assignments.filter(
          (assignment) => assignment.assignment.userId === userId,
        );
      },
    },
    () => now,
  );
}

function structuredAssignment(input: {
  readonly permission: string;
  readonly scopeType: "managedTalentGroup" | "assignedPlatformAccount";
  readonly targetId: string;
}): StructuredScopeAuthorityAssignment {
  const assignmentId = [
    "structured",
    input.permission,
    input.scopeType,
    input.targetId,
  ].join("-");
  return {
    assignment: {
      assignmentId,
      roleId: assignmentId,
      userId: "manager-user",
      structuredScopeGrants: [
        { scopeType: input.scopeType, targetId: input.targetId },
      ],
      state: "ACTIVE",
      effectiveAt: now - 1,
      expiresAt: null,
      revokedAt: null,
      origin: "DIRECT",
      bundleOrigin: null,
      reason: null,
      createdAt: now - 1,
      updatedAt: now - 1,
    },
    role: {
      id: assignmentId,
      state: "ACTIVE",
      permissions: [input.permission],
    },
  };
}

function withTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId(`manager-revenue-${Math.random()}`, fn);
}
