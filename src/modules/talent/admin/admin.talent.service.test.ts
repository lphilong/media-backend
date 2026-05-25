import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import {
  BusinessCodePolicy,
  BusinessCodeSequenceRepository,
} from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { TalentAdminService } from "@modules/talent/admin/admin.talent.service";
import {
  TalentInvalidEmploymentLinkageError,
  TalentValidationError,
} from "@modules/talent/domain/talent.errors";
import {
  TalentRepository,
  UpdateTalentCoreInput,
} from "@modules/talent/domain/talent.repository";
import {
  TalentOperationalStatus,
  TalentRecord,
} from "@modules/talent/domain/talent.types";
import {
  TalentEmploymentProfileReadonlyAccess,
  TalentReferencedEmploymentProfile,
} from "@modules/talent/domain/talent-employment-profile-readonly-access";

const NOW = 1_800_000_000_000;

test("internal Talent create accepts linked EmploymentProfile without duplicate name inputs", async () => {
  const harness = createHarness();

  const result = await runWithTrace(() =>
    harness.service.createTalent(createActor(), {
      talentOrigin: "INTERNAL",
      linkedEmploymentProfileId: "ep-talent",
      commercialParticipationStatus: "ELIGIBLE",
      livestreamEligible: true,
      eventEligible: true,
    }),
  );

  assert.equal(result.talentOrigin, "INTERNAL");
  assert.equal(result.linkedEmploymentProfileId, "ep-talent");
  assert.equal(result.displayName, "Employment Display");
  assert.equal(result.performanceAlias, null);
  assert.equal(result.stageName, "Employment Display");
  assert.equal(result.legalName, "Employment Legal");
  assert.equal(result.displayShortName, null);
  assert.equal(harness.repository.records[0]?.legalName, "Employment Legal");
  assert.equal(harness.audit.records.length, 1);
});

test("internal Talent create and update require linkedEmploymentProfileId", async () => {
  const harness = createHarness();

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createTalent(createActor(), {
        talentOrigin: "INTERNAL",
        commercialParticipationStatus: "ELIGIBLE",
        livestreamEligible: true,
        eventEligible: true,
      }),
    ),
    TalentInvalidEmploymentLinkageError,
  );

  const staleInternal = harness.repository.seed(
    talentRecord({
      id: "talent-stale",
      linkedEmploymentProfileId: null,
    }),
  );

  await assert.rejects(
    runWithTrace(() =>
      harness.service.updateTalentCore(createActor(), {
        talentId: staleInternal.id,
        externalRef: "repair-blocked",
      }),
    ),
    TalentInvalidEmploymentLinkageError,
  );
});

test("internal Talent create and update do not require legalName or displayShortName input", async () => {
  const harness = createHarness();
  const created = await runWithTrace(() =>
    harness.service.createTalent(createActor(), {
      talentOrigin: "INTERNAL",
      linkedEmploymentProfileId: "ep-talent",
      commercialParticipationStatus: "ELIGIBLE",
      livestreamEligible: true,
      eventEligible: true,
    }),
  );

  const updated = await runWithTrace(() =>
    harness.service.updateTalentCore(createActor(), {
      talentId: created.id,
      externalRef: "internal-no-duplicate-name-input",
    }),
  );

  assert.equal(updated.displayName, "Employment Display");
  assert.equal(updated.legalName, "Employment Legal");
  assert.equal(updated.displayShortName, null);
  assert.equal(updated.externalRef, "internal-no-duplicate-name-input");
});

test("internal Talent display derives from EmploymentProfile and ignores stale legacy names", async () => {
  const harness = createHarness();
  const seeded = harness.repository.seed(
    talentRecord({
      id: "talent-stale-names",
      stageName: "Legacy Stage",
      normalizedStageName: "legacy stage",
      legalName: "Legacy Legal",
      normalizedLegalName: "legacy legal",
      displayShortName: "Legacy Short",
      normalizedDisplayShortName: "legacy short",
      linkedEmploymentProfileId: "ep-talent",
    }),
  );

  const result = await runWithTrace(() =>
    harness.service.updateTalentCore(createActor(), {
      talentId: seeded.id,
      externalRef: "legacy-name-update",
    }),
  );

  assert.equal(result.displayName, "Employment Display");
  assert.equal(result.performanceAlias, "Legacy Stage");
  assert.equal(result.stageName, "Legacy Stage");
  assert.equal(result.legalName, "Legacy Legal");
  assert.equal(result.displayShortName, "Legacy Short");
});

