import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export function buildEmploymentTermsCodePolicy(bucket: string): BusinessCodePolicy {
  return Object.freeze({
    moduleKey: "employment-terms",
    bucket,
    prefix: `ET-${bucket}`,
    width: 6,
  });
}
