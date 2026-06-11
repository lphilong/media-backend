import { v4 as uuidv4 } from "uuid";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import { utcYearBucketFromTimestamp } from "@core/business-code/business-code-bucket";
import {
  BusinessCodeSequenceRepository,
  formatBusinessCode,
} from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import {
  EMPLOYMENT_STATUSES,
  EmploymentStatus,
} from "@modules/employment-profile/domain/employment-profile.types";
import { buildEmploymentTermsCodePolicy } from "../domain/employment-terms-code-policy";
import {
  EmploymentTermsConflictError,
  EmploymentTermsNotFoundError,
  EmploymentTermsStateError,
  EmploymentTermsValidationError,
} from "../domain/employment-terms.errors";
import { EmploymentTermsRepository } from "../domain/employment-terms.repository";
import {
  EMPLOYMENT_TERMS_ADMIN_READINESS_FILTERS,
  EMPLOYMENT_TERMS_STATUSES,
  EMPLOYMENT_TERMS_PAY_FREQUENCIES,
  EmploymentTermsAdminDerivedFlags,
  EmploymentTermsAdminListItemView,
  EmploymentTermsAdminListRecord,
  EmploymentTermsAdminReadinessFilter,
  EmploymentTermsAllowance,
  EmploymentTermsOverlapContextRecord,
  EmploymentTermsPayFrequency,
  EmploymentTermsRecord,
  EmploymentTermsStatus,
  EmploymentTermsView,
  PayrollReadableEmploymentTerms,
} from "../domain/employment-terms.types";
import {
  evaluatePayrollReadableEmploymentTerms,
  toHcmBusinessDateTimestamp,
} from "../domain/employment-terms-readiness";
import {
  CreateEmploymentTermsCommand,
  EmploymentTermsAdminListResult,
  EmploymentTermsLifecycleCommand,
  ListEmploymentTermsAdminQuery,
  UpdateEmploymentTermsCommand,
} from "../shared/employment-terms.contracts";

const MAX_SOURCE_NOTE_LENGTH = 500;
const MAX_ALLOWANCE_TYPE_LENGTH = 64;
const MAX_ALLOWANCE_LABEL_LENGTH = 120;
const MAX_ALLOWANCE_COUNT = 20;
const DEFAULT_ADMIN_LIST_LIMIT = 50;
const MAX_ADMIN_LIST_LIMIT = 100;

export class EmploymentTermsAdminService {
  constructor(
    private readonly repository: EmploymentTermsRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly employmentProfileRepository: EmploymentProfileRepository,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly now: () => number = Date.now,
  ) {}

  async list(actor: Actor, employmentProfileId: string): Promise<readonly EmploymentTermsView[]> {
    this.assertRead(actor);
    const profileId = requiredId(employmentProfileId, "employmentProfileId");
    await this.requireNonArchivedProfile(profileId);
    const sensitive = actor.permissions.includes(Permission.EMPLOYMENT_TERMS_READ_SENSITIVE);
    return (await this.repository.listByEmploymentProfileId(profileId)).map((record) =>
      toView(record, sensitive),
    );
  }

