import { Db } from "mongodb";
import { bootstrapRegisteredIndexes } from "./module-registrar";

/**
 * Runtime bootstrap entry for indexes/readiness owned by registered
 * foundation and module bootstrap contracts.
 */
export async function bootstrapDatabaseIndexes(
  db: Db,
): Promise<void> {
  await bootstrapRegisteredIndexes(db);
}