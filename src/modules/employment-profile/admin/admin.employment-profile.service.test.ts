import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
import type { ClientSession } from "mongodb";
import { bindCommand } from "@app/base/command.middleware";
import { Actor } from "@core/actor/actor";
import type {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import type { BusinessCodeSequenceRepository } from "@core/business-code/business-code-sequence.repository";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import type {
  AssignEmploymentProfileManagerInput,
  AssignEmploymentProfileOrgUnitInput,
  EmploymentProfileRepository,
  SetEmploymentProfileLinkedUserInput,
  TransitionEmploymentProfileLifecycleInput,
  UpdateEmploymentProfileContractStatusInput,
  UpdateEmploymentProfileCoreInput,
} from "@modules/employment-profile/domain/employment-profile.repository";
import {
  EmploymentProfileConflictError,
  EmploymentProfileStateError,
  EmploymentProfileValidationError,
} from "@modules/employment-profile/domain/employment-profile.errors";
import type { EmploymentProfileRecord } from "@modules/employment-profile/domain/employment-profile.types";
import type { UpdateEmploymentProfileCoreCommand } from "@modules/employment-profile/shared/employment-profile.contracts";
import { EmploymentProfileAdminController } from "./admin.employment-profile.controller";
import { EmploymentProfileAdminService } from "./admin.employment-profile.service";

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

class MemoryBusinessCodeSequenceRepository
  implements BusinessCodeSequenceRepository
{
  private value = 0;

  async allocateNext(): Promise<number> {
    this.value += 1;
    return this.value;
  }

  async ensureAtLeast(
    _moduleKey: string,
    _bucket: string,
    minimumValue: number,
  ): Promise<void> {
    this.value = Math.max(this.value, minimumValue);
  }
}

class MemoryEmploymentProfileRepository
  implements EmploymentProfileRepository
{
  readonly records: EmploymentProfileRecord[] = [];

  async insert(
    record: EmploymentProfileRecord,
  ): Promise<EmploymentProfileRecord> {
    if (
      this.records.some(
        (item) => item.employeeCode === record.employeeCode,
      )
    ) {
      throw new EmploymentProfileConflictError(
        "Employee code already exists",
      );
    }

    this.records.push(record);
    return record;
  }

  async findById(
    id: string,
  ): Promise<EmploymentProfileRecord | null> {
    return (
      this.records.find((record) => record.id === id) ??
      null
    );
  }

  async findByEmployeeCode(
    employeeCode: string,
  ): Promise<EmploymentProfileRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.employeeCode === employeeCode,
      ) ?? null
    );
  }

  async findMaxGeneratedCodeSequence(): Promise<number> {
    return 0;
  }

  async findNonArchivedByLinkedUserId(): Promise<EmploymentProfileRecord | null> {
    return null;
  }

  async updateCore(
    input: UpdateEmploymentProfileCoreInput,
  ): Promise<EmploymentProfileRecord | null> {
    const index = this.records.findIndex(
      (record) => record.id === input.employmentProfileId,
    );

    if (index < 0) {
      return null;
    }

    const current = this.records[index]!;
    const updated: EmploymentProfileRecord = {
      ...current,
      ...input,
      id: current.id,
      employeeCode: current.employeeCode,
    };
    this.records[index] = updated;
    return updated;
  }

  async assignOrgUnit(
    input: AssignEmploymentProfileOrgUnitInput,
  ): Promise<EmploymentProfileRecord | null> {
    return this.updateById(input.employmentProfileId, {
      orgUnitId: input.orgUnitId,
      updatedAt: input.updatedAt,
    });
  }

  async assignManager(
    input: AssignEmploymentProfileManagerInput,
  ): Promise<EmploymentProfileRecord | null> {
    return this.updateById(input.employmentProfileId, {
      managerEmploymentProfileId:
        input.managerEmploymentProfileId,
      updatedAt: input.updatedAt,
    });
  }

  async setLinkedUser(
    input: SetEmploymentProfileLinkedUserInput,
  ): Promise<EmploymentProfileRecord | null> {
    return this.updateById(input.employmentProfileId, {
      linkedUserId: input.linkedUserId,
      updatedAt: input.updatedAt,
    });
  }

  async transitionLifecycle(
    input: TransitionEmploymentProfileLifecycleInput,
  ): Promise<EmploymentProfileRecord | null> {
    return this.updateById(input.employmentProfileId, {
      employmentStatus: input.toStatus,
      contractStatus: input.contractStatus,
      employmentEndDate: input.employmentEndDate,
      updatedAt: input.updatedAt,
    });
  }

  async updateContractStatus(
    input: UpdateEmploymentProfileContractStatusInput,
  ): Promise<EmploymentProfileRecord | null> {
    return this.updateById(input.employmentProfileId, {
      contractStatus: input.contractStatus,
      updatedAt: input.updatedAt,
    });
  }

  async hasNonArchivedDirectReports(): Promise<boolean> {
    return false;
  }

  private updateById(
    id: string,
    patch: Partial<EmploymentProfileRecord>,
  ): EmploymentProfileRecord | null {
    const index = this.records.findIndex(
      (record) => record.id === id,
    );

    if (index < 0) {
      return null;
    }

    const updated = {
      ...this.records[index]!,
      ...patch,
    };
    this.records[index] = updated;
    return updated;
  }
}

