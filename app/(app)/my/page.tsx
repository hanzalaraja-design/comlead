import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { TaskList } from "@/components/tasks/task-list";
import { getDepartments, requireViewer } from "@/lib/auth";
import { parseFilters } from "@/lib/tasks/filters";
import { comparePriority, fetchTasks, type TaskListRow } from "@/lib/tasks/queries";
import { formatDate, todayPKT, weekEndPKT } from "@/lib/time";

export const metadata = { title: "My tasks · Highfy Tasks" };

const GROUPS = [
  { key: "overdue", title: "Overdue" },
  { key: "today", title: "Today" },
  { key: "week", title: "This week" },
  { key: "later", title: "Later" },
  { key: "none", title: "No date" },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

function groupOf(t: TaskListRow, today: string, weekEnd: string): GroupKey {
  if (t.overdue) return "overdue";
  if (!t.due_date) return "none";
  if (t.due_date <= today) return "today";
  if (t.due_date <= weekEnd) return "week";
  return "later";
}

export default async function MyTasksPage() {
  const viewer = await requireViewer();
  const departments = await getDepartments();
  const { tasks, error } = await fetchTasks(parseFilters({ owner: "me", sort: "due" }), {
    viewerId: viewer.id,
    departments,
  });

  const today = todayPKT();
  const weekEnd = weekEndPKT();
  const grouped = new Map<GroupKey, TaskListRow[]>(GROUPS.map((g) => [g.key, []]));
  for (const t of tasks) grouped.get(groupOf(t, today, weekEnd))!.push(t);
  // Undated tasks: most important first.
  grouped.get("none")!.sort(comparePriority);

  return (
    <>
      <PageHeader
        title="My tasks"
        description={`${formatDate(today, "EEEE d MMMM")} · ${tasks.length} open`}
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/tasks?owner=me&status=done&sort=completed&dir=desc">Completed</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/tasks/new">
                <Plus className="h-4 w-4" /> New task
              </Link>
            </Button>
          </>
        }
      />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {tasks.length === 0 ? (
        <EmptyState>Nothing on your plate. Tasks you own will show up here.</EmptyState>
      ) : (
        <div className="space-y-6">
          {GROUPS.map((g) => {
            const items = grouped.get(g.key)!;
            if (!items.length) return null;
            return (
              <section key={g.key}>
                <h2
                  className={
                    "mb-2 flex items-center gap-2 text-sm font-semibold " +
                    (g.key === "overdue" ? "text-red-600 dark:text-red-400" : "")
                  }
                >
                  {g.title}
                  <span className="rounded-full bg-muted px-2 text-xs font-normal text-muted-foreground">{items.length}</span>
                </h2>
                <TaskList tasks={items} />
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
