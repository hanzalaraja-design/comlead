import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
        breadcrumb={["Tasks", "My tasks"]}
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
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {tasks.length === 0 ? (
        <EmptyState
          action={
            <Button asChild size="sm">
              <Link href="/tasks/new">New task</Link>
            </Button>
          }
        >
          Nothing assigned to you.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {GROUPS.map((g) => {
            const items = grouped.get(g.key)!;
            if (!items.length) return null;
            return (
              <section key={g.key}>
                <h2 className="kicker mb-2 flex items-center gap-2 text-ink">
                  {g.title}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 tracking-normal",
                      g.key === "overdue" ? "bg-brand-accent text-ink" : "bg-subtle text-ink",
                    )}
                  >
                    {items.length}
                  </span>
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
