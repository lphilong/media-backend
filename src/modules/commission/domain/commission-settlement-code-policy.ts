import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export function buildCommissionSettlementCodePolicy(
  bucket: string,
): BusinessCodePolicy {
  return Object.freeze({
    moduleKey: "commission-settlement",
    bucket,
    prefix: `CS-${bucket}`,
    width: 6,
  });
}
