import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
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
  RevenueLedgerPermissionScopeError,
} from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import { ManagerWorkspaceRevenueAdminService } from "./admin/admin.manager-workspace-revenue.service";
import { adminManagerWorkspaceRoutes } from "./admin/admin.manager-workspace.routes";
import { ManagerWorkspaceAdminController } from "./admin/admin.manager-workspace.controller";

const now = Date.UTC(2026, 5, 18);

test("manager Daily Source router exposes GET-only contracts", () => {
  const router = adminManagerWorkspaceRoutes({
    execute: (_request: unknown, _response: unknown, next: () => void) => next(),
  } as unknown as ManagerWorkspaceAdminController);
  const revenueRoutes = (
    router as unknown as {
      stack: readonly {
        route?: { path: string; methods: Record<string, boolean> };
      }[];
    }
  ).stack
    .map((layer) => layer.route)
    .filter(
      (route): route is { path: string; methods: Record<string, boolean> } =>
        Boolean(route?.path.startsWith("/revenue/")),
    );

  assert.equal(revenueRoutes.length, 4);
  assert.equal(
    revenueRoutes.every(
      (route) => route.methods.get === true && Object.keys(route.methods).length === 1,
    ),
    true,
  );
});

test("manager revenue lists official batches in the assigned TalentGroup", async () => {
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

  assert.deepEqual(
    result.items.map((item) => item.id),
    ["other-actor", "owned"],
  );
  assert.equal(
    (await harness.service.getBatch(managerActor(), "other-actor")).id,
    "other-actor",
  );
  await assert.rejects(
    harness.service.listBatches(managerActor(), {
      talentGroupId: "tg-other",
    }),
    RevenueLedgerPermissionScopeError,
  );
});

test("manager batch list constrains mixed-account pagination before cursor creation", async () => {
  const authority = structuredAuthority([
    structuredAssignment({
      permission: "revenueLedger.platformEarning.read",
      scopeType: "managedTalentGroup",
      targetId: "tg-managed",
    }),
    structuredAssignment({
      permission: "revenueLedger.platformEarning.read",
      scopeType: "assignedPlatformAccount",
      targetId: "pa-managed",
    }),
    structuredAssignment({
      permission: "revenueLedger.platformEarning.read",
      scopeType: "assignedPlatformAccount",
      targetId: "pa-managed-2",
    }),
  ]);
  const harness = createHarness({ structuredAuthority: authority });
  harness.additionalAccounts.push(
    platformAccount({ id: "pa-unassigned", accountCode: "PA-002" }),
    platformAccount({ id: "pa-managed-2", accountCode: "PA-003" }),
  );
  harness.repository.batches.set(
    "a-ineligible",
    batch({ id: "a-ineligible", platformAccountId: "pa-unassigned" }),
  );
  harness.repository.batches.set(
    "b-eligible",
    batch({ id: "b-eligible", platformAccountId: "pa-managed" }),
  );
  harness.repository.batches.set(
    "c-eligible",
    batch({ id: "c-eligible", platformAccountId: "pa-managed-2" }),
  );
  const actor = managerActor();

  const first = await harness.service.listBatches(actor, {
    talentGroupId: "tg-managed",
    limit: 1,
  });
  assert.deepEqual(first.items.map((item) => item.id), ["b-eligible"]);
  assert.equal(first.nextCursor, "b-eligible");
  assert.deepEqual(harness.repository.lastBatchFilters?.platformAccountIds, [
    "pa-managed",
    "pa-managed-2",
  ]);

  const second = await harness.service.listBatches(actor, {
    talentGroupId: "tg-managed",
    limit: 1,
    cursor: first.nextCursor,
  });
  assert.deepEqual(second.items.map((item) => item.id), ["c-eligible"]);
  assert.equal(second.nextCursor, undefined);
  assert.equal(
    [...first.items, ...second.items].some((item) => item.id === "a-ineligible"),
    false,
  );
});

