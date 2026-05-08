import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { ContractRegistryAdminController } from "./admin.contract-registry.controller";
import { ContractRegistryAdminQueryController } from "./admin.contract-registry.query.controller";

export function adminContractRegistryRoutes(
  mutationController: ContractRegistryAdminController,
  queryController: ContractRegistryAdminQueryController,
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

  return router;
}
