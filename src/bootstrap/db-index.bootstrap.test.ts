import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LogEvent,
  StructuredLogger,
} from "@infra/logger.adapter";
import { bootstrapDatabaseIndexes } from "./db-index.bootstrap";

function createCapturingLogger(): {
  readonly logger: StructuredLogger;
  readonly events: Array<{ level: string; event: LogEvent }>;
} {
  const events: Array<{ level: string; event: LogEvent }> =
    [];
  const record =
    (level: string) =>
    (event: LogEvent): void => {
      events.push({ level, event });
    };

  return {
    events,
    logger: {
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      fatal: record("fatal"),
    },
  };
}

test("bootstrapDatabaseIndexes runs registered bootstrap by default", async () => {
  let calls = 0;
  const { logger, events } = createCapturingLogger();

  await bootstrapDatabaseIndexes({} as never, {
    logger,
    traceId: "trace-1",
    bootstrapRegisteredIndexesFn: async () => {
      calls += 1;
    },
  });

  assert.equal(calls, 1);
  assert.equal(
    events.some(
      ({ event }) => event.operation === "indexBootstrap.total",
    ),
    true,
  );
});

test("bootstrapDatabaseIndexes skip path does not run registered bootstrap", async () => {
  let calls = 0;
  const { logger, events } = createCapturingLogger();

  await bootstrapDatabaseIndexes({} as never, {
    skip: true,
    logger,
    traceId: "trace-1",
    bootstrapRegisteredIndexesFn: async () => {
      calls += 1;
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(
    events.map(({ level, event }) => ({
      level,
      operation: event.operation,
      status: event.status,
      reason: event.metadata?.reason,
    })),
    [
      {
        level: "warn",
        operation: "indexBootstrap.total",
        status: "SKIPPED",
        reason: "SKIP_DB_INDEX_BOOTSTRAP=true",
      },
    ],
  );
});
