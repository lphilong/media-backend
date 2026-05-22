import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export const KPI_PLAN_CODE_POLICY: BusinessCodePolicy =
  Object.freeze({
    moduleKey: "kpi",
    bucket: "global",
    prefix: "KPI",
    width: 6,
  });
