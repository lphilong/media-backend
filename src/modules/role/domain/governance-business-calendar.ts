export const GOVERNANCE_TIME_ZONE = "Asia/Ho_Chi_Minh";
const HO_CHI_MINH_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface GovernanceBusinessCalendar {
  readonly version: string;
  readonly holidayDates: ReadonlySet<string>;
}

export interface FrozenGovernanceReviewDeadline {
  readonly calendarVersion: string;
  readonly timeZone: typeof GOVERNANCE_TIME_ZONE;
  readonly dueAt: number;
}

export function buildGovernanceBusinessCalendar(input: {
  readonly version: string | null | undefined;
  readonly holidayDates: string | null | undefined;
}): GovernanceBusinessCalendar {
  const version = input.version?.trim() ?? "";
  if (!version || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(version)) {
    throw new Error("INVALID_CALENDAR_VERSION");
  }
  const rawDates = input.holidayDates?.trim() ?? "";
  if (!rawDates) throw new Error("GOVERNANCE_HOLIDAY_DATES_REQUIRED");
  const holidayDates = new Set(
    rawDates.split(",").map((value) => validateDateKey(value.trim())),
  );
  return { version, holidayDates };
}

export function nextGovernanceReviewDeadline(
  activationEndsAt: number,
  calendar: GovernanceBusinessCalendar,
): FrozenGovernanceReviewDeadline {
  if (!Number.isFinite(activationEndsAt) || activationEndsAt < 0) {
    throw new Error("INVALID_ACTIVATION_END");
  }
  if (!calendar.version.trim()) throw new Error("INVALID_CALENDAR_VERSION");
  for (const holidayDate of calendar.holidayDates) validateDateKey(holidayDate);

  const local = new Date(activationEndsAt + HO_CHI_MINH_OFFSET_MS);
  let localMidnightUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  for (let dayOffset = 1; dayOffset <= 370; dayOffset += 1) {
    localMidnightUtc += DAY_MS;
    const candidate = new Date(localMidnightUtc);
    const day = candidate.getUTCDay();
    const dateKey = toDateKey(candidate);
    if (day !== 0 && day !== 6 && !calendar.holidayDates.has(dateKey)) {
      return {
        calendarVersion: calendar.version,
        timeZone: GOVERNANCE_TIME_ZONE,
        dueAt: localMidnightUtc + 17 * 60 * 60 * 1000 - HO_CHI_MINH_OFFSET_MS,
      };
    }
  }
  throw new Error("BUSINESS_CALENDAR_UNRESOLVABLE");
}

export function failClosedGovernanceReviewDeadline(
  activationEndsAt: number,
  calendar: GovernanceBusinessCalendar,
): FrozenGovernanceReviewDeadline {
  try {
    return nextGovernanceReviewDeadline(activationEndsAt, calendar);
  } catch {
    return {
      calendarVersion: calendar.version.trim() || "UNRESOLVED",
      timeZone: GOVERNANCE_TIME_ZONE,
      dueAt: activationEndsAt,
    };
  }
}

function toDateKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validateDateKey(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("INVALID_GOVERNANCE_HOLIDAY_DATE");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("INVALID_GOVERNANCE_HOLIDAY_DATE");
  }
  return value;
}
