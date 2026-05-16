import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export function buildContractRegistryCodePolicy(
  bucket: string,
): BusinessCodePolicy {
  return Object.freeze({
    moduleKey: "contract-registry",
    bucket,
    prefix: `CON-${bucket}`,
    width: 6,
  });
}
