import { EmptyState, PageHeader } from "@/components/page-header";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskList } from "@/components/tasks/task-list";
import { getDepartments, requireViewer } from "@/lib/auth";
import { parseFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { fetchTasks, type TaskListRow } from "@/lib/tasks/queries";

export const metadata = { title: "Overdue · Highfy Tasks" };

/** Overdue across every department the viewer can see, grouped by department. */
export default async function OverduePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  const filters = { ...parseFilters(await searchParams), overdue: true };
  const [departments, options] = await Promise.all([getDepartments(), getFilterOptions()]);
  const { tasks, error } = await fetchTasks(filters, { viewerId: viewer.id, departments });

  const byDept = new Map<string, { name: string; tasks: TaskListRow[] }>();
  for (const t of tasks) {
    const key = t.department_id;
    if (!byDept.has(key)) byDept.set(key, { name: t.department?.name ?? "Unknown", tasks: [] });
    byDept.get(key)!.tasks.push(t);
  }
  const order = new Map(departments.map((d, i) => [d.id, i]));
  const groups = [...byDept.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99));

  return (
    <>
      <PageHeader breadcrumb={["Tasks", "Overdue"]} title="Overdue" description={`${tasks.length} overdue task${tasks.length === 1 ? "" : "s"}`} />
      <TaskFilterBar filters={filters} options={options} hide={["overdue", "status"]} />
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {groups.length === 0 ? (
        <EmptyState>Nothing overdue.</EmptyState>
      ) : (
        <div className="space-y-6">
          {groups.map(([id, g]) => (
            <section key={id}>
              <h2 className="kicker mb-2 text-brand-primary">
                {g.name} <span className="font-normal text-muted-foreground">· {g.tasks.length}</span>
              </h2>
              <TaskList tasks={g.tasks} showDepartment={false} />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
