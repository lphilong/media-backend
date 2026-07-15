import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { PermissionContract } from "@core/permission/permission.contract";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { EmploymentProfileRecord } from "@modules/employment-profile/domain/employment-profile.types";
import { PlatformAccountReadRepository } from "@modules/platform-account/read/platform-account.read-repository";
import { PlatformAccountRepository } from "@modules/platform-account/domain/platform-account.repository";
import { PlatformAccountListItemView } from "@modules/platform-account/domain/platform-account.types";
import { ResponsibilityManagedScopeReader } from "@modules/responsibility/domain/responsibility-managed-scope";
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
  RevenueLedgerInvalidPlatformAttributionError,
  RevenueLedgerNotFoundError,
  RevenueLedgerPermissionScopeError,
  RevenueLedgerValidationError,
} from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import { WorkScheduleEmploymentProfileReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import {
  ListPlatformEarningBatchesQuery,
  ListPlatformEarningLinesQuery,
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
    private readonly managedScopeReader: ResponsibilityManagedScopeReader,
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
    const eligiblePlatformAccountIds = (
      await this.listEligiblePlatformAccounts(actor, [talentGroupId])
    ).map((account) => account.id);
    const requestedPlatformAccountId = normalizeOptionalText(
      query.platformAccountId,
    );
    if (
      requestedPlatformAccountId &&
      !eligiblePlatformAccountIds.includes(requestedPlatformAccountId)
    ) {
      throw new RevenueLedgerPermissionScopeError(
        "Platform account is outside the current eligible assigned scope",
      );
    }
    const constrainedPlatformAccountIds = requestedPlatformAccountId
      ? [requestedPlatformAccountId]
      : eligiblePlatformAccountIds;
    if (constrainedPlatformAccountIds.length === 0) {
      return { items: [] };
    }
    const page = await this.platformEarningRepository.listBatches({
      status: normalizeOptionalBatchStatus(query.status),
      platform: normalizeOptionalText(query.platform)?.toUpperCase(),
      platformAccountIds: constrainedPlatformAccountIds,
      talentGroupId,
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

  private async resolveManagerScope(actor: Actor): Promise<{
    readonly profile: EmploymentProfileRecord;
    readonly talentGroupIds: readonly string[];
  }> {
    this.assertReadPermission(actor);
    const profile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );
    if (!profile) {
      throw new RevenueLedgerPermissionScopeError(
        "Manager Daily Source read requires a linked employment profile",
      );
    }
    if (
      profile.employmentStatus !== "ACTIVE" &&
      profile.employmentStatus !== "ON_LEAVE"
    ) {
      throw new RevenueLedgerPermissionScopeError(
        "Manager Daily Source read requires ACTIVE or ON_LEAVE employment profile",
      );
    }
    const managedScope =
      await this.managedScopeReader.resolveManagedScopeByResponsibleEmploymentProfile(
        {
          responsibleEmploymentProfileId: profile.id,
          asOf: this.clock(),
        },
      );
    const authorized = await filterManagedTalentGroupIds(
      this.structuredAuthority,
      actor,
      managedScope.talentGroupIds,
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
        "No assigned TalentGroup scope for Daily Source read",
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
      talentGroupIds.map(async (talentGroupId) => {
        const items: PlatformAccountListItemView[] = [];
        const seenCursors = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await this.platformAccountReadRepository.listPlatformAccounts({
          ownerKind: "TALENT_GROUP",
          ownerTalentGroupId: talentGroupId,
          operationalStatus: "ACTIVE",
          livestreamEnabled: true,
          monetizationEnabled: true,
          limit: 100,
            ...(cursor ? { cursor } : {}),
          });
          items.push(...page.items);
          cursor = page.nextCursor;
          if (cursor && seenCursors.has(cursor)) {
            throw new SystemInvariantError(
              "SYSTEM_INVARIANT_VIOLATION",
              "Platform Account pagination repeated a cursor while resolving Manager Daily Source eligibility",
            );
          }
          if (cursor) seenCursors.add(cursor);
        } while (cursor);
        return items;
      }),
    );
    const eligible = pages
      .flat()
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
      permission: Permission.REVENUE_LEDGER_PLATFORM_EARNING_READ,
      scope: {
        scopeType: "assignedPlatformAccount",
        targetId: platformAccountId,
      },
    });
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
    if (!batch) {
      throw new RevenueLedgerNotFoundError(batchId);
    }
    return batch;
  }

  private assertReadPermission(actor: Actor): PermissionContract {
    if (!actor.accountContexts.includes("MANAGER_CONSOLE")) {
      throw new SystemInvariantError(
        "PERMISSION_DENIED",
        "Manager Workspace access requires MANAGER_CONSOLE account context",
      );
    }
    const permission = PermissionResolver.resolve(
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_READ,
    );
    PermissionGuard.assert(actor, permission);
    return permission;
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
        permission: Permission.REVENUE_LEDGER_PLATFORM_EARNING_READ,
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
