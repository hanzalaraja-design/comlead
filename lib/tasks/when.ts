import { addDaysISO, todayPKT, weekEndPKT, weekStartPKT } from "@/lib/time";

/**
 * The "When" filter: ranges of days that can be ticked together. Open tasks
 * match on their due date, finished ones on the day they were completed.
 */
export const WHEN = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "next_week", label: "Next week" },
  { value: "last_month", label: "Last month" },
  { value: "this_month", label: "This month" },
  { value: "next_month", label: "Next month" },
  { value: "all", label: "All time" },
] as const;

export type WhenKey = (typeof WHEN)[number]["value"];

export const isWhen = (v: string): v is WhenKey => WHEN.some((w) => w.value === v);

/** First and last day (yyyy-MM-dd) of the calendar month `offset` months from `day`'s. */
function month(day: string, offset: number): [string, string] {
  const [y, m] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(y, m + offset, 0));
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}

/** yyyy-MM-dd ranges (inclusive) for the ticked options, merged where they touch. Null = no limit. */
export function whenRanges(keys: WhenKey[]): { from: string; to: string }[] | null {
  if (!keys.length || keys.includes("all")) return null;
  const today = todayPKT();
  const ws = weekStartPKT();
  const we = weekEndPKT();
  const r: Record<Exclude<WhenKey, "all">, [string, string]> = {
    this_week: [ws, we],
    last_week: [addDaysISO(ws, -7), addDaysISO(ws, -1)],
    next_week: [addDaysISO(we, 1), addDaysISO(we, 7)],
    last_month: month(today, -1),
    this_month: month(today, 0),
    next_month: month(today, 1),
  };
  const ranges = keys
    .filter((k): k is Exclude<WhenKey, "all"> => k !== "all")
    .map((k) => ({ from: r[k][0], to: r[k][1] }))
    .sort((a, b) => a.from.localeCompare(b.from));
  const merged: { from: string; to: string }[] = [];
  for (const x of ranges) {
    const last = merged.at(-1);
    if (last && x.from <= addDaysISO(last.to, 1)) last.to = x.to > last.to ? x.to : last.to;
    else merged.push({ ...x });
  }
  return merged;
}

export const whenLabel = (keys: WhenKey[]) =>
  keys.length ? WHEN.filter((w) => keys.includes(w.value)).map((w) => w.label).join(", ") : "";
