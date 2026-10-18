import { addDays, addMonths, differenceInCalendarDays, format, getDaysInMonth } from "date-fns";
import { formatDate, formatTime, parseISODate } from "@/lib/time";

/** Dates of a meeting set up in Meetings. All dates are yyyy-MM-dd in Pakistan time. */

export type Frequency = "once" | "weekly" | "fortnightly" | "monthly";
export type SeriesShape = { frequency: Frequency; start_date: string };

export const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "once", label: "One-off" },
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Every two weeks" },
  { value: "monthly", label: "Monthly" },
];

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** The n-th monthly occurrence: same day of the month, or the month's last day. */
function monthly(start: string, n: number): string {
  const s = parseISODate(start);
  const first = addMonths(new Date(s.getFullYear(), s.getMonth(), 1), n);
  return iso(new Date(first.getFullYear(), first.getMonth(), Math.min(s.getDate(), getDaysInMonth(first))));
}

/** First occurrence on or after `date`, or null for a one-off already past. */
export function nextOnOrAfter(series: SeriesShape, date: string): string | null {
  const { frequency, start_date: start } = series;
  if (date <= start) return start;
  if (frequency === "once") return null;
  if (frequency === "monthly") {
    const s = parseISODate(start);
    const d = parseISODate(date);
    let n = (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth();
    while (monthly(start, n) < date) n++;
    return monthly(start, n);
  }
  const step = frequency === "weekly" ? 7 : 14;
  const gap = differenceInCalendarDays(parseISODate(date), parseISODate(start));
  return iso(addDays(parseISODate(start), Math.ceil(gap / step) * step));
}

/** Last occurrence on or before `date`, or null if the meeting hasn't started. */
export function lastOnOrBefore(series: SeriesShape, date: string): string | null {
  const { frequency, start_date: start } = series;
  if (date < start) return null;
  if (frequency === "once") return start;
  if (frequency === "monthly") {
    const next = nextOnOrAfter(series, date)!;
    if (next === date) return date;
    const s = parseISODate(start);
    const n = parseISODate(next);
    return monthly(start, (n.getFullYear() - s.getFullYear()) * 12 + n.getMonth() - s.getMonth() - 1);
  }
  const step = frequency === "weekly" ? 7 : 14;
  const gap = differenceInCalendarDays(parseISODate(date), parseISODate(start));
  return iso(addDays(parseISODate(start), Math.floor(gap / step) * step));
}

/**
 * The occurrence someone most likely means when they open the meeting today:
 * the one just held if it's closer than the next, otherwise the next.
 */
export function currentOccurrence(series: SeriesShape, today: string): string {
  const prev = lastOnOrBefore(series, today);
  const next = nextOnOrAfter(series, today);
  if (!prev) return next ?? series.start_date;
  if (!next) return prev;
  const back = differenceInCalendarDays(parseISODate(today), parseISODate(prev));
  const ahead = differenceInCalendarDays(parseISODate(next), parseISODate(today));
  return back <= ahead ? prev : next;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** "Weekly on Tuesday at 11:00 am", "Every two weeks on Tuesday…", "Monthly on the 14th…", "Tue 4 Nov at…". */
export function describeSeries(series: SeriesShape & { meeting_time: string }): string {
  const at = `at ${formatTime(series.meeting_time)}`;
  const day = formatDate(series.start_date, "EEEE");
  switch (series.frequency) {
    case "once":
      return `${formatDate(series.start_date, "EEE d MMM yyyy")} ${at}`;
    case "weekly":
      return `Weekly on ${day} ${at}`;
    case "fortnightly":
      return `Every two weeks on ${day} ${at}`;
    case "monthly":
      return `Monthly on the ${ordinal(parseISODate(series.start_date).getDate())} ${at}`;
  }
}