  async listAllProfiles(
    actor: Actor,
    query: ListEmploymentTermsAdminQuery,
  ): Promise<EmploymentTermsAdminListResult> {
    this.assertRead(actor);
    const parsed = parseAdminListQuery(query, this.now());
    const sensitive = this.canReadSensitive(actor);
    const cursor = parseAdminListCursor(parsed.cursor, buildAdminListCursorScope(parsed));
    const records = await this.repository.listAdminRecords({
      employmentProfileId: parsed.employmentProfileId,
      orgUnitId: parsed.orgUnitId,
      employmentStatus: parsed.employmentStatus,
      status: parsed.status,
      payrollEligible: parsed.payrollEligible,
      effectiveOn: parsed.effectiveOnFilter,
      expiringBefore: parsed.expiringBefore,
      readiness: parsed.readiness,
      readinessAsOf: parsed.effectiveOn,
      search: parsed.search,
    });
    const overlapContext = await this.repository.listOverlapContextByEmploymentProfileIds(
      [...new Set(records.map((item) => item.terms.employmentProfileId))],
    );
    const profileRecords = groupOverlapContextByEmploymentProfile(overlapContext);
    const filtered = records
      .map((item) => toAdminListItem(
        item,
        sensitive,
        parsed.effectiveOn,
        profileRecords.get(item.terms.employmentProfileId) ?? [],
      ))
      .filter((item) => matchesReadinessFilter(item, parsed.readiness));
    const items = filtered.slice(cursor.offset, cursor.offset + parsed.limit);
    const nextOffset = cursor.offset + items.length;
    return {
      items,
      nextCursor: nextOffset < filtered.length
        ? encodeAdminListCursor({
            scope: buildAdminListCursorScope(parsed),
            offset: nextOffset,
          })
        : null,
      appliedFilters: {
        ...(parsed.employmentProfileId ? { employmentProfileId: parsed.employmentProfileId } : {}),
        ...(parsed.orgUnitId ? { orgUnitId: parsed.orgUnitId } : {}),
        ...(parsed.employmentStatus ? { employmentStatus: parsed.employmentStatus } : {}),
        ...(parsed.status ? { status: parsed.status } : {}),
        ...(parsed.payrollEligible !== undefined ? { payrollEligible: parsed.payrollEligible } : {}),
        effectiveOn: parsed.effectiveOn,
        ...(parsed.expiringBefore !== undefined ? { expiringBefore: parsed.expiringBefore } : {}),
        ...(parsed.readiness ? { readiness: parsed.readiness } : {}),
        ...(parsed.search ? { search: parsed.search } : {}),
      },
    };
  }

  async get(actor: Actor, command: EmploymentTermsLifecycleCommand): Promise<EmploymentTermsView> {
    this.assertRead(actor);
    const record = await this.requireOwnedRecord(command);
    return toView(record, actor.permissions.includes(Permission.EMPLOYMENT_TERMS_READ_SENSITIVE));
  }

  async create(actor: Actor, command: CreateEmploymentTermsCommand): Promise<EmploymentTermsView> {
    const permission = this.assertManageDraft(actor);
    const normalized = normalizeTerms(command);
    await this.requireNonArchivedProfile(normalized.employmentProfileId);
    return this.executeMutation(actor, permission, "employment-terms.create", normalized.employmentProfileId, async (session) => {
      const now = this.now();
      const termsCode = await this.allocateCode(normalized.effectiveFrom, session);
      const record: EmploymentTermsRecord = {
        id: uuidv4(),
        termsCode,
        ...normalized,
        status: "DRAFT",
        createdBy: actor.id,
        createdAt: now,
        updatedBy: actor.id,
        updatedAt: now,
        submittedBy: null,
        submittedAt: null,
        approvedBy: null,
        approvedAt: null,
        cancelledBy: null,
        cancelledAt: null,
        supersedesTermsId: null,
        supersededByTermsId: null,
        version: 1,
      };
      const inserted = await this.repository.insert(record, session);
      await this.recordAudit(actor, permission, inserted.id, "employment-terms.create", session, {
        employmentProfileId: inserted.employmentProfileId,
        status: inserted.status,
      });
      return toView(inserted, this.canReadSensitive(actor));
    });
  }

  async update(actor: Actor, command: UpdateEmploymentTermsCommand): Promise<EmploymentTermsView> {
    const permission = this.assertManageDraft(actor);
    const current = await this.requireOwnedRecord(command);
    if (current.status !== "DRAFT") {
      throw new EmploymentTermsStateError("Only DRAFT employment terms can be updated");
    }
    const normalized = normalizeTerms({ ...current, ...command, employmentProfileId: current.employmentProfileId });
    return this.executeMutation(actor, permission, "employment-terms.update-draft", current.id, async (session) => {
      const updated = await this.repository.updateDraft(
        { id: current.id, ...normalized, updatedBy: actor.id, updatedAt: this.now() },
        session,
      );
      if (!updated) throw new EmploymentTermsStateError("Employment terms are no longer editable");
      await this.recordAudit(actor, permission, updated.id, "employment-terms.update-draft", session, {
        employmentProfileId: updated.employmentProfileId,
      });
      return toView(updated, this.canReadSensitive(actor));
    });
  }

