import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";

export function buildEventAssignmentCodePolicy(
  bucket: string,
): BusinessCodePolicy {
  return Object.freeze({
    moduleKey: "event-assignment",
    bucket,
    prefix: `EVT-${bucket}`,
    width: 6,
  });
}
