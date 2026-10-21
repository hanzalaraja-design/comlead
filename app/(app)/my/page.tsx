import Link from "next/link";
import { AtSign, CheckCircle2, ChevronDown, TriangleAlert, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TaskList } from "@/components/tasks/task-list";
import { QuickAdd } from "@/components/tasks/quick-add";
import { CelebrateWhenCleared } from "@/components/progress/celebrate";
import { PersonAvatar } from "@/components/person-avatar";
import { MarkMentionsRead } from "@/components/my/mention-buttons";
import { getDepartments, getPeople, isMemberOf, requireViewer, viewerId } from "@/lib/auth";
import { OPEN_STATUSES, personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/tasks/filters";
import { TASK_SELECT, comparePriority, fetchTasks, type TaskListRow } from "@/lib/tasks/queries";
import { addDaysISO, formatDate, formatPKT, todayPKT, weekEndPKT } from "@/lib/time";
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
  const [id, supabase] = await Promise.all([viewerId(), createClient()]);
  const today = todayPKT();
  const weekEnd = weekEndPKT();

  // Everything at once: no query here waits for another.
  const [viewer, departments, { tasks, error }, collabRes, mentionsRes, people, done] = await Promise.all([
    requireViewer(),
    getDepartments(),
    fetchTasks(parseFilters({ owner: "me", sort: "due" }), { viewerId: id }),
    // Open tasks I'm a collaborator on but don't own.
    supabase
      .from("tasks")
      .select(`${TASK_SELECT}, me:task_collaborators!inner(user_id)`)
      .eq("me.user_id", id)
      .in("status", OPEN_STATUSES)
      .or(`owner_id.is.null,owner_id.neq.${id}`)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(100),
    supabase
      .from("task_mentions")
      .select("id, created_at, seen_at, mentioned_by, task:tasks(id, title), comment:task_comments(body)")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(15),
    getPeople(),
    // Done in the last two weeks, newest first.
    fetchTasks(
      { ...parseFilters({ owner: "me" }), status: ["done"], completed_from: addDaysISO(today, -14), sort: "completed", dir: "desc" },
      { viewerId: id },
    ),
  ]);

  const collaborating = (collabRes.data ?? []) as unknown as TaskListRow[];
  // Only mentions you haven't read; opening the task or ticking one clears it.
  const mentions = ((mentionsRes.data ?? []) as unknown as Mention[]).filter((m) => m.task && !m.seen_at);
  const unseen = mentions.length;
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
              <span className="rounded-full bg-brand-primary px-2 py-0.5 text-xs text-white">{unseen} new</span>
              {unseen > 1 && <MarkMentionsRead className="ml-auto normal-case tracking-normal" />}
            </h2>
            <ul className="divide-y divide-line surface">
              {mentions.map((m) => {
                const by = m.mentioned_by ? peopleById.get(m.mentioned_by) : undefined;
                return (
                  <li key={m.id} className="relative flex gap-3 bg-brand-bg/40 px-4 py-3 hover:bg-subtle/60">
                    <PersonAvatar person={by} className="mt-0.5 h-7 w-7" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/tasks/${m.task!.id}#comments`} className="font-semibold text-ink after:absolute after:inset-0">
                        {m.task!.title}
                      </Link>
                      <p className="line-clamp-2 text-sm text-ink-muted">
                        <span className="font-medium text-ink">{personName(by)}:</span> {m.comment?.body}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs text-ink-muted">{formatPKT(m.created_at, "d MMM")}</span>
                      <MarkMentionsRead id={m.id} className="-mr-1.5" />
                    </div>
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

        {done.tasks.length > 0 && (
          <details className="group">
            <summary className="kicker mb-2 flex cursor-pointer list-none items-center gap-2 text-ink [&::-webkit-details-marker]:hidden">
              <CheckCircle2 className="h-4 w-4 text-success" /> Completed
              <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success-ink">{done.tasks.length}</span>
              <span className="text-xs font-normal normal-case tracking-normal text-ink-muted">last 2 weeks</span>
              <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <TaskList tasks={done.tasks} showOwner={false} showCompleted />
            <Link href="/tasks?owner=me&status=done&sort=completed&dir=desc" className="mt-2 inline-block text-sm font-medium text-brand-primary hover:underline">
              See everything you&apos;ve completed
            </Link>
          </details>
        )}

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
