/** Timezone-aware formatting helpers. All instants are stored in UTC. */
export function formatDate(
  iso: string | Date,
  timeZone: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...opts,
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatLongDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function partOfDay(date: Date, timeZone: string): "morning" | "afternoon" | "evening" {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hour12: false }).format(date),
  );
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** "3 days ago", "in 5 days" — coarse relative time for lists. */
export function relativeDays(iso: string, now = new Date()): string {
  const days = Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(days, "day");
}

/** Today's calendar date (YYYY-MM-DD) in the agency time zone. */
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Offset (ms) of `timeZone` from UTC at instant `at`. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - at.getTime();
}

/**
 * Wall-clock date + time in `timeZone` → UTC instant (DST-safe: two-pass
 * correction). `date` "YYYY-MM-DD", `time` "HH:mm".
 */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  let guess = naive - tzOffsetMs(new Date(naive), timeZone);
  guess = naive - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** "14:30" → "2:30 PM" */
export function formatClock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h! >= 12 ? "PM" : "AM";
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Add days to a YYYY-MM-DD calendar date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** "2026-10-05" → "Mon, 5 Oct" (calendar date, timezone-independent). */
export function formatCalendarDate(date: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...opts,
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}
