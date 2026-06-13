import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { ContractRegistryAdminController } from "./admin.contract-registry.controller";
import { ContractRegistryAdminQueryController } from "./admin.contract-registry.query.controller";
import { ContractObligationAdminController } from "./admin.contract-obligation.controller";

export function adminContractRegistryRoutes(
  mutationController: ContractRegistryAdminController,
  queryController: ContractRegistryAdminQueryController,
  obligationController: ContractObligationAdminController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("CONTRACT_RECORD_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("CONTRACT_RECORD_LIST"),
    queryController.execute,
  );

  router.get(
    "/by-linked-entity",
    withCommand("CONTRACT_RECORD_LIST_BY_LINKED_ENTITY"),
    queryController.execute,
  );

  router.get(
    "/by-owner",
    withCommand("CONTRACT_RECORD_LIST_BY_OWNER"),
    queryController.execute,
  );

  router.get(
    "/:contractRecordId",
    withCommand("CONTRACT_RECORD_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:contractRecordId/draft-core",
    withCommand("CONTRACT_RECORD_UPDATE_DRAFT_CORE"),
    mutationController.execute,
  );

  router.post(
    "/:contractRecordId/assign-owner",
    withCommand("CONTRACT_RECORD_ASSIGN_OWNER"),
    mutationController.execute,
  );

  router.post(
    "/:contractRecordId/file-reference",
    withCommand("CONTRACT_RECORD_UPDATE_FILE_REFERENCE"),
    mutationController.execute,
  );

  router.post(
    "/:contractRecordId/mark-pending-signature",
    withCommand(
      "CONTRACT_RECORD_MARK_PENDING_SIGNATURE",
    ),
    mutationController.execute,
  );

  router.post(
    "/:contractRecordId/reopen-draft",
    withCommand("CONTRACT_RECORD_REOPEN_DRAFT"),
    mutationController.execute,
  );

  router.post(
    "/:contractRecordId/activate",
    withCommand("CONTRACT_RECORD_ACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:contractRecordId/expire",
    withCommand("CONTRACT_RECORD_EXPIRE"),
    mutationController.execute,
  );

  router.post(
    "/:contractRecordId/terminate",
    withCommand("CONTRACT_RECORD_TERMINATE"),
    mutationController.execute,
  );

  router.post(
    "/:contractRecordId/archive",
    withCommand("CONTRACT_RECORD_ARCHIVE"),
    mutationController.execute,
  );

  router.post(
    "/:contractRecordId/obligations",
    withCommand("CONTRACT_OBLIGATION_CREATE"),
    obligationController.execute,
  );

  router.get(
    "/:contractRecordId/obligations",
    withCommand("CONTRACT_OBLIGATION_LIST"),
    obligationController.execute,
  );

  router.get(
    "/obligations/:obligationId",
    withCommand("CONTRACT_OBLIGATION_GET_DETAIL"),
    obligationController.execute,
  );

  router.patch(
    "/obligations/:obligationId",
    withCommand("CONTRACT_OBLIGATION_UPDATE"),
    obligationController.execute,
  );

  for (const [path, command] of [
    ["open", "CONTRACT_OBLIGATION_OPEN"],
    ["deliver", "CONTRACT_OBLIGATION_DELIVER"],
    ["reject", "CONTRACT_OBLIGATION_REJECT"],
    ["reopen", "CONTRACT_OBLIGATION_REOPEN"],
    ["accept", "CONTRACT_OBLIGATION_ACCEPT"],
    ["cancel", "CONTRACT_OBLIGATION_CANCEL"],
    ["archive", "CONTRACT_OBLIGATION_ARCHIVE"],
  ] as const) {
    router.post(
      `/obligations/:obligationId/${path}`,
      withCommand(command),
      obligationController.execute,
    );
  }

  return router;
}
