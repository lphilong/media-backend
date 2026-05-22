import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export const ROLE_CODE_POLICY: BusinessCodePolicy = Object.freeze({
  moduleKey: "role",
  bucket: "global",
  prefix: "ROLE",
  width: 6,
});
