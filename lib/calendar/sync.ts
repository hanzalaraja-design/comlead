import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { addDays, addMinutes, format } from "date-fns";
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
// Department weekly meeting series (sent from the shared mailbox)
// ---------------------------------------------------------------------------

/** Next date (PKT) on or after today that falls on ISO weekday 1–7. */
function nextOccurrence(weekday: number): string {
  const today = parseISODate(todayPKT());
  const iso = today.getDay() === 0 ? 7 : today.getDay();
  return format(addDays(today, (weekday - iso + 7) % 7), "yyyy-MM-dd");
}

export function syncDepartmentSeries(departmentId: string) {
  return guarded(`department ${departmentId}`, async () => {
    const db = createAdminClient();
    const { data: dept } = await db
      .from("departments")
      .select("id, name, slug, archived, meeting_weekday, meeting_time, meeting_duration_minutes")
      .eq("id", departmentId)
      .maybeSingle();
    const { data: links } = await db
      .from("calendar_links")
      .select("id, mailbox, outlook_event_id, synced_hash")
      .eq("kind", "department_series")
      .eq("department_id", departmentId);
    const link = (links?.[0] ?? null) as Link | null;

    // No series wanted: department gone/archived or no schedule.
    if (!dept || dept.archived || !dept.meeting_weekday || !dept.meeting_time) {
      if (link) await cancelSeries(db, link, "This weekly meeting is no longer scheduled in Highfy Tasks.");
      return;
    }

    const { data: members } = await db
      .from("department_members")
      .select("profiles!inner(email, full_name, status)")
      .eq("department_id", departmentId);
    const attendees = ((members ?? []) as unknown as { profiles: { email: string; full_name: string | null; status: string } }[])
      .map((m) => m.profiles)
      .filter((p) => p.status === "active")
      .sort((a, b) => a.email.localeCompare(b.email));

    const time = String(dept.meeting_time).slice(0, 5);
    const duration = dept.meeting_duration_minutes ?? 60;
    const minutesUrl = `${siteUrl()}/meetings/this-week/${dept.slug}`;
    const shape = { name: dept.name, weekday: dept.meeting_weekday, time, duration, attendees: attendees.map((a) => a.email), minutesUrl };
    const fingerprint = hash(shape);
    if (link && link.synced_hash === fingerprint) return;

    // A changed schedule restarts the series from its next occurrence.
    const startDate = nextOccurrence(dept.meeting_weekday);
    const start = parseISODate(startDate);
    const [h, m] = time.split(":").map(Number);
    start.setHours(h, m, 0, 0);
    const end = addMinutes(start, duration);
    const event = {
      subject: `${dept.name} weekly meeting`,
      body: {
        contentType: "HTML",
        content:
          `<p>Weekly ${escapeHtml(dept.name)} meeting.</p>` +
          `<p><a href="${minutesUrl}">Open this week's minutes</a> to see last week's action items and take notes.</p>`,
      },
      start: { dateTime: format(start, "yyyy-MM-dd'T'HH:mm:ss"), timeZone: TZ },
      end: { dateTime: format(end, "yyyy-MM-dd'T'HH:mm:ss"), timeZone: TZ },
      recurrence: {
        pattern: {
          type: "weekly",
          interval: 1,
          daysOfWeek: [WEEKDAYS[dept.meeting_weekday - 1].toLowerCase()],
          firstDayOfWeek: "monday",
        },
        range: { type: "noEnd", startDate },
      },
      attendees: attendees.map((a) => ({
        emailAddress: { address: a.email, name: a.full_name ?? a.email },
        type: "required",
      })),
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
      transactionId: `dept-${departmentId}-${fingerprint}`,
    });
    await db.from("calendar_links").insert({
      kind: "department_series",
      department_id: departmentId,
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

/** Re-sync the series of every department a person belongs to. */
export async function syncDepartmentsForUser(userId: string) {
  if (!isCalendarConfigured()) return;
  const db = createAdminClient();
  const { data } = await db.from("department_members").select("department_id").eq("user_id", userId);
  for (const m of data ?? []) await syncDepartmentSeries(m.department_id as string);
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

/** Nightly repair: every department series and every task that should (or no longer should) be in Outlook. */
export async function reconcileAll(): Promise<{ departments: number; tasks: number }> {
  if (!isCalendarConfigured()) return { departments: 0, tasks: 0 };
  const db = createAdminClient();
  const { data: depts } = await db.from("departments").select("id");
  const { data: seriesLinks } = await db.from("calendar_links").select("department_id").eq("kind", "department_series");
  const deptIds = new Set([...(depts ?? []).map((d) => d.id as string), ...(seriesLinks ?? []).map((l) => l.department_id as string)]);
  for (const id of deptIds) await syncDepartmentSeries(id);

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
  return { departments: deptIds.size, tasks: taskIds.size };
}
