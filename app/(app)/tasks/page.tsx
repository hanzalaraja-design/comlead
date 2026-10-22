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
import { addDaysISO, todayPKT } from "@/lib/time";

export const metadata = { title: "All tasks · Highfy Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [id, filters] = await Promise.all([viewerId(), searchParams.then(parseFilters)]);
  // The default view (open tasks) also lists what was finished recently, with the same filters.
  const withDone = Array.isArray(filters.status) && filters.status.length === 0 && !filters.overdue;
  const [, options, { tasks, truncated, error }, done] = await Promise.all([
    requireViewer(),
    getFilterOptions(),
    fetchTasks(filters, { viewerId: id }),
    withDone
      ? fetchTasks(
          { ...filters, status: ["done"], completed_from: filters.completed_from ?? addDaysISO(todayPKT(), -14), sort: "completed", dir: "desc" },
          { viewerId: id },
        )
      : null,
  ]);
  const completed = done?.tasks ?? [];

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
      {completed.length > 0 && (
        <section className="mt-8">
          <h2 className="kicker mb-2 flex items-center gap-2 text-ink">
            Completed
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success-ink">{completed.length}</span>
            <span className="text-xs font-normal normal-case tracking-normal text-ink-muted">last 2 weeks</span>
            <Link
              href={`/tasks${filtersToSearch({ ...filters, status: ["done"], sort: "completed", dir: "desc" })}`}
              className="ml-auto text-sm font-medium normal-case tracking-normal text-brand-primary hover:underline"
            >
              See all
            </Link>
          </h2>
          <TaskList tasks={completed} showCompleted />
        </section>
      )}
    </>
  );
}
