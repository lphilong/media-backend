import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  TALENT_GROUP_CREATED_AT_INDEX_NAME,
  TALENT_GROUP_DISPLAY_ORDER_NAME_INDEX_NAME,
  TALENT_GROUP_GROUP_CODE_UNIQ_INDEX_NAME,
  TALENT_GROUP_MEMBER_GROUP_LINEUP_UNIQ_INDEX_NAME,
  TALENT_GROUP_MEMBER_GROUP_STATUS_LINEUP_INDEX_NAME,
  TALENT_GROUP_MEMBER_GROUP_TALENT_UNIQ_INDEX_NAME,
  TALENT_GROUP_MEMBER_TALENT_STATUS_INDEX_NAME,
  TALENT_GROUP_NAME_INDEX_NAME,
  TALENT_GROUP_NORMALIZED_NAME_UNIQ_INDEX_NAME,
  TALENT_GROUP_NORMALIZED_SHORT_NAME_INDEX_NAME,
  TALENT_GROUP_STATUS_DISPLAY_ORDER_NAME_INDEX_NAME,
  TALENT_GROUP_STATUS_INDEX_NAME,
  initTalentGroupIndexes,
} from "@infra/mongo/talent-group/talent-group.index";
import { registerPresenters } from "./talent-group.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createTalentGroupBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "talent-group",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initTalentGroupIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "talent_groups",
        TALENT_GROUP_GROUP_CODE_UNIQ_INDEX_NAME,
        {
          groupCode: 1,
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "talent_groups",
        TALENT_GROUP_NORMALIZED_NAME_UNIQ_INDEX_NAME,
        {
          normalizedName: 1,
        },
        {
          status: {
            $in: ["ACTIVE", "INACTIVE"],
          },
        },
      );

      await assertRequiredIndex(
        db,
        "talent_groups",
        TALENT_GROUP_STATUS_INDEX_NAME,
        {
          status: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "talent_groups",
        TALENT_GROUP_NORMALIZED_SHORT_NAME_INDEX_NAME,
        {
          normalizedShortName: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "talent_groups",
        TALENT_GROUP_STATUS_DISPLAY_ORDER_NAME_INDEX_NAME,
        {
          status: 1,
          displayOrder: 1,
          name: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "talent_groups",
        TALENT_GROUP_DISPLAY_ORDER_NAME_INDEX_NAME,
        {
          displayOrder: 1,
          name: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "talent_groups",
        TALENT_GROUP_NAME_INDEX_NAME,
        {
          name: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "talent_groups",
        TALENT_GROUP_CREATED_AT_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "talent_group_members",
        TALENT_GROUP_MEMBER_GROUP_TALENT_UNIQ_INDEX_NAME,
        {
          groupId: 1,
          talentId: 1,
        },
        {
          membershipStatus: {
            $in: ["ACTIVE", "INACTIVE"],
          },
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "talent_group_members",
        TALENT_GROUP_MEMBER_GROUP_LINEUP_UNIQ_INDEX_NAME,
        {
          groupId: 1,
          lineupOrder: 1,
        },
        {
          membershipStatus: {
            $in: ["ACTIVE", "INACTIVE"],
          },
        },
      );

      await assertRequiredIndex(
        db,
        "talent_group_members",
        TALENT_GROUP_MEMBER_GROUP_STATUS_LINEUP_INDEX_NAME,
        {
          groupId: 1,
          membershipStatus: 1,
          lineupOrder: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "talent_group_members",
        TALENT_GROUP_MEMBER_TALENT_STATUS_INDEX_NAME,
        {
          talentId: 1,
          membershipStatus: 1,
        },
      );
    },
  });
}

async function assertRequiredUniqueIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
): Promise<void> {
  const matched = await assertRequiredIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
  );

  if (matched.unique !== true) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} must be unique`,
    );
  }
}

async function assertRequiredUniquePartialIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
  expectedPartialFilterExpression: Record<
    string,
    unknown
  >,
): Promise<void> {
  const matched = await assertRequiredIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
  );

  if (matched.unique !== true) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} must be unique`,
    );
  }

  if (
    !hasDeepExactShape(
      matched.partialFilterExpression,
      expectedPartialFilterExpression,
    )
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid partialFilterExpression`,
    );
  }
}

async function assertRequiredIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
): Promise<IndexMetadata> {
  const indexes = await db
    .collection(collectionName)
    .indexes();

  const matched = indexes.find((index) => {
    const name =
      typeof index.name === "string"
        ? index.name
        : undefined;

    return name === indexName;
  });

  if (!matched) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} missing on ${collectionName}`,
    );
  }

  if (!hasDeepExactShape(matched.key, expectedKey)) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid key shape`,
    );
  }

  return matched as IndexMetadata;
}

function hasDeepExactShape(
  candidate: unknown,
  expected: unknown,
): boolean {
  if (Object.is(candidate, expected)) {
    return true;
  }

  if (
    Array.isArray(candidate) &&
    Array.isArray(expected)
  ) {
    if (candidate.length !== expected.length) {
      return false;
    }

    for (let index = 0; index < candidate.length; index += 1) {
      if (
        !hasDeepExactShape(
          candidate[index],
          expected[index],
        )
      ) {
        return false;
      }
    }

    return true;
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof expected !== "object" ||
    expected === null
  ) {
    return false;
  }

  const candidateRecord = candidate as Record<
    string,
    unknown
  >;
  const expectedRecord = expected as Record<
    string,
    unknown
  >;
  const expectedKeys = Object.keys(expectedRecord);

  if (
    Object.keys(candidateRecord).length !==
    expectedKeys.length
  ) {
    return false;
  }

  for (const key of expectedKeys) {
    if (
      !hasDeepExactShape(
        candidateRecord[key],
        expectedRecord[key],
      )
    ) {
      return false;
    }
  }

  return true;
}
