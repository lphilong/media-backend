import assert from "node:assert/strict";
import { test } from "node:test";
import { SystemInvariantError } from "../../core/error/system-error";
import { assertPresentationResult } from "./presentation-result.assert";

function assertPasses(output: unknown): void {
  assert.doesNotThrow(() => {
    assertPresentationResult(output);
  });
}

function assertPresentationViolation(output: unknown): void {
  assert.throws(
    () => {
      assertPresentationResult(output);
    },
    (err: unknown) => {
      assert.equal(err instanceof SystemInvariantError, true);
      assert.equal(
        (err as SystemInvariantError).code,
        "HTTP_PRESENTATION_CONTRACT_VIOLATION",
      );
      assert.equal(
        (err as SystemInvariantError).message,
        "Presentation contract violation",
      );
      return true;
    },
  );
}

test("accepts non-empty string arrays in presentation objects", () => {
  assertPasses({
    data: {
      values: ["root-id"],
    },
  });
});

test("accepts non-empty finite number arrays in presentation objects", () => {
  assertPasses({
    data: {
      values: [0, 1, 42.5],
    },
  });
});

test("accepts non-empty boolean arrays in presentation objects", () => {
  assertPasses({
    data: {
      values: [true, false],
    },
  });
});

test("accepts null values inside presentation arrays", () => {
  assertPasses({
    data: {
      values: [null],
    },
  });
});

test("accepts arrays of plain objects and empty arrays", () => {
  assertPasses({
    data: {
      emptyValues: [],
      objectValues: [{ id: "one" }, { id: "two" }],
    },
  });
});

test("accepts top-level data arrays of plain objects", () => {
  assertPasses({
    data: [{ id: "ok" }],
  });
});

test("rejects top-level primitive entries in data arrays", () => {
  for (const value of ["x", 1, true, null]) {
    assertPresentationViolation({
      data: [value],
    });
  }
});

test("rejects undefined values inside presentation arrays", () => {
  assertPresentationViolation({
    data: {
      values: [undefined],
    },
  });
});

test("rejects functions, symbols, class instances, and dates inside presentation arrays", () => {
  class UnsafeClass {
    readonly id = "unsafe";
  }

  const invalidValues = [
    () => undefined,
    Symbol("unsafe"),
    new UnsafeClass(),
    new Date(0),
  ];

  for (const value of invalidValues) {
    assertPresentationViolation({
      data: {
        values: [value],
      },
    });
  }
});

test("rejects non-finite numbers inside presentation arrays", () => {
  for (const value of [Number.NaN, Infinity, -Infinity]) {
    assertPresentationViolation({
      data: {
        values: [value],
      },
    });
  }
});

test("keeps invalid object behavior unchanged", () => {
  class UnsafeClass {
    readonly id = "unsafe";
  }

  assertPresentationViolation({
    data: {
      value: new UnsafeClass(),
    },
  });
  assertPresentationViolation({
    data: {
      value: new Date(0),
    },
  });
  assertPresentationViolation({
    data: {
      value: new Map([["id", "unsafe"]]),
    },
  });
});

test("rejects direct nested arrays inside presentation arrays", () => {
  assertPresentationViolation({
    data: {
      values: [["nested"]],
    },
  });
});

test("accepts org unit detail shaped payload with a non-empty ancestor chain", () => {
  assertPasses({
    data: {
      id: "OU-000002",
      code: "OU-000002",
      name: "Smoke Production",
      type: "DEPARTMENT",
      status: "ACTIVE",
      parentOrgUnitId: "OU-000001",
      depth: 1,
      displayOrder: 20,
      description: null,
      externalRef: null,
      createdAt: 1,
      updatedAt: 1,
      hierarchy: {
        id: "OU-000002",
        parentOrgUnitId: "OU-000001",
        depth: 1,
        ancestorChain: ["OU-000001"],
      },
    },
  });
});

test("accepts work pattern list shaped payload with non-empty working days", () => {
  assertPasses({
    data: [
      {
        workPatternId: "WP-000001",
        patternCode: "WP-SMOKE-WEEKDAY",
        name: "Smoke Weekday",
        status: "ACTIVE",
        timezone: "Asia/Ho_Chi_Minh",
        startLocalTime: "09:00",
        endLocalTime: "18:00",
        workingMinutes: 480,
        breakMinutes: 60,
        workingDays: ["MON", "TUE"],
        description: null,
        externalRef: null,
        activatedAt: 1,
        archivedAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
});
