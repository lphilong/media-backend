import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export const TALENT_CODE_POLICY: BusinessCodePolicy =
  Object.freeze({
    moduleKey: "talent",
    bucket: "global",
    prefix: "TAL",
    width: 6,
  });
