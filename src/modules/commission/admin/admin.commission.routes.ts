import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { CommissionAdminController } from "./admin.commission.controller";
import { CommissionAdminQueryController } from "./admin.commission.query.controller";

export function adminCommissionRoutes(
  mutationController: CommissionAdminController,
  queryController: CommissionAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/rules",
    withCommand("COMMISSION_RULE_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/rules",
    withCommand("COMMISSION_RULE_LIST"),
    queryController.execute,
  );

  router.get(
    "/rules/by-beneficiary",
    withCommand("COMMISSION_RULE_LIST_BY_BENEFICIARY"),
    queryController.execute,
  );

  router.get(
    "/rules/by-contract",
    withCommand("COMMISSION_RULE_LIST_BY_CONTRACT"),
    queryController.execute,
  );

  router.get(
    "/rules/:commissionRuleId",
    withCommand("COMMISSION_RULE_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/rules/:commissionRuleId/draft-core",
    withCommand("COMMISSION_RULE_UPDATE_DRAFT_CORE"),
    mutationController.execute,
  );

  router.post(
    "/rules/:commissionRuleId/activate",
    withCommand("COMMISSION_RULE_ACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/rules/:commissionRuleId/deactivate",
    withCommand("COMMISSION_RULE_DEACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/rules/:commissionRuleId/archive",
    withCommand("COMMISSION_RULE_ARCHIVE"),
    mutationController.execute,
  );

  router.post(
    "/settlements",
    withCommand("COMMISSION_SETTLEMENT_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/settlements",
    withCommand("COMMISSION_SETTLEMENT_LIST"),
    queryController.execute,
  );

  router.get(
    "/settlements/by-beneficiary",
    withCommand("COMMISSION_SETTLEMENT_LIST_BY_BENEFICIARY"),
    queryController.execute,
  );

  router.get(
    "/settlements/by-subject-talent",
    withCommand("COMMISSION_SETTLEMENT_LIST_BY_SUBJECT_TALENT"),
    queryController.execute,
  );

  router.get(
    "/settlements/by-revenue-entry",
    withCommand("COMMISSION_SETTLEMENT_LIST_BY_REVENUE_ENTRY"),
    queryController.execute,
  );

  router.get(
    "/settlements/:commissionSettlementId/lines",
    withCommand("COMMISSION_SETTLEMENT_LIST_LINES"),
    queryController.execute,
  );

  router.get(
    "/settlements/:commissionSettlementId",
    withCommand("COMMISSION_SETTLEMENT_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/settlements/:commissionSettlementId/draft-core",
    withCommand("COMMISSION_SETTLEMENT_UPDATE_DRAFT_CORE"),
    mutationController.execute,
  );

  router.post(
    "/settlements/:commissionSettlementId/revenue-entries",
    withCommand("COMMISSION_SETTLEMENT_REPLACE_REVENUE_ENTRIES"),
    mutationController.execute,
  );

  router.post(
    "/settlements/:commissionSettlementId/finalize",
    withCommand("COMMISSION_SETTLEMENT_FINALIZE"),
    mutationController.execute,
  );

  router.post(
    "/settlements/:commissionSettlementId/void",
    withCommand("COMMISSION_SETTLEMENT_VOID"),
    mutationController.execute,
  );

  router.post(
    "/settlements/:commissionSettlementId/archive",
    withCommand("COMMISSION_SETTLEMENT_ARCHIVE"),
    mutationController.execute,
  );

  return router;
}
