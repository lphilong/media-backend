import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { CommissionValidationError } from "@modules/commission/domain/commission.errors";
import {
  COMMISSION_ADMIN_RULE_BY_BENEFICIARY_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_RULE_BY_CONTRACT_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_RULE_DETAIL_PRESENTER_KEY,
  COMMISSION_ADMIN_RULE_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_BY_BENEFICIARY_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_BY_REVENUE_ENTRY_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_BY_SUBJECT_TALENT_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_DETAIL_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_LINE_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_LIST_PRESENTER_KEY,
} from "@modules/commission/shared/commission.presenter-keys";
import {
  GetCommissionRuleDetailQuery,
  GetCommissionSettlementDetailQuery,
  ListCommissionRulesByBeneficiaryQuery,
  ListCommissionRulesByContractQuery,
  ListCommissionRulesQuery,
  ListCommissionSettlementLinesQuery,
  ListCommissionSettlementsByBeneficiaryQuery,
  ListCommissionSettlementsByRevenueEntryQuery,
  ListCommissionSettlementsBySubjectTalentQuery,
  ListCommissionSettlementsQuery,
} from "@modules/commission/shared/commission.contracts";
import { CommissionAdminQueryService } from "./admin.commission.query-service";

type CommissionQueryCommand =
  | "COMMISSION_RULE_LIST"
  | "COMMISSION_RULE_LIST_BY_BENEFICIARY"
  | "COMMISSION_RULE_LIST_BY_CONTRACT"
  | "COMMISSION_RULE_GET_DETAIL"
  | "COMMISSION_SETTLEMENT_LIST"
  | "COMMISSION_SETTLEMENT_LIST_LINES"
  | "COMMISSION_SETTLEMENT_LIST_BY_BENEFICIARY"
  | "COMMISSION_SETTLEMENT_LIST_BY_SUBJECT_TALENT"
  | "COMMISSION_SETTLEMENT_LIST_BY_REVENUE_ENTRY"
  | "COMMISSION_SETTLEMENT_GET_DETAIL";

const LIST_RULE_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "settlementKind",
    "beneficiaryKind",
    "beneficiaryEmploymentProfileId",
    "beneficiaryTalentId",
    "sourceContractRecordId",
    "appliesToRevenueKind",
    "windowStartDate",
    "windowEndDate",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ]);

const LIST_RULE_BY_BENEFICIARY_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "beneficiaryKind",
    "beneficiaryEmploymentProfileId",
    "beneficiaryTalentId",
    "status",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const LIST_RULE_BY_CONTRACT_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "sourceContractRecordId",
    "status",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const GET_RULE_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

const LIST_SETTLEMENT_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "settlementKindSnapshot",
    "beneficiaryKindSnapshot",
    "beneficiaryEmploymentProfileIdSnapshot",
    "beneficiaryTalentIdSnapshot",
    "subjectTalentId",
    "sourceRuleId",
    "containsRevenueEntryId",
    "settlementCurrencyCode",
    "windowStartAt",
    "windowEndAt",
    "createdBeforeAt",
    "finalizedFromAt",
    "finalizedToAt",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ]);

const LIST_SETTLEMENT_LINES_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

