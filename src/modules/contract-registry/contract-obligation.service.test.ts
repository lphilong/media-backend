import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { BusinessCodeSequenceRepository } from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { ContractObligationAdminService } from "./admin/admin.contract-obligation.service";
import { ContractRegistryAdminService } from "./admin/admin.contract-registry.service";
import {
  ContractObligationEventEvidenceLinkRepository,
  RemoveContractObligationEventEvidenceLinkInput,
} from "./domain/contract-obligation-event-evidence-link.repository";
import { ContractObligationEventEvidenceLink } from "./domain/contract-obligation-event-evidence-link.types";
import {
  ContractObligationRepository,
  TransitionContractObligationInput,
  UpdateContractObligationMetadataInput,
} from "./domain/contract-obligation.repository";
import {
  CONTRACT_OBLIGATION_EVIDENCE_REF_TYPES,
  ContractObligation,
} from "./domain/contract-obligation.types";
import {
  ContractObligationEligibilityError,
  ContractObligationSelfAcceptanceError,
  ContractObligationStateError,
  ContractObligationValidationError,
  ContractRegistryStateError,
} from "./domain/contract-registry.errors";
import { ContractObligationAdminExposure } from "./shared/contract-registry.exposure";
import {
  ContractRegistryRepository,
  TransitionContractRecordStatusInput,
} from "./domain/contract-registry.repository";
import {
  ContractRecord,
  ContractRecordStatus,
} from "./domain/contract-registry.types";

const session = {} as ClientSession;
const audit = { async record() {} } as unknown as AuditGuard;
const bridge: AuthoritativeAdminMutationBridge = {
  async execute(_params, mutate) {
    return mutate(session, {
      markAuthSecurityTruthChanged() {},
      markExplicitNoOpSuccess() {},
    } as AuthoritativeMutationControls);
  },
};

