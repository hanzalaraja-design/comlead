import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { addDays, addMinutes, format } from "date-fns";
import { nextOnOrAfter, type Frequency } from "@/lib/series";
import { createAdminClient } from "@/lib/supabase/admin";
import { priorityLabel } from "@/lib/labels";
import { parseISODate, todayPKT, WEEKDAYS } from "@/lib/time";
import { GraphError, calendarMailbox, graph, isCalendarConfigured, userPath } from "./graph";

/**
 * Keeps Outlook in step with the app. Every function is safe to call at any
 * time: it works out what Outlook *should* contain and makes it so. Errors are
 * logged, never thrown, so a Microsoft outage can't break saving a task. The
 * nightly reconcile (/api/cron/calendar) repairs anything that was missed.
 */

const TZ = "Pakistan Standard Time";
const OPEN = ["todo", "in_progress", "blocked"];

type Db = ReturnType<typeof createAdminClient>;
type Link = { id: string; mailbox: string; outlook_event_id: string; synced_hash: string };

function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const isNotFound = (e: unknown) => e instanceof GraphError && (e.status === 404 || e.status === 410);

// When an Admin runs "Sync everything now", failures are collected here so the
// page can show them instead of only writing them to the server log.
const collector = new AsyncLocalStorage<{ label: string; message: string }[]>();

export async function collectSyncErrors<T>(fn: () => Promise<T>): Promise<{ result: T; errors: { label: string; message: string }[] }> {
  const errors: { label: string; message: string }[] = [];
  const result = await collector.run(errors, fn);
  return { result, errors };
}

