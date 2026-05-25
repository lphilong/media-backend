import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { SelfServiceCurrentPersonController } from "./self-service.current-person.controller";

export function selfServiceRoutes(
  currentPersonController: SelfServiceCurrentPersonController,
): Router {
  const router = Router();

  router.get(
    "/me",
    withCommand("SELF_SERVICE_CURRENT_PERSON"),
    currentPersonController.execute,
  );

  return router;
}
