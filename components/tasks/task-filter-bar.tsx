"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDownAZ, ArrowUpAZ, CalendarRange, Search, SlidersHorizontal, X } from "lucide-react";
import { MultiSelect, type Option } from "@/components/multi-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRIORITIES, SOURCES, STATUSES } from "@/lib/labels";
import { SORTS, countActiveFilters, filtersToSearch, type SortKey, type TaskFilters } from "@/lib/tasks/filters";
import { cn } from "@/lib/utils";
import { WHEN, whenRanges, type WhenKey } from "@/lib/tasks/when";
import { formatDate } from "@/lib/time";

const WHEN_PILLS: WhenKey[][] = [
  ["last_week", "this_week", "next_week"],
  ["last_month", "this_month", "next_month"],
  ["all"],
];
import type { TaskPriority, TaskSource, TaskStatus } from "@/lib/types";

export type FilterOptions = {
  departments: Option[]; // value = slug
  projects: Option[];    // value = slug
  people: Option[];      // value = id
  tags: string[];
  meetings: Option[];    // value = id
};

type DateKey = "due" | "created" | "completed";

export function TaskFilterBar({
  filters,
  options,
  hide = [],
  preserve,
  whenPills = false,
}: {
  filters: TaskFilters;
  options: FilterOptions;
  /** Filters fixed by the page (e.g. the department board hides "dept"). */
  hide?: ("dept" | "project" | "owner" | "status" | "sort" | "overdue" | "when")[];
  /** Extra query params the page needs kept (e.g. the calendar month). */
  preserve?: Record<string, string>;
  /** My tasks and My team: When as a row of week and month pills instead of a menu. */
  whenPills?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");

  // Follow the URL when it changes from outside (back button, Clear).
  const [prevQ, setPrevQ] = useState(filters.q);
  if (prevQ !== filters.q) {
    setPrevQ(filters.q);
    setQ(filters.q ?? "");
  }

  function href(next: Partial<TaskFilters>) {
    const params = new URLSearchParams(filtersToSearch(next).slice(1));
    for (const [k, v] of Object.entries(preserve ?? {})) params.set(k, v);
    const s = params.toString();
    return pathname + (s ? `?${s}` : "");
  }

  function apply(patch: Partial<TaskFilters>) {
    const next = { ...filters, ...patch };
    startTransition(() => router.push(href(next), { scroll: false }));
  }

  // Debounced title search
  useEffect(() => {
    if ((filters.q ?? "") === q) return;
    const t = setTimeout(() => apply({ q: q || undefined }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Less-used filters live behind "More" and open by themselves when one is set.
  const secondary =
    (filters.tags.length ? 1 : 0) +
    (filters.source.length ? 1 : 0) +
    (filters.meeting ? 1 : 0) +
    (["due", "created", "completed"] as const).filter((k) => filters[`${k}_from`] || filters[`${k}_to`]).length;
  const [more, setMore] = useState(secondary > 0);
  const statusValue = filters.status === "all" ? STATUSES.map((s) => s.value) : filters.status;
  const showingDone = Array.isArray(filters.status) && filters.status.length === 1 && filters.status[0] === "done";
  const active = countActiveFilters(filters);

  // Ticking adds a range; All time stands alone.
  const toggleWhen = (k: WhenKey) =>
    apply({
      when: k === "all" ? (filters.when.includes("all") ? [] : ["all"]) : filters.when.includes(k) ? filters.when.filter((x) => x !== k) : [...filters.when.filter((x) => x !== "all"), k],
    });
  const ranges = whenRanges(filters.when);

  return (
    <div className="mb-4 space-y-2">
      {whenPills && (
        <div className="space-y-1.5">
          <div role="group" aria-label="When" className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
            {WHEN_PILLS.map((group, gi) => (
              <span key={gi} className="flex shrink-0 items-center gap-1.5">
                {gi > 0 && <span aria-hidden className="mx-1 h-5 w-px bg-line" />}
                {group.map((k) => {
                  const on = filters.when.includes(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleWhen(k)}
                      className={cn(
                        "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[13px] font-semibold",
                        on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-subtle",
                      )}
                    >
                      {WHEN.find((w) => w.value === k)!.label}
                      {on && <X className="h-3 w-3 opacity-70" />}
                    </button>
                  );
                })}
              </span>
            ))}
          </div>
          {ranges && ranges.length > 0 && (
            <p className="text-xs text-ink-muted">
              Showing {ranges.map((r) => (r.from === r.to ? formatDate(r.from, "d MMM") : `${formatDate(r.from, "d MMM")} to ${formatDate(r.to, "d MMM")}`)).join(" and ")}
              {" "}· open tasks by due date, finished ones by the day they were done
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles…" className="h-9 pl-8" />
        </div>
      </div>

      {/* Scrolls sideways on phones */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {!hide.includes("status") && (
          <MultiSelect
            label={filters.status.length === 0 ? "Open tasks" : "Status"}
            options={[...STATUSES.map((s) => ({ value: s.value, label: s.label }))]}
            value={statusValue}
            onChange={(v) =>
              apply({ status: v.length === STATUSES.length ? "all" : (v as TaskStatus[]) })
            }
          />
        )}
        {!hide.includes("status") && (
          <button
            type="button"
            aria-pressed={showingDone}
            onClick={() =>
              apply(showingDone ? { status: [], sort: "due", dir: undefined } : { status: ["done"], sort: "completed", dir: "desc", overdue: false })
            }
            className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs",
              showingDone ? "border-success-soft bg-success-soft font-semibold text-success-ink" : "text-muted-foreground hover:bg-accent",
            )}
          >
            Completed
          </button>
        )}
        {!hide.includes("when") && !whenPills && (
          <MultiSelect
            label="When"
            options={WHEN.map((w) => ({ value: w.value, label: w.label }))}
            value={filters.when}
            onChange={(v) => apply({ when: v.includes("all") && !filters.when.includes("all") ? ["all"] : (v.filter((x) => x !== "all" || v.length === 1) as WhenKey[]) })}
          />
        )}
        {!hide.includes("overdue") && (
          <button
            type="button"
            onClick={() => apply({ overdue: !filters.overdue })}
            className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs",
              filters.overdue
                ? "border-danger-soft bg-danger-soft font-semibold text-danger-ink"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            Overdue
          </button>
        )}
        {!hide.includes("owner") && (
          <MultiSelect
            label="Owner"
            options={[{ value: "me", label: "Me" }, { value: "none", label: "Unassigned" }, ...options.people]}
            value={filters.owner}
            onChange={(v) => apply({ owner: v })}
            searchable
          />
        )}
        {!hide.includes("dept") && options.departments.length > 1 && (
          <MultiSelect
            label="Team"
            options={options.departments}
            value={filters.dept}
            onChange={(v) => apply({ dept: v })}
          />
        )}
        {!hide.includes("project") && options.projects.length > 0 && (
          <MultiSelect
            label="Project"
            options={options.projects}
            value={filters.project}
            onChange={(v) => apply({ project: v })}
          />
        )}
        <MultiSelect
          label="Priority"
          options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
          value={filters.priority}
          onChange={(v) => apply({ priority: v as TaskPriority[] })}
        />
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs",
            secondary ? "border-ink font-semibold text-ink" : "text-muted-foreground hover:bg-accent",
          )}
        >
          <SlidersHorizontal className="h-3 w-3" /> More{secondary ? ` · ${secondary}` : ""}
        </button>
        {active > 0 && (
          <button
            type="button"
            onClick={() => startTransition(() => router.push(href({})))}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs text-muted-foreground hover:bg-accent"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {more && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        <MultiSelect
          label="Source"
          options={SOURCES.map((s) => ({ value: s.value, label: s.label }))}
          value={filters.source}
          onChange={(v) => apply({ source: v as TaskSource[] })}
        />
        {options.meetings.length > 0 && (
          <MultiSelect
            label="Meeting"
            options={options.meetings}
            value={filters.meeting ? [filters.meeting] : []}
            onChange={(v) => apply({ meeting: v.filter((x) => x !== filters.meeting)[0] ?? undefined })}
            searchable
          />
        )}
        <DateFilters filters={filters} apply={apply} />
        {!hide.includes("sort") && (
          <div className="flex shrink-0 items-center gap-1">
            <select
              aria-label="Sort by"
              value={filters.sort}
              onChange={(e) => apply({ sort: e.target.value as SortKey })}
              className="h-9 field px-2 text-sm"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon"
              aria-label={filters.dir === "asc" ? "Ascending" : "Descending"}
              onClick={() => apply({ dir: filters.dir === "asc" ? "desc" : "asc" })}
            >
              {filters.dir === "asc" ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
            </Button>
          </div>
        )}
        </div>
      )}
    </div>
  );
}

function DateFilters({ filters, apply }: { filters: TaskFilters; apply: (p: Partial<TaskFilters>) => void }) {
  const ranges: { key: DateKey; label: string }[] = [
    { key: "due", label: "Due" },
    { key: "created", label: "Created" },
    { key: "completed", label: "Completed" },
  ];
  const count = ranges.filter((r) => filters[`${r.key}_from`] || filters[`${r.key}_to`]).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs",
            count ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground hover:bg-accent",
          )}
        >
          <CalendarRange className="h-3 w-3" /> Dates{count ? ` · ${count}` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        {ranges.map((r) => (
          <div key={r.key}>
            <p className="mb-1 text-xs font-medium">{r.label}</p>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                className="h-8 text-xs"
                value={filters[`${r.key}_from`] ?? ""}
                onChange={(e) => apply({ [`${r.key}_from`]: e.target.value || undefined })}
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                className="h-8 text-xs"
                value={filters[`${r.key}_to`] ?? ""}
                onChange={(e) => apply({ [`${r.key}_to`]: e.target.value || undefined })}
              />
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
