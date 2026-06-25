import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import {
  BusinessCodeSequenceRepository,
  BusinessCodePolicy,
} from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { RevenueLedgerAdminService } from "@modules/revenue-ledger/admin/admin.revenue-ledger.service";
import {
  RevenueLedgerConflictError,
  RevenueLedgerPermissionScopeError,
  RevenueLedgerValidationError,
} from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import {
  RevenueEntryRepository,
  TransitionRevenueEntryStatusInput,
  UpdateRevenueEntryDraftCoreInput,
} from "@modules/revenue-ledger/domain/revenue-ledger.repository";
import { RevenueEntry } from "@modules/revenue-ledger/domain/revenue-ledger.types";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityService,
} from "@modules/role/domain/structured-scope-authority";

const SESSION = {} as never;
const MAY_2024 = Date.UTC(2024, 4, 15);
const JUNE_2024 = Date.UTC(2024, 5, 15);

test("AUTH-3D-2 exact financePeriod can create detail lifecycle and archive Revenue Entry", async () => {
  const harness = createHarness();
  const finance = actorWith("finance", [
    Permission.REVENUE_LEDGER_CREATE,
    Permission.REVENUE_LEDGER_UPDATE,
    Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
    Permission.REVENUE_LEDGER_RECONCILE,
  ]);

  const created = await withTrace(() =>
    harness.service.createRevenueEntry(finance, createCommand()),
  );
  assert.equal(created.status, "DRAFT");

  const updated = await withTrace(() =>
    harness.service.updateRevenueEntryDraftCore(finance, {
      revenueEntryId: created.id,
      title: "June revenue revised",
      recognizedAmount: 125,
    }),
  );
  assert.equal(updated.title, "June revenue revised");

  const finalized = await withTrace(() =>
    harness.service.finalizeRevenueEntry(finance, {
      revenueEntryId: created.id,
    }),
  );
  assert.equal(finalized.status, "FINALIZED");

  const reconciled = await withTrace(() =>
    harness.service.reconcileRevenueEntry(finance, {
      revenueEntryId: created.id,
      reconciliationReference: "statement-1",
    }),
  );
  assert.equal(reconciled.status, "RECONCILED");

  const archived = await withTrace(() =>
    harness.service.archiveRevenueEntry(finance, {
      revenueEntryId: created.id,
    }),
  );
  assert.equal(archived.status, "ARCHIVED");
});

test("AUTH-3D-2 financeGlobal can create and void Revenue Entry", async () => {
  const harness = createHarness({
    structuredAssignments: financeAssignmentsFor(
      "global-finance",
      [
        Permission.REVENUE_LEDGER_CREATE,
        Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
      ],
      { scopeType: "financeGlobal" },
    ),
  });
  const finance = actorWith("global-finance", [
    Permission.REVENUE_LEDGER_CREATE,
    Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
  ]);

  const created = await withTrace(() =>
    harness.service.createRevenueEntry(finance, createCommand()),
  );
  await withTrace(() =>
    harness.service.finalizeRevenueEntry(finance, {
      revenueEntryId: created.id,
    }),
  );
  const voided = await withTrace(() =>
    harness.service.voidRevenueEntry(finance, {
      revenueEntryId: created.id,
    }),
  );
  assert.equal(voided.status, "VOIDED");
});

test("AUTH-3D-2 denies no structured scope wrong period legacy-only and manager source-only Revenue Entry actors", async () => {
  const noStructured = createHarness({ structuredAssignments: [] });
  await assert.rejects(
    withTrace(() =>
      noStructured.service.createRevenueEntry(
        actorWith("legacy-only", [Permission.REVENUE_LEDGER_CREATE]),
        createCommand(),
      ),
    ),
    RevenueLedgerPermissionScopeError,
  );

  const wrongPeriod = createHarness({
    structuredAssignments: financeAssignmentsFor(
      "wrong-period",
      [Permission.REVENUE_LEDGER_CREATE],
      { scopeType: "financePeriod", periodKey: "2024-05" },
    ),
  });
  await assert.rejects(
    withTrace(() =>
      wrongPeriod.service.createRevenueEntry(
        actorWith("wrong-period", [Permission.REVENUE_LEDGER_CREATE]),
        createCommand(),
      ),
    ),
    RevenueLedgerPermissionScopeError,
  );

  const managerSourceOnly = createHarness({
    structuredAssignments: [
      structuredAssignment({
        userId: "manager-source",
        permission: Permission.REVENUE_LEDGER_CREATE,
        scope: {
          scopeType: "managedTalentGroup",
          targetId: "tg-1",
        },
      }),
    ],
  });
  await assert.rejects(
    withTrace(() =>
      managerSourceOnly.service.createRevenueEntry(
        actorWith("manager-source", [Permission.REVENUE_LEDGER_CREATE]),
        createCommand(),
      ),
    ),
    RevenueLedgerPermissionScopeError,
  );
});