  async submit(actor: Actor, command: EmploymentTermsLifecycleCommand): Promise<EmploymentTermsView> {
    const permission = this.assertManageDraft(actor);
    const current = await this.requireOwnedRecord(command);
    if (current.status !== "DRAFT") throw new EmploymentTermsStateError("Only DRAFT employment terms can be submitted");
    return this.transition(actor, permission, "employment-terms.submit", current, ["DRAFT"], "PENDING_APPROVAL", {
      submittedBy: actor.id,
      submittedAt: this.now(),
    });
  }

  async approve(actor: Actor, command: EmploymentTermsLifecycleCommand): Promise<EmploymentTermsView> {
    const permission = this.assertApprove(actor);
    const current = await this.requireOwnedRecord(command);
    if (current.status !== "PENDING_APPROVAL") {
      throw new EmploymentTermsStateError("Only PENDING_APPROVAL employment terms can be approved");
    }
    if (current.createdBy === actor.id || current.submittedBy === actor.id) {
      throw new EmploymentTermsConflictError("Maker/checker rule prevents creator or submitter from approving employment terms");
    }
    await this.requireNonArchivedProfile(current.employmentProfileId);
    return this.executeMutation(actor, permission, "employment-terms.approve", current.id, async (session) => {
      await this.repository.acquireApprovalLock(current.employmentProfileId, session);
      if (current.payrollEligible) {
        const overlap = await this.repository.findOverlappingApprovedPayrollReadable(
          current.employmentProfileId,
          current.effectiveFrom,
          current.effectiveTo,
          current.id,
          session,
        );
        if (overlap) {
          throw new EmploymentTermsConflictError(`Approved payroll-readable employment terms overlap with ${overlap.id}`);
        }
      }
      const updated = await this.repository.transition(
        {
          id: current.id,
          employmentProfileId: current.employmentProfileId,
          fromStatuses: ["PENDING_APPROVAL"],
          toStatus: "APPROVED",
          updatedBy: actor.id,
          updatedAt: this.now(),
          approvedBy: actor.id,
          approvedAt: this.now(),
        },
        session,
      );
      if (!updated) throw new EmploymentTermsStateError("Employment terms can no longer be approved");
      await this.recordAudit(actor, permission, updated.id, "employment-terms.approve", session, {
        employmentProfileId: updated.employmentProfileId,
        fromStatus: current.status,
        toStatus: "APPROVED",
      });
      return toView(updated, this.canReadSensitive(actor));
    });
  }

  async cancel(actor: Actor, command: EmploymentTermsLifecycleCommand): Promise<EmploymentTermsView> {
    const permission = this.assertManageDraft(actor);
    const current = await this.requireOwnedRecord(command);
    if (current.status !== "DRAFT" && current.status !== "PENDING_APPROVAL") {
      throw new EmploymentTermsStateError("Only DRAFT or PENDING_APPROVAL employment terms can be cancelled");
    }
    return this.transition(actor, permission, "employment-terms.cancel", current, [current.status], "CANCELLED", {
      cancelledBy: actor.id,
      cancelledAt: this.now(),
    });
  }

