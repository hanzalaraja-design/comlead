import { addDaysISO, todayPKT, weekEndPKT, weekStartPKT } from "@/lib/time";

/**
 * The "When" filter: ranges of days that can be ticked together. Open tasks
 * match on their due date, finished ones on the day they were completed.
 */
export const WHEN = [
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "next_week", label: "Next week" },
  { value: "last_30", label: "Last 30 days" },
  { value: "last_90", label: "Last 90 days" },
  { value: "next_30", label: "Next 30 days" },
  { value: "next_90", label: "Next 90 days" },
  { value: "all", label: "All time" },
] as const;

export type WhenKey = (typeof WHEN)[number]["value"];

export const isWhen = (v: string): v is WhenKey => WHEN.some((w) => w.value === v);

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
    last_30: [addDaysISO(today, -29), today],
    last_90: [addDaysISO(today, -89), today],
    next_30: [today, addDaysISO(today, 29)],
    next_90: [today, addDaysISO(today, 89)],
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