test("CR-3A obligation lifecycle, eligibility, evidence, separation, archive guard, and boundaries", async () => {
  await bindTraceId("cr-3a-obligation", async () => {
    const contracts = new MemoryContractRepository();
    const obligations = new MemoryObligationRepository();
    const codes = new MemoryCodeSequenceRepository();
    const service = new ContractObligationAdminService(
      obligations,
      new MemoryEventEvidenceLinkRepository(),
      contracts,
      codes,
      {
        async findById(id: string) {
          return id === "owner-1"
            ? {
                id,
                employmentStatus: "ACTIVE" as const,
              }
            : null;
        },
      },
      audit,
      bridge,
    );
    const maker = actor("maker");
    const reviewer = actor("reviewer");

    contracts.records.push(contractRecord());
    const created = await service.create(
      maker,
      createCommand("contract-1"),
    );
    assert.equal(created.status, "DRAFT");
    assert.equal(created.obligationType, "DELIVERABLE");
    assert.equal(
      created.boundaryMetadata.eventEvidenceLinkImplemented,
      true,
    );
    assert.equal(
      created.boundaryMetadata.acceptanceCreatesRevenue,
      false,
    );
    assert.equal(
      created.boundaryMetadata.acceptanceCreatesCommission,
      false,
    );
    const exposed = ContractObligationAdminExposure.expose({
      ...created,
      _id: "must-not-leak",
    } as never);
    assert.equal("_id" in exposed, false);
    assert.deepEqual(
      exposed.boundaryMetadata,
      created.boundaryMetadata,
    );

    const opened = await service.open(maker, {
      obligationId: created.id,
    });
    assert.equal(opened.status, "OPEN");
    const delivered = await service.deliver(maker, {
      obligationId: created.id,
      deliveryNote: "Delivered for review",
      evidenceRefs: [
        {
          type: "URL",
          label: "Published output",
          url: "https://example.com/output",
        },
      ],
    });
    assert.equal(delivered.status, "DELIVERED");
    await assert.rejects(
      service.accept(maker, {
        obligationId: created.id,
      }),
      ContractObligationSelfAcceptanceError,
    );
    const accepted = await service.accept(reviewer, {
      obligationId: created.id,
      reviewNote: "Accepted after independent review",
    });
    assert.equal(accepted.status, "ACCEPTED");
    assert.equal(accepted.acceptedByActorId, "reviewer");
    assert.deepEqual(
      accepted.statusHistory.map((entry) => entry.toStatus),
      ["DRAFT", "OPEN", "DELIVERED", "ACCEPTED"],
    );
    await assert.rejects(
      service.reject(reviewer, {
        obligationId: created.id,
        reason: "Too late",
      }),
      ContractObligationStateError,
    );

    const correction = await service.create(
      maker,
      createCommand("contract-1", "OPTIONAL"),
    );
    await service.open(maker, {
      obligationId: correction.id,
    });
    await service.deliver(maker, {
      obligationId: correction.id,
      evidenceRefs: [],
    });
    const rejected = await service.reject(reviewer, {
      obligationId: correction.id,
      reason: "Output needs correction",
    });
    assert.equal(rejected.status, "REJECTED");
    const reopened = await service.reopen(reviewer, {
      obligationId: correction.id,
      reason: "Returned to delivery owner",
    });
    assert.equal(reopened.status, "OPEN");

    const required = await service.create(
      maker,
      createCommand("contract-1"),
    );
    await service.open(maker, {
      obligationId: required.id,
    });
    await assert.rejects(
      service.deliver(maker, {
        obligationId: required.id,
        evidenceRefs: [],
      }),
      ContractObligationValidationError,
    );
    await assert.rejects(
      service.deliver(maker, {
        obligationId: required.id,
        evidenceRefs: [
          {
            type: "URL",
            label: "Invalid URL",
            url: "file:///tmp/evidence",
          },
        ],
      }),
      ContractObligationValidationError,
    );
    await assert.rejects(
      service.deliver(maker, {
        obligationId: required.id,
        evidenceRefs: [
          {
            type: "INTERNAL_REFERENCE",
            label: "Missing reference",
          },
        ],
      }),
      ContractObligationValidationError,
    );

    contracts.records.push(
      contractRecord({
        id: "employment-contract",
        contractKind: "EMPLOYMENT",
      }),
      contractRecord({
        id: "future-contract",
        contractKind: "FUTURE_KIND" as never,
      }),
    );
    await assert.rejects(
      service.create(
        maker,
        createCommand("employment-contract"),
      ),
      ContractObligationEligibilityError,
    );
    await assert.rejects(
      service.create(
        maker,
        createCommand("future-contract"),
      ),
      ContractObligationEligibilityError,
    );

    assert.equal(
      CONTRACT_OBLIGATION_EVIDENCE_REF_TYPES.includes(
        "EVENT_COMPLETION" as never,
      ),
      false,
    );

    const unresolved = await service.create(
      maker,
      createCommand("contract-1", "OPTIONAL"),
    );
    contracts.setStatus("contract-1", "TERMINATED");
    const contractService = new ContractRegistryAdminService(
      contracts,
      obligations,
      codes,
      {} as never,
      {} as never,
      audit,
      bridge,
    );
    await assert.rejects(
      contractService.archiveContractRecord(maker, {
        contractRecordId: "contract-1",
      }),
      ContractRegistryStateError,
    );

    contracts.setStatus("contract-1", "ACTIVE");
    await service.cancel(maker, {
      obligationId: unresolved.id,
      reason: "No longer required",
    });
    await service.archive(maker, {
      obligationId: unresolved.id,
    });
    await service.cancel(maker, {
      obligationId: correction.id,
      reason: "Correction path closed",
    });
    await service.archive(maker, {
      obligationId: correction.id,
    });
    await service.archive(maker, {
      obligationId: accepted.id,
    });
    await service.cancel(maker, {
      obligationId: required.id,
      reason: "Test cleanup",
    });
    await service.archive(maker, {
      obligationId: required.id,
    });
    contracts.setStatus("contract-1", "TERMINATED");
    const archived =
      await contractService.archiveContractRecord(maker, {
        contractRecordId: "contract-1",
      });
    assert.equal(archived.status, "ARCHIVED");
  });
});

test("CR-3A active TALENT_MANAGEMENT contracts can receive and process obligations", async () => {
  await bindTraceId(
    "cr-3a-talent-management-obligation",
    async () => {
      const contracts = new MemoryContractRepository();
      const obligations = new MemoryObligationRepository();
      const service = createObligationService(
        contracts,
        obligations,
      );
      const maker = actor("maker");

      contracts.records.push(
        contractRecord({
          id: "talent-management-contract",
          contractCode: "CON-TM-1",
          title: "Talent management contract",
          normalizedTitle: "talent management contract",
          contractKind: "TALENT_MANAGEMENT",
        }),
      );

      const created = await service.create(
        maker,
        createCommand("talent-management-contract", "OPTIONAL"),
      );
      assert.equal(created.contractRecordId, "talent-management-contract");
      assert.equal(created.status, "DRAFT");

      const opened = await service.open(maker, {
        obligationId: created.id,
      });
      assert.equal(opened.status, "OPEN");

      const delivered = await service.deliver(maker, {
        obligationId: created.id,
        deliveryNote: "Talent management output delivered",
        evidenceRefs: [],
      });
      assert.equal(delivered.status, "DELIVERED");
    },
  );
});

