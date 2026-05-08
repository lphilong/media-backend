import {
  Collection,
  Db,
} from "mongodb";

export const CONTRACT_RECORD_CONTRACT_CODE_UNIQ_INDEX_NAME =
  "uniq_contract_record_contract_code";
export const CONTRACT_RECORD_NORMALIZED_CONTRACT_CODE_INDEX_NAME =
  "idx_contract_record_normalized_contract_code";
export const CONTRACT_RECORD_NORMALIZED_TITLE_INDEX_NAME =
  "idx_contract_record_normalized_title";
export const CONTRACT_RECORD_STATUS_EFFECTIVE_WINDOW_INDEX_NAME =
  "idx_contract_record_status_effective_window";
export const CONTRACT_RECORD_CONTRACT_KIND_LINKED_ENTITY_KIND_STATUS_INDEX_NAME =
  "idx_contract_record_contract_kind_linked_entity_kind_status";
export const CONTRACT_RECORD_OWNER_EMPLOYMENT_PROFILE_ID_INDEX_NAME =
  "idx_contract_record_owner_employment_profile_id";
export const CONTRACT_RECORD_LINKED_EMPLOYMENT_PROFILE_STATUS_EFFECTIVE_START_INDEX_NAME =
  "idx_contract_record_linked_employment_profile_status_effective_start";
export const CONTRACT_RECORD_LINKED_TALENT_STATUS_EFFECTIVE_START_INDEX_NAME =
  "idx_contract_record_linked_talent_status_effective_start";
export const CONTRACT_RECORD_CONFIDENTIALITY_TIER_STATUS_INDEX_NAME =
  "idx_contract_record_confidentiality_tier_status";
export const CONTRACT_RECORD_STATUS_FILE_REFERENCE_ID_INDEX_NAME =
  "idx_contract_record_status_file_reference_id";
export const CONTRACT_RECORD_CREATED_AT_ID_INDEX_NAME =
  "idx_contract_record_created_at";

interface ContractRecordLegacyDocument {
  readonly _id: string;
  readonly contractCode?: unknown;
  readonly title?: unknown;
}

export async function initContractRegistryIndexes(
  db: Db,
): Promise<void> {
  const collection =
    db.collection<ContractRecordLegacyDocument>(
      "contract_records",
    );

  await backfillNormalizedSearchFields(collection);

  await collection.createIndex(
    {
      contractCode: 1,
    },
    {
      name:
        CONTRACT_RECORD_CONTRACT_CODE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    {
      normalizedContractCode: 1,
      _id: 1,
    },
    {
      name:
        CONTRACT_RECORD_NORMALIZED_CONTRACT_CODE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedTitle: 1,
      _id: 1,
    },
    {
      name:
        CONTRACT_RECORD_NORMALIZED_TITLE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      status: 1,
      effectiveStartDate: 1,
      effectiveEndDate: 1,
    },
    {
      name:
        CONTRACT_RECORD_STATUS_EFFECTIVE_WINDOW_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      contractKind: 1,
      linkedEntityKind: 1,
      status: 1,
    },
    {
      name:
        CONTRACT_RECORD_CONTRACT_KIND_LINKED_ENTITY_KIND_STATUS_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      ownerEmploymentProfileId: 1,
    },
    {
      name:
        CONTRACT_RECORD_OWNER_EMPLOYMENT_PROFILE_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      linkedEmploymentProfileId: 1,
      status: 1,
      effectiveStartDate: 1,
    },
    {
      name:
        CONTRACT_RECORD_LINKED_EMPLOYMENT_PROFILE_STATUS_EFFECTIVE_START_INDEX_NAME,
      partialFilterExpression: {
        linkedEmploymentProfileId: {
          $ne: null,
        },
      },
    },
  );

  await collection.createIndex(
    {
      linkedTalentId: 1,
      status: 1,
      effectiveStartDate: 1,
    },
    {
      name:
        CONTRACT_RECORD_LINKED_TALENT_STATUS_EFFECTIVE_START_INDEX_NAME,
      partialFilterExpression: {
        linkedTalentId: {
          $ne: null,
        },
      },
    },
  );

  await collection.createIndex(
    {
      confidentialityTier: 1,
      status: 1,
    },
    {
      name:
        CONTRACT_RECORD_CONFIDENTIALITY_TIER_STATUS_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      status: 1,
      fileReferenceId: 1,
    },
    {
      name:
        CONTRACT_RECORD_STATUS_FILE_REFERENCE_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name: CONTRACT_RECORD_CREATED_AT_ID_INDEX_NAME,
    },
  );
}

async function backfillNormalizedSearchFields(
  collection: Collection<ContractRecordLegacyDocument>,
): Promise<void> {
  const cursor = collection.find(
    {
      $or: [
        {
          normalizedContractCode: {
            $exists: false,
          },
        },
        {
          normalizedTitle: {
            $exists: false,
          },
        },
      ],
    },
    {
      projection: {
        _id: 1,
        contractCode: 1,
        title: 1,
      },
    },
  );
  const operations: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: {
        $set: Record<string, unknown>;
      };
    };
  }> = [];

  for await (const document of cursor) {
    const contractCode =
      typeof document.contractCode === "string"
        ? document.contractCode
        : "";
    const title =
      typeof document.title === "string"
        ? document.title
        : "";

    operations.push({
      updateOne: {
        filter: { _id: document._id },
        update: {
          $set: {
            normalizedContractCode:
              canonicalizeContractSearchToken(
                contractCode,
              ),
            normalizedTitle:
              canonicalizeContractSearchToken(
                title,
              ),
          },
        },
      },
    });

    if (operations.length >= 500) {
      await collection.bulkWrite(operations, {
        ordered: true,
      });
      operations.length = 0;
    }
  }

  if (operations.length > 0) {
    await collection.bulkWrite(operations, {
      ordered: true,
    });
  }
}

function canonicalizeContractSearchToken(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
