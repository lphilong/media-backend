import { DashboardLiteReadinessError } from "./dashboard-lite.errors";

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ZONE_OFFSET_PATTERN =
  /^GMT(?:(?<sign>[+-])(?<hour>\d{1,2})(?::?(?<minute>\d{2}))?)?$/;
const ZERO_OFFSET_TOKENS = new Set([
  "GMT",
  "UTC",
  "GMT+0",
  "GMT-0",
  "GMT+00",
  "GMT-00",
  "GMT+0000",
  "GMT-0000",
  "GMT+00:00",
  "GMT-00:00",
]);

interface CalendarDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface LocalDateTimeParts extends CalendarDateParts {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export interface DashboardLiteWindowSnapshot {
  readonly generatedAt: number;
  readonly businessTimeZone: string;
  readonly businessDate: string;
  readonly todayWindowStartAt: number;
  readonly todayWindowEndAt: number;
  readonly next7DayWindowEndAt: number;
  readonly trailing30DayWindowStartAt: number;
  readonly staleDraftThresholdAt: number;
  readonly expiringContractWindowStartDate: number;
  readonly expiringContractWindowEndDate: number;
}

export function assertValidBusinessTimeZone(
  value: string,
): void {
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).format(new Date(0));
  } catch {
    throw new DashboardLiteReadinessError(
      `Unsupported admin business timezone: ${value}`,
    );
  }
}

export function createDashboardLiteWindowSnapshot(
  generatedAt: number,
  businessTimeZone: string,
): DashboardLiteWindowSnapshot {
  assertValidBusinessTimeZone(businessTimeZone);

  const businessDateParts =
    toLocalDateParts(generatedAt, businessTimeZone);
  const nextBusinessDayParts = addCalendarDays(
    businessDateParts,
    1,
  );
  const next7DayParts = addCalendarDays(
    businessDateParts,
    7,
  );
  const expiryEndDateParts = addCalendarDays(
    businessDateParts,
    30,
  );

  return {
    generatedAt,
    businessTimeZone,
    businessDate:
      toCanonicalCalendarDateString(businessDateParts),
    todayWindowStartAt:
      toUtcTimestampForLocalMidnight(
        businessDateParts,
        businessTimeZone,
      ),
    todayWindowEndAt: toUtcTimestampForLocalMidnight(
      nextBusinessDayParts,
      businessTimeZone,
    ),
    next7DayWindowEndAt:
      toUtcTimestampForLocalMidnight(
        next7DayParts,
        businessTimeZone,
      ),
    trailing30DayWindowStartAt:
      generatedAt - 30 * DAY_MS,
    staleDraftThresholdAt:
      generatedAt - 7 * DAY_MS,
    expiringContractWindowStartDate:
      toUtcCalendarDateTimestamp(businessDateParts),
    expiringContractWindowEndDate:
      toUtcCalendarDateTimestamp(expiryEndDateParts),
  };
}

function toLocalDateParts(
  timestamp: number,
  timeZone: string,
): CalendarDateParts {
  const formatter = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  );
  const parts = formatter.formatToParts(
    new Date(timestamp),
  );

  return {
    year: readPart(parts, "year", timeZone),
    month: readPart(parts, "month", timeZone),
    day: readPart(parts, "day", timeZone),
  };
}

function toLocalDateTimeParts(
  timestamp: number,
  timeZone: string,
): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      hourCycle: "h23",
    },
  );
  const parts = formatter.formatToParts(
    new Date(timestamp),
  );

  return {
    year: readPart(parts, "year", timeZone),
    month: readPart(parts, "month", timeZone),
    day: readPart(parts, "day", timeZone),
    hour: readHourPart(parts, timeZone),
    minute: readPart(parts, "minute", timeZone),
    second: readPart(parts, "second", timeZone),
  };
}

export function toDashboardLiteUtcDateOnlyString(
  timestamp: number,
): string {
  if (!Number.isFinite(timestamp)) {
    throw new DashboardLiteReadinessError(
      "Invalid Dashboard Lite UTC date-only timestamp",
    );
  }

  return new Date(timestamp).toISOString().slice(0, 10);
}