test("manager batch list accepts only an explicitly eligible assigned Platform Account", async () => {
  const harness = createHarness();
  harness.additionalAccounts.push(
    platformAccount({ id: "pa-unassigned", accountCode: "PA-002" }),
  );
  harness.repository.batches.set("eligible", batch({ id: "eligible" }));
  harness.repository.batches.set(
    "unassigned",
    batch({ id: "unassigned", platformAccountId: "pa-unassigned" }),
  );

  assert.deepEqual(
    (
      await harness.service.listBatches(managerActor(), {
        talentGroupId: "tg-managed",
        platformAccountId: "pa-managed",
      })
    ).items.map((item) => item.id),
    ["eligible"],
  );
  await assert.rejects(
    harness.service.listBatches(managerActor(), {
      talentGroupId: "tg-managed",
      platformAccountId: "pa-unassigned",
    }),
    RevenueLedgerPermissionScopeError,
  );
});

test("manager batch list rejects revoked or inactive account eligibility without repository leakage", async () => {
  const harness = createHarness();
  harness.account = platformAccount({ operationalStatus: "INACTIVE" });
  harness.repository.batches.set("hidden", batch({ id: "hidden" }));

  const omitted = await harness.service.listBatches(managerActor(), {
    talentGroupId: "tg-managed",
  });
  assert.deepEqual(omitted, { items: [] });
  assert.equal(harness.repository.lastBatchFilters, undefined);
  await assert.rejects(
    harness.service.listBatches(managerActor(), {
      talentGroupId: "tg-managed",
      platformAccountId: "pa-managed",
    }),
    RevenueLedgerPermissionScopeError,
  );
  assert.equal(harness.repository.lastBatchFilters, undefined);
});

test("manager Daily Source service exposes no mutation methods", () => {
  const harness = createHarness();
  for (const method of [
    "createBatch",
    "updateBatch",
    "addLine",
    "updateLine",
    "submitBatch",
  ]) {
    assert.equal(method in harness.service, false);
  }
  assert.equal(harness.repository.batches.size, 0);
});

