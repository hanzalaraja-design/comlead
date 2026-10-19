"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { filtersToSearch, type TaskFilters } from "@/lib/tasks/filters";
import type { Option } from "@/components/multi-select";
import { cn } from "@/lib/utils";

/** One tap to a team: a swipeable row that sets the Team filter, keeping the rest. */
export function TeamTabs({
  path,
  filters,
  departments,
}: {
  path: string;
  filters: TaskFilters;
  departments: Option[]; // value = slug
}) {
  const row = useRef<HTMLElement>(null);
  const current = filters.dept.length === 1 ? filters.dept[0] : filters.dept.length ? null : "";
  // Bring the chosen team into view on phones, where the row scrolls sideways.
  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>("[aria-current=page]");
    if (el && row.current) row.current.scrollLeft = el.offsetLeft - (row.current.clientWidth - el.offsetWidth) / 2;
  }, [current]);
  if (departments.length < 2) return null;
  const tabs = [{ value: "", label: "All teams" }, ...departments];
  return (
    <nav ref={row} aria-label="Teams" className="no-scrollbar relative -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
      {tabs.map((d) => (
        <Link
          key={d.value}
          href={path + filtersToSearch({ ...filters, dept: d.value ? [d.value] : [] })}
          scroll={false}
          aria-current={current === d.value ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors",
            current === d.value ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-subtle",
          )}
        >
          {d.label}
        </Link>
      ))}
    </nav>
  );
}
