import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  CONTRACT_RECORD_CONFIDENTIALITY_TIER_STATUS_INDEX_NAME,
  CONTRACT_RECORD_CONTRACT_CODE_UNIQ_INDEX_NAME,
  CONTRACT_RECORD_CONTRACT_KIND_LINKED_ENTITY_KIND_STATUS_INDEX_NAME,
  CONTRACT_RECORD_CREATED_AT_ID_INDEX_NAME,
  CONTRACT_RECORD_LINKED_EMPLOYMENT_PROFILE_STATUS_EFFECTIVE_START_INDEX_NAME,
  CONTRACT_RECORD_LINKED_TALENT_STATUS_EFFECTIVE_START_INDEX_NAME,
  CONTRACT_RECORD_NORMALIZED_CONTRACT_CODE_INDEX_NAME,
  CONTRACT_RECORD_NORMALIZED_TITLE_INDEX_NAME,
  CONTRACT_RECORD_OWNER_EMPLOYMENT_PROFILE_ID_INDEX_NAME,
  CONTRACT_RECORD_STATUS_EFFECTIVE_WINDOW_INDEX_NAME,
  CONTRACT_RECORD_STATUS_FILE_REFERENCE_ID_INDEX_NAME,
  CONTRACT_OBLIGATION_CODE_UNIQ_INDEX_NAME,
  CONTRACT_OBLIGATION_CONTRACT_STATUS_CREATED_INDEX_NAME,
  CONTRACT_OBLIGATION_DUE_DATE_INDEX_NAME,
  CONTRACT_OBLIGATION_RESPONSIBLE_OWNER_INDEX_NAME,
  CONTRACT_OBLIGATION_STATUS_TYPE_INDEX_NAME,
  initContractRegistryIndexes,
} from "@infra/mongo/contract-registry/contract-registry.index";
import { registerPresenters } from "./contract-registry.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createContractRegistryBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "contract-registry",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initContractRegistryIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "contract_records",
        CONTRACT_RECORD_CONTRACT_CODE_UNIQ_INDEX_NAME,
        {
          contractCode: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "contract_records",
        CONTRACT_RECORD_NORMALIZED_CONTRACT_CODE_INDEX_NAME,
        {
          normalizedContractCode: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "contract_records",
        CONTRACT_RECORD_NORMALIZED_TITLE_INDEX_NAME,
        {
          normalizedTitle: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "contract_records",
        CONTRACT_RECORD_STATUS_EFFECTIVE_WINDOW_INDEX_NAME,
        {
          status: 1,
          effectiveStartDate: 1,
          effectiveEndDate: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "contract_records",
        CONTRACT_RECORD_CONTRACT_KIND_LINKED_ENTITY_KIND_STATUS_INDEX_NAME,
        {
          contractKind: 1,
          linkedEntityKind: 1,
          status: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "contract_records",
        CONTRACT_RECORD_OWNER_EMPLOYMENT_PROFILE_ID_INDEX_NAME,
        {
          ownerEmploymentProfileId: 1,
        },
      );

      await assertRequiredPartialIndex(
        db,
        "contract_records",
        CONTRACT_RECORD_LINKED_EMPLOYMENT_PROFILE_STATUS_EFFECTIVE_START_INDEX_NAME,
        {
          linkedEmploymentProfileId: 1,
          status: 1,
          effectiveStartDate: 1,
        },
        {
          linkedEmploymentProfileId: {
            $type: "string",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "contract_records",
        CONTRACT_RECORD_LINKED_TALENT_STATUS_EFFECTIVE_START_INDEX_NAME,
        {
          linkedTalentId: 1,
          status: 1,
          effectiveStartDate: 1,
        },
        {
          linkedTalentId: {
            $type: "string",
          },
        },
      );

      await assertRequiredIndex(
        db,
        "contract_records",
        CONTRACT_RECORD_CONFIDENTIALITY_TIER_STATUS_INDEX_NAME,
        {
          confidentialityTier: 1,
          status: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "contract_records",
        CONTRACT_RECORD_STATUS_FILE_REFERENCE_ID_INDEX_NAME,
        {
          status: 1,
          fileReferenceId: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "contract_records",
        CONTRACT_RECORD_CREATED_AT_ID_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
      );

      await assertRequiredUniqueIndex(
        db,
        "contract_obligations",
        CONTRACT_OBLIGATION_CODE_UNIQ_INDEX_NAME,
        { code: 1 },
      );
      await assertRequiredIndex(
        db,
        "contract_obligations",
        CONTRACT_OBLIGATION_CONTRACT_STATUS_CREATED_INDEX_NAME,
        {
          contractRecordId: 1,
          status: 1,
          createdAt: -1,
          _id: 1,
        },
      );
      await assertRequiredIndex(
        db,
        "contract_obligations",
        CONTRACT_OBLIGATION_STATUS_TYPE_INDEX_NAME,
        { status: 1, obligationType: 1 },
      );
      await assertRequiredIndex(
        db,
        "contract_obligations",
        CONTRACT_OBLIGATION_RESPONSIBLE_OWNER_INDEX_NAME,
        { responsibleOwnerEmploymentProfileId: 1 },
      );
      await assertRequiredIndex(
        db,
        "contract_obligations",
        CONTRACT_OBLIGATION_DUE_DATE_INDEX_NAME,
        { dueDate: 1 },
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

async function assertRequiredPartialIndex(
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
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof expected !== "object" ||
    expected === null
  ) {
    return Object.is(candidate, expected);
  }

  if (
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
  const candidateKeys = Object.keys(candidateRecord);
  const expectedKeys = Object.keys(expectedRecord);

  if (candidateKeys.length !== expectedKeys.length) {
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
