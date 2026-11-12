import { addDaysISO, formatDate, todayPKT, weekEndPKT, weekStartPKT } from "@/lib/time";

/**
 * The time tabs on the task pages: what's up today, this week, last week,
 * this month, last month, next month, or everything still open.
 */
export const PERIODS = [
  { key: "today", label: "Today" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "next_month", label: "Next month" },
  { key: "open", label: "All open" },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

export const isPeriod = (v: unknown): v is PeriodKey => PERIODS.some((p) => p.key === v);

export type Period = {
  key: PeriodKey;
  label: string;
  /** First and last day; null for All open. */
  from: string | null;
  to: string | null;
  /** past: last week / last month. future: next month. now: everything else. */
  when: "past" | "now" | "future";
  /** "today", "this week", … for headings. */
  words: string;
  /** "Thursday 12 November", "9–15 November", … */
  range: string;
};

function month(day: string, offset: number): [string, string] {
  const [y, m] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(y, m + offset, 0));
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}

function rangeText(from: string, to: string) {
  if (from === to) return formatDate(from, "EEEE d MMMM");
  if (from.slice(0, 7) === to.slice(0, 7)) return `${formatDate(from, "d")}–${formatDate(to, "d MMMM")}`;
  return `${formatDate(from, "d MMM")} – ${formatDate(to, "d MMM")}`;
}

export function getPeriod(key: PeriodKey): Period {
  const today = todayPKT();
  const ws = weekStartPKT();
  const we = weekEndPKT();
  const label = PERIODS.find((p) => p.key === key)!.label;
  const make = (from: string | null, to: string | null, when: Period["when"], words: string, range?: string): Period => ({
    key,
    label,
    from,
    to,
    when,
    words,
    range: range ?? (from && to ? rangeText(from, to) : ""),
  });
  switch (key) {
    case "today":
      return make(today, today, "now", "today");
    case "this_week":
      return make(ws, we, "now", "this week");
    case "last_week":
      return make(addDaysISO(ws, -7), addDaysISO(ws, -1), "past", "last week");
    case "this_month": {
      const [f, t] = month(today, 0);
      return make(f, t, "now", "this month", formatDate(f, "MMMM yyyy"));
    }
    case "last_month": {
      const [f, t] = month(today, -1);
      return make(f, t, "past", "last month", formatDate(f, "MMMM yyyy"));
    }
    case "next_month": {
      const [f, t] = month(today, 1);
      return make(f, t, "future", "next month", formatDate(f, "MMMM yyyy"));
    }
    default:
      return make(null, null, "now", "", "Everything still open");
  }
}