test("AUTH-3D-2 cross-period draft update requires both old and new finance periods or financeGlobal", async () => {
  const oneSide = createHarness({
    structuredAssignments: financeAssignmentsFor(
      "one-side",
      [
        Permission.REVENUE_LEDGER_CREATE,
        Permission.REVENUE_LEDGER_UPDATE,
      ],
      { scopeType: "financePeriod", periodKey: "2024-05" },
    ),
  });
  const actor = actorWith("one-side", [
    Permission.REVENUE_LEDGER_CREATE,
    Permission.REVENUE_LEDGER_UPDATE,
  ]);
  const created = await withTrace(() =>
    oneSide.service.createRevenueEntry(
      actor,
      createCommand({ recognizedAt: MAY_2024 }),
    ),
  );

  await assert.rejects(
    withTrace(() =>
      oneSide.service.updateRevenueEntryDraftCore(actor, {
        revenueEntryId: created.id,
        recognizedAt: JUNE_2024,
      }),
    ),
    RevenueLedgerPermissionScopeError,
  );

  const bothSides = createHarness({
    structuredAssignments: [
      ...financeAssignmentsFor(
        "both-sides",
        [
          Permission.REVENUE_LEDGER_CREATE,
          Permission.REVENUE_LEDGER_UPDATE,
        ],
        { scopeType: "financePeriod", periodKey: "2024-05" },
      ),
      ...financeAssignmentsFor(
        "both-sides",
        [Permission.REVENUE_LEDGER_UPDATE],
        { scopeType: "financePeriod", periodKey: "2024-06" },
      ),
    ],
  });
  const bothActor = actorWith("both-sides", [
    Permission.REVENUE_LEDGER_CREATE,
    Permission.REVENUE_LEDGER_UPDATE,
  ]);
  const bothCreated = await withTrace(() =>
    bothSides.service.createRevenueEntry(
      bothActor,
      createCommand({ recognizedAt: MAY_2024 }),
    ),
  );
  const moved = await withTrace(() =>
    bothSides.service.updateRevenueEntryDraftCore(bothActor, {
      revenueEntryId: bothCreated.id,
      recognizedAt: JUNE_2024,
    }),
  );
  assert.equal(moved.recognizedAt, JUNE_2024);
});

test("AUTH-3D-2 fails closed for invalid recognizedAt target and preserves finalized commission void block", async () => {
  const harness = createHarness();
  const finance = actorWith("finance", [
    Permission.REVENUE_LEDGER_CREATE,
    Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
  ]);

  await assert.rejects(
    withTrace(() =>
      harness.service.createRevenueEntry(
        finance,
        {
          ...createCommand(),
          recognizedAt: undefined as never,
        },
      ),
    ),
    RevenueLedgerValidationError,
  );

  const bad = revenueEntryRecord({
    id: "bad-recognized-at",
    recognizedAt: Number.NaN as never,
  });
  harness.repository.seed(bad);
  await assert.rejects(
    withTrace(() =>
      harness.service.finalizeRevenueEntry(finance, {
        revenueEntryId: bad.id,
      }),
    ),
    RevenueLedgerPermissionScopeError,
  );

  const created = await withTrace(() =>
    harness.service.createRevenueEntry(finance, createCommand()),
  );
  await withTrace(() =>
    harness.service.finalizeRevenueEntry(finance, {
      revenueEntryId: created.id,
    }),
  );
  harness.commissionReferenceRevenueEntryId = created.id;

  await assert.rejects(
    withTrace(() =>
      harness.service.voidRevenueEntry(finance, {
        revenueEntryId: created.id,
      }),
    ),
    RevenueLedgerConflictError,
  );
});

