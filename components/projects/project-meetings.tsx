import Link from "next/link";
import { EmptyState } from "@/components/page-header";
import { UnlinkMeetingButton } from "@/components/projects/link-meeting-button";
import { getPeople } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime, todayPKT } from "@/lib/time";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

type Row = { meeting: { id: string; title: string | null; meeting_date: string; meeting_time: string | null; series_id: string | null } | null };

/**
 * A project's meetings: every meeting linked to it, upcoming first, with who
 * was there and how its action items (in this project's tasks) are going.
 */
export async function ProjectMeetings({ project, canUnlink }: { project: Project; canUnlink: boolean }) {
  const supabase = await createClient();
  const today = todayPKT();
  const { data } = await supabase
    .from("meeting_projects")
    .select("meeting:meetings(id, title, meeting_date, meeting_time, series_id)")
    .eq("project_id", project.id);
  const meetings = ((data ?? []) as unknown as Row[]).map((r) => r.meeting).filter((m): m is NonNullable<Row["meeting"]> => !!m);
  const upcoming = meetings.filter((m) => m.meeting_date >= today).sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  const past = meetings.filter((m) => m.meeting_date < today).sort((a, b) => b.meeting_date.localeCompare(a.meeting_date));
  const ids = meetings.map((m) => m.id);
  const [attRes, itemsRes, people] = await Promise.all([
    ids.length ? supabase.from("meeting_attendees").select("meeting_id, user_id").in("meeting_id", ids) : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from("tasks").select("meeting_id, status").in("meeting_id", ids).eq("project_id", project.id).is("parent_task_id", null).neq("status", "cancelled")
      : Promise.resolve({ data: [] }),
    getPeople(),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const who = new Map<string, string[]>();
  for (const a of (attRes.data ?? []) as { meeting_id: string; user_id: string }[]) {
    const p = byId.get(a.user_id);
    if (p) who.set(a.meeting_id, [...(who.get(a.meeting_id) ?? []), personName(p).split(" ")[0]]);
  }
  const counts = new Map<string, { open: number; done: number }>();
  for (const t of (itemsRes.data ?? []) as { meeting_id: string; status: string }[]) {
    const c = counts.get(t.meeting_id) ?? { open: 0, done: 0 };
    if (t.status === "done") c.done++;
    else c.open++;
    counts.set(t.meeting_id, c);
  }

  if (!meetings.length) return <EmptyState>No meetings linked yet. Use “Link a meeting”, or link it from the meeting’s own page.</EmptyState>;

  const row = (m: NonNullable<Row["meeting"]>) => {
    const c = counts.get(m.id) ?? { open: 0, done: 0 };
    const people = who.get(m.id) ?? [];
    return (
      <li key={m.id} className="relative grid gap-2 px-4 py-3 md:grid-cols-[8rem_minmax(0,1fr)_12rem_9rem_auto] md:items-center">
        <span className="text-sm">
          <span className="font-semibold text-ink">{formatDate(m.meeting_date, "EEE d MMM")}</span>
          <span className="block text-xs text-ink-muted">
            {m.meeting_time ? formatTime(m.meeting_time) : ""}
            {m.meeting_date >= today ? `${m.meeting_time ? " · " : ""}upcoming` : ""}
          </span>
        </span>
        <span className="min-w-0">
          <Link href={`/meetings/${m.id}`} className="block truncate font-semibold text-ink hover:underline">
            {m.title || "Meeting"}
          </Link>
          <span className="text-xs text-ink-muted">{m.series_id ? "Recurring" : "One-off"}</span>
        </span>
        <span className="truncate text-sm text-ink-muted">{people.length ? people.slice(0, 4).join(", ") + (people.length > 4 ? ` +${people.length - 4}` : "") : "—"}</span>
        <span className={cn("text-sm font-semibold", c.open ? "text-info-ink" : "text-ink-muted")}>
          {c.open + c.done ? `${c.open} open · ${c.done} done` : "No action items"}
        </span>
        <span className="relative z-10 md:justify-self-end">
          {canUnlink && <UnlinkMeetingButton meetingId={m.id} projectId={project.id} title={m.title || "this meeting"} recurring={!!m.series_id} />}
        </span>
      </li>
    );
  };

  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <h2 className="text-[15px] font-semibold text-ink">Meetings about {project.name}</h2>
        <span className="text-xs text-ink-muted">Their action items are in {project.name}&apos;s tasks</span>
      </div>
      <div className="hidden grid-cols-[8rem_minmax(0,1fr)_12rem_9rem_auto] gap-2 bg-subtle px-4 py-2 text-[13px] font-bold text-ink md:grid">
        <span>When</span>
        <span>Meeting</span>
        <span>Who was there</span>
        <span>Action items</span>
        <span />
      </div>
      <ul className="divide-y divide-line">
        {upcoming.map(row)}
        {past.map(row)}
      </ul>
    </section>
  );
}
