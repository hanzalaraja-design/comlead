"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDownAZ, ArrowUpAZ, Bookmark, CalendarRange, Search, X } from "lucide-react";
import { toast } from "sonner";
import { MultiSelect, type Option } from "@/components/multi-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRIORITIES, SOURCES, STATUSES } from "@/lib/labels";
import { SORTS, countActiveFilters, filtersToSearch, type SortKey, type TaskFilters } from "@/lib/tasks/filters";
import { cn } from "@/lib/utils";
import type { TaskPriority, TaskSource, TaskStatus } from "@/lib/types";
import { saveView } from "@/app/(app)/tasks/actions";

export type FilterOptions = {
  departments: Option[]; // value = slug
  subTeams: Option[];    // value = id, hint = department
  people: Option[];      // value = id
  tags: string[];
  meetings: Option[];    // value = id
};

type DateKey = "due" | "created" | "completed";

export function TaskFilterBar({
  filters,
  options,
  hide = [],
  allowSave = true,
  preserve,
}: {
  filters: TaskFilters;
  options: FilterOptions;
  /** Filters fixed by the page (e.g. the department board hides "dept"). */
  hide?: ("dept" | "owner" | "status" | "sort" | "overdue")[];
  allowSave?: boolean;
  /** Extra query params the page needs kept (e.g. the calendar month). */
  preserve?: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");

  useEffect(() => setQ(filters.q ?? ""), [filters.q]);

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

  const statusValue = filters.status === "all" ? STATUSES.map((s) => s.value) : filters.status;
  const active = countActiveFilters(filters);

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles…" className="h-9 pl-8" />
        </div>
        {!hide.includes("sort") && (
          <div className="flex shrink-0 items-center gap-1">
            <select
              aria-label="Sort by"
              value={filters.sort}
              onChange={(e) => apply({ sort: e.target.value as SortKey })}
              className="h-9 rounded-md border bg-background px-2 text-sm"
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
        {!hide.includes("overdue") && (
          <button
            type="button"
            onClick={() => apply({ overdue: !filters.overdue })}
            className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs",
              filters.overdue
                ? "border-red-500 bg-red-50 font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
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
            label="Department"
            options={options.departments}
            value={filters.dept}
            onChange={(v) => apply({ dept: v })}
          />
        )}
        {options.subTeams.length > 0 && (
          <MultiSelect label="Sub-team" options={options.subTeams} value={filters.sub} onChange={(v) => apply({ sub: v })} />
        )}
        <MultiSelect
          label="Priority"
          options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
          value={filters.priority}
          onChange={(v) => apply({ priority: v as TaskPriority[] })}
        />
        {options.tags.length > 0 && (
          <MultiSelect
            label="Tags"
            options={options.tags.map((t) => ({ value: t, label: `#${t}` }))}
            value={filters.tags}
            onChange={(v) => apply({ tags: v })}
          />
        )}
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
        {active > 0 && (
          <button
            type="button"
            onClick={() => startTransition(() => router.push(href({})))}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs text-muted-foreground hover:bg-accent"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        {allowSave && active > 0 && <SaveViewButton path={pathname + filtersToSearch(filters)} />}
      </div>
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

function SaveViewButton({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs text-muted-foreground hover:bg-accent"
        >
          <Bookmark className="h-3 w-3" /> Save view
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await saveView(name, path);
              if (res.ok) {
                toast.success("View saved");
                setOpen(false);
                setName("");
              } else toast.error(res.error);
            });
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marketing overdue" />
          <Button type="submit" size="sm" className="w-full" disabled={pending || !name.trim()}>
            Save
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
