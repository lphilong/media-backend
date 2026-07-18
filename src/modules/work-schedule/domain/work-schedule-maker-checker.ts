import { WorkSchedulePermissionScopeError } from "./work-schedule.errors";

const CANONICAL_USER_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]+$/u;

export function assertWorkScheduleMakerCheckerSeparation(
  makerUserId: unknown,
  checkerUserId: unknown,
): asserts makerUserId is string {
  if (!isUsableCanonicalUserId(makerUserId)) {
    throw new WorkSchedulePermissionScopeError(
      "WorkSchedule maker identity is unavailable for checker decision",
    );
  }
  if (!isUsableCanonicalUserId(checkerUserId)) {
    throw new WorkSchedulePermissionScopeError(
      "WorkSchedule checker identity is unavailable for controlled decision",
    );
  }
  if (makerUserId === checkerUserId) {
    throw new WorkSchedulePermissionScopeError(
      "WorkSchedule maker cannot perform a checker decision on the same operation",
    );
  }
}

function isUsableCanonicalUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    CANONICAL_USER_ID_PATTERN.test(value)
  );
}
