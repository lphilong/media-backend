import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  EMPLOYMENT_PROFILE_CONTRACT_STATUS_INDEX_NAME,
  EMPLOYMENT_PROFILE_CREATED_AT_INDEX_NAME,
  EMPLOYMENT_PROFILE_DISPLAY_NAME_INDEX_NAME,
  EMPLOYMENT_PROFILE_DIRECT_REPORT_INDEX_NAME,
  EMPLOYMENT_PROFILE_EMPLOYEE_CODE_INDEX_NAME,
  EMPLOYMENT_PROFILE_LEGAL_NAME_INDEX_NAME,
  EMPLOYMENT_PROFILE_LINKED_USER_UNIQ_INDEX_NAME,
  EMPLOYMENT_PROFILE_MANAGER_INDEX_NAME,
  EMPLOYMENT_PROFILE_NORMALIZED_DISPLAY_NAME_INDEX_NAME,
  EMPLOYMENT_PROFILE_NORMALIZED_LEGAL_NAME_INDEX_NAME,
  EMPLOYMENT_PROFILE_ORG_STATUS_EMPLOYEE_CODE_INDEX_NAME,
  EMPLOYMENT_PROFILE_ORG_UNIT_INDEX_NAME,
  initEmploymentProfileIndexes,
} from "@infra/mongo/employment-profile/employment-profile.index";
import { registerPresenters } from "./employment-profile.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createEmploymentProfileBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "employment-profile",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initEmploymentProfileIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_EMPLOYEE_CODE_INDEX_NAME,
        {
          employeeCode: 1,
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_LINKED_USER_UNIQ_INDEX_NAME,
        {
          linkedUserId: 1,
        },
        {
          linkedUserId: {
            $type: "string",
          },
          employmentStatus: {
            $in: [
              "ACTIVE",
              "ON_LEAVE",
              "SUSPENDED",
              "TERMINATED",
            ],
          },
        },
      );

      await assertRequiredIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_ORG_UNIT_INDEX_NAME,
        {
          orgUnitId: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_MANAGER_INDEX_NAME,
        {
          managerEmploymentProfileId: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_CONTRACT_STATUS_INDEX_NAME,
        {
          employmentStatus: 1,
          contractStatus: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_ORG_STATUS_EMPLOYEE_CODE_INDEX_NAME,
        {
          orgUnitId: 1,
          employmentStatus: 1,
          employeeCode: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_NORMALIZED_LEGAL_NAME_INDEX_NAME,
        {
          normalizedLegalName: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_NORMALIZED_DISPLAY_NAME_INDEX_NAME,
        {
          normalizedDisplayName: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_LEGAL_NAME_INDEX_NAME,
        {
          legalName: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_DISPLAY_NAME_INDEX_NAME,
        {
          displayName: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_CREATED_AT_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "employment_profiles",
        EMPLOYMENT_PROFILE_DIRECT_REPORT_INDEX_NAME,
        {
          managerEmploymentProfileId: 1,
          employmentStatus: 1,
          employeeCode: 1,
          _id: 1,
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

    return candidate.every((entry, index) =>
      hasDeepExactShape(entry, expected[index]),
    );
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof expected !== "object" ||
    expected === null ||
    Array.isArray(candidate) ||
    Array.isArray(expected)
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

  return expectedKeys.every((key) =>
    hasDeepExactShape(
      candidateRecord[key],
      expectedRecord[key],
    ),
  );
}
