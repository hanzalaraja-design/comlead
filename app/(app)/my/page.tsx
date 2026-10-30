import Link from "next/link";
import { AtSign, CheckCircle2, ChevronDown, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { TaskList } from "@/components/tasks/task-list";
import { cookies } from "next/headers";
import { RememberRole } from "@/components/tasks/remember-role";
import { QuickAdd } from "@/components/tasks/quick-add";
import { CelebrateWhenCleared } from "@/components/progress/celebrate";
import { PersonAvatar } from "@/components/person-avatar";
import { MarkMentionsRead } from "@/components/my/mention-buttons";
import { getDepartments, getPeople, isMemberOf, requireViewer, viewerId } from "@/lib/auth";
import { OPEN_STATUSES, personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { countActiveFilters, filtersToSearch, parseFilters, type TaskFilters } from "@/lib/tasks/filters";
import { getFilterOptions } from "@/lib/tasks/filter-options";
import { TaskFilterBar } from "@/components/tasks/task-filter-bar";
import { TaskTabs } from "@/components/tasks/task-tabs";
import { comparePriority, fetchTasks, withTaskSelect, type TaskListRow } from "@/lib/tasks/queries";
import { addDaysISO, formatDate, formatPKT, startOfDayPKT, todayPKT, weekEndPKT } from "@/lib/time";
import { onTimeStatus } from "@/lib/tasks/ontime";
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

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [id, supabase, raw] = await Promise.all([viewerId(), createClient(), searchParams]);
  // Yours, always; the filter bar narrows it further.
  const filters: TaskFilters = { ...parseFilters(raw), owner: ["me"] };
  const filtered = countActiveFilters({ ...filters, owner: [] }) > 0;
  // Owner, collaborator or both: which of your tasks to show.
  // Opens on the last one you picked; "I own" the first time.
  const asked = raw.role === "own" || raw.role === "collab" || raw.role === "both" ? raw.role : (await cookies()).get("my_role")?.value;
  const role = asked === "collab" || asked === "both" ? asked : "own";
  const today = todayPKT();
  const weekEnd = weekEndPKT();

  // Everything at once: no query here waits for another.
  const monthStart = `${today.slice(0, 7)}-01`;
  const [viewer, departments, { tasks, error }, collabRes, mentionsRes, people, done, options, monthDone] = await Promise.all([
    requireViewer(),
    getDepartments(),
    fetchTasks({ ...filters, sort: "due", dir: "asc" }, { viewerId: id }),
    // Open tasks I'm a collaborator on but don't own.
    withTaskSelect((select) =>
      supabase
        .from("tasks")
        .select(`${select}, me:task_collaborators!inner(user_id)`)
        .eq("me.user_id", id)
        .in("status", OPEN_STATUSES)
        .or(`owner_id.is.null,owner_id.neq.${id}`)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(100),
    ),
    supabase
      .from("task_mentions")
      .select("id, created_at, seen_at, mentioned_by, task:tasks(id, title), comment:task_comments(body)")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(15),
    getPeople(),
    // Done: the dates picked in When, or the last 30 days. Newest first.
    fetchTasks(
      filters.when.length
        ? { ...filters, status: ["done"], sort: "completed", dir: "desc" }
        : { ...filters, status: ["done"], completed_from: addDaysISO(today, -29), sort: "completed", dir: "desc" },
      { viewerId: id },
      200,
    ),
    getFilterOptions(),
    // On time this month: your finished tasks that had a due date.
    supabase
      .from("tasks")
      .select("due_date, completed_at")
      .eq("owner_id", id)
      .eq("status", "done")
      .not("due_date", "is", null)
      .gte("completed_at", startOfDayPKT(monthStart))
      .limit(1000),
  ]);
  const scored = ((monthDone.data ?? []) as { due_date: string; completed_at: string }[]).map((t) => onTimeStatus(t.due_date, t.completed_at)).filter((x) => !!x);
  const onTimeCount = scored.filter((x) => x!.onTime).length;

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

  const collabSection = (
    <section>
      <h2 className="kicker mb-2 flex items-center gap-2 text-ink">
        <span className="rounded-md border border-ink px-2 py-0.5 text-[11px] font-bold normal-case tracking-normal text-ink">Collaborating</span>
        Tasks I help on
        <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-ink">{collaborating.length}</span>
      </h2>
      {collaborating.length ? (
        <TaskList tasks={collaborating} from="my" />
      ) : (
        <p className="surface px-4 py-6 text-center text-sm text-ink-muted">You’re not collaborating on anything open right now.</p>
      )}
    </section>
  );

  // This month's on-time score.
  const onTimeChip = (className: string) =>
    scored.length > 0 && (
      <span className={cn("items-center gap-2 rounded-[12px] bg-white px-3 py-2 text-[13px] text-ink shadow-sm", className)}>
        <span className={cn("font-bold", onTimeCount / scored.length >= 0.8 ? "text-success-ink" : "text-warning-ink")}>
          {Math.round((onTimeCount / scored.length) * 100)}% on time
        </span>
        <span className="text-ink-muted">
          {onTimeCount} of {scored.length} finished by their due date this month
        </span>
      </span>
    );

  return (
    <>
      <PageHeader
        breadcrumb={["Tasks", "My tasks"]}
        title="My tasks"
        description={formatDate(today, "EEEE d MMMM")}
      />
      <TaskTabs scope="my" view="list" search={filtersToSearch({ ...filters, owner: [] })} />
      <RememberRole role={role} />
      {/* Pinned while you scroll, so switching never means scrolling back up. */}
      <div className="sticky top-14 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b border-transparent bg-background/95 px-4 py-2 backdrop-blur md:top-0 md:-mx-12 md:px-12">
        {(
          [
            ["own", "I own", tasks.length],
            ["collab", "Collaborating", collaborating.length],
            ["both", "All", tasks.length + collaborating.length],
          ] as const
        ).map(([key, label, n]) => {
          const params = new URLSearchParams(filtersToSearch({ ...filters, owner: [] }).slice(1));
          params.set("role", key);
          const qs = params.toString();
          return (
            <Link
              key={key}
              href={`/my${qs ? `?${qs}` : ""}`}
              aria-current={role === key ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold",
                role === key ? "bg-ink text-white" : "border border-line bg-white text-ink hover:bg-subtle",
              )}
            >
              {label}
              {n !== null && <span className={cn("rounded-full px-2 text-xs", role === key ? "bg-white/20" : "bg-subtle")}>{n}</span>}
            </Link>
          );
        })}
        {onTimeChip("ml-auto hidden md:inline-flex")}
      </div>
      {/* On phones it sits below the switch, so the pinned bar stays one line. */}
      {onTimeChip("mb-4 inline-flex md:hidden")}
      {!filtered && <CelebrateWhenCleared remaining={overdue + dueToday} line={clearedLine(today + viewer.id)} />}

      {/* Today at a glance (only when nothing is filtered, so the counts are the whole picture) */}
      {!filtered && <div
        className={cn(
          "mb-4 flex items-center gap-3 rounded-[20px] px-4 py-3 text-[15px] font-medium",
          state.tone === "bad" ? "bg-danger-soft text-danger-ink" : "bg-success-soft text-success-ink",
        )}
      >
        {state.tone === "bad" ? <TriangleAlert className="h-5 w-5 shrink-0" /> : <CheckCircle2 className="h-5 w-5 shrink-0" />}
        <span className="flex-1">{state.text}</span>
        <Link href="/my?status=done&sort=completed&dir=desc&when=all" className="shrink-0 text-sm font-medium underline-offset-2 hover:underline">
          Completed
        </Link>
      </div>}

      <div className="mb-6">
        <QuickAdd departments={myDepartments.map((d) => ({ id: d.id, name: d.name }))} mine />
      </div>

      <TaskFilterBar filters={filters} options={options} hide={["owner", "sort"]} preserve={{ role }} />
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

        {role === "collab" && collabSection}

        {role !== "collab" && <section>
          <h2 className="kicker mb-2 flex items-center gap-2 text-ink">
            <span className="rounded-md bg-ink px-2 py-0.5 text-[11px] font-bold normal-case tracking-normal text-white">Owner</span> Tasks I own
          </h2>
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
                    <TaskList tasks={items} from="my" />
                  </div>
                );
              })}
            </div>
          )}
        </section>}

        {role !== "collab" && done.tasks.length > 0 && (
          <details className="group">
            <summary className="kicker mb-2 flex cursor-pointer list-none items-center gap-2 text-ink [&::-webkit-details-marker]:hidden">
              <CheckCircle2 className="h-4 w-4 text-success" /> Completed
              <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success-ink">{done.tasks.length}</span>
              <span className="text-xs font-normal normal-case tracking-normal text-ink-muted">{filters.when.length ? "in the dates you picked" : "last 30 days"}</span>
              <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <TaskList tasks={done.tasks} showCompleted from="my" />
            <Link href="/my?status=done&sort=completed&dir=desc&when=all" className="mt-2 inline-block text-sm font-medium text-brand-primary hover:underline">
              See everything you&apos;ve completed
            </Link>
          </details>
        )}

        {role === "both" && collabSection}
      </div>
    </>
  );
}
