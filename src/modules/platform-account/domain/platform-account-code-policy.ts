import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export const PLATFORM_ACCOUNT_CODE_POLICY: BusinessCodePolicy =
  Object.freeze({
    moduleKey: "platform-account",
    bucket: "global",
    prefix: "PA",
    width: 6,
  });