test("CR-3A non-active contract states reject obligation creation and processing", async () => {
  await bindTraceId("cr-3a-non-active-contract-states", async () => {
    const nonActiveStatuses: readonly ContractRecordStatus[] = [
      "DRAFT",
      "PENDING_SIGNATURE",
      "EXPIRED",
      "TERMINATED",
      "ARCHIVED",
    ];

    for (const status of nonActiveStatuses) {
      const contracts = new MemoryContractRepository();
      const obligations = new MemoryObligationRepository();
      const service = createObligationService(
        contracts,
        obligations,
      );
      const maker = actor(`maker-${status}`);
      const blockedContractId = `blocked-${status}`;
      const activeContractId = `active-before-${status}`;

      contracts.records.push(
        contractRecord({
          id: blockedContractId,
          contractCode: `CON-BLOCKED-${status}`,
          status,
        }),
      );

      await assert.rejects(
        service.create(
          maker,
          createCommand(blockedContractId, "OPTIONAL"),
        ),
        ContractObligationEligibilityError,
        `${status} contracts must reject obligation creation`,
      );

      contracts.records.push(
        contractRecord({
          id: activeContractId,
          contractCode: `CON-ACTIVE-${status}`,
        }),
      );
      const existing = await service.create(
        maker,
        createCommand(activeContractId, "OPTIONAL"),
      );

      contracts.setStatus(activeContractId, status);
      await assert.rejects(
        service.open(maker, {
          obligationId: existing.id,
        }),
        ContractObligationEligibilityError,
        `${status} contracts must reject obligation processing`,
      );
      assert.equal(
        obligations.records.find(
          (record) => record.id === existing.id,
        )?.status,
        "DRAFT",
      );
    }
  });
});

function createObligationService(
  contracts: MemoryContractRepository,
  obligations: MemoryObligationRepository,
): ContractObligationAdminService {
  return new ContractObligationAdminService(
    obligations,
    new MemoryEventEvidenceLinkRepository(),
    contracts,
    new MemoryCodeSequenceRepository(),
    {
      async findById(id: string) {
        return id === "owner-1"
          ? {
              id,
              employmentStatus: "ACTIVE" as const,
            }
          : null;
      },
    },
    audit,
    bridge,
  );
}

function actor(id: string): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    accountContexts: ["ADMIN_CONSOLE"],
    roles: [],
    permissions: [
      Permission.CONTRACT_OBLIGATION_READ,
      Permission.CONTRACT_OBLIGATION_MANAGE_DRAFT,
      Permission.CONTRACT_OBLIGATION_DELIVER,
      Permission.CONTRACT_OBLIGATION_REVIEW,
      Permission.CONTRACT_OBLIGATION_MANAGE_LIFECYCLE,
      Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE,
    ],
    scopeGrants: {
      contractRegistry: ["global"],
    },
    isActive: true,
  });
}

function createCommand(
  contractRecordId: string,
  evidencePolicy: "OPTIONAL" | "REQUIRED" = "REQUIRED",
) {
  return {
    contractRecordId,
    obligationType: "DELIVERABLE",
    title: "Publish campaign output",
    description: "Provide the agreed campaign output",
    dueDate: "2026-07-01",
    responsibleOwnerEmploymentProfileId: "owner-1",
    evidencePolicy,
  };
}

