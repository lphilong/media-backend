export function utcMonthBucketFromTimestamp(
  timestamp: number,
): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  );

  return `${year}${month}`;
}

export function utcYearBucketFromTimestamp(
  timestamp: number,
): string {
  return String(new Date(timestamp).getUTCFullYear());
}