function toUtcTimestampForLocalMidnight(
  dateParts: CalendarDateParts,
  timeZone: string,
): number {
  const localMidnightAsUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    0,
    0,
    0,
    0,
  );

  let candidate =
    localMidnightAsUtc -
    resolveTimeZoneOffsetMs(
      localMidnightAsUtc,
      timeZone,
    );

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const offset = resolveTimeZoneOffsetMs(
      candidate,
      timeZone,
    );
    const normalized = localMidnightAsUtc - offset;

    if (normalized === candidate) {
      break;
    }

    candidate = normalized;
  }

  const resolvedParts = toLocalDateTimeParts(
    candidate,
    timeZone,
  );

  if (
    resolvedParts.year !== dateParts.year ||
    resolvedParts.month !== dateParts.month ||
    resolvedParts.day !== dateParts.day ||
    resolvedParts.hour !== 0 ||
    resolvedParts.minute !== 0 ||
    resolvedParts.second !== 0
  ) {
    throw new DashboardLiteReadinessError(
      `Failed to resolve local midnight for ${toCanonicalCalendarDateString(dateParts)} in timezone ${timeZone}`,
    );
  }

  return candidate;
}

function resolveTimeZoneOffsetMs(
  timestamp: number,
  timeZone: string,
): number {
  const formatter = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone,
      timeZoneName: "shortOffset",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      hourCycle: "h23",
    },
  );
  const zoneToken = formatter
    .formatToParts(new Date(timestamp))
    .find((part) => part.type === "timeZoneName")
    ?.value;

  if (!zoneToken) {
    throw new DashboardLiteReadinessError(
      `Failed to resolve timezone offset token for ${timeZone}`,
    );
  }

  return parseTimeZoneOffsetTokenMs(zoneToken, timeZone);
}

export function parseTimeZoneOffsetTokenMs(
  zoneToken: string,
  timeZone: string,
): number {
  const normalizedToken = zoneToken.trim();
  if (ZERO_OFFSET_TOKENS.has(normalizedToken)) {
    return 0;
  }

  const match = TIME_ZONE_OFFSET_PATTERN.exec(
    normalizedToken,
  );
  if (!match || !match.groups) {
    throw new DashboardLiteReadinessError(
      `Unsupported timezone offset token "${zoneToken}" for ${timeZone}`,
    );
  }

  const sign = match.groups.sign;
  const hour = match.groups.hour;
  const minute = match.groups.minute;

  if (!sign || !hour) {
    return 0;
  }

  const parsedHour = Number.parseInt(hour, 10);
  const parsedMinute = minute
    ? Number.parseInt(minute, 10)
    : 0;
  const totalMinutes =
    parsedHour * 60 + parsedMinute;
  const offsetMinutes =
    sign === "+"
      ? totalMinutes
      : -totalMinutes;

  return offsetMinutes * 60 * 1000;
}

function toUtcCalendarDateTimestamp(
  dateParts: CalendarDateParts,
): number {
  return Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    0,
    0,
    0,
    0,
  );
}

function addCalendarDays(
  dateParts: CalendarDateParts,
  days: number,
): CalendarDateParts {
  const timestamp =
    Date.UTC(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      0,
      0,
      0,
      0,
    ) +
    days * DAY_MS;
  const date = new Date(timestamp);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function toCanonicalCalendarDateString(
  dateParts: CalendarDateParts,
): string {
  const month = String(dateParts.month).padStart(
    2,
    "0",
  );
  const day = String(dateParts.day).padStart(
    2,
    "0",
  );

  return `${dateParts.year}-${month}-${day}`;
}

function readPart(
  parts: readonly Intl.DateTimeFormatPart[],
  type:
    | "year"
    | "month"
    | "day"
    | "hour"
    | "minute"
    | "second",
  timeZone: string,
): number {
  const token = parts.find(
    (part) => part.type === type,
  )?.value;

  if (!token) {
    throw new DashboardLiteReadinessError(
      `Failed to read ${type} from timezone formatter for ${timeZone}`,
    );
  }

  const parsed = Number.parseInt(token, 10);
  if (!Number.isFinite(parsed)) {
    throw new DashboardLiteReadinessError(
      `Invalid ${type} token "${token}" for ${timeZone}`,
    );
  }

  return parsed;
}

function readHourPart(
  parts: readonly Intl.DateTimeFormatPart[],
  timeZone: string,
): number {
  const parsed = readPart(parts, "hour", timeZone);

  if (parsed === 24) {
    return 0;
  }

  return parsed;
}
