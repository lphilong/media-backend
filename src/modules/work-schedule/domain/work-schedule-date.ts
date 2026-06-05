import { WorkScheduleValidationError } from "./work-schedule.errors";

const VIETNAM_UTC_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1000;

export function normalizeWorkScheduleDateOnly(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `${field} must be a valid date-only YYYY-MM-DD string`,
    );
  }

  const normalized = value.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/u.exec(
      normalized,
    );

  if (!match) {
    throw new WorkScheduleValidationError(
      `${field} must be a valid date-only YYYY-MM-DD string`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(
    Date.UTC(year, month - 1, day),
  );

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new WorkScheduleValidationError(
      `${field} must be a real calendar date`,
    );
  }

  return normalized;
}

export function assertWorkScheduleDateOnlyWithinRosterMonth(
  value: unknown,
  rosterMonth: string,
  options: {
    readonly field: string;
    readonly invalidDateMessage?: string;
    readonly outsideMonthMessage?: string;
  },
): string {
  let normalized: string;

  try {
    normalized = normalizeWorkScheduleDateOnly(
      value,
      options.field,
    );
  } catch (error) {
    if (
      error instanceof WorkScheduleValidationError &&
      options.invalidDateMessage
    ) {
      throw new WorkScheduleValidationError(
        options.invalidDateMessage,
      );
    }

    throw error;
  }

  if (!normalized.startsWith(`${rosterMonth}-`)) {
    throw new WorkScheduleValidationError(
      options.outsideMonthMessage ??
        `${options.field} must be inside rosterMonth`,
    );
  }

  return normalized;
}

export function assertRosterMonthWithinPlanningWindow(
  rosterMonth: string,
  now: number = Date.now(),
): void {
  const currentMonth = toVietnamRosterMonth(now);
  const latestMonth = addRosterMonths(currentMonth, 2);

  if (
    rosterMonth < currentMonth ||
    rosterMonth > latestMonth
  ) {
    throw new WorkScheduleValidationError(
      `rosterMonth must be between current month ${currentMonth} and ${latestMonth}`,
    );
  }
}

function toVietnamRosterMonth(timestamp: number): string {
  const date = new Date(
    timestamp + VIETNAM_UTC_OFFSET_MILLISECONDS,
  );

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addRosterMonths(
  rosterMonth: string,
  monthOffset: number,
): string {
  const [year, month] = rosterMonth.split("-").map(Number);
  const date = new Date(
    Date.UTC(year, month - 1 + monthOffset, 1),
  );

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