function createHarness(input: {
  readonly structuredAssignments?: readonly StructuredScopeAuthorityAssignment[];
} = {}): {
  readonly service: RevenueLedgerAdminService;
  readonly repository: InMemoryRevenueEntryRepository;
  commissionReferenceRevenueEntryId: string | null;
} {
  const repository = new InMemoryRevenueEntryRepository();
  const harnessState: {
    commissionReferenceRevenueEntryId: string | null;
  } = {
    commissionReferenceRevenueEntryId: null,
  };
  const service = new RevenueLedgerAdminService(
    repository,
    new InMemoryBusinessCodeSequenceRepository(),
    {
      async findById(id: string) {
        return id === "talent-1" ? { id } : null;
      },
    },
    {
      async findById(id: string) {
        return id === "pa-1" ? { id } : null;
      },
    },
    {
      async findById() {
        return null;
      },
      async hasActiveTalentAssignment() {
        return false;
      },
    },
    {
      async findFinalizedSettlementReferenceByRevenueEntryId(
        revenueEntryId: string,
      ) {
        return harnessState.commissionReferenceRevenueEntryId ===
          revenueEntryId
          ? { commissionSettlementId: "settlement-1" }
          : null;
      },
    },
    {
      async record() {
        return undefined;
      },
    } as unknown as AuditGuard,
    {
      async execute(_params, mutate) {
        return mutate(SESSION, {
          markAuthSecurityTruthChanged() {
            return undefined;
          },
          markExplicitNoOpSuccess() {
            return undefined;
          },
        });
      },
    } satisfies AuthoritativeAdminMutationBridge,
    structuredAuthority(
      input.structuredAssignments ?? defaultFinanceAssignments(),
    ),
  );

  return {
    service,
    repository,
    get commissionReferenceRevenueEntryId() {
      return harnessState.commissionReferenceRevenueEntryId;
    },
    set commissionReferenceRevenueEntryId(value: string | null) {
      harnessState.commissionReferenceRevenueEntryId = value;
    },
  };
}

function createCommand(
  overrides: Partial<{
    readonly title: string;
    readonly recognizedAt: number;
  }> = {},
) {
  return {
    title: overrides.title ?? "June revenue",
    subjectTalentId: "talent-1",
    attributionPlatformAccountId: "pa-1",
    revenueKind: "PLATFORM_LIVESTREAM",
    entrySource: "MANUAL",
    currencyCode: "VND",
    recognizedAmount: 100,
    recognizedAt: overrides.recognizedAt ?? JUNE_2024,
  };
}

class InMemoryBusinessCodeSequenceRepository
  implements BusinessCodeSequenceRepository
{
  private readonly values = new Map<string, number>();

  async allocateNext(
    moduleKey: string,
    bucket: string,
  ): Promise<number> {
    const key = `${moduleKey}:${bucket}`;
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }

  async ensureAtLeast(
    moduleKey: string,
    bucket: string,
    value: number,
  ): Promise<void> {
    const key = `${moduleKey}:${bucket}`;
    this.values.set(
      key,
      Math.max(this.values.get(key) ?? 0, value),
    );
  }
}

class InMemoryRevenueEntryRepository
  implements RevenueEntryRepository
{
  readonly entries = new Map<string, RevenueEntry>();

  seed(entry: RevenueEntry): void {
    this.entries.set(entry.id, entry);
  }

  async insert(
    revenueEntry: RevenueEntry,
  ): Promise<RevenueEntry> {
    this.entries.set(revenueEntry.id, revenueEntry);
    return revenueEntry;
  }

  async findById(
    revenueEntryId: string,
  ): Promise<RevenueEntry | null> {
    return this.entries.get(revenueEntryId) ?? null;
  }

  async findByRevenueEntryCode(
    revenueEntryCode: string,
  ): Promise<RevenueEntry | null> {
    return (
      [...this.entries.values()].find(
        (entry) =>
          entry.revenueEntryCode === revenueEntryCode,
      ) ?? null
    );
  }

  async findMaxGeneratedRevenueEntryCodeSequence(
    _policy: Pick<BusinessCodePolicy, "prefix" | "width">,
  ): Promise<number> {
    return 0;
  }

  async updateDraftCore(
    input: UpdateRevenueEntryDraftCoreInput,
  ): Promise<RevenueEntry | null> {
    const current = this.entries.get(input.revenueEntryId);
    if (!current || current.status !== "DRAFT") {
      return null;
    }
    const updated: RevenueEntry = {
      ...current,
      title: input.title ?? current.title,
      normalizedTitle:
        input.normalizedTitle ?? current.normalizedTitle,
      description:
        input.description !== undefined
          ? input.description
          : current.description,
      externalRef:
        input.externalRef !== undefined
          ? input.externalRef
          : current.externalRef,
      subjectTalentId:
        input.subjectTalentId ?? current.subjectTalentId,
      attributionPlatformAccountId:
        input.attributionPlatformAccountId !== undefined
          ? input.attributionPlatformAccountId
          : current.attributionPlatformAccountId,
      attributionEventId:
        input.attributionEventId !== undefined
          ? input.attributionEventId
          : current.attributionEventId,
      revenueKind: input.revenueKind ?? current.revenueKind,
      currencyCode: input.currencyCode ?? current.currencyCode,
      recognizedAmount:
        input.recognizedAmount ?? current.recognizedAmount,
      recognizedAt: input.recognizedAt ?? current.recognizedAt,
      updatedAt: input.updatedAt,
    };
    this.entries.set(updated.id, updated);
    return updated;
  }

  async transitionStatus(
    input: TransitionRevenueEntryStatusInput,
  ): Promise<RevenueEntry | null> {
    const current = this.entries.get(input.revenueEntryId);
    if (
      !current ||
      !input.fromStatuses.includes(current.status)
    ) {
      return null;
    }
    const updated: RevenueEntry = {
      ...current,
      status: input.toStatus,
      finalizedAt:
        input.finalizedAt !== undefined
          ? input.finalizedAt
          : current.finalizedAt,
      reconciledAt:
        input.reconciledAt !== undefined
          ? input.reconciledAt
          : current.reconciledAt,
      voidedAt:
        input.voidedAt !== undefined
          ? input.voidedAt
          : current.voidedAt,
      reconciliationReference:
        input.reconciliationReference !== undefined
          ? input.reconciliationReference
          : current.reconciliationReference,
      updatedAt: input.updatedAt,
    };
    this.entries.set(updated.id, updated);
    return updated;
  }
}