test("internal stageName alias is optional, preserved when provided, and falls back when blanked", async () => {
  const harness = createHarness();

  const withoutAlias = await runWithTrace(() =>
    harness.service.createTalent(createActor(), {
      talentOrigin: "INTERNAL",
      linkedEmploymentProfileId: "ep-talent",
      commercialParticipationStatus: "ELIGIBLE",
      livestreamEligible: true,
      eventEligible: true,
    }),
  );
  assert.equal(withoutAlias.displayName, "Employment Display");
  assert.equal(withoutAlias.performanceAlias, null);

  const withAlias = await runWithTrace(() =>
    harness.service.createTalent(createActor(), {
      talentOrigin: "INTERNAL",
      linkedEmploymentProfileId: "ep-alias",
      stageName: "Performance Alias",
      commercialParticipationStatus: "ELIGIBLE",
      livestreamEligible: true,
      eventEligible: true,
    }),
  );
  assert.equal(withAlias.displayName, "Alias Profile Display");
  assert.equal(withAlias.performanceAlias, "Performance Alias");
  assert.equal(withAlias.stageName, "Performance Alias");

  const removedAlias = await runWithTrace(() =>
    harness.service.updateTalentCore(createActor(), {
      talentId: withAlias.id,
      stageName: "  ",
    }),
  );
  assert.equal(removedAlias.displayName, "Alias Profile Display");
  assert.equal(removedAlias.performanceAlias, null);
  assert.equal(removedAlias.stageName, "Alias Profile Display");
});

test("external Talent rejects EmploymentProfile linkage and requires Talent-owned names", async () => {
  const harness = createHarness();

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createTalent(createActor(), {
        talentOrigin: "EXTERNAL",
        linkedEmploymentProfileId: "ep-talent",
        stageName: "External Alias",
        legalName: "External Legal",
        commercialParticipationStatus: "ELIGIBLE",
        livestreamEligible: true,
        eventEligible: true,
      }),
    ),
    TalentInvalidEmploymentLinkageError,
  );

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createTalent(createActor(), {
        talentOrigin: "EXTERNAL",
        stageName: "External Alias",
        commercialParticipationStatus: "ELIGIBLE",
        livestreamEligible: true,
        eventEligible: true,
      }),
    ),
    TalentValidationError,
  );

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createTalent(createActor(), {
        talentOrigin: "EXTERNAL",
        legalName: "External Legal",
        commercialParticipationStatus: "ELIGIBLE",
        livestreamEligible: true,
        eventEligible: true,
      }),
    ),
    TalentValidationError,
  );
});

test("external Talent display and update preserve Talent-owned names", async () => {
  const harness = createHarness();

  const created = await runWithTrace(() =>
    harness.service.createTalent(createActor(), {
      talentOrigin: "EXTERNAL",
      stageName: "External Alias",
      legalName: "External Legal",
      displayShortName: "External Short",
      commercialParticipationStatus: "ELIGIBLE",
      livestreamEligible: true,
      eventEligible: true,
    }),
  );

  assert.equal(created.linkedEmploymentProfileId, null);
  assert.equal(created.displayName, "External Short");
  assert.equal(created.performanceAlias, "External Alias");

  const updated = await runWithTrace(() =>
    harness.service.updateTalentCore(createActor(), {
      talentId: created.id,
      stageName: "External Alias 2",
      legalName: "External Legal 2",
      displayShortName: null,
    }),
  );

  assert.equal(updated.displayName, "External Alias 2");
  assert.equal(updated.performanceAlias, "External Alias 2");
  assert.equal(updated.legalName, "External Legal 2");
  assert.equal(updated.displayShortName, null);
});

test("Talent origin validation remains strict", async () => {
  const harness = createHarness();

  await assert.rejects(
    runWithTrace(() =>
      harness.service.createTalent(createActor(), {
        talentOrigin: "PARTNER" as never,
        linkedEmploymentProfileId: "ep-talent",
        commercialParticipationStatus: "ELIGIBLE",
        livestreamEligible: true,
        eventEligible: true,
      }),
    ),
    TalentValidationError,
  );
});

function createHarness(): {
  readonly service: TalentAdminService;
  readonly repository: InMemoryTalentRepository;
  readonly audit: RecordingAudit;
} {
  const repository = new InMemoryTalentRepository();
  const employmentProfiles = new InMemoryEmploymentProfileReadonlyAccess();
  const audit = new RecordingAudit();
  const service = new TalentAdminService(
    repository,
    new InMemoryCodeSequenceRepository(),
    employmentProfiles,
    alwaysFalseReadonlyAccess,
    alwaysFalseReadonlyAccess,
    alwaysFalseReadonlyAccess,
    alwaysFalseReadonlyAccess,
    audit as unknown as AuditGuard,
    new ImmediateMutationBridge(),
    noopLogger,
  );

  return { service, repository, audit };
}

function createActor(): Actor {
  return new Actor({
    id: "admin-user",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [Permission.TALENT_CREATE, Permission.TALENT_UPDATE],
    scopeGrants: {},
    isActive: true,
  });
}

function runWithTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId("trace-talent-service-name-derivation", fn);
}

