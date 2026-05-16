import assert from "node:assert/strict";
import { test } from "node:test";
import { getBootstrapRegistrars } from "@bootstrap/module-registrar";

const UNSUPPORTED_PARTIAL_INDEX_OPERATORS = new Set([
  "$ne",
  "$not",
  "$nin",
  "$nor",
]);

interface CapturedIndex {
  readonly moduleName: string;
  readonly collectionName: string;
  readonly indexName: string;
  readonly partialFilterExpression?: unknown;
}

test("registered Mongo index specs do not use unsupported partialFilterExpression operators", async () => {
  const capturedIndexes: CapturedIndex[] = [];

  for (const registrar of getBootstrapRegistrars()) {
    if (!registrar.initIndexes) {
      continue;
    }

    await registrar.initIndexes(
      createIndexCaptureDb(
        registrar.name,
        capturedIndexes,
      ) as never,
    );
  }

  const violations = capturedIndexes.flatMap((index) =>
    findUnsupportedOperators(
      index.partialFilterExpression,
    ).map((operator) => ({
      ...index,
      operator,
    })),
  );

  assert.deepEqual(
    violations,
    [],
    violations
      .map(
        (violation) =>
          `${violation.moduleName}:${violation.collectionName}:${violation.indexName} uses ${violation.operator}`,
      )
      .join("\n"),
  );
});

function createIndexCaptureDb(
  moduleName: string,
  capturedIndexes: CapturedIndex[],
) {
  const indexesByCollection = new Map<
    string,
    Array<{
      name: string;
      key: Record<string, number>;
      unique?: boolean;
      partialFilterExpression?: unknown;
    }>
  >();

  function collection(collectionName: string) {
    const indexes =
      indexesByCollection.get(collectionName) ?? [];
    indexesByCollection.set(collectionName, indexes);

    return {
      async createIndex(
        key: Record<string, number>,
        options: {
          name?: string;
          unique?: boolean;
          partialFilterExpression?: unknown;
        } = {},
      ) {
        const indexName =
          options.name ??
          Object.keys(key)
            .map((field) => `${field}_1`)
            .join("_");

        indexes.push({
          name: indexName,
          key,
          unique: options.unique,
          partialFilterExpression:
            options.partialFilterExpression,
        });
        capturedIndexes.push({
          moduleName,
          collectionName,
          indexName,
          partialFilterExpression:
            options.partialFilterExpression,
        });

        return indexName;
      },
      async indexes() {
        return indexes;
      },
      find() {
        return {
          async *[Symbol.asyncIterator]() {},
          sort() {
            return this;
          },
          limit() {
            return this;
          },
          async next() {
            return null;
          },
          async toArray() {
            return [];
          },
        };
      },
      async updateMany() {},
      async bulkWrite() {},
    };
  }

  return {
    collection,
    listCollections() {
      return {
        async hasNext() {
          return false;
        },
      };
    },
    async createCollection(collectionName: string) {
      return collection(collectionName);
    },
    async command() {},
  };
}

function findUnsupportedOperators(
  value: unknown,
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      findUnsupportedOperators(entry),
    );
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  const violations: string[] = [];

  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (UNSUPPORTED_PARTIAL_INDEX_OPERATORS.has(key)) {
      violations.push(key);
    }

    violations.push(
      ...findUnsupportedOperators(nested),
    );
  }

  return violations;
}
