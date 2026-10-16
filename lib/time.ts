import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfWeek } from "date-fns";

/** All "today" and display logic runs in Pakistan time. */
export const TZ = "Asia/Karachi";

export function nowPKT(): TZDate {
  return new TZDate(Date.now(), TZ);
}

/** Today's date in PKT as yyyy-MM-dd. */
export function todayPKT(): string {
  return format(nowPKT(), "yyyy-MM-dd");
}

/** Current PKT wall-clock time as HH:mm:ss. */
export function nowTimePKT(): string {
  return format(nowPKT(), "HH:mm:ss");
}

/** Monday of the current PKT week as yyyy-MM-dd. */
export function weekStartPKT(): string {
  return format(startOfWeek(nowPKT(), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

/** Sunday of the current PKT week as yyyy-MM-dd. */
export function weekEndPKT(): string {
  return format(addDays(startOfWeek(nowPKT(), { weekStartsOn: 1 }), 6), "yyyy-MM-dd");
}

/** Add days to a yyyy-MM-dd date string. */
export function addDaysISO(date: string, days: number): string {
  return format(addDays(parseISODate(date), days), "yyyy-MM-dd");
}

/** Parse yyyy-MM-dd as a calendar date (noon, so no DST/TZ edge flips). */
export function parseISODate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function isISODate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(parseISODate(value).getTime());
}

/** UTC instant for 00:00 PKT on the given date, for timestamptz range queries. */
export function startOfDayPKT(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new TZDate(y, m - 1, d, 0, 0, 0, TZ).toISOString();
}

/** Format a timestamptz in PKT. */
export function formatPKT(ts: string | null | undefined, pattern = "d MMM yyyy, h:mm a"): string {
  if (!ts) return "";
  return format(new TZDate(new Date(ts).getTime(), TZ), pattern);
}

/** Format a yyyy-MM-dd date. */
export function formatDate(date: string | null | undefined, pattern = "EEE d MMM"): string {
  if (!date) return "";
  return format(parseISODate(date), pattern);
}

/** "14:30:00" → "2:30 pm" */
export function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatDue(date: string | null, time: string | null): string {
  if (!date) return "No date";
  const today = todayPKT();
  let label: string;
  if (date === today) label = "Today";
  else if (date === addDaysISO(today, 1)) label = "Tomorrow";
  else if (date === addDaysISO(today, -1)) label = "Yesterday";
  else label = formatDate(date, date.slice(0, 4) === today.slice(0, 4) ? "EEE d MMM" : "d MMM yyyy");
  return time ? `${label}, ${formatTime(time)}` : label;
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** ISO weekday 1–7 → name. */
export function weekdayName(n: number | null | undefined): string {
  return n ? WEEKDAYS[n - 1] : "";
}
