import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export const COMMISSION_RULE_CODE_POLICY: BusinessCodePolicy =
  Object.freeze({
    moduleKey: "commission-rule",
    bucket: "global",
    prefix: "CRULE",
    width: 6,
  });