test("manager revenue requires matching structured TalentGroup and Platform Account scope", async () => {
  const missingTalentGroupScope = createHarness({
    structuredAuthority: structuredAuthority([
      structuredAssignment({
        permission: "revenueLedger.platformEarning.read",
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
        permission: "revenueLedger.platformEarning.read",
        scopeType: "managedTalentGroup",
        targetId: "tg-managed",
      }),
      structuredAssignment({
        permission: "revenueLedger.platformEarning.read",
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
  const official = batch();
  missingPlatformAccountScope.repository.batches.set(official.id, official);
  await assert.rejects(
    missingPlatformAccountScope.service.getBatch(managerActor(), official.id),
    RevenueLedgerPermissionScopeError,
  );
});

test("manager reads fail closed after Platform Account eligibility drifts", async () => {
  const harness = createHarness();
  const draft = batch();
  harness.repository.batches.set(draft.id, draft);
  const sourceLine = line({ batchId: draft.id });
  harness.repository.lines.set(sourceLine.id, sourceLine);

  assert.equal((await harness.service.getBatch(managerActor(), draft.id)).id, draft.id);
  assert.equal(
    (await harness.service.listLines(managerActor(), { batchId: draft.id })).items.length,
    1,
  );

  harness.account = platformAccount({ operationalStatus: "INACTIVE" });
  await assert.rejects(
    harness.service.getBatch(managerActor(), draft.id),
    RevenueLedgerInvalidPlatformAttributionError,
  );
  await assert.rejects(
    harness.service.listLines(managerActor(), { batchId: draft.id }),
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
  readonly additionalAccounts: PlatformAccountRecord[];
} {
  const repository = new InMemoryPlatformEarningRepository();
  const harness = {
    account: platformAccount(),
    additionalAccounts: [] as PlatformAccountRecord[],
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
      async resolveManagedScopeByResponsibleEmploymentProfile() {
        const assignments = input.assignments ?? [managerAssignment()];
        return {
          talentGroupIds: [...new Set(assignments.map((item) => item.groupId))],
          orgUnitIds: [],
          orgUnitScopes: [],
        };
      },
    },
    {
      async findById(platformAccountId) {
        return [harness.account, ...harness.additionalAccounts].find(
          (account) => account.id === platformAccountId,
        ) ?? null;
      },
    },
    {
      async listPlatformAccounts(query) {
        const items = [harness.account, ...harness.additionalAccounts]
          .filter(
            (account) =>
              (!query.ownerTalentGroupId ||
                account.ownerTalentGroupId === query.ownerTalentGroupId) &&
              (!query.operationalStatus ||
                account.operationalStatus === query.operationalStatus) &&
              (query.livestreamEnabled === undefined ||
                account.livestreamEnabled === query.livestreamEnabled) &&
              (query.monetizationEnabled === undefined ||
                account.monetizationEnabled === query.monetizationEnabled),
          )
          .sort((left, right) => left.id.localeCompare(right.id));
        const afterCursor = query.cursor
          ? items.filter((account) => account.id > query.cursor!)
          : items;
        const page = afterCursor.slice(0, query.limit);
        return {
          items: page,
          nextCursor:
            afterCursor.length > query.limit
              ? page[page.length - 1]?.id
              : undefined,
        };
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
    input.structuredAuthority ?? structuredAuthority(),
    () => now,
  );
  return harness;
}

class InMemoryPlatformEarningRepository implements PlatformEarningRepository {
  readonly batches = new Map<string, PlatformEarningBatch>();
  readonly lines = new Map<string, PlatformEarningLine>();
  lastBatchFilters:
    | Parameters<PlatformEarningRepository["listBatches"]>[0]
    | undefined;

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
    this.lastBatchFilters = filters;
    const items = [...this.batches.values()]
      .filter(
        (item) =>
          (!filters.talentGroupId || item.talentGroupId === filters.talentGroupId) &&
          (!filters.platformAccountId ||
            item.platformAccountId === filters.platformAccountId) &&
          (!filters.platformAccountIds ||
            filters.platformAccountIds.includes(item.platformAccountId)) &&
          (!filters.createdByActorId ||
            item.createdByActorId === filters.createdByActorId),
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const afterCursor = filters.cursor
      ? items.filter((item) => item.id > filters.cursor!)
      : items;
    const page = afterCursor.slice(0, filters.limit);
    return {
      items: page,
      nextCursor:
        afterCursor.length > filters.limit
          ? page[page.length - 1]?.id
          : undefined,
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

function line(overrides: Partial<PlatformEarningLine> = {}): PlatformEarningLine {
  return {
    id: "line-managed",
    batchId: "batch-managed",
    batchStatus: "DRAFT",
    sourceDate: now,
    periodMonth: "2026-06",
    platform: "TIKTOK",
    platformAccountId: "pa-managed",
    talentGroupId: "tg-managed",
    memberTalentId: "talent-member",
    memberEmploymentProfileId: "ep-member",
    eventId: null,
    sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
    sourceUnit: "DIAMOND",
    rawQuantity: 100,
    externalSourceRef: null,
    notes: null,
    duplicateDetectionKey: "managed-line-key",
    correctionOfLineId: null,
    replacementLineId: null,
    enteredByActorId: "admin-source",
    enteredAt: now,
    submittedByActorId: null,
    submittedAt: null,
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
    permissions: ["revenueLedger.platformEarning.read"],
    scopeGrants: {},
    accountContexts: ["MANAGER_CONSOLE"],
    isActive: true,
  });
}

function structuredAuthority(
  assignments: readonly StructuredScopeAuthorityAssignment[] = [
    structuredAssignment({
      permission: "revenueLedger.platformEarning.read",
      scopeType: "managedTalentGroup",
      targetId: "tg-managed",
    }),
    structuredAssignment({
      permission: "revenueLedger.platformEarning.read",
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
