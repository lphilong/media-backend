import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  CommissionNotFoundError,
  CommissionPermissionScopeError,
  CommissionValidationError,
} from "@modules/commission/domain/commission.errors";
import {
  COMMISSION_BENEFICIARY_KINDS,
  COMMISSION_RULE_SORT_FIELDS,
  COMMISSION_RULE_STATUSES,
  COMMISSION_SETTLEMENT_KINDS,
  COMMISSION_SETTLEMENT_SORT_FIELDS,
  COMMISSION_SETTLEMENT_STATUSES,
  COMMISSION_SORT_DIRECTIONS,
  CommissionBeneficiaryKind,
  CommissionRuleSortField,
  CommissionRuleStatus,
  CommissionSettlementKind,
  CommissionSettlementSortField,
  CommissionSettlementStatus,
  CommissionSortDirection,
} from "@modules/commission/domain/commission.types";
import {
  CommissionReadRepository,
} from "@modules/commission/read/commission.read-repository";
import {
  GetCommissionRuleDetailQuery,
  GetCommissionRuleDetailResult,
  GetCommissionSettlementDetailQuery,
  GetCommissionSettlementDetailResult,
  ListCommissionRulesByContractResult,
  ListCommissionRulesByBeneficiaryResult,
  ListCommissionRulesByBeneficiaryQuery,
  ListCommissionRulesByContractQuery,
  ListCommissionRulesQuery,
  ListCommissionRulesResult,
  ListCommissionSettlementLinesQuery,
  ListCommissionSettlementLinesResult,
  ListCommissionSettlementsByBeneficiaryQuery,
  ListCommissionSettlementsByBeneficiaryResult,
  ListCommissionSettlementsByRevenueEntryQuery,
  ListCommissionSettlementsByRevenueEntryResult,
  ListCommissionSettlementsBySubjectTalentQuery,
  ListCommissionSettlementsBySubjectTalentResult,
  ListCommissionSettlementsQuery,
  ListCommissionSettlementsResult,
} from "@modules/commission/shared/commission.contracts";
import {
  REVENUE_ENTRY_KINDS,
  RevenueKind,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ParsedRuleBeneficiaryFilter {
  readonly beneficiaryKind?: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileId?: string;
  readonly beneficiaryTalentId?: string;
}

interface ParsedSettlementBeneficiaryFilter {
  readonly beneficiaryKindSnapshot?: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot?: string;
  readonly beneficiaryTalentIdSnapshot?: string;
}

interface ParsedRuleWindowFilter {
  readonly windowStartDate?: number;
  readonly windowEndDate?: number;
}

interface ParsedSettlementWindowFilter {
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
}

interface ParsedTimestampRangeFilter {
  readonly fromAt?: number;
  readonly toAt?: number;
}

export class CommissionAdminQueryService {
  constructor(
    private readonly readRepository: CommissionReadRepository,
  ) {}

  async listCommissionRules(
    actor: Actor,
    query: ListCommissionRulesQuery,
  ): Promise<ListCommissionRulesResult> {
    this.assertRuleReadPermission(actor);
    assertGlobalScope(
      actor,
      "Commission rule queries require global scope",
    );

    const beneficiary = parseRuleBeneficiaryFilter({
      beneficiaryKind: query.beneficiaryKind,
      beneficiaryEmploymentProfileId:
        query.beneficiaryEmploymentProfileId,
      beneficiaryTalentId:
        query.beneficiaryTalentId,
    });

    const window = parseRuleWindowFilter({
      windowStartDate: query.windowStartDate,
      windowEndDate: query.windowEndDate,
    });

    return this.readRepository.listCommissionRules({
      status: parseOptionalRuleStatus(query.status),
      settlementKind: parseOptionalSettlementKind(
        query.settlementKind,
      ),
      beneficiaryKind: beneficiary.beneficiaryKind,
      beneficiaryEmploymentProfileId:
        beneficiary.beneficiaryEmploymentProfileId,
      beneficiaryTalentId:
        beneficiary.beneficiaryTalentId,
      sourceContractRecordId: parseOptionalId(
        query.sourceContractRecordId,
        "sourceContractRecordId",
      ),
      appliesToRevenueKind:
        parseOptionalRevenueKind(
          query.appliesToRevenueKind,
        ),
      windowStartDate: window.windowStartDate,
      windowEndDate: window.windowEndDate,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
      sortField: parseOptionalRuleSortField(
        query.sortBy,
      ),
      sortDirection: parseOptionalSortDirection(
        query.sortDirection,
      ),
    });
  }

  async listCommissionRulesByBeneficiary(
    actor: Actor,
    query: ListCommissionRulesByBeneficiaryQuery,
  ): Promise<ListCommissionRulesByBeneficiaryResult> {
    this.assertRuleReadPermission(actor);
    assertGlobalScope(
      actor,
      "Commission rule queries require global scope",
    );

    const beneficiary = parseRequiredRuleBeneficiaryFilter({
      beneficiaryKind: query.beneficiaryKind,
      beneficiaryEmploymentProfileId:
        query.beneficiaryEmploymentProfileId,
      beneficiaryTalentId:
        query.beneficiaryTalentId,
    });

    return this.readRepository.listCommissionRulesByBeneficiary(
      {
        beneficiaryKind: beneficiary.beneficiaryKind,
        beneficiaryEmploymentProfileId:
          beneficiary.beneficiaryEmploymentProfileId,
        beneficiaryTalentId:
          beneficiary.beneficiaryTalentId,
        status: parseOptionalRuleStatus(query.status),
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        sortField: parseOptionalRuleSortField(
          query.sortBy,
        ),
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async listCommissionRulesByContract(
    actor: Actor,
    query: ListCommissionRulesByContractQuery,
  ): Promise<ListCommissionRulesByContractResult> {
    this.assertRuleReadPermission(actor);
    assertGlobalScope(
      actor,
      "Commission rule queries require global scope",
    );

    return this.readRepository.listCommissionRulesByContract(
      {
        sourceContractRecordId:
          normalizeRequiredText(
            query.sourceContractRecordId,
            "sourceContractRecordId",
          ),
        status: parseOptionalRuleStatus(query.status),
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        sortField: parseOptionalRuleSortField(
          query.sortBy,
        ),
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async getCommissionRuleDetail(
    actor: Actor,
    query: GetCommissionRuleDetailQuery,
  ): Promise<GetCommissionRuleDetailResult> {
    this.assertRuleReadPermission(actor);
    assertGlobalScope(
      actor,
      "Commission rule queries require global scope",
    );

    const commissionRuleId = normalizeRequiredText(
      query.commissionRuleId,
      "commissionRuleId",
    );

    const detail =
      await this.readRepository.getCommissionRuleDetail(
        commissionRuleId,
      );

    if (!detail) {
      throw new CommissionNotFoundError(
        "rule",
        commissionRuleId,
      );
    }

    return detail;
  }

  async listCommissionSettlements(
    actor: Actor,
    query: ListCommissionSettlementsQuery,
  ): Promise<ListCommissionSettlementsResult> {
    this.assertSettlementReadPermission(actor);
    assertGlobalScope(
      actor,
      "Commission settlement queries require global scope",
    );

    const beneficiary =
      parseSettlementBeneficiaryFilter({
        beneficiaryKindSnapshot:
          query.beneficiaryKindSnapshot,
        beneficiaryEmploymentProfileIdSnapshot:
          query.beneficiaryEmploymentProfileIdSnapshot,
        beneficiaryTalentIdSnapshot:
          query.beneficiaryTalentIdSnapshot,
      });

    const window = parseSettlementWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });
    const finalizedAt = parseTimestampRangeFilter(
      {
        fromAt: query.finalizedFromAt,
        toAt: query.finalizedToAt,
      },
      "finalizedFromAt",
      "finalizedToAt",
    );

    return this.readRepository.listCommissionSettlements(
      {
        status: parseOptionalSettlementStatus(
          query.status,
        ),
        settlementKindSnapshot:
          parseOptionalSettlementKind(
            query.settlementKindSnapshot,
          ),
        beneficiaryKindSnapshot:
          beneficiary.beneficiaryKindSnapshot,
        beneficiaryEmploymentProfileIdSnapshot:
          beneficiary.beneficiaryEmploymentProfileIdSnapshot,
        beneficiaryTalentIdSnapshot:
          beneficiary.beneficiaryTalentIdSnapshot,
        subjectTalentId: parseOptionalId(
          query.subjectTalentId,
          "subjectTalentId",
        ),
        sourceRuleId: parseOptionalId(
          query.sourceRuleId,
          "sourceRuleId",
        ),
        containsRevenueEntryId: parseOptionalId(
          query.containsRevenueEntryId,
          "containsRevenueEntryId",
        ),
        settlementCurrencyCode:
          parseOptionalCurrencyCode(
            query.settlementCurrencyCode,
          ),
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
        createdBeforeAt: parseOptionalInteger(
          query.createdBeforeAt,
          "createdBeforeAt",
        ),
        finalizedFromAt: finalizedAt.fromAt,
        finalizedToAt: finalizedAt.toAt,
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        search: parseOptionalSearch(query.search),
        sortField:
          parseOptionalSettlementSortField(
            query.sortBy,
          ),
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async listCommissionSettlementLines(
    actor: Actor,
    query: ListCommissionSettlementLinesQuery,
  ): Promise<ListCommissionSettlementLinesResult> {
    this.assertSettlementReadPermission(actor);
    assertGlobalScope(
      actor,
      "Commission settlement queries require global scope",
    );

    const commissionSettlementId =
      normalizeRequiredText(
        query.commissionSettlementId,
        "commissionSettlementId",
      );

    const detail =
      await this.readRepository.getCommissionSettlementDetail(
        commissionSettlementId,
      );

    if (!detail) {
      throw new CommissionNotFoundError(
        "settlement",
        commissionSettlementId,
      );
    }

    return {
      items:
        await this.readRepository.listCommissionSettlementLines(
          commissionSettlementId,
        ),
    };
  }

  async listCommissionSettlementsByBeneficiary(
    actor: Actor,
    query: ListCommissionSettlementsByBeneficiaryQuery,
  ): Promise<ListCommissionSettlementsByBeneficiaryResult> {
    this.assertSettlementReadPermission(actor);
    assertGlobalScope(
      actor,
      "Commission settlement queries require global scope",
    );

    const beneficiary =
      parseRequiredSettlementBeneficiaryFilter({
        beneficiaryKindSnapshot:
          query.beneficiaryKindSnapshot,
        beneficiaryEmploymentProfileIdSnapshot:
          query.beneficiaryEmploymentProfileIdSnapshot,
        beneficiaryTalentIdSnapshot:
          query.beneficiaryTalentIdSnapshot,
      });

    const window = parseSettlementWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    return this.readRepository.listCommissionSettlementsByBeneficiary(
      {
        beneficiaryKindSnapshot:
          beneficiary.beneficiaryKindSnapshot,
        beneficiaryEmploymentProfileIdSnapshot:
          beneficiary.beneficiaryEmploymentProfileIdSnapshot,
        beneficiaryTalentIdSnapshot:
          beneficiary.beneficiaryTalentIdSnapshot,
        status: parseOptionalSettlementStatus(
          query.status,
        ),
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        sortField:
          parseOptionalSettlementSortField(
            query.sortBy,
          ),
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async listCommissionSettlementsBySubjectTalent(
    actor: Actor,
    query: ListCommissionSettlementsBySubjectTalentQuery,
  ): Promise<ListCommissionSettlementsBySubjectTalentResult> {
    this.assertSettlementReadPermission(actor);
    assertGlobalScope(
      actor,
      "Commission settlement queries require global scope",
    );

    const window = parseSettlementWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    return this.readRepository.listCommissionSettlementsBySubjectTalent(
      {
        subjectTalentId: normalizeRequiredText(
          query.subjectTalentId,
          "subjectTalentId",
        ),
        status: parseOptionalSettlementStatus(
          query.status,
        ),
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        sortField:
          parseOptionalSettlementSortField(
            query.sortBy,
          ),
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async listCommissionSettlementsByRevenueEntry(
    actor: Actor,
    query: ListCommissionSettlementsByRevenueEntryQuery,
  ): Promise<ListCommissionSettlementsByRevenueEntryResult> {
    this.assertSettlementReadPermission(actor);
    assertGlobalScope(
      actor,
      "Commission settlement queries require global scope",
    );

    const window = parseSettlementWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    return this.readRepository.listCommissionSettlementsByRevenueEntry(
      {
        revenueEntryId: normalizeRequiredText(
          query.revenueEntryId,
          "revenueEntryId",
        ),
        status: parseOptionalSettlementStatus(
          query.status,
        ),
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        sortField:
          parseOptionalSettlementSortField(
            query.sortBy,
          ),
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async getCommissionSettlementDetail(
    actor: Actor,
    query: GetCommissionSettlementDetailQuery,
  ): Promise<GetCommissionSettlementDetailResult> {
    this.assertSettlementReadPermission(actor);
    assertGlobalScope(
      actor,
      "Commission settlement queries require global scope",
    );

    const commissionSettlementId =
      normalizeRequiredText(
        query.commissionSettlementId,
        "commissionSettlementId",
      );

    const detail =
      await this.readRepository.getCommissionSettlementDetail(
        commissionSettlementId,
      );

    if (!detail) {
      throw new CommissionNotFoundError(
        "settlement",
        commissionSettlementId,
      );
    }

    return detail;
  }

  private assertRuleReadPermission(actor: Actor): void {
    assertAdminActorType(actor);

    const permission = PermissionResolver.resolve(
      Permission.COMMISSION_RULE_READ,
    );
    PermissionGuard.assert(actor, permission);
  }

  private assertSettlementReadPermission(
    actor: Actor,
  ): void {
    assertAdminActorType(actor);

    const permission = PermissionResolver.resolve(
      Permission.COMMISSION_SETTLEMENT_READ,
    );
    PermissionGuard.assert(actor, permission);
  }
}

function parseTimestampRangeFilter(
  input: {
    readonly fromAt: unknown;
    readonly toAt: unknown;
  },
  fromField: string,
  toField: string,
): ParsedTimestampRangeFilter {
  const fromAt = parseOptionalInteger(
    input.fromAt,
    fromField,
  );
  const toAt = parseOptionalInteger(
    input.toAt,
    toField,
  );

  if (
    fromAt !== undefined &&
    toAt !== undefined &&
    toAt <= fromAt
  ) {
    throw new CommissionValidationError(
      `${toField} must be strictly greater than ${fromField}`,
    );
  }

  return {
    fromAt,
    toAt,
  };
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new CommissionValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function parseOptionalId(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = normalizeRequiredText(value, field);
  return normalized;
}

function parseOptionalRuleStatus(
  value: unknown,
): CommissionRuleStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `status must be one of ${COMMISSION_RULE_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();
  if (
    COMMISSION_RULE_STATUSES.includes(
      normalized as CommissionRuleStatus,
    )
  ) {
    return normalized as CommissionRuleStatus;
  }

  throw new CommissionValidationError(
    `status must be one of ${COMMISSION_RULE_STATUSES.join(", ")}`,
  );
}

function parseOptionalSettlementStatus(
  value: unknown,
): CommissionSettlementStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `status must be one of ${COMMISSION_SETTLEMENT_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();
  if (
    COMMISSION_SETTLEMENT_STATUSES.includes(
      normalized as CommissionSettlementStatus,
    )
  ) {
    return normalized as CommissionSettlementStatus;
  }

  throw new CommissionValidationError(
    `status must be one of ${COMMISSION_SETTLEMENT_STATUSES.join(", ")}`,
  );
}

function parseOptionalSettlementKind(
  value: unknown,
): CommissionSettlementKind | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `settlementKind must be one of ${COMMISSION_SETTLEMENT_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();
  if (
    COMMISSION_SETTLEMENT_KINDS.includes(
      normalized as CommissionSettlementKind,
    )
  ) {
    return normalized as CommissionSettlementKind;
  }

  throw new CommissionValidationError(
    `settlementKind must be one of ${COMMISSION_SETTLEMENT_KINDS.join(", ")}`,
  );
}

function parseOptionalBeneficiaryKind(
  value: unknown,
  field: string,
): CommissionBeneficiaryKind | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `${field} must be one of ${COMMISSION_BENEFICIARY_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    COMMISSION_BENEFICIARY_KINDS.includes(
      normalized as CommissionBeneficiaryKind,
    )
  ) {
    return normalized as CommissionBeneficiaryKind;
  }

  throw new CommissionValidationError(
    `${field} must be one of ${COMMISSION_BENEFICIARY_KINDS.join(", ")}`,
  );
}

function parseRequiredBeneficiaryKind(
  value: unknown,
  field: string,
): CommissionBeneficiaryKind {
  const parsed = parseOptionalBeneficiaryKind(
    value,
    field,
  );

  if (!parsed) {
    throw new CommissionValidationError(
      `${field} is required`,
    );
  }

  return parsed;
}

function parseRuleBeneficiaryFilter(input: {
  readonly beneficiaryKind: unknown;
  readonly beneficiaryEmploymentProfileId: unknown;
  readonly beneficiaryTalentId: unknown;
}): ParsedRuleBeneficiaryFilter {
  const beneficiaryKind = parseOptionalBeneficiaryKind(
    input.beneficiaryKind,
    "beneficiaryKind",
  );
  const beneficiaryEmploymentProfileId =
    parseOptionalId(
      input.beneficiaryEmploymentProfileId,
      "beneficiaryEmploymentProfileId",
    );
  const beneficiaryTalentId = parseOptionalId(
    input.beneficiaryTalentId,
    "beneficiaryTalentId",
  );

  assertBeneficiaryFilterConsistency({
    beneficiaryKind,
    beneficiaryEmploymentProfileId,
    beneficiaryTalentId,
  });

  return {
    beneficiaryKind,
    beneficiaryEmploymentProfileId,
    beneficiaryTalentId,
  };
}

function parseRequiredRuleBeneficiaryFilter(input: {
  readonly beneficiaryKind: unknown;
  readonly beneficiaryEmploymentProfileId: unknown;
  readonly beneficiaryTalentId: unknown;
}): {
  readonly beneficiaryKind: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileId: string | null;
  readonly beneficiaryTalentId: string | null;
} {
  const parsed = parseRuleBeneficiaryFilter(input);
  const beneficiaryKind = parseRequiredBeneficiaryKind(
    parsed.beneficiaryKind,
    "beneficiaryKind",
  );

  if (beneficiaryKind === "EMPLOYMENT_PROFILE") {
    if (
      parsed.beneficiaryEmploymentProfileId &&
      !parsed.beneficiaryTalentId
    ) {
      return {
        beneficiaryKind,
        beneficiaryEmploymentProfileId:
          parsed.beneficiaryEmploymentProfileId,
        beneficiaryTalentId: null,
      };
    }

    throw new CommissionValidationError(
      "beneficiaryKind EMPLOYMENT_PROFILE requires beneficiaryEmploymentProfileId and forbids beneficiaryTalentId",
    );
  }

  if (
    parsed.beneficiaryTalentId &&
    !parsed.beneficiaryEmploymentProfileId
  ) {
    return {
      beneficiaryKind,
      beneficiaryEmploymentProfileId: null,
      beneficiaryTalentId:
        parsed.beneficiaryTalentId,
    };
  }

  throw new CommissionValidationError(
    "beneficiaryKind TALENT requires beneficiaryTalentId and forbids beneficiaryEmploymentProfileId",
  );
}

function parseSettlementBeneficiaryFilter(input: {
  readonly beneficiaryKindSnapshot: unknown;
  readonly beneficiaryEmploymentProfileIdSnapshot: unknown;
  readonly beneficiaryTalentIdSnapshot: unknown;
}): ParsedSettlementBeneficiaryFilter {
  const beneficiaryKindSnapshot =
    parseOptionalBeneficiaryKind(
      input.beneficiaryKindSnapshot,
      "beneficiaryKindSnapshot",
    );
  const beneficiaryEmploymentProfileIdSnapshot =
    parseOptionalId(
      input.beneficiaryEmploymentProfileIdSnapshot,
      "beneficiaryEmploymentProfileIdSnapshot",
    );
  const beneficiaryTalentIdSnapshot = parseOptionalId(
    input.beneficiaryTalentIdSnapshot,
    "beneficiaryTalentIdSnapshot",
  );

  assertBeneficiaryFilterConsistency({
    beneficiaryKind: beneficiaryKindSnapshot,
    beneficiaryEmploymentProfileId:
      beneficiaryEmploymentProfileIdSnapshot,
    beneficiaryTalentId:
      beneficiaryTalentIdSnapshot,
  });

  return {
    beneficiaryKindSnapshot,
    beneficiaryEmploymentProfileIdSnapshot,
    beneficiaryTalentIdSnapshot,
  };
}

function parseRequiredSettlementBeneficiaryFilter(input: {
  readonly beneficiaryKindSnapshot: unknown;
  readonly beneficiaryEmploymentProfileIdSnapshot: unknown;
  readonly beneficiaryTalentIdSnapshot: unknown;
}): {
  readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot: string | null;
  readonly beneficiaryTalentIdSnapshot: string | null;
} {
  const parsed = parseSettlementBeneficiaryFilter(input);
  const beneficiaryKindSnapshot =
    parseRequiredBeneficiaryKind(
      parsed.beneficiaryKindSnapshot,
      "beneficiaryKindSnapshot",
    );

  if (beneficiaryKindSnapshot === "EMPLOYMENT_PROFILE") {
    if (
      parsed.beneficiaryEmploymentProfileIdSnapshot &&
      !parsed.beneficiaryTalentIdSnapshot
    ) {
      return {
        beneficiaryKindSnapshot,
        beneficiaryEmploymentProfileIdSnapshot:
          parsed.beneficiaryEmploymentProfileIdSnapshot,
        beneficiaryTalentIdSnapshot: null,
      };
    }

    throw new CommissionValidationError(
      "beneficiaryKindSnapshot EMPLOYMENT_PROFILE requires beneficiaryEmploymentProfileIdSnapshot and forbids beneficiaryTalentIdSnapshot",
    );
  }

  if (
    parsed.beneficiaryTalentIdSnapshot &&
    !parsed.beneficiaryEmploymentProfileIdSnapshot
  ) {
    return {
      beneficiaryKindSnapshot,
      beneficiaryEmploymentProfileIdSnapshot: null,
      beneficiaryTalentIdSnapshot:
        parsed.beneficiaryTalentIdSnapshot,
    };
  }

  throw new CommissionValidationError(
    "beneficiaryKindSnapshot TALENT requires beneficiaryTalentIdSnapshot and forbids beneficiaryEmploymentProfileIdSnapshot",
  );
}

function assertBeneficiaryFilterConsistency(input: {
  readonly beneficiaryKind?: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileId?: string;
  readonly beneficiaryTalentId?: string;
}): void {
  if (
    input.beneficiaryEmploymentProfileId !== undefined &&
    input.beneficiaryTalentId !== undefined
  ) {
    throw new CommissionValidationError(
      "At most one beneficiary-id filter may be provided",
    );
  }

  if (
    input.beneficiaryKind === "EMPLOYMENT_PROFILE" &&
    input.beneficiaryTalentId !== undefined
  ) {
    throw new CommissionValidationError(
      "beneficiaryKind EMPLOYMENT_PROFILE is inconsistent with beneficiaryTalentId filter",
    );
  }

  if (
    input.beneficiaryKind === "TALENT" &&
    input.beneficiaryEmploymentProfileId !== undefined
  ) {
    throw new CommissionValidationError(
      "beneficiaryKind TALENT is inconsistent with beneficiaryEmploymentProfileId filter",
    );
  }
}

function parseOptionalRevenueKind(
  value: unknown,
): RevenueKind | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `appliesToRevenueKind must be one of ${REVENUE_ENTRY_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();
  if (
    REVENUE_ENTRY_KINDS.includes(
      normalized as RevenueKind,
    )
  ) {
    return normalized as RevenueKind;
  }

  throw new CommissionValidationError(
    `appliesToRevenueKind must be one of ${REVENUE_ENTRY_KINDS.join(", ")}`,
  );
}

function parseOptionalCurrencyCode(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      "settlementCurrencyCode must be a string",
    );
  }

  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }

  if (!/^[A-Z]{3}$/u.test(normalized)) {
    throw new CommissionValidationError(
      "settlementCurrencyCode must be exactly 3 uppercase letters",
    );
  }

  return normalized;
}

function parseRuleWindowFilter(input: {
  readonly windowStartDate: unknown;
  readonly windowEndDate: unknown;
}): ParsedRuleWindowFilter {
  const windowStartDate = parseOptionalCanonicalDate(
    input.windowStartDate,
    "windowStartDate",
  );
  const windowEndDate = parseOptionalCanonicalDate(
    input.windowEndDate,
    "windowEndDate",
  );

  if (
    windowStartDate !== undefined &&
    windowEndDate !== undefined &&
    windowEndDate < windowStartDate
  ) {
    throw new CommissionValidationError(
      "windowEndDate must not be earlier than windowStartDate",
    );
  }

  return {
    windowStartDate,
    windowEndDate,
  };
}

function parseSettlementWindowFilter(input: {
  readonly windowStartAt: unknown;
  readonly windowEndAt: unknown;
}): ParsedSettlementWindowFilter {
  const windowStartAt = parseOptionalInteger(
    input.windowStartAt,
    "windowStartAt",
  );
  const windowEndAt = parseOptionalInteger(
    input.windowEndAt,
    "windowEndAt",
  );

  if (
    windowStartAt !== undefined &&
    windowEndAt !== undefined &&
    windowEndAt <= windowStartAt
  ) {
    throw new CommissionValidationError(
      "windowEndAt must be strictly greater than windowStartAt",
    );
  }

  return {
    windowStartAt,
    windowEndAt,
  };
}

function parseOptionalCanonicalDate(
  value: unknown,
  field: string,
): number | undefined {
  const parsed = parseOptionalInteger(value, field);

  if (parsed === undefined) {
    return undefined;
  }

  const date = new Date(parsed);
  if (
    date.getUTCHours() !== 0 ||
    date.getUTCMinutes() !== 0 ||
    date.getUTCSeconds() !== 0 ||
    date.getUTCMilliseconds() !== 0
  ) {
    throw new CommissionValidationError(
      `${field} must be a canonical UTC calendar date timestamp at 00:00:00.000Z`,
    );
  }

  return parsed;
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_LIMIT;
  }

  const parsed = parseOptionalInteger(value, "limit");
  if (parsed === undefined) {
    return DEFAULT_LIMIT;
  }

  if (parsed <= 0) {
    throw new CommissionValidationError(
      "limit must be a positive integer",
    );
  }

  return Math.min(parsed, MAX_LIMIT);
}

function parseOptionalInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  let numeric: number;

  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    if (!value.trim()) {
      return undefined;
    }

    numeric = Number(value);
  } else {
    throw new CommissionValidationError(
      `${field} must be an integer`,
    );
  }

  if (!Number.isInteger(numeric)) {
    throw new CommissionValidationError(
      `${field} must be an integer`,
    );
  }

  return numeric;
}

function parseOptionalCursor(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      "cursor must be a string",
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function parseOptionalSearch(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      "search must be a string",
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();

  return normalized.length > 0
    ? normalized
    : undefined;
}

function parseOptionalRuleSortField(
  value: unknown,
): CommissionRuleSortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `sortBy must be one of ${COMMISSION_RULE_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();
  if (
    COMMISSION_RULE_SORT_FIELDS.includes(
      normalized as CommissionRuleSortField,
    )
  ) {
    return normalized as CommissionRuleSortField;
  }

  throw new CommissionValidationError(
    `sortBy must be one of ${COMMISSION_RULE_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSettlementSortField(
  value: unknown,
): CommissionSettlementSortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `sortBy must be one of ${COMMISSION_SETTLEMENT_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();
  if (
    COMMISSION_SETTLEMENT_SORT_FIELDS.includes(
      normalized as CommissionSettlementSortField,
    )
  ) {
    return normalized as CommissionSettlementSortField;
  }

  throw new CommissionValidationError(
    `sortBy must be one of ${COMMISSION_SETTLEMENT_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): CommissionSortDirection | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `sortDirection must be one of ${COMMISSION_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();
  if (
    COMMISSION_SORT_DIRECTIONS.includes(
      normalized as CommissionSortDirection,
    )
  ) {
    return normalized as CommissionSortDirection;
  }

  throw new CommissionValidationError(
    `sortDirection must be one of ${COMMISSION_SORT_DIRECTIONS.join(", ")}`,
  );
}

function assertGlobalScope(
  actor: Actor,
  message: string,
): void {
  if (
    PermissionGuard.hasCommissionScopeGrant(
      actor,
      "global",
    )
  ) {
    return;
  }

  throw new CommissionPermissionScopeError(message);
}

function assertAdminActorType(actor: Actor): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Commission access requires actor.type admin, received ${actor.type}`,
  );
}
