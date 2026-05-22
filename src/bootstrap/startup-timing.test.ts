import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LogEvent,
  StructuredLogger,
} from "@infra/logger.adapter";
import { measureStartupStage } from "./startup-timing";

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

test("measureStartupStage logs successful stage duration", async () => {
  const { logger, events } = createCapturingLogger();
  const ticks = [100, 145];

  const result = await measureStartupStage(
    {
      label: "startup.test",
      logger,
      traceId: "trace-1",
      now: () => ticks.shift() ?? 145,
    },
    () => "ok",
  );

  assert.equal(result, "ok");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.level, "info");
  assert.equal(events[0]?.event.operation, "startup.test");
  assert.equal(events[0]?.event.status, "SUCCESS");
  assert.deepEqual(events[0]?.event.metadata, {
    durationMs: 45,
  });
});

test("measureStartupStage logs slow successful stages as warnings by default", async () => {
  const { logger, events } = createCapturingLogger();
  const ticks = [10, 1010];

  await measureStartupStage(
    {
      label: "indexBootstrap.module.init",
      logger,
      traceId: "trace-1",
      now: () => ticks.shift() ?? 1010,
    },
    async () => undefined,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.level, "warn");
  assert.deepEqual(events[0]?.event.metadata, {
    slow: true,
    slowThresholdMs: 1000,
    durationMs: 1000,
  });
});

test("measureStartupStage honors explicit slow warning overrides", async () => {
  const { logger, events } = createCapturingLogger();
  const ticks = [10, 30];

  await measureStartupStage(
    {
      label: "indexBootstrap.module.init",
      logger,
      traceId: "trace-1",
      warnAfterMs: 20,
      now: () => ticks.shift() ?? 30,
    },
    async () => undefined,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.level, "warn");
  assert.deepEqual(events[0]?.event.metadata, {
    slow: true,
    slowThresholdMs: 20,
    durationMs: 20,
  });
});

test("measureStartupStage logs failure duration and rethrows", async () => {
  const { logger, events } = createCapturingLogger();
  const ticks = [200, 260];
  const failure = new Error("boom");

  await assert.rejects(
    () =>
      measureStartupStage(
        {
          label: "startup.fail",
          logger,
          traceId: "trace-1",
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
    error: "boom",
    durationMs: 60,
  });
});