function defaultFinanceAssignments(): readonly StructuredScopeAuthorityAssignment[] {
  return [
    ...financeAssignmentsFor("finance", [
      Permission.REVENUE_LEDGER_CREATE,
      Permission.REVENUE_LEDGER_UPDATE,
      Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
      Permission.REVENUE_LEDGER_RECONCILE,
    ]),
  ];
}

function financeAssignmentsFor(
  userId: string,
  permissions: readonly Permission[],
  scope:
    | { readonly scopeType: "financeGlobal" }
    | {
        readonly scopeType: "financePeriod";
        readonly periodKey: string;
      } = {
    scopeType: "financePeriod",
    periodKey: "2024-06",
  },
): readonly StructuredScopeAuthorityAssignment[] {
  return permissions.map((permission) =>
    structuredAssignment({
      userId,
      permission,
      scope,
    }),
  );
}

function structuredAuthority(
  assignments: readonly StructuredScopeAuthorityAssignment[],
): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(userId) {
      return assignments.filter(
        (record) => record.assignment.userId === userId,
      );
    },
  });
}

function structuredAssignment(input: {
  readonly userId: string;
  readonly permission: Permission;
  readonly scope:
    | { readonly scopeType: "financeGlobal" }
    | {
        readonly scopeType: "financePeriod";
        readonly periodKey: string;
      }
    | {
        readonly scopeType: "managedTalentGroup";
        readonly targetId: string;
      };
}): StructuredScopeAuthorityAssignment {
  const scopeKey =
    input.scope.scopeType === "financePeriod"
      ? input.scope.periodKey
      : input.scope.scopeType === "financeGlobal"
        ? "global"
        : input.scope.targetId;
  const assignmentId = [
    "structured",
    input.userId,
    input.permission,
    input.scope.scopeType,
    scopeKey,
  ].join("-");
  return {
    assignment: {
      assignmentId,
      roleId: assignmentId,
      userId: input.userId,
      structuredScopeGrants: [input.scope],
      state: "ACTIVE",
      effectiveAt: 1,
      expiresAt: null,
      revokedAt: null,
      origin: "DIRECT",
      bundleOrigin: null,
      reason: null,
      createdAt: 1,
      updatedAt: 1,
    },
    role: {
      id: assignmentId,
      state: "ACTIVE",
      permissions: [input.permission],
    },
  };
}

function actorWith(
  id: string,
  permissions: readonly Permission[],
): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants: {
      revenueLedger: ["global"],
    },
    isActive: true,
  });
}

function revenueEntryRecord(
  overrides: Partial<RevenueEntry> = {},
): RevenueEntry {
  return {
    id: "seed-entry",
    revenueEntryCode: "REV-202406-00001",
    title: "Seed revenue",
    normalizedTitle: "seed revenue",
    subjectTalentId: "talent-1",
    attributionPlatformAccountId: "pa-1",
    attributionTalentGroupId: null,
    attributionEmploymentProfileId: null,
    attributionEventId: null,
    revenueKind: "PLATFORM_LIVESTREAM",
    entrySource: "MANUAL",
    sourceBatchIds: [],
    sourceSummaryRef: null,
    sourceLineCount: null,
    sourceSummarySnapshot: null,
    conversionSnapshot: null,
    platformCutSnapshot: null,
    commissionableBasisSnapshot: null,
    status: "DRAFT",
    currencyCode: "VND",
    recognizedAmount: 100,
    recognizedAt: JUNE_2024,
    finalizedAt: null,
    reconciledAt: null,
    voidedAt: null,
    reconciliationReference: null,
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function withTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId(
    `auth-3d-2-revenue-${Math.random().toString(36).slice(2)}`,
    fn,
  );
}
