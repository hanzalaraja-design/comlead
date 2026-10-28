import { differenceInCalendarDays } from "date-fns";
import { parseISODate } from "@/lib/time";

/** The day something was finished, in Pakistan time (UTC+5, no daylight saving). */
export const pktDay = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 10);

export type OnTime = { onTime: boolean; label: string; tone: "good" | "late" | "very-late" };

/**
 * Finished by its due date? Null when it isn't finished or had no due date.
 * "On time", "1 day late", "5 days late".
 */
export function onTimeStatus(dueDate: string | null | undefined, completedAt: string | null | undefined): OnTime | null {
  if (!dueDate || !completedAt) return null;
  const late = differenceInCalendarDays(parseISODate(pktDay(completedAt)), parseISODate(dueDate));
  if (late <= 0) return { onTime: true, label: "On time", tone: "good" };
  return { onTime: false, label: `${late} day${late === 1 ? "" : "s"} late`, tone: late <= 2 ? "late" : "very-late" };
}

export const ON_TIME_STYLES = {
  good: "bg-success-soft text-success-ink",
  late: "bg-warning-soft text-warning-ink",
  "very-late": "bg-danger-soft text-danger-ink",
} as const;
