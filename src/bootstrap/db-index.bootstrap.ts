import { Db } from "mongodb";
import { StructuredLogger } from "@infra/logger.adapter";
import { bootstrapRegisteredIndexes } from "./module-registrar";
import { measureStartupStage } from "./startup-timing";

/**
 * Runtime bootstrap entry for indexes/readiness owned by registered
 * foundation and module bootstrap contracts.
 */
export interface DatabaseIndexBootstrapOptions {
  readonly skip?: boolean;
  readonly logger?: StructuredLogger;
  readonly traceId?: string;
  readonly bootstrapRegisteredIndexesFn?: typeof bootstrapRegisteredIndexes;
}

export async function bootstrapDatabaseIndexes(
  db: Db,
  options: DatabaseIndexBootstrapOptions = {},
): Promise<void> {
  const bootstrapRegisteredIndexesFn =
    options.bootstrapRegisteredIndexesFn ?? bootstrapRegisteredIndexes;

  if (options.skip) {
    options.logger?.warn({
      traceId: options.traceId ?? "startup",
      actorId: "SYSTEM",
      context: "SYSTEM",
      operation: "indexBootstrap.total",
      status: "SKIPPED",
      timestamp: Date.now(),
      metadata: {
        durationMs: 0,
        reason: "SKIP_DB_INDEX_BOOTSTRAP=true",
        warning:
          "Database index bootstrap and readiness assertions skipped for explicit dev/diagnostic measurement only.",
      },
    });
    return;
  }

  const task = async (): Promise<void> => {
    await bootstrapRegisteredIndexesFn(db, {
      logger: options.logger,
      traceId: options.traceId,
    });
  };

  if (!options.logger || !options.traceId) {
    await task();
    return;
  }

  await measureStartupStage(
    {
      label: "indexBootstrap.total",
      logger: options.logger,
      traceId: options.traceId,
    },
    task,
  );
}
