import { Express, Request } from "express";
import { SystemInvariantError } from "@core/error/system-error";
import { Presenter } from "./presenter.base";

const REGISTRY_KEY = "presenterRegistry";

export interface PresenterRegistryAccess {
  get<TI, TO>(key: string): Presenter<TI, TO>;
}

export interface PresenterRegistryWriter {
  register<TI, TO>(
    key: string,
    presenter: Presenter<TI, TO>,
  ): void;
}

export function bindPresenterRegistry(
  app: Express,
  registry: PresenterRegistryAccess,
): void {
  if (app.locals[REGISTRY_KEY]) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "PresenterRegistry already bound to Express app",
    );
  }

  app.locals[REGISTRY_KEY] = registry;
}

export function getPresenterRegistryFromRequest(
  req: Request,
): PresenterRegistryAccess {
  const registry = req.app.locals[REGISTRY_KEY];

  if (!registry) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "PresenterRegistry not bound to Express app",
    );
  }

  return registry as PresenterRegistryAccess;
}
