import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export const STUDIO_RESOURCE_CODE_POLICY: BusinessCodePolicy =
  Object.freeze({
    moduleKey: "studio-resource",
    bucket: "global",
    prefix: "SR",
    width: 6,
  });
