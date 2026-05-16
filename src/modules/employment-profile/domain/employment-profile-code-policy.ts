import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export const EMPLOYMENT_PROFILE_CODE_POLICY: BusinessCodePolicy =
  Object.freeze({
    moduleKey: "employment-profile",
    bucket: "global",
    prefix: "EP",
    width: 6,
  });