  async getPayrollReadableForDate(
    employmentProfileId: string,
    date: unknown,
  ): Promise<PayrollReadableEmploymentTerms | null> {
    const profileId = requiredId(employmentProfileId, "employmentProfileId");
    const effectiveDate = canonicalDate(date, "date");
    const profile = await this.employmentProfileRepository.findById(profileId);
    if (!profile || profile.employmentStatus === "ARCHIVED") return null;
    const matches = await this.repository.findPayrollReadableForDate(profileId, effectiveDate);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new EmploymentTermsConflictError("Multiple payroll-readable employment terms apply for the requested date");
    }
    const record = matches[0]!;
    const allowances = assertRecordPayrollReadable(record, effectiveDate);
    return {
      id: record.id,
      termsCode: record.termsCode,
      employmentProfileId: record.employmentProfileId,
      effectiveFrom: record.effectiveFrom,
      effectiveTo: record.effectiveTo,
      baseSalaryAmount: record.baseSalaryAmount,
      currencyCode: record.currencyCode,
      payFrequency: record.payFrequency,
      allowances,
      version: record.version,
      approvedAt: record.approvedAt!,
    };
  }

  private async transition(
    actor: Actor,
    permission: ReturnType<typeof PermissionResolver.resolve>,
    mutationType: AuthoritativeAdminMutationIdentity,
    current: EmploymentTermsRecord,
    fromStatuses: readonly EmploymentTermsRecord["status"][],
    toStatus: EmploymentTermsRecord["status"],
    metadata: Partial<EmploymentTermsRecord>,
  ): Promise<EmploymentTermsView> {
    return this.executeMutation(actor, permission, mutationType, current.id, async (session) => {
      const updated = await this.repository.transition(
        {
          id: current.id,
          employmentProfileId: current.employmentProfileId,
          fromStatuses,
          toStatus,
          updatedBy: actor.id,
          updatedAt: this.now(),
          submittedBy: metadata.submittedBy ?? undefined,
          submittedAt: metadata.submittedAt ?? undefined,
          approvedBy: metadata.approvedBy ?? undefined,
          approvedAt: metadata.approvedAt ?? undefined,
          cancelledBy: metadata.cancelledBy ?? undefined,
          cancelledAt: metadata.cancelledAt ?? undefined,
        },
        session,
      );
      if (!updated) throw new EmploymentTermsStateError(`Employment terms cannot transition to ${toStatus}`);
      await this.recordAudit(actor, permission, updated.id, mutationType, session, {
        employmentProfileId: updated.employmentProfileId,
        fromStatus: current.status,
        toStatus,
      });
      return toView(updated, this.canReadSensitive(actor));
    });
  }

  private async requireOwnedRecord(command: EmploymentTermsLifecycleCommand): Promise<EmploymentTermsRecord> {
    const profileId = requiredId(command.employmentProfileId, "employmentProfileId");
    const termsId = requiredId(command.termsId, "termsId");
    const record = await this.repository.findById(termsId);
    if (!record || record.employmentProfileId !== profileId) throw new EmploymentTermsNotFoundError(termsId);
    return record;
  }

  private async requireNonArchivedProfile(id: string): Promise<void> {
    const profile = await this.employmentProfileRepository.findById(id);
    if (!profile || profile.employmentStatus === "ARCHIVED") {
      throw new EmploymentTermsValidationError(`employmentProfileId must reference an existing non-archived EmploymentProfile: ${id}`);
    }
  }

  private assertRead(actor: Actor): void {
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, PermissionResolver.resolve(Permission.EMPLOYMENT_TERMS_READ));
  }

  private assertManageDraft(actor: Actor) {
    PermissionGuard.assertAdminActor(actor);
    const permission = PermissionResolver.resolve(Permission.EMPLOYMENT_TERMS_MANAGE_DRAFT);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private assertApprove(actor: Actor) {
    PermissionGuard.assertAdminActor(actor);
    const permission = PermissionResolver.resolve(Permission.EMPLOYMENT_TERMS_APPROVE);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private canReadSensitive(actor: Actor): boolean {
    return actor.permissions.includes(Permission.EMPLOYMENT_TERMS_READ_SENSITIVE);
  }

  private async executeMutation<T>(
    actor: Actor,
    permission: ReturnType<typeof PermissionResolver.resolve>,
    mutationIdentity: AuthoritativeAdminMutationIdentity,
    target: string,
    mutate: (session: ClientSession, controls: AuthoritativeMutationControls) => Promise<T>,
  ): Promise<T> {
    return this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity,
        mutationTargetDescriptor: target,
      },
      mutate,
    );
  }

  private async recordAudit(
    actor: Actor,
    permission: ReturnType<typeof PermissionResolver.resolve>,
    id: string,
    mutationType: AuthoritativeAdminMutationIdentity,
    session: ClientSession,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(actor, permission, id, { mutationType, targetType: "employment-terms", ...metadata }, session);
  }

  private async allocateCode(effectiveFrom: number, session: ClientSession): Promise<string> {
    const policy = buildEmploymentTermsCodePolicy(utcYearBucketFromTimestamp(effectiveFrom));
    const maxExisting = await this.repository.findMaxGeneratedCodeSequence(policy, session);
    await this.codeSequenceRepository.ensureAtLeast(policy.moduleKey, policy.bucket, maxExisting, session);
    return formatBusinessCode(policy, await this.codeSequenceRepository.allocateNext(policy.moduleKey, policy.bucket, session));
  }
}

