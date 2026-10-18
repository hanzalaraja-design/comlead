import Link from "next/link";
import { AtSign, CheckCircle2, TriangleAlert, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TaskList } from "@/components/tasks/task-list";
import { QuickAdd } from "@/components/tasks/quick-add";
import { CelebrateWhenCleared } from "@/components/progress/celebrate";
import { PersonAvatar } from "@/components/person-avatar";
import { getDepartments, getPeople, isMemberOf, requireViewer } from "@/lib/auth";
import { OPEN_STATUSES, personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/tasks/filters";
import { TASK_SELECT, comparePriority, fetchTasks, type TaskListRow } from "@/lib/tasks/queries";
import { formatDate, formatPKT, todayPKT, weekEndPKT, weekStartPKT } from "@/lib/time";
import { clearedLine, emptyLine, todayLine } from "@/lib/voice";

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

type Mention = {
  id: string;
  created_at: string;
  seen_at: string | null;
  mentioned_by: string | null;
  task: { id: string; title: string } | null;
  comment: { body: string } | null;
};

export default async function MyTasksPage() {
  const viewer = await requireViewer();
  const supabase = await createClient();
  const today = todayPKT();
  const weekStart = weekStartPKT();
  const weekEnd = weekEndPKT();

  const departments = await getDepartments();
  const [{ tasks, error }, collabRes, mentionsRes, people] = await Promise.all([
    fetchTasks(parseFilters({ owner: "me", sort: "due" }), { viewerId: viewer.id, departments }),
    supabase.from("task_collaborators").select("task_id").eq("user_id", viewer.id),
    supabase
      .from("task_mentions")
      .select("id, created_at, seen_at, mentioned_by, task:tasks(id, title), comment:task_comments(body)")
      .eq("user_id", viewer.id)
      .order("created_at", { ascending: false })
      .limit(15),
    getPeople(),
  ]);

  // Tasks I'm helping with but don't own.
  const collabIds = (collabRes.data ?? []).map((c) => c.task_id as string);
  let collaborating: TaskListRow[] = [];
  if (collabIds.length) {
    const { data } = await supabase
      .from("tasks")
      .select(TASK_SELECT)
      .in("id", collabIds)
      .in("status", OPEN_STATUSES)
      .or(`owner_id.is.null,owner_id.neq.${viewer.id}`)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(100);
    collaborating = (data ?? []) as unknown as TaskListRow[];
  }
  const mentions = ((mentionsRes.data ?? []) as unknown as Mention[]).filter(
    (m) => m.task && (!m.seen_at || m.created_at >= `${weekStart}T00:00:00`),
  );
  const unseen = mentions.filter((m) => !m.seen_at).length;
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const grouped = new Map<GroupKey, TaskListRow[]>(GROUPS.map((g) => [g.key, []]));
  for (const t of tasks) grouped.get(groupOf(t, today, weekEnd))!.push(t);
  grouped.get("none")!.sort(comparePriority);

  const overdue = grouped.get("overdue")!.length;
  const dueToday = grouped.get("today")!.length;
  const state = todayLine(today, overdue, dueToday);
  // Teams you can add tasks to: your own, or every team for Admin.
  const myDepartments = departments.filter((d) => !d.archived && isMemberOf(viewer, d.id));

  return (
    <>
      <PageHeader
        breadcrumb={["Tasks", "My tasks"]}
        title="My tasks"
        description={formatDate(today, "EEEE d MMMM")}
      />
      <CelebrateWhenCleared remaining={overdue + dueToday} line={clearedLine(today + viewer.id)} />

      {/* Today at a glance */}
      <div
        className={cn(
          "mb-4 flex items-center gap-3 rounded-[20px] px-4 py-3 text-[15px] font-medium",
          state.tone === "bad" ? "bg-danger-soft text-danger-ink" : "bg-success-soft text-success-ink",
        )}
      >
        {state.tone === "bad" ? <TriangleAlert className="h-5 w-5 shrink-0" /> : <CheckCircle2 className="h-5 w-5 shrink-0" />}
        <span className="flex-1">{state.text}</span>
        <Link href="/tasks?owner=me&status=done&sort=completed&dir=desc" className="shrink-0 text-sm font-medium underline-offset-2 hover:underline">
          Completed
        </Link>
      </div>

      <div className="mb-6">
        <QuickAdd departments={myDepartments.map((d) => ({ id: d.id, name: d.name }))} allowPrivate />
      </div>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      <div className="space-y-8">
        {/* Mentions first when something is new: it's what someone is waiting on. */}
        {mentions.length > 0 && (
          <section>
            <h2 className="kicker mb-2 flex items-center gap-2 text-ink">
              <AtSign className="h-4 w-4" /> Mentioned
              {unseen > 0 && <span className="rounded-full bg-brand-primary px-2 py-0.5 text-xs text-white">{unseen} new</span>}
            </h2>
            <ul className="divide-y divide-line surface">
              {mentions.map((m) => {
                const by = m.mentioned_by ? peopleById.get(m.mentioned_by) : undefined;
                return (
                  <li key={m.id} className={cn("relative flex gap-3 px-4 py-3 hover:bg-subtle/60", !m.seen_at && "bg-brand-bg/40")}>
                    <PersonAvatar person={by} className="mt-0.5 h-7 w-7" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/tasks/${m.task!.id}#comments`} className="font-semibold text-ink after:absolute after:inset-0">
                        {m.task!.title}
                      </Link>
                      <p className="line-clamp-2 text-sm text-ink-muted">
                        <span className="font-medium text-ink">{personName(by)}:</span> {m.comment?.body}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-muted">{formatPKT(m.created_at, "d MMM")}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section>
          <h2 className="kicker mb-2 text-ink">Assigned to me</h2>
          {tasks.length === 0 ? (
            <p className="surface px-4 py-6 text-center text-sm text-ink-muted">{emptyLine(today + viewer.id)}</p>
          ) : (
            <div className="space-y-5">
              {GROUPS.map((g) => {
                const items = grouped.get(g.key)!;
                if (!items.length) return null;
                return (
                  <div key={g.key}>
                    <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink">
                      {g.title}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs",
                          g.key === "overdue"
                            ? "bg-danger-soft text-danger-ink"
                            : g.key === "today"
                              ? "bg-warning-soft text-warning-ink"
                              : "bg-subtle text-ink",
                        )}
                      >
                        {items.length}
                      </span>
                    </h3>
                    <TaskList tasks={items} showOwner={false} />
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {collaborating.length > 0 && (
          <section>
            <h2 className="kicker mb-2 flex items-center gap-2 text-ink">
              <Users className="h-4 w-4" /> I&apos;m collaborating on
              <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-ink">{collaborating.length}</span>
            </h2>
            <TaskList tasks={collaborating} />
          </section>
        )}
      </div>
    </>
  );
}
