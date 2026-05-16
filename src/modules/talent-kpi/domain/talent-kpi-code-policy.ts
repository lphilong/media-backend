import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export function buildTalentKpiCodePolicy(
  bucket: string,
): BusinessCodePolicy {
  return Object.freeze({
    moduleKey: "talent-kpi",
    bucket,
    prefix: `KPI-${bucket}`,
    width: 6,
  });
}