const LIST_SETTLEMENT_BY_BENEFICIARY_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "beneficiaryKindSnapshot",
    "beneficiaryEmploymentProfileIdSnapshot",
    "beneficiaryTalentIdSnapshot",
    "status",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const LIST_SETTLEMENT_BY_SUBJECT_TALENT_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "subjectTalentId",
    "status",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const LIST_SETTLEMENT_BY_REVENUE_ENTRY_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "revenueEntryId",
    "status",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const GET_SETTLEMENT_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class CommissionAdminQueryController extends SecureController {
  constructor(
    private readonly service: CommissionAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<CommissionQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Commission query command missing",
      );
    }

    switch (command) {
      case "COMMISSION_RULE_LIST":
        return this.service.listCommissionRules(
          actor,
          parseListRulesQuery(req),
        );

      case "COMMISSION_RULE_LIST_BY_BENEFICIARY":
        return this.service.listCommissionRulesByBeneficiary(
          actor,
          parseListRulesByBeneficiaryQuery(req),
        );

      case "COMMISSION_RULE_LIST_BY_CONTRACT":
        return this.service.listCommissionRulesByContract(
          actor,
          parseListRulesByContractQuery(req),
        );

      case "COMMISSION_RULE_GET_DETAIL":
        return this.service.getCommissionRuleDetail(
          actor,
          parseGetRuleDetailQuery(req),
        );

      case "COMMISSION_SETTLEMENT_LIST":
        return this.service.listCommissionSettlements(
          actor,
          parseListSettlementsQuery(req),
        );

      case "COMMISSION_SETTLEMENT_LIST_LINES":
        return this.service.listCommissionSettlementLines(
          actor,
          parseListSettlementLinesQuery(req),
        );

      case "COMMISSION_SETTLEMENT_LIST_BY_BENEFICIARY":
        return this.service.listCommissionSettlementsByBeneficiary(
          actor,
          parseListSettlementsByBeneficiaryQuery(req),
        );

      case "COMMISSION_SETTLEMENT_LIST_BY_SUBJECT_TALENT":
        return this.service.listCommissionSettlementsBySubjectTalent(
          actor,
          parseListSettlementsBySubjectTalentQuery(req),
        );

      case "COMMISSION_SETTLEMENT_LIST_BY_REVENUE_ENTRY":
        return this.service.listCommissionSettlementsByRevenueEntry(
          actor,
          parseListSettlementsByRevenueEntryQuery(req),
        );

      case "COMMISSION_SETTLEMENT_GET_DETAIL":
        return this.service.getCommissionSettlementDetail(
          actor,
          parseGetSettlementDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported commission query command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command =
      readCommand<CommissionQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Commission query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "COMMISSION_RULE_LIST":
        return registry
          .get<unknown, PresentationResult>(
            COMMISSION_ADMIN_RULE_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "COMMISSION_RULE_LIST_BY_BENEFICIARY":
        return registry
          .get<unknown, PresentationResult>(
            COMMISSION_ADMIN_RULE_BY_BENEFICIARY_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "COMMISSION_RULE_LIST_BY_CONTRACT":
        return registry
          .get<unknown, PresentationResult>(
            COMMISSION_ADMIN_RULE_BY_CONTRACT_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "COMMISSION_RULE_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            COMMISSION_ADMIN_RULE_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      case "COMMISSION_SETTLEMENT_LIST":
        return registry
          .get<unknown, PresentationResult>(
            COMMISSION_ADMIN_SETTLEMENT_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "COMMISSION_SETTLEMENT_LIST_LINES":
        return registry
          .get<unknown, PresentationResult>(
            COMMISSION_ADMIN_SETTLEMENT_LINE_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "COMMISSION_SETTLEMENT_LIST_BY_BENEFICIARY":
        return registry
          .get<unknown, PresentationResult>(
            COMMISSION_ADMIN_SETTLEMENT_BY_BENEFICIARY_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "COMMISSION_SETTLEMENT_LIST_BY_SUBJECT_TALENT":
        return registry
          .get<unknown, PresentationResult>(
            COMMISSION_ADMIN_SETTLEMENT_BY_SUBJECT_TALENT_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "COMMISSION_SETTLEMENT_LIST_BY_REVENUE_ENTRY":
        return registry
          .get<unknown, PresentationResult>(
            COMMISSION_ADMIN_SETTLEMENT_BY_REVENUE_ENTRY_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "COMMISSION_SETTLEMENT_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            COMMISSION_ADMIN_SETTLEMENT_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported commission query command: ${command}`,
        );
    }
  }
}

function parseListRulesQuery(
  req: Request,
): ListCommissionRulesQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_RULE_QUERY_FIELDS,
    "listCommissionRules",
  );

  return {
    status: req.query.status as string | undefined,
    settlementKind:
      req.query.settlementKind as
        | string
        | undefined,
    beneficiaryKind:
      req.query.beneficiaryKind as
        | string
        | undefined,
    beneficiaryEmploymentProfileId:
      req.query.beneficiaryEmploymentProfileId as
        | string
        | undefined,
    beneficiaryTalentId:
      req.query.beneficiaryTalentId as
        | string
        | undefined,
    sourceContractRecordId:
      req.query.sourceContractRecordId as
        | string
        | undefined,
    appliesToRevenueKind:
      req.query.appliesToRevenueKind as
        | string
        | undefined,
    windowStartDate:
      req.query.windowStartDate as
        | string
        | undefined,
    windowEndDate:
      req.query.windowEndDate as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListRulesByBeneficiaryQuery(
  req: Request,
): ListCommissionRulesByBeneficiaryQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_RULE_BY_BENEFICIARY_QUERY_FIELDS,
    "listCommissionRulesByBeneficiary",
  );

  return {
    beneficiaryKind:
      req.query.beneficiaryKind as string,
    beneficiaryEmploymentProfileId:
      req.query.beneficiaryEmploymentProfileId as
        | string
        | undefined,
    beneficiaryTalentId:
      req.query.beneficiaryTalentId as
        | string
        | undefined,
    status: req.query.status as string | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListRulesByContractQuery(
  req: Request,
): ListCommissionRulesByContractQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_RULE_BY_CONTRACT_QUERY_FIELDS,
    "listCommissionRulesByContract",
  );

  return {
    sourceContractRecordId:
      req.query.sourceContractRecordId as string,
    status: req.query.status as string | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseGetRuleDetailQuery(
  req: Request,
): GetCommissionRuleDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_RULE_DETAIL_QUERY_FIELDS,
    "getCommissionRuleDetail",
  );

  return {
    commissionRuleId: req.params.commissionRuleId,
  };
}

function parseListSettlementsQuery(
  req: Request,
): ListCommissionSettlementsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_SETTLEMENT_QUERY_FIELDS,
    "listCommissionSettlements",
  );

  return {
    status: req.query.status as string | undefined,
    settlementKindSnapshot:
      req.query.settlementKindSnapshot as
        | string
        | undefined,
    beneficiaryKindSnapshot:
      req.query.beneficiaryKindSnapshot as
        | string
        | undefined,
    beneficiaryEmploymentProfileIdSnapshot:
      req.query
        .beneficiaryEmploymentProfileIdSnapshot as
        | string
        | undefined,
    beneficiaryTalentIdSnapshot:
      req.query.beneficiaryTalentIdSnapshot as
        | string
        | undefined,
    subjectTalentId:
      req.query.subjectTalentId as
        | string
        | undefined,
    sourceRuleId:
      req.query.sourceRuleId as
        | string
        | undefined,
    containsRevenueEntryId:
      req.query.containsRevenueEntryId as
        | string
        | undefined,
    settlementCurrencyCode:
      req.query.settlementCurrencyCode as
        | string
        | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt:
      req.query.windowEndAt as
        | string
        | undefined,
    createdBeforeAt:
      req.query.createdBeforeAt as
        | string
        | undefined,
    finalizedFromAt:
      req.query.finalizedFromAt as
        | string
        | undefined,
    finalizedToAt:
      req.query.finalizedToAt as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListSettlementLinesQuery(
  req: Request,
): ListCommissionSettlementLinesQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_SETTLEMENT_LINES_QUERY_FIELDS,
    "listCommissionSettlementLines",
  );

  return {
    commissionSettlementId:
      req.params.commissionSettlementId,
  };
}

function parseListSettlementsByBeneficiaryQuery(
  req: Request,
): ListCommissionSettlementsByBeneficiaryQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_SETTLEMENT_BY_BENEFICIARY_QUERY_FIELDS,
    "listCommissionSettlementsByBeneficiary",
  );

  return {
    beneficiaryKindSnapshot:
      req.query.beneficiaryKindSnapshot as string,
    beneficiaryEmploymentProfileIdSnapshot:
      req.query
        .beneficiaryEmploymentProfileIdSnapshot as
        | string
        | undefined,
    beneficiaryTalentIdSnapshot:
      req.query.beneficiaryTalentIdSnapshot as
        | string
        | undefined,
    status: req.query.status as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt:
      req.query.windowEndAt as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListSettlementsBySubjectTalentQuery(
  req: Request,
): ListCommissionSettlementsBySubjectTalentQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_SETTLEMENT_BY_SUBJECT_TALENT_QUERY_FIELDS,
    "listCommissionSettlementsBySubjectTalent",
  );

  return {
    subjectTalentId:
      req.query.subjectTalentId as string,
    status: req.query.status as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt:
      req.query.windowEndAt as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListSettlementsByRevenueEntryQuery(
  req: Request,
): ListCommissionSettlementsByRevenueEntryQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_SETTLEMENT_BY_REVENUE_ENTRY_QUERY_FIELDS,
    "listCommissionSettlementsByRevenueEntry",
  );

  return {
    revenueEntryId: req.query.revenueEntryId as string,
    status: req.query.status as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt:
      req.query.windowEndAt as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseGetSettlementDetailQuery(
  req: Request,
): GetCommissionSettlementDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_SETTLEMENT_DETAIL_QUERY_FIELDS,
    "getCommissionSettlementDetail",
  );

  return {
    commissionSettlementId:
      req.params.commissionSettlementId,
  };
}

function assertNoUnexpectedQueryFields(
  query: Record<string, unknown>,
  allowedFields: readonly string[],
  queryName: string,
): void {
  const unexpectedFields = Object.keys(query).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  throw new CommissionValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
