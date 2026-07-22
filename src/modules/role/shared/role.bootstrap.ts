import { Db } from "mongodb";
import {
  DEFAULT_ROLE_SCHEMA_PROVENANCE,
  RoleSchemaProvenance,
  assertFinalRoleSchemaReadiness,
  initRoleIndexes,
} from "@infra/mongo/role/role.index";
import { registerPresenters } from "./role.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

export function createRoleBootstrapRegistrar(
  options: {
    readonly provenance?: RoleSchemaProvenance;
  } = {},
): BootstrapRegistrar {
  const provenance = options.provenance ?? DEFAULT_ROLE_SCHEMA_PROVENANCE;
  return Object.freeze({
    name: "role",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initRoleIndexes(db, provenance);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertFinalRoleSchemaReadiness(db);
    },
  });
}