class TestableEmploymentProfileAdminController extends EmploymentProfileAdminController {
  async dispatch(
    req: Request,
    actor: Actor,
  ): Promise<unknown> {
    return this.handle(req, actor, "ADMIN");
  }
}

test("Employment Profile update HTTP parser passes attribution fields to the service", async () => {
  let captured:
    | UpdateEmploymentProfileCoreCommand
    | undefined;
  const service = {
    async updateEmploymentProfileCore(
      _actor: Actor,
      command: UpdateEmploymentProfileCoreCommand,
    ) {
      captured = command;
      return { id: command.employmentProfileId };
    },
  } as unknown as EmploymentProfileAdminService;
  const controller =
    new TestableEmploymentProfileAdminController(
      service,
    );
  const req = {
    params: { employmentProfileId: "ep-target" },
    body: {
      displayName: "Updated Display",
      recruiterEmploymentProfileId: "ep-recruiter",
      hrOwnerEmploymentProfileId: "ep-hr",
      onboardingOwnerEmploymentProfileId:
        "ep-onboarding",
      sourcedByEmploymentProfileId: null,
      hiredAt: "2026-01-10",
      onboardedAt: 1_768_608_000_000,
    },
  } as unknown as Request;
  bindCommand(req, "EMPLOYMENT_PROFILE_UPDATE_CORE");

  await controller.dispatch(
    req,
    createActor([Permission.EMPLOYMENT_PROFILE_UPDATE]),
  );

  assert.deepEqual(captured, {
    employmentProfileId: "ep-target",
    legalName: undefined,
    displayName: "Updated Display",
    employmentKind: undefined,
    jobTitle: undefined,
    externalRef: undefined,
    titleDescription: undefined,
    recruiterEmploymentProfileId: "ep-recruiter",
    hrOwnerEmploymentProfileId: "ep-hr",
    onboardingOwnerEmploymentProfileId:
      "ep-onboarding",
    sourcedByEmploymentProfileId: null,
    hiredAt: "2026-01-10",
    onboardedAt: 1_768_608_000_000,
  });
});