function normalizeTerms(command: CreateEmploymentTermsCommand): Omit<EmploymentTermsRecord, "id" | "termsCode" | "status" | "createdBy" | "createdAt" | "updatedBy" | "updatedAt" | "submittedBy" | "submittedAt" | "approvedBy" | "approvedAt" | "cancelledBy" | "cancelledAt" | "supersedesTermsId" | "supersededByTermsId" | "version"> {
  const effectiveFrom = canonicalDate(command.effectiveFrom, "effectiveFrom");
  const effectiveTo = command.effectiveTo === undefined || command.effectiveTo === null
    ? null
    : canonicalDate(command.effectiveTo, "effectiveTo");
  if (effectiveTo !== null && effectiveTo < effectiveFrom) {
    throw new EmploymentTermsValidationError("effectiveTo must not be before effectiveFrom");
  }
  return {
    employmentProfileId: requiredId(command.employmentProfileId, "employmentProfileId"),
    effectiveFrom,
    effectiveTo,
    baseSalaryAmount: nonNegativeAmount(command.baseSalaryAmount, "baseSalaryAmount"),
    currencyCode: currency(command.currencyCode, "currencyCode"),
    payFrequency: payFrequency(command.payFrequency),
    allowances: normalizeAllowances(command.allowances ?? [], effectiveFrom, effectiveTo),
    payrollEligible: requiredBoolean(command.payrollEligible, "payrollEligible"),
    sourceNote: nullableText(command.sourceNote, "sourceNote", MAX_SOURCE_NOTE_LENGTH),
  };
}

function normalizeAllowances(
  allowances: readonly Partial<EmploymentTermsAllowance>[],
  termsFrom: number,
  termsTo: number | null,
): readonly EmploymentTermsAllowance[] {
  if (!Array.isArray(allowances)) throw new EmploymentTermsValidationError("allowances must be an array");
  if (allowances.length > MAX_ALLOWANCE_COUNT) {
    throw new EmploymentTermsValidationError(`allowances must contain at most ${MAX_ALLOWANCE_COUNT} items`);
  }
  return allowances.map((allowance, index) => {
    const effectiveFrom = allowance.effectiveFrom == null ? null : canonicalDate(allowance.effectiveFrom, `allowances[${index}].effectiveFrom`);
    const effectiveTo = allowance.effectiveTo == null ? null : canonicalDate(allowance.effectiveTo, `allowances[${index}].effectiveTo`);
    const actualFrom = effectiveFrom ?? termsFrom;
    const actualTo = effectiveTo ?? termsTo;
    if (actualTo !== null && actualTo < actualFrom) {
      throw new EmploymentTermsValidationError(`allowances[${index}].effectiveTo must not be before effectiveFrom`);
    }
    return {
      type: requiredText(allowance.type, `allowances[${index}].type`, MAX_ALLOWANCE_TYPE_LENGTH),
      label: requiredText(allowance.label, `allowances[${index}].label`, MAX_ALLOWANCE_LABEL_LENGTH),
      amount: nonNegativeAmount(allowance.amount, `allowances[${index}].amount`),
      currencyCode: currency(allowance.currencyCode, `allowances[${index}].currencyCode`),
      payrollEligible: requiredBoolean(allowance.payrollEligible, `allowances[${index}].payrollEligible`),
      effectiveFrom,
      effectiveTo,
      sourceNote: nullableText(allowance.sourceNote, `allowances[${index}].sourceNote`, MAX_SOURCE_NOTE_LENGTH),
    };
  });
}

