import { Db } from "mongodb";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";
import { initEmploymentTermsIndexes } from "@infra/mongo/employment-terms/employment-terms.index";

export function createEmploymentTermsBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "employment-terms",
    async initIndexes(db: Db): Promise<void> {
      await initEmploymentTermsIndexes(db);
    },
  });
}