test("Employment Profile attribution persists, validates EmploymentProfile refs, and keeps audit actor separate", async () => {
  const repository =
    new MemoryEmploymentProfileRepository();
  repository.records.push(
    createEmploymentProfileRecord({
      id: "ep-target",
      employeeCode: "EP-TARGET",
      displayName: "Target",
    }),
    createEmploymentProfileRecord({
      id: "ep-recruiter",
      employeeCode: "EP-REC",
      displayName: "Recruiter Display",
    }),
    createEmploymentProfileRecord({
      id: "ep-hr",
      employeeCode: "EP-HR",
      displayName: "HR Owner Display",
    }),
    createEmploymentProfileRecord({
      id: "ep-onboarding",
      employeeCode: "EP-ONB",
      displayName: "Onboarding Display",
    }),
    createEmploymentProfileRecord({
      id: "ep-source",
      employeeCode: "EP-SRC",
      displayName: "Source Display",
    }),
    createEmploymentProfileRecord({
      id: "ep-suspended",
      employeeCode: "EP-SUSP",
      displayName: "Suspended Display",
      employmentStatus: "SUSPENDED",
    }),
  );
  const service =
    createEmploymentProfileAttributionService(
      repository,
    );

  await bindTraceId(
    "trace-employment-profile-attribution-tracked",
    async () => {
      const created =
        await service.createEmploymentProfile(
          createActor([
            Permission.EMPLOYMENT_PROFILE_CREATE,
          ]),
          {
            employeeCode: " EP-ATTR ",
            legalName: "Attribution Legal",
            displayName: "Attribution Display",
            employmentKind: "EMPLOYEE",
            jobTitle: "Producer",
            orgUnitId: "org-1",
            managerEmploymentProfileId: null,
            linkedUserId: null,
            recruiterEmploymentProfileId:
              " ep-recruiter ",
            hrOwnerEmploymentProfileId: "ep-hr",
            onboardingOwnerEmploymentProfileId:
              "ep-onboarding",
            sourcedByEmploymentProfileId:
              "ep-source",
            contractStatus: "ACTIVE",
            employmentStartDate: "2026-01-01",
            hiredAt: "2026-01-02",
            onboardedAt: "2026-01-05",
          },
        );

      assert.equal(created.employeeCode, "EP-ATTR");
      assert.equal(
        created.recruiterEmploymentProfileId,
        "ep-recruiter",
      );
      assert.equal(
        created.hrOwnerEmploymentProfileId,
        "ep-hr",
      );
      assert.equal(
        created.onboardingOwnerEmploymentProfileId,
        "ep-onboarding",
      );
      assert.equal(
        created.sourcedByEmploymentProfileId,
        "ep-source",
      );
      assert.equal(
        created.hiredAt,
        Date.UTC(2026, 0, 2),
      );
      assert.equal(
        created.onboardedAt,
        Date.UTC(2026, 0, 5),
      );

      const auditSeparated =
        await service.createEmploymentProfile(
          createActor(
            [Permission.EMPLOYMENT_PROFILE_CREATE],
            "ep-recruiter",
          ),
          {
            employeeCode: "EP-AUDIT",
            legalName: "Audit Legal",
            displayName: "Audit Display",
            employmentKind: "EMPLOYEE",
            jobTitle: "Producer",
            orgUnitId: "org-1",
            contractStatus: "ACTIVE",
            employmentStartDate: "2026-01-01",
          },
        );
      assert.equal(
        auditSeparated.recruiterEmploymentProfileId,
        null,
      );
      assert.equal(
        auditSeparated.onboardingOwnerEmploymentProfileId,
        null,
      );

      const updated =
        await service.updateEmploymentProfileCore(
          createActor([
            Permission.EMPLOYMENT_PROFILE_UPDATE,
          ]),
          {
            employmentProfileId: "ep-target",
            recruiterEmploymentProfileId:
              "ep-recruiter",
            hrOwnerEmploymentProfileId: "ep-hr",
            onboardingOwnerEmploymentProfileId:
              "ep-onboarding",
            sourcedByEmploymentProfileId: null,
            hiredAt: "2026-01-10",
            onboardedAt: "2026-01-12",
          },
        );
      assert.equal(
        updated.recruiterEmploymentProfileId,
        "ep-recruiter",
      );
      assert.equal(
        updated.hrOwnerEmploymentProfileId,
        "ep-hr",
      );
      assert.equal(
        updated.onboardingOwnerEmploymentProfileId,
        "ep-onboarding",
      );
      assert.equal(
        updated.sourcedByEmploymentProfileId,
        null,
      );
      assert.equal(
        updated.hiredAt,
        Date.UTC(2026, 0, 10),
      );
      assert.equal(
        updated.onboardedAt,
        Date.UTC(2026, 0, 12),
      );

      await assert.rejects(
        service.updateEmploymentProfileCore(
          createActor([
            Permission.EMPLOYMENT_PROFILE_UPDATE,
          ]),
          {
            employmentProfileId: "ep-target",
            sourcedByEmploymentProfileId: "user-1",
          },
        ),
        EmploymentProfileValidationError,
      );
      await assert.rejects(
        service.updateEmploymentProfileCore(
          createActor([
            Permission.EMPLOYMENT_PROFILE_UPDATE,
          ]),
          {
            employmentProfileId: "ep-target",
            recruiterEmploymentProfileId: "talent-1",
          },
        ),
        EmploymentProfileValidationError,
      );
      await assert.rejects(
        service.updateEmploymentProfileCore(
          createActor([
            Permission.EMPLOYMENT_PROFILE_UPDATE,
          ]),
          {
            employmentProfileId: "ep-target",
            recruiterEmploymentProfileId:
              "ep-suspended",
          },
        ),
        EmploymentProfileStateError,
      );
      await assert.rejects(
        service.updateEmploymentProfileCore(
          createActor([
            Permission.EMPLOYMENT_PROFILE_UPDATE,
          ]),
          {
            employmentProfileId: "ep-target",
            hiredAt: "2026-01-20",
            onboardedAt: "2026-01-19",
          },
        ),
        EmploymentProfileValidationError,
      );
      await assert.rejects(
        service.updateEmploymentProfileCore(
          createActor([]),
          {
            employmentProfileId: "ep-target",
            recruiterEmploymentProfileId:
              "ep-recruiter",
          },
        ),
        (error) => {
          assert.ok(
            error instanceof SystemInvariantError,
          );
          assert.equal(
            error.code,
            "PERMISSION_DENIED",
          );
          return true;
        },
      );
    },
  );
});