function toView(record: EmploymentTermsRecord, sensitive: boolean): EmploymentTermsView {
  return {
    id: record.id,
    termsCode: record.termsCode,
    employmentProfileId: record.employmentProfileId,
    status: record.status,
    effectiveFrom: record.effectiveFrom,
    effectiveTo: record.effectiveTo,
    ...(sensitive ? { baseSalaryAmount: record.baseSalaryAmount } : {}),
    currencyCode: record.currencyCode,
    payFrequency: record.payFrequency,
    allowances: record.allowances.map((allowance) => ({
      type: allowance.type,
      label: allowance.label,
      ...(sensitive ? { amount: allowance.amount } : {}),
      currencyCode: allowance.currencyCode,
      payrollEligible: allowance.payrollEligible,
      effectiveFrom: allowance.effectiveFrom,
      effectiveTo: allowance.effectiveTo,
      sourceNote: allowance.sourceNote,
    })),
    payrollEligible: record.payrollEligible,
    sourceNote: record.sourceNote,
    sensitiveAmountsRedacted: !sensitive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    submittedAt: record.submittedAt,
    approvedAt: record.approvedAt,
    cancelledAt: record.cancelledAt,
    supersedesTermsId: record.supersedesTermsId,
    supersededByTermsId: record.supersededByTermsId,
    version: record.version,
  };
}

function toAdminListItem(
  record: EmploymentTermsAdminListRecord,
  sensitive: boolean,
  asOfDate: number,
  profileTerms: readonly EmploymentTermsOverlapContextRecord[],
): EmploymentTermsAdminListItemView {
  return {
    ...toView(record.terms, sensitive),
    employmentProfile: record.employmentProfile,
    ...deriveAdminFlags(record.terms, asOfDate, profileTerms),
  };
}

function deriveAdminFlags(
  record: EmploymentTermsRecord,
  asOfDate: number,
  profileTerms: readonly EmploymentTermsOverlapContextRecord[],
): EmploymentTermsAdminDerivedFlags {
  const payrollReadable = evaluatePayrollReadableEmploymentTerms(record, asOfDate);
  return {
    isCurrentEffective: payrollReadable !== null,
    isExpired:
      record.status === "APPROVED"
      && record.payrollEligible
      && record.effectiveTo !== null
      && record.effectiveTo < asOfDate,
    isPendingApproval: record.status === "PENDING_APPROVAL",
    hasMissingBaseSalary:
      record.payrollEligible
      && (record.status === "APPROVED" || record.status === "PENDING_APPROVAL")
      && isRecordEffective(record, asOfDate)
      && !hasValidBaseSalary(record),
    hasOverlapForProfile: hasApprovedPayrollEligibleOverlap(record, profileTerms),
    payrollSourceEligibility: record.payrollEligible ? "ELIGIBLE" : "INELIGIBLE",
  };
}

function groupOverlapContextByEmploymentProfile(
  records: readonly EmploymentTermsOverlapContextRecord[],
): ReadonlyMap<string, readonly EmploymentTermsOverlapContextRecord[]> {
  const grouped = new Map<string, EmploymentTermsOverlapContextRecord[]>();
  for (const record of records) {
    const current = grouped.get(record.employmentProfileId) ?? [];
    current.push(record);
    grouped.set(record.employmentProfileId, current);
  }
  return grouped;
}

function matchesReadinessFilter(
  item: EmploymentTermsAdminListItemView,
  readiness: EmploymentTermsAdminReadinessFilter | undefined,
): boolean {
  if (!readiness) return true;
  switch (readiness) {
    case "CURRENT_EFFECTIVE":
      return item.isCurrentEffective;
    case "PENDING_APPROVAL":
      return item.isPendingApproval && item.payrollEligible;
    case "EXPIRED":
      return item.isExpired;
    case "MISSING_BASE_SALARY":
      return item.hasMissingBaseSalary;
    case "OVERLAPPING":
      return item.hasOverlapForProfile;
    case "PAYROLL_SOURCE_ELIGIBLE":
      return item.payrollEligible === true;
    case "PAYROLL_SOURCE_INELIGIBLE":
      return item.payrollEligible === false;
  }
}