function talentRecord(
  overrides: Partial<TalentRecord> = {},
): TalentRecord {
  return {
    id: "talent-1",
    talentCode: "TAL-000001",
    stageName: "Employment Display",
    normalizedStageName: "employment display",
    legalName: "Employment Legal",
    normalizedLegalName: "employment legal",
    displayShortName: null,
    normalizedDisplayShortName: null,
    talentOrigin: "INTERNAL",
    operationalStatus: "ACTIVE",
    managerEmploymentProfileId: null,
    linkedEmploymentProfileId: "ep-talent",
    commercialParticipationStatus: "ELIGIBLE",
    livestreamEligible: true,
    eventEligible: true,
    externalRef: null,
    profileSummary: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

class ImmediateMutationBridge implements AuthoritativeAdminMutationBridge {
  async execute<T>(
    _params: Parameters<AuthoritativeAdminMutationBridge["execute"]>[0],
    fn: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
  ): Promise<T> {
    return fn(undefined as unknown as ClientSession, {
      markAuthSecurityTruthChanged() {
        return undefined;
      },
      markExplicitNoOpSuccess() {
        return undefined;
      },
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

class InMemoryCodeSequenceRepository
  implements BusinessCodeSequenceRepository
{
  private next = 1;

  async allocateNext(): Promise<number> {
    const allocated = this.next;
    this.next += 1;
    return allocated;
  }

  async ensureAtLeast(
    _moduleKey: string,
    _bucket: string,
    minimumValue: number,
  ): Promise<void> {
    this.next = Math.max(this.next, minimumValue + 1);
  }
}

class InMemoryEmploymentProfileReadonlyAccess
  implements TalentEmploymentProfileReadonlyAccess
{
  private readonly profiles = new Map<
    string,
    TalentReferencedEmploymentProfile
  >([
    [
      "ep-talent",
      {
        id: "ep-talent",
        employeeCode: "EP-000001",
        displayName: "Employment Display",
        legalName: "Employment Legal",
        employmentStatus: "ACTIVE",
      },
    ],
    [
      "ep-alias",
      {
        id: "ep-alias",
        employeeCode: "EP-000002",
        displayName: "Alias Profile Display",
        legalName: "Alias Profile Legal",
        employmentStatus: "ACTIVE",
      },
    ],
  ]);

  async findById(
    employmentProfileId: string,
  ): Promise<TalentReferencedEmploymentProfile | null> {
    return this.profiles.get(employmentProfileId) ?? null;
  }
}

class InMemoryTalentRepository implements TalentRepository {
  readonly records: TalentRecord[] = [];

  seed(record: TalentRecord): TalentRecord {
    this.records.push(record);
    return record;
  }

  async insert(talent: TalentRecord): Promise<TalentRecord> {
    this.records.push(talent);
    return talent;
  }

  async findById(talentId: string): Promise<TalentRecord | null> {
    return this.records.find((record) => record.id === talentId) ?? null;
  }

  async findByTalentCode(
    talentCode: string,
  ): Promise<TalentRecord | null> {
    return (
      this.records.find((record) => record.talentCode === talentCode) ??
      null
    );
  }

  async findMaxGeneratedCodeSequence(
    _policy: Pick<BusinessCodePolicy, "prefix" | "width">,
  ): Promise<number> {
    return this.records.length;
  }

  async findNonArchivedByLinkedEmploymentProfileId(
    linkedEmploymentProfileId: string,
  ): Promise<TalentRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.linkedEmploymentProfileId === linkedEmploymentProfileId &&
          record.operationalStatus !== "ARCHIVED",
      ) ?? null
    );
  }

  async updateCore(
    input: UpdateTalentCoreInput,
  ): Promise<TalentRecord | null> {
    const index = this.records.findIndex(
      (record) => record.id === input.talentId,
    );
    if (index < 0) {
      return null;
    }

    const current = this.records[index] as TalentRecord;
    const updated: TalentRecord = {
      ...current,
      stageName: input.stageName ?? current.stageName,
      normalizedStageName:
        input.normalizedStageName ?? current.normalizedStageName,
      legalName: input.legalName ?? current.legalName,
      normalizedLegalName:
        input.normalizedLegalName ?? current.normalizedLegalName,
      displayShortName:
        input.displayShortName !== undefined
          ? input.displayShortName
          : current.displayShortName,
      normalizedDisplayShortName:
        input.normalizedDisplayShortName !== undefined
          ? input.normalizedDisplayShortName
          : current.normalizedDisplayShortName,
      externalRef:
        input.externalRef !== undefined
          ? input.externalRef
          : current.externalRef,
      profileSummary:
        input.profileSummary !== undefined
          ? input.profileSummary
          : current.profileSummary,
      updatedAt: input.updatedAt,
    };
    this.records[index] = updated;
    return updated;
  }

  async assignManager(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async setLinkedEmploymentProfile(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async transitionOperationalStatus(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async updateCommercialParticipation(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }
}

const alwaysFalseReadonlyAccess = {
  async hasActiveMembershipsForTalent() {
    return false;
  },
  async hasNonRemovedMembershipsForTalent() {
    return false;
  },
  async hasActiveOwnedPlatformAccountsForTalent() {
    return false;
  },
  async hasNonArchivedOwnedPlatformAccountsForTalent() {
    return false;
  },
  async hasLiveScheduledShiftForTalent() {
    return false;
  },
  async hasLiveEventBindingForTalent() {
    return false;
  },
} as never;

const noopLogger = {
  info() {
    return undefined;
  },
  warn() {
    return undefined;
  },
  error() {
    return undefined;
  },
  debug() {
    return undefined;
  },
} as never;
