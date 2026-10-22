import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { TaskFilterBar, type FilterOptions } from "@/components/tasks/task-filter-bar";
import { TaskTabs } from "@/components/tasks/task-tabs";
import { TeamTabs } from "@/components/tasks/team-tabs";
import { filtersToSearch, type TaskFilters } from "@/lib/tasks/filters";
import { viewHref, type TaskView } from "@/lib/tasks/scope";

/** Header, tabs, team chips and filters for All teams, in any view. */
export function AllTeamsHeader({
  view,
  filters,
  options,
  count,
  month,
}: {
  view: TaskView;
  filters: TaskFilters;
  options: FilterOptions;
  count?: string;
  month?: string;
}) {
  const search = filtersToSearch(view === "board" ? { ...filters, status: [] } : filters);
  return (
    <>
      <PageHeader
        breadcrumb={["Tasks", "All teams"]}
        title="All teams"
        description={count}
        actions={
          <Button asChild size="sm">
            <Link href="/tasks/new">
              <Plus className="h-4 w-4" /> New task
            </Link>
          </Button>
        }
      />
      <TaskTabs scope="all" view={view} search={search} />
      <TeamTabs path={viewHref("all", view)} filters={filters} departments={options.departments} />
      <TaskFilterBar
        filters={filters}
        options={options}
        hide={view === "board" ? ["status", "sort"] : view === "calendar" ? ["sort", "when"] : []}
        preserve={month ? { month } : undefined}
      />
    </>
  );
}