function contractRecord(
  overrides: Partial<ContractRecord> = {},
): ContractRecord {
  return {
    id: "contract-1",
    contractCode: "CON-1",
    title: "Commercial contract",
    normalizedTitle: "commercial contract",
    contractKind: "TALENT_SERVICE",
    linkedEntityKind: "TALENT",
    linkedEmploymentProfileId: null,
    linkedTalentId: "talent-1",
    ownerEmploymentProfileId: "owner-1",
    confidentialityTier: "INTERNAL",
    status: "ACTIVE",
    effectiveStartDate: Date.UTC(2026, 0, 1),
    effectiveEndDate: null,
    fileReferenceId: null,
    fileDisplayName: null,
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

class MemoryObligationRepository
  implements ContractObligationRepository
{
  readonly records: ContractObligation[] = [];

  async insert(record: ContractObligation) {
    this.records.push(record);
    return record;
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findByCode(code: string) {
    return this.records.find((record) => record.code === code) ?? null;
  }

  async findMaxGeneratedCodeSequence() {
    return this.records.length;
  }

  async updateMetadata(
    input: UpdateContractObligationMetadataInput,
  ) {
    const index = this.records.findIndex(
      (record) =>
        record.id === input.obligationId &&
        input.fromStatuses.includes(record.status),
    );
    if (index < 0) return null;
    const updated = {
      ...this.records[index],
      ...input,
      id: this.records[index].id,
      status: this.records[index].status,
    };
    this.records[index] = updated;
    return updated;
  }

  async transitionStatus(
    input: TransitionContractObligationInput,
  ) {
    const index = this.records.findIndex(
      (record) =>
        record.id === input.obligationId &&
        input.fromStatuses.includes(record.status),
    );
    if (index < 0) return null;
    const current = this.records[index];
    const updated: ContractObligation = {
      ...current,
      ...input,
      id: current.id,
      status: input.toStatus,
      statusHistory: [
        ...current.statusHistory,
        input.transition,
      ],
      latestEvidenceRefs:
        input.latestEvidenceRefs ??
        current.latestEvidenceRefs,
      latestEventEvidenceLinkIds:
        input.latestEventEvidenceLinkIds ??
        current.latestEventEvidenceLinkIds,
    };
    this.records[index] = updated;
    return updated;
  }

  async hasUnresolvedByContractRecordId(
    contractRecordId: string,
  ) {
    return this.records.some(
      (record) =>
        record.contractRecordId === contractRecordId &&
        ["DRAFT", "OPEN", "DELIVERED", "REJECTED"].includes(
          record.status,
        ),
    );
  }
}

class MemoryEventEvidenceLinkRepository
  implements ContractObligationEventEvidenceLinkRepository
{
  readonly records: ContractObligationEventEvidenceLink[] = [];

  async insert(record: ContractObligationEventEvidenceLink) {
    this.records.push(record);
    return record;
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findActiveByObligationAndEvent(
    contractObligationId: string,
    eventId: string,
  ) {
    return (
      this.records.find(
        (record) =>
          record.contractObligationId === contractObligationId &&
          record.eventId === eventId &&
          record.status === "ACTIVE",
      ) ?? null
    );
  }

  async listActiveByIdsForObligation(
    contractObligationId: string,
    linkIds: readonly string[],
  ) {
    const ids = new Set(linkIds);
    return this.records.filter(
      (record) =>
        ids.has(record.id) &&
        record.contractObligationId === contractObligationId &&
        record.status === "ACTIVE",
    );
  }

  async softRemove(
    input: RemoveContractObligationEventEvidenceLinkInput,
  ) {
    const index = this.records.findIndex(
      (record) =>
        record.id === input.linkId &&
        record.status === "ACTIVE",
    );
    if (index < 0) return null;
    const current = this.records[index];
    const updated: ContractObligationEventEvidenceLink = {
      ...current,
      status: "REMOVED",
      removedByActorId: input.removedByActorId,
      removedAt: input.removedAt,
      removeReason: input.removeReason,
      actionHistory: [
        ...current.actionHistory,
        input.action,
      ],
      updatedByActorId: input.updatedByActorId,
      updatedAt: input.updatedAt,
    };
    this.records[index] = updated;
    return updated;
  }
}

class MemoryContractRepository
  implements ContractRegistryRepository
{
  readonly records: ContractRecord[] = [];

  async insert(record: ContractRecord) {
    this.records.push(record);
    return record;
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findByContractCode(code: string) {
    return (
      this.records.find(
        (record) => record.contractCode === code,
      ) ?? null
    );
  }

  async findMaxGeneratedContractCodeSequence() {
    return 0;
  }

  async updateDraftCore() {
    return null;
  }

  async assignOwner() {
    return null;
  }

  async updateFileReference() {
    return null;
  }

  async transitionStatus(
    input: TransitionContractRecordStatusInput,
  ) {
    const index = this.records.findIndex(
      (record) =>
        record.id === input.contractRecordId &&
        input.fromStatuses.includes(record.status),
    );
    if (index < 0) return null;
    const updated = {
      ...this.records[index],
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };
    this.records[index] = updated;
    return updated;
  }

  setStatus(
    id: string,
    status: ContractRecord["status"],
  ): void {
    const index = this.records.findIndex(
      (record) => record.id === id,
    );
    this.records[index] = {
      ...this.records[index],
      status,
    };
  }
}

class MemoryCodeSequenceRepository
  implements BusinessCodeSequenceRepository
{
  private value = 0;

  async allocateNext() {
    this.value += 1;
    return this.value;
  }

  async ensureAtLeast(
    _moduleKey: string,
    _bucket: string,
    minimumValue: number,
  ) {
    this.value = Math.max(this.value, minimumValue);
  }
}
