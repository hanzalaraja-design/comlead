import Link from "next/link";
import { Settings } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { PersonAvatar } from "@/components/person-avatar";
import { MarkAllRead } from "@/components/notifications/mark-read";
import { getPeople, viewerId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, formatPKT, todayPKT } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Notifications · Highfy Tasks" };

type Row = { id: string; kind: string; actor_id: string | null; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string };

const SHOW = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "mentions", label: "Mentions" },
  { key: "tasks", label: "Tasks" },
  { key: "design", label: "Placements and design" },
] as const;
const TASK_KINDS = ["assigned", "collaborator", "comment", "finished", "status", "due", "edits", "roundup", "due_tomorrow", "project_task", "project_added", "meeting"];
const DESIGN_KINDS = ["design_new", "my_requests", "revision", "ending", "homepage_today"];

/** Everything that happened that concerns you, newest first; unread ones stand out. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const [{ show: raw }, id, supabase, people] = await Promise.all([searchParams, viewerId(), createClient(), getPeople()]);
  const show = SHOW.some((s) => s.key === raw) ? raw! : "all";
  let q = supabase.from("notifications").select("id, kind, actor_id, title, body, href, read_at, created_at").eq("user_id", id).eq("in_feed", true);
  if (show === "unread") q = q.is("read_at", null);
  if (show === "mentions") q = q.eq("kind", "mention");
  if (show === "tasks") q = q.in("kind", TASK_KINDS);
  if (show === "design") q = q.in("kind", DESIGN_KINDS);
  const [{ data }, { count: unread }] = await Promise.all([
    q.order("created_at", { ascending: false }).limit(150),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", id).eq("in_feed", true).is("read_at", null),
  ]);
  const rows = (data ?? []) as Row[];
  const byId = new Map(people.map((p) => [p.id, p]));

  // Today, Yesterday, This week, Earlier.
  const today = todayPKT();
  const day = (ts: string) => formatPKT(ts, "yyyy-MM-dd");
  const bucket = (ts: string) => {
    const d = day(ts);
    if (d === today) return "Today";
    if (d === addDaysISO(today, -1)) return "Yesterday";
    if (d > addDaysISO(today, -7)) return "Earlier this week";
    return "Older";
  };
  const groups: { label: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const label = bucket(r.created_at);
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(r);
    else groups.push({ label, rows: [r] });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description="Tasks given to you, comments, mentions, finished work, design requests and reminders."
        actions={
          <div className="flex items-center gap-3">
            {!!unread && <MarkAllRead />}
            <Link href="/settings#notifications" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
              <Settings className="h-4 w-4" /> Settings
            </Link>
          </div>
        }
      />
      <nav aria-label="Show" className="mb-4 flex flex-wrap gap-2">
        {SHOW.map((s) => (
          <Link
            key={s.key}
            href={s.key === "all" ? "/notifications" : `/notifications?show=${s.key}`}
            aria-current={show === s.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-semibold",
              show === s.key ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink/40",
            )}
          >
            {s.label}
            {s.key === "unread" && !!unread && <span className="ml-1.5 opacity-80">{unread}</span>}
          </Link>
        ))}
      </nav>
      {groups.length ? (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="kicker mb-2 text-ink">{g.label}</h2>
              <ul className="divide-y divide-line surface">
                {g.rows.map((n) => {
                  const isNew = !n.read_at;
                  return (
                    <li key={n.id} className={cn("relative flex gap-3 px-4 py-3 hover:bg-subtle/60", isNew && "bg-brand-bg/40")}>
                      <PersonAvatar person={n.actor_id ? byId.get(n.actor_id) : undefined} className="mt-0.5 h-8 w-8" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/notifications/${n.id}`} prefetch={false} className={cn("text-sm leading-snug after:absolute after:inset-0", isNew ? "font-semibold text-ink" : "text-ink")}>
                          {n.title}
                        </Link>
                        {n.body && <p className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{n.body}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="text-xs text-ink-muted">{formatPKT(n.created_at, day(n.created_at) === today ? "h:mm a" : "d MMM, h:mm a")}</span>
                        {isNew && <span aria-label="Unread" className="h-2 w-2 rounded-full bg-brand-primary" />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState>
          {show === "unread" ? "You're all caught up." : show === "mentions" ? "No one has mentioned you yet." : "Nothing yet. When someone gives you a task, comments or finishes something you're waiting on, it shows up here."}
        </EmptyState>
      )}
    </div>
  );
}
