import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskViewTabs } from "@/components/tasks/task-view-tabs";
import { getDepartments, requireViewer } from "@/lib/auth";
import { filtersToSearch, parseFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { fetchTasks } from "@/lib/tasks/queries";
import { addDaysISO, todayPKT } from "@/lib/time";

export const metadata = { title: "Board · Highfy Tasks" };

/** Status board across every department the viewer can see. */
export default async function TaskBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  const filters = parseFilters(await searchParams);
  const [departments, options] = await Promise.all([getDepartments(), getFilterOptions()]);
  const ctx = { viewerId: viewer.id, departments };

  const [open, done] = await Promise.all([
    fetchTasks({ ...filters, status: ["todo", "in_progress", "blocked"], sort: "due", dir: "asc" }, ctx),
    // Done column: last two weeks only, so the board stays readable.
    fetchTasks(
      { ...filters, status: ["done"], completed_from: addDaysISO(todayPKT(), -14), sort: "completed", dir: "desc" },
      ctx,
      100,
    ),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Tasks", href: "/tasks" }, "Board"]}
        title="Board"
        description="By status, across the departments you can see. Done shows the last 2 weeks."
        actions={
          <Button asChild size="sm">
            <Link href="/tasks/new">
              <Plus className="h-4 w-4" /> New task
            </Link>
          </Button>
        }
      />
      <TaskViewTabs active="board" search={filtersToSearch({ ...filters, status: [] })} />
      <TaskFilterBar filters={filters} options={options} hide={["status", "sort"]} />
      {(open.error || done.error) && <p className="mb-3 text-sm text-danger">{open.error || done.error}</p>}
      <KanbanBoard tasks={[...open.tasks, ...done.tasks]} canEdit showDepartment />
    </>
  );
}
