import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export const TALENT_GROUP_CODE_POLICY: BusinessCodePolicy =
  Object.freeze({
    moduleKey: "talent-group",
    bucket: "global",
    prefix: "TG",
    width: 6,
  });