async function guarded(label: string, fn: () => Promise<void>) {
  if (!isCalendarConfigured()) return;
  try {
    await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[calendar] ${label} failed:`, message);
    collector.getStore()?.push({ label, message });
  }
}

// ---------------------------------------------------------------------------
// Meetings set up in the app (sent from the shared mailbox)
// ---------------------------------------------------------------------------

type SeriesRow = {
  id: string;
  title: string;
  kind: "internal" | "external";
  frequency: Frequency;
  start_date: string;
  meeting_time: string;
  duration_minutes: number;
  external_emails: string[];
  archived: boolean;
};

async function seriesAttendees(db: Db, seriesId: string, external: string[]) {
  const [{ data: people }, { data: depts }] = await Promise.all([
    db.from("meeting_series_people").select("profiles!inner(email, full_name, status)").eq("series_id", seriesId),
    db.from("meeting_series_departments").select("department_id").eq("series_id", seriesId),
  ]);
  const deptIds = (depts ?? []).map((d) => d.department_id as string);
  const { data: members } = deptIds.length
    ? await db.from("department_members").select("profiles!inner(email, full_name, status)").in("department_id", deptIds)
    : { data: [] };
  type P = { profiles: { email: string; full_name: string | null; status: string } };
  const byEmail = new Map<string, string>();
  for (const row of [...((people ?? []) as unknown as P[]), ...((members ?? []) as unknown as P[])]) {
    if (row.profiles.status === "active") byEmail.set(row.profiles.email.toLowerCase(), row.profiles.full_name ?? row.profiles.email);
  }
  for (const e of external) if (!byEmail.has(e.toLowerCase())) byEmail.set(e.toLowerCase(), e);
  return [...byEmail.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([email, name]) => ({ email, name }));
}

export function syncSeries(seriesId: string) {
  return guarded(`meeting ${seriesId}`, async () => {
    const db = createAdminClient();
    const [{ data: series }, { data: links }] = await Promise.all([
      db
        .from("meeting_series")
        .select("id, title, kind, frequency, start_date, meeting_time, duration_minutes, external_emails, archived")
        .eq("id", seriesId)
        .maybeSingle(),
      db.from("calendar_links").select("id, mailbox, outlook_event_id, synced_hash").eq("kind", "meeting_series").eq("series_id", seriesId),
    ]);
    const s = series as SeriesRow | null;
    const link = (links?.[0] ?? null) as Link | null;
    const today = todayPKT();
    // A changed schedule restarts the series from its next occurrence.
    const first = s ? nextOnOrAfter(s, today) : null;

    if (!s || s.archived || !first) {
      if (link && (!s || s.archived)) await cancelSeries(db, link, "This meeting has been cancelled in Highfy Tasks.");
      return; // A past one-off keeps its event as it was.
    }

    const attendees = await seriesAttendees(db, s.id, s.kind === "external" ? s.external_emails : []);
    const time = String(s.meeting_time).slice(0, 5);
    const minutesUrl = `${siteUrl()}/meetings/series/${s.id}`;
    const shape = { ...s, time, first: s.frequency === "once" ? s.start_date : first, attendees: attendees.map((a) => a.email), minutesUrl };
    const fingerprint = hash(shape);
    if (link && link.synced_hash === fingerprint) return;

    const start = parseISODate(first);
    const [h, m] = time.split(":").map(Number);
    start.setHours(h, m, 0, 0);
    const end = addMinutes(start, s.duration_minutes);
    const weekday = WEEKDAYS[(start.getDay() + 6) % 7].toLowerCase();
    const recurrence =
      s.frequency === "once"
        ? null
        : {
            pattern:
              s.frequency === "monthly"
                ? { type: "absoluteMonthly", interval: 1, dayOfMonth: parseISODate(s.start_date).getDate() }
                : { type: "weekly", interval: s.frequency === "weekly" ? 1 : 2, daysOfWeek: [weekday], firstDayOfWeek: "monday" },
            range: { type: "noEnd", startDate: first },
          };
    const event = {
      subject: s.title,
      body: {
        contentType: "HTML",
        content:
          `<p>${escapeHtml(s.title)}.</p>` +
          (s.kind === "internal"
            ? `<p><a href="${minutesUrl}">Open the agenda and minutes</a> in Highfy Tasks to see open action items and take notes.</p>`
            : ""),
      },
      start: { dateTime: format(start, "yyyy-MM-dd'T'HH:mm:ss"), timeZone: TZ },
      end: { dateTime: format(end, "yyyy-MM-dd'T'HH:mm:ss"), timeZone: TZ },
      recurrence,
      attendees: attendees.map((a) => ({ emailAddress: { address: a.email, name: a.name }, type: "required" })),
      allowNewTimeProposals: false,
      responseRequested: true,
    };

    const mailbox = calendarMailbox();
    if (link) {
      try {
        await graph("PATCH", `${userPath(link.mailbox)}/events/${link.outlook_event_id}`, event);
        await db.from("calendar_links").update({ synced_hash: fingerprint, updated_at: new Date().toISOString() }).eq("id", link.id);
        return;
      } catch (e) {
        if (!isNotFound(e)) throw e;
        // Deleted in Outlook: fall through and create a fresh one.
        await db.from("calendar_links").delete().eq("id", link.id);
      }
    }
    const created = await graph<{ id: string }>("POST", `${userPath(mailbox)}/events`, {
      ...event,
      transactionId: `series-${s.id}-${fingerprint}`,
    });
    await db.from("calendar_links").insert({
      kind: "meeting_series",
      series_id: s.id,
      mailbox,
      outlook_event_id: created!.id,
      synced_hash: fingerprint,
    });
  });
}

async function cancelSeries(db: Db, link: Link, comment: string) {
  try {
    // Cancel (rather than delete) so attendees get a cancellation.
    await graph("POST", `${userPath(link.mailbox)}/events/${link.outlook_event_id}/cancel`, { comment });
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  await db.from("calendar_links").delete().eq("id", link.id);
}

/** Meetings that invite a department, so its member list changes the invite. */
export async function syncSeriesForDepartment(departmentId: string) {
  if (!isCalendarConfigured()) return;
  const db = createAdminClient();
  const { data } = await db.from("meeting_series_departments").select("series_id").eq("department_id", departmentId);
  for (const r of data ?? []) await syncSeries(r.series_id as string);
}

/** Every meeting a person is invited to, directly or through a department. */
export async function syncSeriesForUser(userId: string) {
  if (!isCalendarConfigured()) return;
  const db = createAdminClient();
  const [{ data: direct }, { data: memberships }] = await Promise.all([
    db.from("meeting_series_people").select("series_id").eq("user_id", userId),
    db.from("department_members").select("department_id").eq("user_id", userId),
  ]);
  const ids = new Set((direct ?? []).map((r) => r.series_id as string));
  const deptIds = (memberships ?? []).map((m) => m.department_id as string);
  if (deptIds.length) {
    const { data } = await db.from("meeting_series_departments").select("series_id").in("department_id", deptIds);
    for (const r of data ?? []) ids.add(r.series_id as string);
  }
  for (const id of ids) await syncSeries(id);
}

// ---------------------------------------------------------------------------
// Tasks in the owner's own calendar (only if they switched it on)
// ---------------------------------------------------------------------------

export function syncTask(taskId: string) {
  return guarded(`task ${taskId}`, async () => {
    const db = createAdminClient();
    const { data: task } = await db
      .from("tasks")
      .select(
        "id, title, status, priority, due_date, due_time, deleted_at, department:departments(name), owner:profiles!tasks_owner_id_fkey(email, status, outlook_tasks_enabled)",
      )
      .eq("id", taskId)
      .maybeSingle();
    const { data: linkRows } = await db
      .from("calendar_links")
      .select("id, mailbox, outlook_event_id, synced_hash")
      .eq("kind", "task")
      .eq("task_id", taskId);
    const links = (linkRows ?? []) as Link[];

    const t = task as unknown as {
      id: string;
      title: string;
      status: string;
      priority: string;
      due_date: string | null;
      due_time: string | null;
      deleted_at: string | null;
      department: { name: string } | null;
      owner: { email: string; status: string; outlook_tasks_enabled: boolean } | null;
    } | null;

    const wanted =
      t && !t.deleted_at && OPEN.includes(t.status) && t.due_date && t.owner?.status === "active" && t.owner.outlook_tasks_enabled
        ? t.owner.email
        : null;

    // Remove events from calendars that shouldn't have this task any more
    // (owner changed, task done, sync switched off, ...).
    for (const link of links.filter((l) => l.mailbox !== wanted)) {
      try {
        await graph("DELETE", `${userPath(link.mailbox)}/events/${link.outlook_event_id}`);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
      await db.from("calendar_links").delete().eq("id", link.id);
    }
    if (!wanted || !t) return;

    const url = `${siteUrl()}/tasks/${t.id}`;
    const shape = { title: t.title, priority: t.priority, due: t.due_date, time: t.due_time?.slice(0, 5) ?? null, dept: t.department?.name, url };
    const fingerprint = hash(shape);
    const link = links.find((l) => l.mailbox === wanted);
    if (link && link.synced_hash === fingerprint) return;

    let start: Date;
    let end: Date;
    const allDay = !t.due_time;
    if (allDay) {
      start = parseISODate(t.due_date!);
      start.setHours(0, 0, 0, 0);
      end = addDays(start, 1);
    } else {
      start = parseISODate(t.due_date!);
      const [h, m] = t.due_time!.split(":").map(Number);
      start.setHours(h, m, 0, 0);
      end = addMinutes(start, 30);
    }
    const event = {
      subject: `Task: ${t.title}`,
      body: {
        contentType: "HTML",
        content:
          `<p>${escapeHtml(t.department?.name ?? "")} · ${priorityLabel(t.priority as never)} priority</p>` +
          `<p><a href="${url}">Open the task in Highfy Tasks</a></p>`,
      },
      start: { dateTime: format(start, "yyyy-MM-dd'T'HH:mm:ss"), timeZone: TZ },
      end: { dateTime: format(end, "yyyy-MM-dd'T'HH:mm:ss"), timeZone: TZ },
      isAllDay: allDay,
      showAs: "free",
      isReminderOn: !allDay,
      ...(allDay ? {} : { reminderMinutesBeforeStart: 15 }),
      categories: ["Highfy Tasks"],
    };

    if (link) {
      try {
        await graph("PATCH", `${userPath(wanted)}/events/${link.outlook_event_id}`, event);
        await db.from("calendar_links").update({ synced_hash: fingerprint, updated_at: new Date().toISOString() }).eq("id", link.id);
        return;
      } catch (e) {
        if (!isNotFound(e)) throw e;
        await db.from("calendar_links").delete().eq("id", link.id);
      }
    }
    const created = await graph<{ id: string }>("POST", `${userPath(wanted)}/events`, {
      ...event,
      transactionId: `task-${t.id}-${fingerprint}`,
    });
    await db.from("calendar_links").insert({
      kind: "task",
      task_id: t.id,
      mailbox: wanted,
      outlook_event_id: created!.id,
      synced_hash: fingerprint,
    });
  });
}

/** All tasks a person owns, plus any task events already in their calendar. */
export async function syncUserTasks(userId: string) {
  if (!isCalendarConfigured()) return;
  const db = createAdminClient();
  const [{ data: owned }, { data: profile }] = await Promise.all([
    db.from("tasks").select("id").eq("owner_id", userId).is("deleted_at", null).not("due_date", "is", null),
    db.from("profiles").select("email").eq("id", userId).maybeSingle(),
  ]);
  const ids = new Set((owned ?? []).map((t) => t.id as string));
  if (profile?.email) {
    const { data: inCalendar } = await db.from("calendar_links").select("task_id").eq("kind", "task").eq("mailbox", profile.email);
    for (const l of inCalendar ?? []) ids.add(l.task_id as string);
  }
  for (const id of ids) await syncTask(id);
}

export async function syncTasksForMeeting(meetingId: string) {
  if (!isCalendarConfigured()) return;
  const db = createAdminClient();
  const { data } = await db.from("tasks").select("id").eq("meeting_id", meetingId);
  for (const t of data ?? []) await syncTask(t.id as string);
}

/** Nightly repair: every meeting and every task that should (or no longer should) be in Outlook. */
export async function reconcileAll(): Promise<{ departments: number; tasks: number }> {
  if (!isCalendarConfigured()) return { departments: 0, tasks: 0 };
  const db = createAdminClient();
  const { data: series } = await db.from("meeting_series").select("id");
  for (const r of series ?? []) await syncSeries(r.id as string);
  // Invites from the old per-department schedule that weren't carried over.
  const { data: oldLinks } = await db.from("calendar_links").select("id, mailbox, outlook_event_id, synced_hash").eq("kind", "department_series");
  for (const l of (oldLinks ?? []) as Link[]) {
    await guarded("old department invite", () => cancelSeries(db, l, "This meeting has moved to a new invite."));
  }

  const { data: optedIn } = await db.from("profiles").select("id").eq("outlook_tasks_enabled", true).eq("status", "active");
  const owners = (optedIn ?? []).map((p) => p.id as string);
  const taskIds = new Set<string>();
  if (owners.length) {
    const { data } = await db
      .from("tasks")
      .select("id")
      .in("owner_id", owners)
      .in("status", OPEN)
      .is("deleted_at", null)
      .not("due_date", "is", null)
      .limit(5000);
    for (const t of data ?? []) taskIds.add(t.id as string);
  }
  const { data: taskLinks } = await db.from("calendar_links").select("task_id").eq("kind", "task");
  for (const l of taskLinks ?? []) taskIds.add(l.task_id as string);
  for (const id of taskIds) await syncTask(id);
  return { departments: (series ?? []).length, tasks: taskIds.size };
}
