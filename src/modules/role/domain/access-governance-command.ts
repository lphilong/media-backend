import { RoleValidationError } from "./role.errors";

export const ACCESS_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type AccessDecision = (typeof ACCESS_DECISIONS)[number];

export const BREAK_GLASS_URGENCIES = ["URGENT", "NON_URGENT"] as const;
export type StrictBreakGlassUrgency =
  (typeof BREAK_GLASS_URGENCIES)[number];

export const BREAK_GLASS_REVIEW_RESULTS = [
  "APPROVED_USE",
  "MISUSE_FOUND",
] as const;
export type StrictBreakGlassReviewResult =
  (typeof BREAK_GLASS_REVIEW_RESULTS)[number];

export const ACCESS_SUCCESSOR_ACTIONS = [
  "RENEWAL",
  "REPLACEMENT",
  "RESTORATION",
] as const;
export type AccessSuccessorAction =
  (typeof ACCESS_SUCCESSOR_ACTIONS)[number];

function parseExactValue<T extends string>(params: {
  readonly value: unknown;
  readonly field: string;
  readonly allowed: readonly T[];
}): T {
  if (
    typeof params.value !== "string" ||
    !params.allowed.includes(params.value as T)
  ) {
    throw new RoleValidationError(
      `${params.field} must be exactly one of: ${params.allowed.join(", ")}`,
    );
  }

  return params.value as T;
}

export function parseAccessDecision(
  value: unknown,
  field = "decision",
): AccessDecision {
  return parseExactValue({ value, field, allowed: ACCESS_DECISIONS });
}

export function parseBreakGlassUrgency(
  value: unknown,
): StrictBreakGlassUrgency {
  return parseExactValue({
    value,
    field: "urgency",
    allowed: BREAK_GLASS_URGENCIES,
  });
}

export function parseBreakGlassReviewResult(
  value: unknown,
): StrictBreakGlassReviewResult {
  return parseExactValue({
    value,
    field: "result",
    allowed: BREAK_GLASS_REVIEW_RESULTS,
  });
}

export function parseAccessSuccessorAction(
  value: unknown,
): AccessSuccessorAction {
  return parseExactValue({
    value,
    field: "action",
    allowed: ACCESS_SUCCESSOR_ACTIONS,
  });
}
