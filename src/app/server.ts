import crypto from "crypto";
import {
  env,
  readRuntimeFromProcessEnv,
} from "@config/env";
import { SystemInvariantError } from "@core/error/system-error";
import { createStructuredLogger } from "@infra/logger.adapter";

const logger = createStructuredLogger();

async function bootstrap(): Promise<void> {
  switch (env.APP_RUNTIME) {
    case "http": {
      const { startHttpRuntime } = await import(
        "@bootstrap/http.runtime"
      );
      return startHttpRuntime();
    }

    case "system": {
      const { startSystemRuntime } = await import(
        "@bootstrap/system.runtime"
      );
      return startSystemRuntime();
    }

    default:
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        `Unsupported APP_RUNTIME: ${env.APP_RUNTIME}`,
      );
  }
}

void bootstrap().catch((err) => {
  const runtimeTraceId = crypto.randomUUID();

  logger.fatal({
    traceId: runtimeTraceId,
    actorId: "SYSTEM",
    context: "SYSTEM",
    operation: "process.bootstrap",
    status: "FAILED",
    timestamp: Date.now(),
    metadata: {
      error:
        err instanceof Error ? err.message : String(err),
      runtime: readRuntimeFromProcessEnv(),
    },
  });

  process.exit(1);
});