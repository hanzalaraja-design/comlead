import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { TaskFilterBar, type FilterOptions } from "@/components/tasks/task-filter-bar";
import { TaskTabs } from "@/components/tasks/task-tabs";
import { filtersToSearch, parseFilters, type TaskFilters } from "@/lib/tasks/filters";
import type { TaskView } from "@/lib/tasks/scope";

/** Your tasks, always; the filter bar narrows them further. */
export function myFilters(raw: Record<string, string | string[] | undefined>): TaskFilters {
  return { ...parseFilters(raw), owner: ["me"] };
}

/** Header, tabs and filters for My tasks' board and calendar. */
export function MyHeader({ view, filters, options, month }: { view: TaskView; filters: TaskFilters; options: FilterOptions; month?: string }) {
  const search = filtersToSearch({ ...filters, owner: [], ...(view === "board" ? { status: [] } : {}) });
  return (
    <>
      <PageHeader
        breadcrumb={["Tasks", "My tasks"]}
        title="My tasks"
        actions={
          <Button asChild size="sm">
            <Link href="/tasks/new">
              <Plus className="h-4 w-4" /> New task
            </Link>
          </Button>
        }
      />
      <TaskTabs scope="my" view={view} search={search} />
      <TaskFilterBar
        filters={filters}
        options={options}
        hide={view === "board" ? ["owner", "status", "sort"] : ["owner", "sort", "when"]}
        preserve={month ? { month } : undefined}
      />
    </>
  );
}
