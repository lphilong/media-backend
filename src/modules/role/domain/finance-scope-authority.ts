import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { StructuredScopeAuthorityService } from "./structured-scope-authority";

export interface RequireFinancePeriodAuthorityInput {
  readonly actor: Actor;
  readonly permission: Permission;
  readonly periodMonth: string;
  readonly authority: StructuredScopeAuthorityService;
  readonly error: Error;
}

export async function requireFinancePeriodAuthority(
  input: RequireFinancePeriodAuthorityInput,
): Promise<void> {
  const periodMonth = normalizeFinancePeriodMonth(input.periodMonth);
  if (!input.actor.isActive || !periodMonth) {
    throw input.error;
  }

  const hasPeriodAuthority = await input.authority.hasAuthority({
    userId: input.actor.id,
    permission: input.permission,
    scope: {
      scopeType: "financePeriod",
      periodKey: periodMonth,
    },
    mode: "STRUCTURED_SCOPE_REQUIRED",
  });
  if (hasPeriodAuthority) {
    return;
  }

  const hasGlobalAuthority = await input.authority.hasAuthority({
    userId: input.actor.id,
    permission: input.permission,
    scope: { scopeType: "financeGlobal" },
    mode: "STRUCTURED_SCOPE_REQUIRED",
  });
  if (!hasGlobalAuthority) {
    throw input.error;
  }
}

export async function hasFinanceGlobalAuthority(input: {
  readonly actor: Actor;
  readonly permission: Permission;
  readonly authority: StructuredScopeAuthorityService;
}): Promise<boolean> {
  if (!input.actor.isActive) {
    return false;
  }
  return input.authority.hasAuthority({
    userId: input.actor.id,
    permission: input.permission,
    scope: { scopeType: "financeGlobal" },
    mode: "STRUCTURED_SCOPE_REQUIRED",
  });
}

export function financePeriodMonthFromTimestamp(
  timestamp: number,
): string | null {
  if (!Number.isInteger(timestamp)) {
    return null;
  }
  const date = new Date(timestamp);
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  );
  return `${year}-${month}`;
}

export function financePeriodMonthRange(periodMonth: string):
  | {
      readonly startAt: number;
      readonly endAt: number;
    }
  | null {
  const normalized = normalizeFinancePeriodMonth(periodMonth);
  if (!normalized) {
    return null;
  }
  const [yearPart, monthPart] = normalized.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  return {
    startAt: Date.UTC(year, monthIndex, 1),
    endAt: Date.UTC(year, monthIndex + 1, 1),
  };
}

export function normalizeFinancePeriodMonth(
  value: string,
): string | null {
  const normalized = value.trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(normalized)) {
    return null;
  }
  return normalized;
}
