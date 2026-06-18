import crypto from "crypto";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import {
  BusinessCodeSequenceRepository,
  formatBusinessCode,
} from "@core/business-code/business-code-sequence.repository";
import { SystemInvariantError } from "@core/error/system-error";
import { PermissionContract } from "@core/permission/permission.contract";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { EmploymentProfileRecord } from "@modules/employment-profile/domain/employment-profile.types";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import { PlatformAccountReadRepository } from "@modules/platform-account/read/platform-account.read-repository";
import { PlatformAccountRepository } from "@modules/platform-account/domain/platform-account.repository";
import { PlatformAccountListItemView } from "@modules/platform-account/domain/platform-account.types";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import {
  PlatformEarningBatch,
  PlatformEarningLine,
  PlatformEarningRepository,
} from "@modules/revenue-ledger/domain/platform-earning.repository";
import {
  PLATFORM_EARNING_BATCH_STATUSES,
  PLATFORM_EARNING_SOURCE_TYPES,
  PlatformEarningBatchStatus,
  PlatformEarningSourceType,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";
import {
  RevenueLedgerConflictError,
  RevenueLedgerInvalidPlatformAttributionError,
  RevenueLedgerInvalidRevenueAmountError,
  RevenueLedgerNotFoundError,
  RevenueLedgerPermissionScopeError,
  RevenueLedgerStateError,
  RevenueLedgerValidationError,
} from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import { WorkScheduleEmploymentProfileReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import {
  CreatePlatformEarningBatchCommand,
  ListPlatformEarningBatchesQuery,
  ListPlatformEarningLinesQuery,
  PlatformEarningBatchLifecycleCommand,
  UpdatePlatformEarningBatchCommand,
  UpdatePlatformEarningLineCommand,
  UpsertPlatformEarningLineCommand,
} from "@modules/revenue-ledger/shared/platform-earning.contracts";

export interface ManagerPlatformEarningScopeView {
  readonly talentGroups: readonly {
    readonly talentGroupId: string;
    readonly members: readonly ManagerPlatformEarningMemberView[];
  }[];
  readonly platformAccounts: readonly ManagerPlatformEarningPlatformAccountView[];
}

export interface ManagerPlatformEarningMemberView {
  readonly employmentProfileId: string;
  readonly talentId: string;
  readonly displayName: string;
  readonly employeeCode?: string;
  readonly talentGroupId: string;
}

export interface ManagerPlatformEarningPlatformAccountView {
  readonly id: string;
  readonly accountCode: string;
  readonly displayName: string;
  readonly platform: string;
  readonly handle: string | null;
  readonly ownerTalentGroupId: string;
}

export interface ManagerPlatformEarningBatchListResult {
  readonly items: readonly ManagerPlatformEarningBatchView[];
  readonly nextCursor?: string;
}

export interface ManagerPlatformEarningLineListResult {
  readonly items: readonly ManagerPlatformEarningLineView[];
  readonly nextCursor?: string;
}

export interface ManagerPlatformEarningBatchView {
  readonly id: string;
  readonly batchCode: string;
  readonly platform: string;
  readonly platformAccountId: string;
  readonly talentGroupId: string;
  readonly sourceType: PlatformEarningSourceType;
  readonly sourceUnit: string;
  readonly periodMonth: string;
  readonly sourceDateFrom: number;
  readonly sourceDateTo: number;
  readonly status: PlatformEarningBatchStatus;
  readonly sourceLineCount: number;
  readonly rawQuantityTotal: number;
  readonly submittedAt: number | null;
  readonly rejectedAt: number | null;
  readonly rejectionReason: string | null;
  readonly voidedAt: number | null;
  readonly voidReason: string | null;
  readonly approvedAt: number | null;
  readonly revenueEntryLinked: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ManagerPlatformEarningLineView {
  readonly id: string;
  readonly batchId: string;
  readonly sourceDate: number;
  readonly memberEmploymentProfileId: string;
  readonly memberTalentId: string;
  readonly rawQuantity: number;
  readonly externalSourceRef: string | null;
  readonly notes: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class ManagerWorkspaceRevenueAdminService {
  constructor(
    private readonly employmentProfileRepository: Pick<
      EmploymentProfileRepository,
      "findNonArchivedByLinkedUserId"
    >,
    private readonly talentGroupManagerAssignmentRepository: Pick<
      TalentGroupManagerAssignmentRepository,
      "listActiveAssignmentsByManagerEmploymentProfile"
    >,
    private readonly platformAccountRepository: Pick<
      PlatformAccountRepository,
      "findById"
    >,
    private readonly platformAccountReadRepository: Pick<
      PlatformAccountReadRepository,
      "listPlatformAccounts"
    >,
    private readonly employmentProfileReadonlyAccess: Pick<
      WorkScheduleEmploymentProfileReadonlyAccess,
      "listTalentGroupMemberEmploymentProfileResolutions"
    >,
    private readonly platformEarningRepository: PlatformEarningRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly structuredAuthority: StructuredScopeAuthorityService,
    private readonly clock: () => number = Date.now,
  ) {}

  async getScope(actor: Actor): Promise<ManagerPlatformEarningScopeView> {
    const scope = await this.resolveManagerScope(actor);
    const [platformAccounts, talentGroups] = await Promise.all([
      this.listEligiblePlatformAccounts(actor, scope.talentGroupIds),
      Promise.all(
        scope.talentGroupIds.map(async (talentGroupId) => ({
          talentGroupId,
          members: await this.listEligibleMembers(talentGroupId),
        })),
      ),
    ]);

    return { talentGroups, platformAccounts };
  }

  async listBatches(
    actor: Actor,
    query: ListPlatformEarningBatchesQuery,
  ): Promise<ManagerPlatformEarningBatchListResult> {
    const scope = await this.resolveManagerScope(actor);
    const talentGroupId = this.resolveRequestedTalentGroup(
      query.talentGroupId,
      scope.talentGroupIds,
    );
    const page = await this.platformEarningRepository.listBatches({
      status: normalizeOptionalBatchStatus(query.status),
      platform: normalizeOptionalText(query.platform)?.toUpperCase(),
      platformAccountId: normalizeOptionalText(query.platformAccountId),
      talentGroupId,
      createdByActorId: actor.id,
      sourceType: normalizeOptionalSourceType(query.sourceType),
      periodMonth: normalizeOptionalPeriodMonth(query.periodMonth),
      createdBeforeAt: normalizeOptionalNumber(query.createdBeforeAt),
      limit: normalizeLimit(query.limit),
      cursor: normalizeOptionalText(query.cursor),
    });

    return {
      items: page.items.map(exposeManagerBatch),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  async getBatch(
    actor: Actor,
    batchId: string,
  ): Promise<ManagerPlatformEarningBatchView> {
    const batch = await this.requireOwnedBatch(actor, batchId);
    await this.assertCurrentBatchEligibility(actor, batch);
    return exposeManagerBatch(batch);
  }

  async listLines(
    actor: Actor,
    query: ListPlatformEarningLinesQuery,
  ): Promise<ManagerPlatformEarningLineListResult> {
    const batchId = normalizeRequiredText(query.batchId, "batchId");
    const batch = await this.requireOwnedBatch(actor, batchId);
    await this.assertCurrentBatchEligibility(actor, batch);
    const page = await this.platformEarningRepository.listLines({
      batchId,
      limit: normalizeLimit(query.limit),
      cursor: normalizeOptionalText(query.cursor),
    });
    return {
      items: page.items.map(exposeManagerLine),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  async createBatch(
    actor: Actor,
    command: CreatePlatformEarningBatchCommand,
  ): Promise<ManagerPlatformEarningBatchView> {
    const permission = this.assertSubmitPermission(actor);
    const input = normalizeCreateBatch(command);
    const operation =
      "revenue-ledger.platform-earning.create-batch" as const;

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        talentGroupId: input.talentGroupId,
        platformAccountId: input.platformAccountId,
      },
      async (session) => {
        await this.assertAssignedTalentGroup(actor, input.talentGroupId);
        await this.assertEligiblePlatformAccount(
          actor,
          input.platformAccountId,
          input.talentGroupId,
          input.platform,
          session,
        );
        const batchCode =
          input.batchCode ??
          (await this.allocateGeneratedBatchCode(
            input.periodMonth,
            session,
          ));
        const now = this.clock();
        const batch = await this.platformEarningRepository.insertBatch(
          {
            id: crypto.randomUUID(),
            batchCode,
            platform: input.platform,
            platformAccountId: input.platformAccountId,
            talentGroupId: input.talentGroupId,
            sourceType: input.sourceType,
            sourceUnit: "DIAMOND",
            periodMonth: input.periodMonth,
            sourceDateFrom: input.sourceDateFrom,
            sourceDateTo: input.sourceDateTo,
            createdByActorId: actor.id,
            createdAt: now,
          },
          session,
        );
        await this.recordAudit(
          actor,
          permission,
          batch.id,
          operation,
          { status: batch.status },
          session,
        );
        return exposeManagerBatch(batch);
      },
    );
  }

  async updateBatch(
    actor: Actor,
    command: UpdatePlatformEarningBatchCommand,
  ): Promise<ManagerPlatformEarningBatchView> {
    const permission = this.assertSubmitPermission(actor);
    const input = normalizeUpdateBatch(command);
    const operation =
      "revenue-ledger.platform-earning.update-batch" as const;

    return this.executeMutation(
      actor,
      permission,
      operation,
      { batchId: input.batchId },
      async (session) => {
        const batch = await this.requireOwnedBatch(
          actor,
          input.batchId,
          session,
        );
        assertBatchStatus(batch, ["DRAFT"], "managerUpdateBatch");
        await this.assertAssignedTalentGroup(actor, batch.talentGroupId);
        const nextTalentGroupId = input.talentGroupId ?? batch.talentGroupId;
        if (!nextTalentGroupId) {
          throw new RevenueLedgerPermissionScopeError(
            "Manager source submission requires an exact TalentGroup scope",
          );
        }
        await this.assertAssignedTalentGroup(actor, nextTalentGroupId);
        const nextPlatformAccountId =
          input.platformAccountId ?? batch.platformAccountId;
        await this.assertEligiblePlatformAccount(
          actor,
          nextPlatformAccountId,
          nextTalentGroupId,
          batch.platform,
          session,
        );
        assertDateOrder(
          input.sourceDateFrom ?? batch.sourceDateFrom,
          input.sourceDateTo ?? batch.sourceDateTo,
        );
        const updated = await this.platformEarningRepository.updateDraftBatch(
          { ...input, updatedAt: this.clock() },
          session,
        );
        if (!updated) {
          throw new RevenueLedgerStateError(
            `Platform earning batch is no longer DRAFT: ${input.batchId}`,
          );
        }
        return exposeManagerBatch(updated);
      },
    );
  }

  async addLine(
    actor: Actor,
    command: UpsertPlatformEarningLineCommand,
  ): Promise<ManagerPlatformEarningLineView> {
    const permission = this.assertSubmitPermission(actor);
    const input = normalizeAddLine(command);
    const operation =
      "revenue-ledger.platform-earning.add-line" as const;

    return this.executeMutation(
      actor,
      permission,
      operation,
      { batchId: input.batchId },
      async (session) => {
        const batch = await this.requireOwnedBatch(
          actor,
          input.batchId,
          session,
        );
        assertBatchStatus(batch, ["DRAFT"], "managerAddLine");
        await this.assertCurrentBatchEligibility(actor, batch, session);
        assertLineDateWithinBatch(batch, input.sourceDate);
        await this.assertLineMemberInBatchScope(batch, input, session);
        const duplicateDetectionKey = buildDuplicateDetectionKey({
          batch,
          sourceDate: input.sourceDate,
          memberTalentId: input.memberTalentId,
          memberEmploymentProfileId: input.memberEmploymentProfileId,
          externalSourceRef: input.externalSourceRef,
        });
        await this.assertDuplicateAvailable(
          duplicateDetectionKey,
          undefined,
          session,
        );
        const now = this.clock();
        const line: PlatformEarningLine = {
          id: crypto.randomUUID(),
          batchId: batch.id,
          batchStatus: batch.status,
          sourceDate: input.sourceDate,
          periodMonth: batch.periodMonth,
          platform: batch.platform,
          platformAccountId: batch.platformAccountId,
          talentGroupId: batch.talentGroupId,
          memberTalentId: input.memberTalentId,
          memberEmploymentProfileId: input.memberEmploymentProfileId,
          eventId: null,
          sourceType: batch.sourceType,
          sourceUnit: batch.sourceUnit,
          rawQuantity: input.rawQuantity,
          externalSourceRef: input.externalSourceRef,
          notes: input.notes,
          duplicateDetectionKey,
          correctionOfLineId: null,
          replacementLineId: null,
          enteredByActorId: actor.id,
          enteredAt: now,
          submittedByActorId: null,
          submittedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        const created = await this.platformEarningRepository.insertLine(
          line,
          session,
        );
        await this.recordAudit(
          actor,
          permission,
          batch.id,
          operation,
          { lineId: created.id },
          session,
        );
        return exposeManagerLine(created);
      },
    );
  }

  async updateLine(
    actor: Actor,
    command: UpdatePlatformEarningLineCommand,
  ): Promise<ManagerPlatformEarningLineView> {
    const permission = this.assertSubmitPermission(actor);
    const input = normalizeUpdateLine(command);
    const operation =
      "revenue-ledger.platform-earning.update-line" as const;

    return this.executeMutation(
      actor,
      permission,
      operation,
      { batchId: input.batchId, lineId: input.lineId },
      async (session) => {
        const batch = await this.requireOwnedBatch(
          actor,
          input.batchId,
          session,
        );
        assertBatchStatus(batch, ["DRAFT"], "managerUpdateLine");
        await this.assertCurrentBatchEligibility(actor, batch, session);
        const current = await this.platformEarningRepository.findLineById(
          input.lineId,
          session,
        );
        if (!current || current.batchId !== batch.id) {
          throw new RevenueLedgerNotFoundError(input.lineId);
        }
        const nextSourceDate = input.sourceDate ?? current.sourceDate;
        const nextMemberEmploymentProfileId =
          input.memberEmploymentProfileId !== undefined
            ? input.memberEmploymentProfileId
            : current.memberEmploymentProfileId;
        const nextMemberTalentId =
          input.memberTalentId !== undefined
            ? input.memberTalentId
            : current.memberTalentId;
        const nextExternalSourceRef =
          input.externalSourceRef !== undefined
            ? input.externalSourceRef
            : current.externalSourceRef;
        assertLineDateWithinBatch(batch, nextSourceDate);
        await this.assertLineMemberInBatchScope(
          batch,
          {
            memberEmploymentProfileId: nextMemberEmploymentProfileId,
            memberTalentId: nextMemberTalentId,
          },
          session,
        );
        const nextDuplicateDetectionKey = buildDuplicateDetectionKey({
          batch,
          sourceDate: nextSourceDate,
          memberTalentId: nextMemberTalentId,
          memberEmploymentProfileId: nextMemberEmploymentProfileId,
          externalSourceRef: nextExternalSourceRef,
        });
        await this.assertDuplicateAvailable(
          nextDuplicateDetectionKey,
          current.id,
          session,
        );
        const updated = await this.platformEarningRepository.updateDraftLine(
          {
            lineId: current.id,
            sourceDate: input.sourceDate,
            memberTalentId: input.memberTalentId,
            memberEmploymentProfileId: input.memberEmploymentProfileId,
            rawQuantity: input.rawQuantity,
            externalSourceRef: input.externalSourceRef,
            notes: input.notes,
            duplicateDetectionKey: nextDuplicateDetectionKey,
            updatedAt: this.clock(),
          },
          session,
        );
        if (!updated) {
          throw new RevenueLedgerStateError(
            `Platform earning line is no longer mutable: ${current.id}`,
          );
        }
        return exposeManagerLine(updated);
      },
    );
  }

  async submitBatch(
    actor: Actor,
    command: PlatformEarningBatchLifecycleCommand,
  ): Promise<ManagerPlatformEarningBatchView> {
    const permission = this.assertSubmitPermission(actor);
    const batchId = normalizeRequiredText(command.batchId, "batchId");
    const operation =
      "revenue-ledger.platform-earning.submit" as const;

    return this.executeMutation(
      actor,
      permission,
      operation,
      { batchId },
      async (session) => {
        const batch = await this.requireOwnedBatch(actor, batchId, session);
        await this.assertCurrentBatchEligibility(actor, batch, session);
        assertBatchStatus(batch, ["DRAFT"], "managerSubmitBatch");
        if (batch.sourceLineCount < 1) {
          throw new RevenueLedgerValidationError(
            "Platform earning batch must contain at least one source line before submit",
          );
        }
        const now = this.clock();
        const updated =
          await this.platformEarningRepository.transitionBatchStatus(
            {
              batchId,
              fromStatuses: ["DRAFT"],
              toStatus: "SUBMITTED",
              submittedByActorId: actor.id,
              submittedAt: now,
              updatedAt: now,
            },
            session,
          );
        if (!updated) {
          throw new RevenueLedgerStateError(
            `Platform earning batch is no longer DRAFT: ${batchId}`,
          );
        }
        await this.recordAudit(
          actor,
          permission,
          batchId,
          operation,
          { status: updated.status },
          session,
        );
        return exposeManagerBatch(updated);
      },
    );
  }

  private async resolveManagerScope(actor: Actor): Promise<{
    readonly profile: EmploymentProfileRecord;
    readonly talentGroupIds: readonly string[];
  }> {
    this.assertSubmitPermission(actor);
    const profile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );
    if (!profile) {
      throw new RevenueLedgerPermissionScopeError(
        "Manager source submission requires a linked employment profile",
      );
    }
    if (
      profile.employmentStatus !== "ACTIVE" &&
      profile.employmentStatus !== "ON_LEAVE"
    ) {
      throw new RevenueLedgerPermissionScopeError(
        "Manager source submission requires ACTIVE or ON_LEAVE employment profile",
      );
    }
    const assignments =
      await this.talentGroupManagerAssignmentRepository.listActiveAssignmentsByManagerEmploymentProfile(
        profile.id,
        this.clock(),
      );
    const authorized = await filterManagedTalentGroupIds(
      this.structuredAuthority,
      actor,
      assignments.map((assignment) => assignment.groupId),
    );
    return {
      profile,
      talentGroupIds: authorized,
    };
  }

  private resolveRequestedTalentGroup(
    requested: string | undefined,
    assigned: readonly string[],
  ): string {
    if (assigned.length === 0) {
      throw new RevenueLedgerPermissionScopeError(
        "No assigned TalentGroup scope for source submission",
      );
    }
    const normalized = requested
      ? normalizeRequiredText(requested, "talentGroupId")
      : assigned.length === 1
        ? assigned[0]
        : undefined;
    if (!normalized) {
      throw new RevenueLedgerValidationError(
        "talentGroupId is required when multiple TalentGroup scopes are assigned",
      );
    }
    if (!assigned.includes(normalized)) {
      throw new RevenueLedgerPermissionScopeError(
        "TalentGroup is not assigned to current manager",
      );
    }
    return normalized;
  }

  private async assertAssignedTalentGroup(
    actor: Actor,
    talentGroupId: string | null,
  ): Promise<void> {
    if (!talentGroupId) {
      throw new RevenueLedgerPermissionScopeError(
        "Manager source submission requires an exact TalentGroup scope",
      );
    }
    const scope = await this.resolveManagerScope(actor);
    if (!scope.talentGroupIds.includes(talentGroupId)) {
      throw new RevenueLedgerPermissionScopeError(
        "TalentGroup is not assigned to current manager",
      );
    }
  }

  private async listEligiblePlatformAccounts(
    actor: Actor,
    talentGroupIds: readonly string[],
  ): Promise<readonly ManagerPlatformEarningPlatformAccountView[]> {
    const pages = await Promise.all(
      talentGroupIds.map((talentGroupId) =>
        this.platformAccountReadRepository.listPlatformAccounts({
          ownerKind: "TALENT_GROUP",
          ownerTalentGroupId: talentGroupId,
          operationalStatus: "ACTIVE",
          livestreamEnabled: true,
          monetizationEnabled: true,
          limit: 100,
        }),
      ),
    );
    const eligible = pages
      .flatMap((page) => page.items)
      .filter(isEligiblePlatformAccountListItem)
      .map((account) => ({
        id: account.id,
        accountCode: account.accountCode,
        displayName: account.displayName,
        platform: account.platform,
        handle: account.handle,
        ownerTalentGroupId: account.ownerTalentGroupId,
      }));
    const authorized = await Promise.all(
      eligible.map(async (account) =>
        (await this.hasAssignedPlatformAccountAuthority(actor, account.id))
          ? account
          : null,
      ),
    );
    return authorized.filter(
      (account): account is NonNullable<(typeof authorized)[number]> =>
        account !== null,
    );
  }

  private async listEligibleMembers(
    talentGroupId: string,
  ): Promise<readonly ManagerPlatformEarningMemberView[]> {
    const resolutions =
      await this.employmentProfileReadonlyAccess.listTalentGroupMemberEmploymentProfileResolutions(
        talentGroupId,
      );
    return resolutions
      .filter(
        (resolution) =>
          resolution.membershipStatus === "ACTIVE" &&
          resolution.employmentProfile &&
          (resolution.employmentProfile.employmentStatus === "ACTIVE" ||
            resolution.employmentProfile.employmentStatus === "ON_LEAVE"),
      )
      .map((resolution) => ({
        employmentProfileId: resolution.employmentProfile?.id ?? "",
        talentId: resolution.talentId,
        displayName:
          resolution.employmentProfile?.ref?.displayName ??
          resolution.employmentProfile?.ref?.name ??
          resolution.employmentProfile?.id ??
          resolution.talentId,
        ...(resolution.employmentProfile?.ref?.code
          ? { employeeCode: resolution.employmentProfile.ref.code }
          : {}),
        talentGroupId,
      }))
      .filter((member) => member.employmentProfileId.length > 0);
  }

  private async assertEligiblePlatformAccount(
    actor: Actor,
    platformAccountId: string,
    talentGroupId: string,
    platform: string,
    session?: ClientSession,
  ): Promise<void> {
    const account = await this.platformAccountRepository.findById(
      platformAccountId,
      session,
    );
    if (
      !account ||
      account.operationalStatus !== "ACTIVE" ||
      account.ownerKind !== "TALENT_GROUP" ||
      account.ownerTalentGroupId !== talentGroupId ||
      account.platform !== platform ||
      !account.livestreamEnabled ||
      !account.monetizationEnabled
    ) {
      throw new RevenueLedgerInvalidPlatformAttributionError(
        "Platform account is not eligible for the assigned TalentGroup source submission scope",
      );
    }
    if (!(await this.hasAssignedPlatformAccountAuthority(actor, account.id))) {
      throw new RevenueLedgerPermissionScopeError(
        "Platform account is outside the actor's assigned structured scope",
      );
    }
  }

  private async assertCurrentBatchEligibility(
    actor: Actor,
    batch: PlatformEarningBatch,
    session?: ClientSession,
  ): Promise<void> {
    if (!batch.talentGroupId) {
      throw new RevenueLedgerPermissionScopeError(
        "Manager source submission requires an exact TalentGroup scope",
      );
    }
    await this.assertAssignedTalentGroup(actor, batch.talentGroupId);
    await this.assertEligiblePlatformAccount(
      actor,
      batch.platformAccountId,
      batch.talentGroupId,
      batch.platform,
      session,
    );
  }

  private hasAssignedPlatformAccountAuthority(
    actor: Actor,
    platformAccountId: string,
  ): Promise<boolean> {
    return this.structuredAuthority.hasAuthority({
      userId: actor.id,
      permission: Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
      scope: {
        scopeType: "assignedPlatformAccount",
        targetId: platformAccountId,
      },
    });
  }

  private async assertLineMemberInBatchScope(
    batch: PlatformEarningBatch,
    input: {
      readonly memberEmploymentProfileId?: string | null;
      readonly memberTalentId?: string | null;
    },
    _session?: ClientSession,
  ): Promise<void> {
    if (!batch.talentGroupId) {
      throw new RevenueLedgerPermissionScopeError(
        "Manager source line requires a TalentGroup-scoped batch",
      );
    }
    const employmentProfileId = input.memberEmploymentProfileId;
    const talentId = input.memberTalentId;
    if (!employmentProfileId || !talentId) {
      throw new RevenueLedgerValidationError(
        "memberEmploymentProfileId and memberTalentId are required for manager source lines",
      );
    }
    const members = await this.listEligibleMembers(batch.talentGroupId);
    const match = members.find(
      (member) =>
        member.employmentProfileId === employmentProfileId &&
        member.talentId === talentId,
    );
    if (!match) {
      throw new RevenueLedgerPermissionScopeError(
        "Source line member is outside assigned TalentGroup scope",
      );
    }
  }

  private async requireOwnedBatch(
    actor: Actor,
    batchId: string,
    session?: ClientSession,
  ): Promise<PlatformEarningBatch> {
    const batch = await this.platformEarningRepository.findBatchById(
      normalizeRequiredText(batchId, "batchId"),
      session,
    );
    if (!batch || batch.createdByActorId !== actor.id) {
      throw new RevenueLedgerNotFoundError(batchId);
    }
    return batch;
  }

  private async assertDuplicateAvailable(
    duplicateDetectionKey: string,
    currentLineId: string | undefined,
    session?: ClientSession,
  ): Promise<void> {
    const existing =
      await this.platformEarningRepository.findLineByDuplicateDetectionKey(
        duplicateDetectionKey,
        session,
      );
    if (existing && existing.id !== currentLineId) {
      throw new RevenueLedgerConflictError(
        `Duplicate platform earning source detail detected: ${duplicateDetectionKey}`,
      );
    }
  }

  private assertSubmitPermission(actor: Actor): PermissionContract {
    if (actor.type !== "admin") {
      throw new SystemInvariantError(
        "PERMISSION_DENIED",
        `Manager Workspace access requires actor.type admin, received ${actor.type}`,
      );
    }
    const permission = PermissionResolver.resolve(
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
    );
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private async allocateGeneratedBatchCode(
    periodMonth: string,
    session: ClientSession,
  ): Promise<string> {
    const policy = {
      moduleKey: "revenue-ledger-platform-earning-batch",
      bucket: periodMonth,
      prefix: `RLEB-${periodMonth.replace("-", "")}`,
      width: 5,
    };
    const sequence = await this.codeSequenceRepository.allocateNext(
      policy.moduleKey,
      policy.bucket,
      session,
    );
    return formatBusinessCode(policy, sequence);
  }

  private async recordAudit(
    actor: Actor,
    permission: PermissionContract,
    targetId: string,
    mutationType: AuthoritativeAdminMutationIdentity,
    metadata: Readonly<Record<string, unknown>>,
    session: ClientSession,
  ): Promise<void> {
    await this.audit.record(
      actor,
      permission,
      targetId,
      {
        mutationType,
        targetId,
        targetType: "manager-platform-earning-batch",
        actorId: actor.id,
        ...metadata,
      },
      session,
    );
  }

  private async executeMutation<T>(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    metadata: Readonly<Record<string, unknown>>,
    fn: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    return this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: operation,
        mutationTargetDescriptor: JSON.stringify(metadata),
      },
      async (session) => fn(session),
    );
  }
}

async function filterManagedTalentGroupIds(
  service: StructuredScopeAuthorityService,
  actor: Actor,
  talentGroupIds: readonly string[],
): Promise<readonly string[]> {
  const authorized = await Promise.all(
    [...new Set(talentGroupIds)].map(async (talentGroupId) =>
      (await service.hasAuthority({
        userId: actor.id,
        permission: Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
        scope: { scopeType: "managedTalentGroup", targetId: talentGroupId },
      }))
        ? talentGroupId
        : null,
    ),
  );
  return authorized.filter((id): id is string => id !== null).sort();
}

function exposeManagerBatch(
  batch: PlatformEarningBatch,
): ManagerPlatformEarningBatchView {
  if (!batch.talentGroupId) {
    throw new RevenueLedgerPermissionScopeError(
      "Manager source batch is missing TalentGroup scope",
    );
  }
  return {
    id: batch.id,
    batchCode: batch.batchCode,
    platform: batch.platform,
    platformAccountId: batch.platformAccountId,
    talentGroupId: batch.talentGroupId,
    sourceType: batch.sourceType,
    sourceUnit: batch.sourceUnit,
    periodMonth: batch.periodMonth,
    sourceDateFrom: batch.sourceDateFrom,
    sourceDateTo: batch.sourceDateTo,
    status: batch.status,
    sourceLineCount: batch.sourceLineCount,
    rawQuantityTotal: batch.rawQuantityTotal,
    submittedAt: batch.submittedAt,
    rejectedAt: batch.rejectedAt,
    rejectionReason: batch.rejectionReason,
    voidedAt: batch.voidedAt,
    voidReason: batch.voidReason,
    approvedAt: batch.approvedAt,
    revenueEntryLinked: Boolean(batch.revenueEntryId),
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

function exposeManagerLine(
  line: PlatformEarningLine,
): ManagerPlatformEarningLineView {
  if (!line.memberEmploymentProfileId || !line.memberTalentId) {
    throw new RevenueLedgerPermissionScopeError(
      "Manager source line is missing member scope",
    );
  }
  return {
    id: line.id,
    batchId: line.batchId,
    sourceDate: line.sourceDate,
    memberEmploymentProfileId: line.memberEmploymentProfileId,
    memberTalentId: line.memberTalentId,
    rawQuantity: line.rawQuantity,
    externalSourceRef: line.externalSourceRef,
    notes: line.notes,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
}

function isEligiblePlatformAccountListItem(
  account: PlatformAccountListItemView,
): account is PlatformAccountListItemView & {
  readonly ownerTalentGroupId: string;
} {
  return (
    account.ownerKind === "TALENT_GROUP" &&
    typeof account.ownerTalentGroupId === "string" &&
    account.ownerTalentGroupId.length > 0 &&
    account.operationalStatus === "ACTIVE" &&
    account.livestreamEnabled &&
    account.monetizationEnabled
  );
}

function normalizeCreateBatch(
  command: CreatePlatformEarningBatchCommand,
): {
  readonly batchCode?: string;
  readonly platform: string;
  readonly platformAccountId: string;
  readonly talentGroupId: string;
  readonly sourceType: PlatformEarningSourceType;
  readonly periodMonth: string;
  readonly sourceDateFrom: number;
  readonly sourceDateTo: number;
} {
  const sourceDateFrom = normalizeTimestamp(
    command.sourceDateFrom,
    "sourceDateFrom",
  );
  const sourceDateTo = normalizeTimestamp(
    command.sourceDateTo,
    "sourceDateTo",
  );
  assertDateOrder(sourceDateFrom, sourceDateTo);
  const talentGroupId = normalizeOptionalNullableId(
    command.talentGroupId,
    "talentGroupId",
  );
  if (!talentGroupId) {
    throw new RevenueLedgerValidationError(
      "talentGroupId is required for manager source submission",
    );
  }
  return {
    batchCode: normalizeOptionalText(command.batchCode ?? undefined),
    platform: normalizeRequiredText(command.platform, "platform").toUpperCase(),
    platformAccountId: normalizeRequiredText(
      command.platformAccountId,
      "platformAccountId",
    ),
    talentGroupId,
    sourceType: normalizeSourceType(command.sourceType),
    periodMonth: normalizePeriodMonth(command.periodMonth),
    sourceDateFrom,
    sourceDateTo,
  };
}

function normalizeUpdateBatch(
  command: UpdatePlatformEarningBatchCommand,
): UpdatePlatformEarningBatchCommand {
  return {
    batchId: normalizeRequiredText(command.batchId, "batchId"),
    platformAccountId: normalizeOptionalText(command.platformAccountId),
    talentGroupId: normalizeOptionalNullableId(
      command.talentGroupId,
      "talentGroupId",
    ),
    sourceDateFrom: normalizeOptionalTimestamp(
      command.sourceDateFrom,
      "sourceDateFrom",
    ),
    sourceDateTo: normalizeOptionalTimestamp(
      command.sourceDateTo,
      "sourceDateTo",
    ),
  };
}

function normalizeAddLine(
  command: UpsertPlatformEarningLineCommand,
): Required<Omit<UpsertPlatformEarningLineCommand, "lineId" | "eventId" | "correctionOfLineId">> {
  return {
    batchId: normalizeRequiredText(command.batchId, "batchId"),
    sourceDate: normalizeTimestamp(command.sourceDate, "sourceDate"),
    memberTalentId: normalizeOptionalNullableId(
      command.memberTalentId,
      "memberTalentId",
    ),
    memberEmploymentProfileId: normalizeOptionalNullableId(
      command.memberEmploymentProfileId,
      "memberEmploymentProfileId",
    ),
    rawQuantity: normalizeRawQuantity(command.rawQuantity),
    externalSourceRef: normalizeOptionalNullableText(
      command.externalSourceRef,
      "externalSourceRef",
    ),
    notes: normalizeOptionalNullableText(command.notes, "notes"),
  };
}

function normalizeUpdateLine(
  command: UpdatePlatformEarningLineCommand,
): UpdatePlatformEarningLineCommand {
  return {
    batchId: normalizeRequiredText(command.batchId, "batchId"),
    lineId: normalizeRequiredText(command.lineId, "lineId"),
    sourceDate: normalizeOptionalTimestamp(command.sourceDate, "sourceDate"),
    memberTalentId: normalizeOptionalNullableId(
      command.memberTalentId,
      "memberTalentId",
    ),
    memberEmploymentProfileId: normalizeOptionalNullableId(
      command.memberEmploymentProfileId,
      "memberEmploymentProfileId",
    ),
    eventId: null,
    rawQuantity:
      command.rawQuantity === undefined
        ? undefined
        : normalizeRawQuantity(command.rawQuantity),
    externalSourceRef: normalizeOptionalNullableText(
      command.externalSourceRef,
      "externalSourceRef",
    ),
    notes: normalizeOptionalNullableText(command.notes, "notes"),
  };
}

function buildDuplicateDetectionKey(params: {
  readonly batch: PlatformEarningBatch;
  readonly sourceDate: number;
  readonly memberTalentId?: string | null;
  readonly memberEmploymentProfileId?: string | null;
  readonly externalSourceRef?: string | null;
}): string {
  return [
    params.batch.platform,
    params.batch.platformAccountId,
    params.batch.periodMonth,
    String(params.sourceDate),
    params.batch.sourceType,
    params.memberTalentId ?? "",
    params.memberEmploymentProfileId ?? "",
    "",
    params.externalSourceRef ?? "",
  ].join("|");
}

function assertBatchStatus(
  batch: PlatformEarningBatch,
  allowed: readonly PlatformEarningBatchStatus[],
  operation: string,
): void {
  if (allowed.includes(batch.status)) return;
  throw new RevenueLedgerStateError(
    `${operation} is not allowed while batch ${batch.id} is ${batch.status}`,
  );
}

function assertLineDateWithinBatch(
  batch: PlatformEarningBatch,
  sourceDate: number,
): void {
  if (sourceDate < batch.sourceDateFrom || sourceDate > batch.sourceDateTo) {
    throw new RevenueLedgerValidationError(
      `sourceDate must be within batch sourceDateFrom/sourceDateTo range for batch ${batch.id}`,
    );
  }
}

function assertDateOrder(sourceDateFrom: number, sourceDateTo: number): void {
  if (sourceDateTo < sourceDateFrom) {
    throw new RevenueLedgerValidationError(
      "sourceDateTo must be greater than or equal to sourceDateFrom",
    );
  }
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(`${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new RevenueLedgerValidationError(`${field} is required`);
  }
  return normalized;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeRequiredText(value, "value");
}

function normalizeOptionalNullableText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeRequiredText(value, field);
}

function normalizeOptionalNullableId(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeRequiredText(value, field);
}

function normalizeTimestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RevenueLedgerValidationError(
      `${field} must be an integer UTC timestamp`,
    );
  }
  return value;
}

function normalizeOptionalTimestamp(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  return normalizeTimestamp(value, field);
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    throw new RevenueLedgerValidationError("Expected integer query value");
  }
  return parsed;
}

function normalizePeriodMonth(value: unknown): string {
  const normalized = normalizeRequiredText(value, "periodMonth");
  if (!/^\d{4}-\d{2}$/u.test(normalized)) {
    throw new RevenueLedgerValidationError(
      "periodMonth must use YYYY-MM format",
    );
  }
  return normalized;
}

function normalizeOptionalPeriodMonth(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return normalizePeriodMonth(value);
}

function normalizeSourceType(value: unknown): PlatformEarningSourceType {
  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `sourceType must be one of ${PLATFORM_EARNING_SOURCE_TYPES.join(", ")}`,
    );
  }
  const normalized = value.trim().toUpperCase();
  if (
    PLATFORM_EARNING_SOURCE_TYPES.includes(
      normalized as PlatformEarningSourceType,
    )
  ) {
    return normalized as PlatformEarningSourceType;
  }
  throw new RevenueLedgerValidationError(
    `sourceType must be one of ${PLATFORM_EARNING_SOURCE_TYPES.join(", ")}`,
  );
}

function normalizeOptionalSourceType(
  value: unknown,
): PlatformEarningSourceType | undefined {
  if (value === undefined) return undefined;
  return normalizeSourceType(value);
}

function normalizeOptionalBatchStatus(
  value: unknown,
): PlatformEarningBatchStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError("status must be a string");
  }
  const normalized = value.trim().toUpperCase();
  if (
    PLATFORM_EARNING_BATCH_STATUSES.includes(
      normalized as PlatformEarningBatchStatus,
    )
  ) {
    return normalized as PlatformEarningBatchStatus;
  }
  throw new RevenueLedgerValidationError(
    `status must be one of ${PLATFORM_EARNING_BATCH_STATUSES.join(", ")}`,
  );
}

function normalizeRawQuantity(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isInteger(value)
  ) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      "rawQuantity must be a positive integer source quantity",
    );
  }
  return value;
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return 50;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > 100
  ) {
    throw new RevenueLedgerValidationError(
      "limit must be an integer between 1 and 100",
    );
  }
  return parsed;
}
