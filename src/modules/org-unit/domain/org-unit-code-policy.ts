import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export const ORG_UNIT_CODE_POLICY: BusinessCodePolicy =
  Object.freeze({
    moduleKey: "org-unit",
    bucket: "global",
    prefix: "OU",
    width: 6,
  });
