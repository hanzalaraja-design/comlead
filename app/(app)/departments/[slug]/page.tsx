import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DepartmentTabs } from "@/components/department-tabs";
import { PageHeader } from "@/components/page-header";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { getDepartments, isMemberOf, requireViewer } from "@/lib/auth";
import { parseFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { fetchTasks } from "@/lib/tasks/queries";
import { addDaysISO, todayPKT } from "@/lib/time";

export default async function DepartmentBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, raw] = await Promise.all([params, searchParams]);
  const viewer = await requireViewer();
  const departments = await getDepartments();
  const dept = departments.find((d) => d.slug === slug);
  if (!dept) notFound();

  const base = { ...parseFilters(raw), dept: [slug] };
  const ctx = { viewerId: viewer.id, departments };
  const [options, open, done] = await Promise.all([
    getFilterOptions({ departmentId: dept.id }),
    fetchTasks({ ...base, status: ["todo", "in_progress", "blocked"], sort: "due", dir: "asc" }, ctx),
    // Done column: the last two weeks only, so the board stays readable.
    fetchTasks(
      { ...base, status: ["done"], completed_from: addDaysISO(todayPKT(), -14), sort: "completed", dir: "desc" },
      ctx,
      100,
    ),
  ]);

  const member = isMemberOf(viewer, dept.id);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Departments", href: "/departments" }, dept.name, "Board"]}
        title={dept.name}
        description={member ? undefined : "You're on a task here, so you can see it."}
        actions={
          member && (
            <Button asChild size="sm">
              <Link href={`/tasks/new?dept=${slug}`}>
                <Plus className="h-4 w-4" /> New task
              </Link>
            </Button>
          )
        }
      />
      <DepartmentTabs slug={slug} active="board" />
      {member && (
        <div className="mb-4">
          <QuickAdd departments={[{ id: dept.id, name: dept.name }]} defaultDepartmentId={dept.id} />
        </div>
      )}
      <TaskFilterBar filters={base} options={options} hide={["dept", "status", "sort"]} allowSave={false} />
      {(open.error || done.error) && <p className="mb-3 text-sm text-danger">{open.error || done.error}</p>}
      <KanbanBoard tasks={[...open.tasks, ...done.tasks]} canEdit={member} />
    </>
  );
}