function hasApprovedPayrollEligibleOverlap(
  record: EmploymentTermsRecord,
  profileTerms: readonly EmploymentTermsOverlapContextRecord[],
): boolean {
  if (record.status !== "APPROVED" || !record.payrollEligible) return false;
  return profileTerms.some(
    (candidate) =>
      candidate.id !== record.id
      && candidate.status === "APPROVED"
      && candidate.payrollEligible
      && rangesOverlap(record, candidate),
  );
}

function isRecordEffective(record: EmploymentTermsRecord, date: number): boolean {
  return isCanonicalDate(record.effectiveFrom)
    && (record.effectiveTo === null || isCanonicalDate(record.effectiveTo))
    && record.effectiveFrom <= date
    && (record.effectiveTo === null || record.effectiveTo >= date);
}

function rangesOverlap(
  left: EmploymentTermsOverlapContextRecord,
  right: EmploymentTermsOverlapContextRecord,
): boolean {
  if (
    !isCanonicalDate(left.effectiveFrom)
    || !isCanonicalDate(right.effectiveFrom)
    || (left.effectiveTo !== null && !isCanonicalDate(left.effectiveTo))
    || (right.effectiveTo !== null && !isCanonicalDate(right.effectiveTo))
  ) {
    return false;
  }
  return left.effectiveFrom <= (right.effectiveTo ?? Number.MAX_SAFE_INTEGER)
    && right.effectiveFrom <= (left.effectiveTo ?? Number.MAX_SAFE_INTEGER);
}

function hasValidBaseSalary(record: EmploymentTermsRecord): boolean {
  return Number.isFinite(record.baseSalaryAmount) && record.baseSalaryAmount >= 0;
}

function assertRecordPayrollReadable(
  record: EmploymentTermsRecord,
  date: number,
): readonly EmploymentTermsAllowance[] {
  const allowances = evaluatePayrollReadableEmploymentTerms(record, date);
  if (allowances === null) {
    throw new EmploymentTermsConflictError(`Employment terms ${record.id} are not valid payroll-readable source data`);
  }
  return allowances;
}

function requiredId(value: unknown, field: string): string {
  return requiredText(value, field);
}

