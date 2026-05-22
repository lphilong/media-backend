import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LogEvent,
  StructuredLogger,
} from "@infra/logger.adapter";
import {
  DashboardLiteTimingContext,
  measureDashboardLiteStage,
} from "./dashboard-lite.timing";

function createCapturingLogger(): {
  readonly logger: StructuredLogger;
  readonly events: Array<{
    readonly level: string;
    readonly event: LogEvent;
  }>;
} {
  const events: Array<{
    readonly level: string;
    readonly event: LogEvent;
  }> = [];
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

const TIMING_CONTEXT: DashboardLiteTimingContext =
  Object.freeze({
    traceId: "trace-dashboard",
    actorId: "admin-dashboard",
    context: "ADMIN",
  });

test("measureDashboardLiteStage logs successful stage duration", async () => {
  const { logger, events } = createCapturingLogger();
  const ticks = [10, 35];

  const result = await measureDashboardLiteStage(
    {
      operation: "dashboardLite.snapshot.total",
      logger,
      timingContext: TIMING_CONTEXT,
      now: () => ticks.shift() ?? 35,
      metadata: {
        metricGroup: "snapshot",
      },
      resultMetadata: () => ({
        resultCount: 1,
      }),
    },
    () => "ok",
  );

  assert.equal(result, "ok");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.level, "info");
  assert.equal(
    events[0]?.event.operation,
    "dashboardLite.snapshot.total",
  );
  assert.equal(events[0]?.event.status, "SUCCESS");
  assert.equal(events[0]?.event.traceId, "trace-dashboard");
  assert.equal(events[0]?.event.actorId, "admin-dashboard");
  assert.equal(events[0]?.event.context, "ADMIN");
  assert.deepEqual(events[0]?.event.metadata, {
    metricGroup: "snapshot",
    resultCount: 1,
    durationMs: 25,
    slow: false,
    slowThresholdMs: 250,
  });
});

test("measureDashboardLiteStage logs slow successful stages as warnings", async () => {
  const { logger, events } = createCapturingLogger();
  const ticks = [100, 225];

  await measureDashboardLiteStage(
    {
      operation: "dashboardLite.metrics.events.today",
      logger,
      timingContext: TIMING_CONTEXT,
      warnAfterMs: 100,
      now: () => ticks.shift() ?? 225,
    },
    async () => 11,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.level, "warn");
  assert.deepEqual(events[0]?.event.metadata, {
    durationMs: 125,
    slow: true,
    slowThresholdMs: 100,
  });
});

test("measureDashboardLiteStage logs failure duration and rethrows", async () => {
  const { logger, events } = createCapturingLogger();
  const ticks = [200, 260];
  const failure = new Error("dashboard failed");

  await assert.rejects(
    () =>
      measureDashboardLiteStage(
        {
          operation: "dashboardLite.snapshot.operations",
          logger,
          timingContext: TIMING_CONTEXT,
          now: () => ticks.shift() ?? 260,
        },
        () => {
          throw failure;
        },
      ),
    failure,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.level, "error");
  assert.equal(events[0]?.event.status, "FAILED");
  assert.deepEqual(events[0]?.event.metadata, {
    error: "dashboard failed",
    durationMs: 60,
    slow: false,
    slowThresholdMs: 250,
  });
});
