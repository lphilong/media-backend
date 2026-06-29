import { Db } from "mongodb";
import { initResponsibilityIndexes } from "@infra/mongo/responsibility/responsibility.index";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

export function createResponsibilityBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "responsibility",
    async initIndexes(db: Db): Promise<void> {
      await initResponsibilityIndexes(db);
    },
  });
}