function createEmploymentProfileAttributionService(
  repository: MemoryEmploymentProfileRepository,
): EmploymentProfileAdminService {
  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
  } as never;

  return new EmploymentProfileAdminService(
    repository,
    new MemoryBusinessCodeSequenceRepository(),
    {
      async findById(id: string) {
        return id === "org-1"
          ? { id, status: "ACTIVE" }
          : null;
      },
    } as never,
    { async findById() { return null; } } as never,
    { async findByLinkedEmploymentProfileId() { return null; } } as never,
    { async hasActiveWorkScheduleAssignmentsForEmploymentProfile() { return false; } } as never,
    { async hasNonArchivedEventsForEmploymentProfile() { return false; } } as never,
    audit,
    mutationBridge,
    logger,
  );
}

function createActor(
  permissions: readonly Permission[],
  id = "admin-user-1",
): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants: {},
    isActive: true,
  });
}

function createEmploymentProfileRecord(params: {
  readonly id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly employmentStatus?: EmploymentProfileRecord["employmentStatus"];
}): EmploymentProfileRecord {
  return {
    id: params.id,
    employeeCode: params.employeeCode,
    legalName: `${params.displayName} Legal`,
    normalizedLegalName:
      `${params.displayName} legal`.toLowerCase(),
    displayName: params.displayName,
    normalizedDisplayName:
      params.displayName.toLowerCase(),
    employmentKind: "EMPLOYEE",
    jobTitle: "Producer",
    titleDescription: null,
    externalRef: null,
    orgUnitId: "org-1",
    managerEmploymentProfileId: null,
    recruiterEmploymentProfileId: null,
    hrOwnerEmploymentProfileId: null,
    onboardingOwnerEmploymentProfileId: null,
    sourcedByEmploymentProfileId: null,
    linkedUserId: null,
    employmentStatus:
      params.employmentStatus ?? "ACTIVE",
    contractStatus:
      params.employmentStatus === "TERMINATED" ||
      params.employmentStatus === "ARCHIVED"
        ? "TERMINATED"
        : "ACTIVE",
    employmentStartDate: Date.UTC(2026, 0, 1),
    employmentEndDate:
      params.employmentStatus === "TERMINATED" ||
      params.employmentStatus === "ARCHIVED"
        ? Date.UTC(2026, 0, 2)
        : null,
    hiredAt: null,
    onboardedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}