function requiredText(value: unknown, field: string, maxLength?: number): string {
  if (typeof value !== "string" || !value.trim()) throw new EmploymentTermsValidationError(`${field} is required`);
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (maxLength !== undefined && normalized.length > maxLength) {
    throw new EmploymentTermsValidationError(`${field} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function nullableText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  return requiredText(value, field, maxLength);
}

function nonNegativeAmount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new EmploymentTermsValidationError(`${field} must be a non-negative finite number`);
  }
  return value;
}

function currency(value: unknown, field: string): string {
  const normalized = requiredText(value, field);
  if (!/^[A-Z]{3}$/u.test(normalized)) throw new EmploymentTermsValidationError(`${field} must be exactly 3 uppercase letters`);
  return normalized;
}

function payFrequency(value: unknown): EmploymentTermsPayFrequency {
  if (typeof value === "string" && EMPLOYMENT_TERMS_PAY_FREQUENCIES.includes(value.trim() as EmploymentTermsPayFrequency)) {
    return value.trim() as EmploymentTermsPayFrequency;
  }
  throw new EmploymentTermsValidationError(`payFrequency must be one of ${EMPLOYMENT_TERMS_PAY_FREQUENCIES.join(", ")}`);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new EmploymentTermsValidationError(`${field} must be a boolean`);
  return value;
}

function canonicalDate(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    const date = new Date(value);
    if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0) return value;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value.trim())) {
    const [year, month, day] = value.trim().split("-").map(Number);
    const timestamp = Date.UTC(year!, month! - 1, day!);
    const date = new Date(timestamp);
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day) return timestamp;
  }
  throw new EmploymentTermsValidationError(`${field} must be a canonical calendar date`);
}

function isCanonicalDate(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return false;
  const date = new Date(value);
  return date.getUTCHours() === 0
    && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0;
}

interface ParsedAdminListQuery {
  readonly employmentProfileId?: string;
  readonly orgUnitId?: string;
  readonly employmentStatus?: EmploymentStatus;
  readonly status?: EmploymentTermsStatus;
  readonly payrollEligible?: boolean;
  readonly effectiveOn: number;
  readonly effectiveOnFilter?: number;
  readonly expiringBefore?: number;
  readonly readiness?: EmploymentTermsAdminReadinessFilter;
  readonly search?: string;
  readonly cursor?: string;
  readonly limit: number;
}

interface AdminListCursor {
  readonly scope: string;
  readonly offset: number;
}

function parseAdminListQuery(
  query: ListEmploymentTermsAdminQuery,
  now: number,
): ParsedAdminListQuery {
  const effectiveOn = query.effectiveOn === undefined
    ? toHcmBusinessDateTimestamp(now)
    : canonicalDate(query.effectiveOn, "effectiveOn");
  return {
    employmentProfileId: optionalId(query.employmentProfileId, "employmentProfileId"),
    orgUnitId: optionalId(query.orgUnitId, "orgUnitId"),
    employmentStatus: optionalEnum(query.employmentStatus, EMPLOYMENT_STATUSES, "employmentStatus"),
    status: optionalEnum(query.status, EMPLOYMENT_TERMS_STATUSES, "status"),
    payrollEligible: optionalBoolean(query.payrollEligible, "payrollEligible"),
    effectiveOn,
    ...(query.effectiveOn === undefined ? {} : { effectiveOnFilter: effectiveOn }),
    expiringBefore: query.expiringBefore === undefined
      ? undefined
      : canonicalDate(query.expiringBefore, "expiringBefore"),
    readiness: optionalEnum(query.readiness, EMPLOYMENT_TERMS_ADMIN_READINESS_FILTERS, "readiness"),
    search: optionalSearch(query.search),
    cursor: optionalCursorText(query.cursor),
    limit: parseAdminLimit(query.limit),
  };
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredId(value, field);
}

function optionalEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new EmploymentTermsValidationError(`${field} must be one of ${values.join(", ")}`);
  }
  const normalized = value.trim();
  if (values.includes(normalized as T)) return normalized as T;
  throw new EmploymentTermsValidationError(`${field} must be one of ${values.join(", ")}`);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") {
    throw new EmploymentTermsValidationError(`${field} must be a boolean`);
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new EmploymentTermsValidationError(`${field} must be a boolean`);
}

function optionalSearch(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new EmploymentTermsValidationError("search must be a string");
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized.length > 0 ? normalized : undefined;
}

function optionalCursorText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new EmploymentTermsValidationError("cursor must be a string");
  }
  const normalized = value.trim();
  if (!normalized) throw new EmploymentTermsValidationError("cursor must not be empty");
  return normalized;
}

function parseAdminLimit(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_ADMIN_LIST_LIMIT;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ADMIN_LIST_LIMIT) {
    throw new EmploymentTermsValidationError(`limit must be an integer from 1 to ${MAX_ADMIN_LIST_LIMIT}`);
  }
  return parsed;
}

function buildAdminListCursorScope(query: ParsedAdminListQuery): string {
  return JSON.stringify({
    query: "employment-terms.admin-list",
    employmentProfileId: query.employmentProfileId ?? null,
    orgUnitId: query.orgUnitId ?? null,
    employmentStatus: query.employmentStatus ?? null,
    status: query.status ?? null,
    payrollEligible: query.payrollEligible ?? null,
    effectiveOn: query.effectiveOn,
    effectiveOnFilter: query.effectiveOnFilter ?? null,
    expiringBefore: query.expiringBefore ?? null,
    readiness: query.readiness ?? null,
    search: query.search ?? null,
  });
}

function parseAdminListCursor(
  value: string | undefined,
  scope: string,
): AdminListCursor {
  if (value === undefined) return { scope, offset: 0 };
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded === "object"
      && decoded !== null
      && !Array.isArray(decoded)
      && (decoded as { scope?: unknown }).scope === scope
      && Number.isInteger((decoded as { offset?: unknown }).offset)
      && Number((decoded as { offset?: unknown }).offset) >= 0
    ) {
      return {
        scope,
        offset: Number((decoded as { offset: number }).offset),
      };
    }
  } catch {}
  throw new EmploymentTermsValidationError("cursor is invalid");
}

function encodeAdminListCursor(cursor: AdminListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}
