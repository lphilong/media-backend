import { Db } from "mongodb";

export const BUSINESS_CODE_SEQUENCE_COLLECTION =
  "business_code_sequences";
export const BUSINESS_CODE_SEQUENCE_MODULE_BUCKET_INDEX_NAME =
  "uniq_business_code_sequence_module_bucket";

export async function initBusinessCodeSequenceIndexes(
  db: Db,
): Promise<void> {
  await db
    .collection(BUSINESS_CODE_SEQUENCE_COLLECTION)
    .createIndex(
      {
        module: 1,
        bucket: 1,
      },
      {
        name: BUSINESS_CODE_SEQUENCE_MODULE_BUCKET_INDEX_NAME,
        unique: true,
      },
    );
}
