import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskList } from "@/components/tasks/task-list";
import { TaskViewTabs } from "@/components/tasks/task-view-tabs";
import { TeamTabs } from "@/components/tasks/team-tabs";
import { requireViewer, viewerId } from "@/lib/auth";
import { filtersToSearch, parseFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { TASK_LIMIT, fetchTasks } from "@/lib/tasks/queries";

export const metadata = { title: "All tasks · Highfy Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [id, filters] = await Promise.all([viewerId(), searchParams.then(parseFilters)]);
  const [, options, { tasks, truncated, error }] = await Promise.all([
    requireViewer(),
    getFilterOptions(),
    fetchTasks(filters, { viewerId: id }),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={["Tasks", "All tasks"]}
        title="All tasks"
        description={`${tasks.length}${truncated ? "+" : ""} task${tasks.length === 1 ? "" : "s"}`}
        actions={
          <Button asChild size="sm">
            <Link href="/tasks/new">
              <Plus className="h-4 w-4" /> New task
            </Link>
          </Button>
        }
      />
      <TaskViewTabs active="list" search={filtersToSearch(filters)} />
      <TeamTabs path={"/tasks"} filters={filters} departments={options.departments} />
      <TaskFilterBar filters={filters} options={options} />
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {tasks.length ? (
        <TaskList tasks={tasks} showCompleted={filters.sort === "completed"} />
      ) : (
        <EmptyState>No tasks match these filters.</EmptyState>
      )}
      {truncated && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Showing the first {TASK_LIMIT}. Narrow the filters to see the rest.
        </p>
      )}
    </>
  );
}
