import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { RevenueLedgerAdminController } from "./admin.revenue-ledger.controller";
import { RevenueLedgerAdminQueryController } from "./admin.revenue-ledger.query.controller";

export function adminRevenueLedgerRoutes(
  mutationController: RevenueLedgerAdminController,
  queryController: RevenueLedgerAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("REVENUE_ENTRY_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("REVENUE_ENTRY_LIST"),
    queryController.execute,
  );

  router.get(
    "/by-talent",
    withCommand("REVENUE_ENTRY_LIST_BY_TALENT"),
    queryController.execute,
  );

  router.get(
    "/by-platform",
    withCommand("REVENUE_ENTRY_LIST_BY_PLATFORM"),
    queryController.execute,
  );

  router.get(
    "/by-event",
    withCommand("REVENUE_ENTRY_LIST_BY_EVENT"),
    queryController.execute,
  );

  router.get(
    "/:revenueEntryId",
    withCommand("REVENUE_ENTRY_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:revenueEntryId/draft-core",
    withCommand("REVENUE_ENTRY_UPDATE_DRAFT_CORE"),
    mutationController.execute,
  );

  router.post(
    "/:revenueEntryId/finalize",
    withCommand("REVENUE_ENTRY_FINALIZE"),
    mutationController.execute,
  );

  router.post(
    "/:revenueEntryId/reconcile",
    withCommand("REVENUE_ENTRY_RECONCILE"),
    mutationController.execute,
  );

  router.post(
    "/:revenueEntryId/void",
    withCommand("REVENUE_ENTRY_VOID"),
    mutationController.execute,
  );

  router.post(
    "/:revenueEntryId/archive",
    withCommand("REVENUE_ENTRY_ARCHIVE"),
    mutationController.execute,
  );

  return router;
}
