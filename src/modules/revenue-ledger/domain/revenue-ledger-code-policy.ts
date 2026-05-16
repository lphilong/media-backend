import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export function buildRevenueLedgerCodePolicy(
  bucket: string,
): BusinessCodePolicy {
  return Object.freeze({
    moduleKey: "revenue-ledger",
    bucket,
    prefix: `REV-${bucket}`,
    width: 6,
  });
}
