import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export function buildContractObligationCodePolicy(
  bucket: string,
): BusinessCodePolicy {
  return Object.freeze({
    moduleKey: "contract-obligation",
    bucket,
    prefix: `OBL-${bucket}`,
    width: 6,
  });
}
