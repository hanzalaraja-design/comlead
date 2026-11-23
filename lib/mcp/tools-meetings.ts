import "server-only";
import { siteUrl, syncSeries, syncTasksForMeeting } from "@/lib/calendar/sync";
import { syncLater } from "@/lib/calendar/schedule";
import { formatDate } from "@/lib/time";
import type { KeyUser } from "@/lib/mcp/keys";
import {
  UserError,
  UUID,
  str,
  date,
  oneOf,
  id,
  richText,
  findPerson,
  findTeam,
  findProject,
  failed,
  strings,
  WRITE,
  type Args,
  type Tool,
} from "@/lib/mcp/helpers";

/**
 * Meetings: change a meeting, link it to projects, place its action items,
 * and set up or change a recurring meeting (with its Outlook invite).
 * Only adds and changes: nothing here removes people, unlinks or cancels.
 */

const FREQUENCIES = ["once", "weekly", "fortnightly", "monthly"];
const FREQUENCY_LABEL: Record<string, string> = { once: "one-off", weekly: "weekly", fortnightly: "fortnightly", monthly: "monthly" };
const TIME = /^\d{2}:\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function time(a: Args, k: string): string | undefined {
  const v = str(a, k, 5);
  if (v !== undefined && !TIME.test(v)) throw new UserError(`"${k}" should look like 14:30.`);
  return v;
}

function emails(a: Args, k: string): string[] {
  const v = a[k];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new UserError(`"${k}" should be a list of email addresses.`);
  const out = (v as string[]).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const bad = out.find((e) => !EMAIL.test(e));
  if (bad) throw new UserError(`"${bad}" isn't a valid email address.`);
  if (out.length > 100) throw new UserError("At most 100 outside guests.");
  return out;
}

function duration(a: Args): number | undefined {
  if (a.duration_minutes === undefined || a.duration_minutes === null) return undefined;
  const n = Number(a.duration_minutes);
  if (!Number.isInteger(n) || n < 15 || n > 480) throw new UserError('"duration_minutes" should be a whole number from 15 to 480.');
  return n;
}

async function personIds(u: KeyUser, who: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const w of who) out.push((await findPerson(u, w)).id);
  return out;
}

async function teamIds(u: KeyUser, names: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const n of names) out.push((await findTeam(u, n)).id);
  return out;
}

async function projectIds(u: KeyUser, names: string[]): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (const n of names) out.push(await findProject(u, n));
  return out;
}

const isMissingFn = (msg: string | undefined, fn: string) => new RegExp(fn).test(msg ?? "") && /function|schema cache/i.test(msg ?? "");

type Series = {
  id: string;
  title: string;
  department_id: string;
  kind: "internal" | "external";
  frequency: string;
  start_date: string;
  meeting_time: string;
  duration_minutes: number;
  external_emails: string[];
};
const SERIES_COLUMNS = "id, title, department_id, kind, frequency, start_date, meeting_time, duration_minutes, external_emails";

/** A recurring meeting by id, by a meeting in it, or by name. Cancelled ones are left out. */
async function findSeries(u: KeyUser, a: Args): Promise<Series> {
  const which = str(a, "recurring_meeting", 200);
  let seriesId: string | null = null;
  if (a.meeting_id) {
    const { data: m } = await u.db.from("meetings").select("series_id").eq("id", id(a, "meeting_id")).maybeSingle();
    if (!m) throw new UserError("No meeting with that id that you can see.");
    if (!m.series_id) throw new UserError("That meeting isn't part of a recurring meeting.");
    seriesId = m.series_id as string;
  } else if (which && UUID.test(which)) {
    seriesId = which;
  }
  if (seriesId) {
    const { data, error } = await u.db.from("meeting_series").select(SERIES_COLUMNS).eq("id", seriesId).eq("archived", false).maybeSingle();
    if (error) failed(error, "read that recurring meeting");
    if (!data) throw new UserError("No recurring meeting with that id that you can see.");
    return data as Series;
  }
  if (!which) throw new UserError('Say which recurring meeting: give "recurring_meeting" (its name or id) or "meeting_id" (one meeting in it).');
  const { data, error } = await u.db.from("meeting_series").select(SERIES_COLUMNS).eq("archived", false).order("title").limit(300);
  if (error) failed(error, "read recurring meetings");
  const all = (data ?? []) as Series[];
  const q = which.toLowerCase();
  const exact = all.filter((s) => s.title.toLowerCase() === q);
  const loose = exact.length ? exact : all.filter((s) => s.title.toLowerCase().includes(q));
  if (loose.length === 1) return loose[0];
  if (!loose.length) throw new UserError(`No recurring meeting called "${which}" that you can see.${all.length ? ` Recurring meetings: ${all.slice(0, 15).map((s) => s.title).join(", ")}.` : ""}`);
  throw new UserError(`"${which}" matches several: ${loose.slice(0, 6).map((s) => `${s.title} (id ${s.id})`).join(", ")}. Use its id.`);
}

/** Add to the invite list and linked projects; never takes anyone or anything off. */
async function addInvitesAndLinks(u: KeyUser, seriesId: string, depts: string[], people: string[], projects: string[] | null) {
  const [{ data: haveDepts }, { data: havePeople }] = await Promise.all([
    u.db.from("meeting_series_departments").select("department_id").eq("series_id", seriesId),
    u.db.from("meeting_series_people").select("user_id").eq("series_id", seriesId),
  ]);
  const oldDepts = new Set((haveDepts ?? []).map((r) => r.department_id as string));
  const oldPeople = new Set((havePeople ?? []).map((r) => r.user_id as string));
  const newDepts = [...new Set(depts)].filter((d) => !oldDepts.has(d));
  const newPeople = [...new Set(people)].filter((p) => !oldPeople.has(p));
  if (newDepts.length) {
    const { error } = await u.db.from("meeting_series_departments").insert(newDepts.map((department_id) => ({ series_id: seriesId, department_id })));
    if (error) failed(error, "invite those teams");
  }
  if (newPeople.length) {
    const { error } = await u.db.from("meeting_series_people").insert(newPeople.map((user_id) => ({ series_id: seriesId, user_id })));
    if (error) failed(error, "invite those people");
  }
  if (projects?.length) {
    const { data: current } = await u.db.from("meeting_series_projects").select("project_id").eq("series_id", seriesId);
    const keep = (current ?? []).map((r) => r.project_id as string);
    const all = [...new Set([...keep, ...projects])];
    if (all.length > 20) throw new UserError("A meeting can be linked to at most 20 projects.");
    const { error } = await u.db.rpc("set_series_projects", { p_series: seriesId, p_projects: all });
    if (error && !/set_series_projects/.test(error.message ?? "")) failed(error, "link it to those projects");
  }
}

const seriesProps = {
  title: { type: "string" },
  team: { type: "string", description: "Its home team: who can see and manage it." },
  kind: { type: "string", enum: ["internal", "external"], description: "External meetings can invite outside guests by email." },
  frequency: { type: "string", enum: FREQUENCIES },
  start_date: { type: "string", description: "YYYY-MM-DD, the first meeting." },
  time: { type: "string", description: "HH:MM, 24-hour, Pakistan time." },
  duration_minutes: { type: "number", description: "15 to 480." },
  external_emails: { type: "array", items: { type: "string" }, description: "Outside guests (external meetings only)." },
  invite_teams: { type: "array", items: { type: "string" }, description: "Whole teams to invite." },
  invite_people: { type: "array", items: { type: "string" }, description: "Names or emails." },
  projects: { type: "array", items: { type: "string" }, description: "Projects, campaigns or partnerships it's about (ones you're in)." },
};

function seriesSummary(s: { id: string; title: string; frequency: string; start_date: string; meeting_time: string; duration_minutes: number }) {
  return `"${s.title}", ${FREQUENCY_LABEL[s.frequency] ?? s.frequency} from ${formatDate(s.start_date, "EEE d MMM yyyy")} at ${String(s.meeting_time).slice(0, 5)} for ${s.duration_minutes} minutes. id ${s.id} · ${siteUrl()}/meetings/series/${s.id}`;
}

export const MEETING_TOOLS: Tool[] = [
  {
    name: "update_meeting",
    description:
      "Change a meeting: title, date, time, agenda or minutes, and add attendees. Only the fields you give change. Attendees are only added, never removed. Only people in the meeting, whoever logged it or the team admin can edit it.",
    inputSchema: {
      type: "object",
      properties: {
        meeting_id: { type: "string" },
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD." },
        time: { type: "string", description: "HH:MM, 24-hour." },
        agenda: { type: "string", description: "Replaces the agenda. Plain text." },
        minutes: { type: "string", description: "Replaces the minutes. Plain text is fine." },
        add_to_minutes: { type: "string", description: "Added to the end of the minutes, keeping what's there." },
        add_attendees: { type: "array", items: { type: "string" }, description: "Names or emails." },
      },
      required: ["meeting_id"],
    },
    annotations: WRITE,
    async run(u, a) {
      const meetingId = id(a, "meeting_id");
      const { data: m, error: readErr } = await u.db.from("meetings").select("id, title, minutes").eq("id", meetingId).maybeSingle();
      if (readErr) failed(readErr, "read that meeting");
      if (!m) throw new UserError("No meeting with that id that you can see.");
      if (a.date === null) throw new UserError("A meeting needs a date.");

      const patch: Record<string, unknown> = {};
      const title = str(a, "title", 200);
      if (title) patch.title = title;
      const d = date(a, "date");
      if (d) patch.meeting_date = d;
      const t = time(a, "time");
      if (t) patch.meeting_time = t;
      const agenda = str(a, "agenda", 20000);
      if (agenda) patch.agenda = agenda;
      const minutes = str(a, "minutes", 50000);
      const more = str(a, "add_to_minutes", 50000);
      if (minutes && more) throw new UserError('Give "minutes" or "add_to_minutes", not both.');
      if (minutes) patch.minutes = richText(minutes);
      if (more) patch.minutes = `${(m.minutes as string | null) ?? ""}${richText(more)}`;

      // Everyone to add, checked before anything changes.
      const people = await Promise.all(strings(a, "add_attendees").map((w) => findPerson(u, w)));
      if (!Object.keys(patch).length && !people.length) throw new UserError("Nothing to change: give a title, date, time, agenda, minutes or attendees.");

      const done: string[] = [];
      if (Object.keys(patch).length) {
        const { data: updated, error } = await u.db.from("meetings").update(patch).eq("id", meetingId).select("id");
        if (error) failed(error, "change that meeting");
        if (!updated?.length) throw new UserError("Only people in this meeting, whoever logged it or the team admin can edit it.");
        if (patch.title) done.push(`title "${title}"`);
        if (patch.meeting_date) done.push(`date ${formatDate(d!, "EEE d MMM yyyy")}`);
        if (patch.meeting_time) done.push(`time ${t}`);
        if (patch.agenda) done.push("agenda");
        if (minutes) done.push("minutes");
        if (more) done.push("added to the minutes");
      }
      if (people.length) {
        const { data: current } = await u.db.from("meeting_attendees").select("user_id").eq("meeting_id", meetingId);
        const have = new Set((current ?? []).map((r) => r.user_id as string));
        const add = [...new Set(people.map((p) => p.id))].filter((p) => !have.has(p));
        if (add.length) {
          const { error } = await u.db.from("meeting_attendees").insert(add.map((user_id) => ({ meeting_id: meetingId, user_id })));
          if (error) failed(error, "add those attendees");
        }
        const names = people.filter((p) => add.includes(p.id)).map((p) => p.label);
        done.push(names.length ? `added ${[...new Set(names)].join(", ")}` : "attendees were already in it");
      }
      syncLater(() => syncTasksForMeeting(meetingId));
      return `Updated "${title ?? ((m.title as string | null) || "Meeting")}": ${done.join(", ")}. ${siteUrl()}/meetings/${meetingId}`;
    },
  },
  {
    name: "link_meeting_to_projects",
    description:
      "Link a meeting to projects, campaigns or partnerships you're in. Existing links stay. New action items go into the first project linked. Optionally move its action items that aren't in a project yet, and link every future meeting in its recurring series too.",
    inputSchema: {
      type: "object",
      properties: {
        meeting_id: { type: "string" },
        projects: { type: "array", items: { type: "string" }, description: "Names of projects, campaigns or partnerships." },
        move_action_items: { type: "boolean", description: "Move its action items that aren't in a project into it. Default false." },
        whole_series: { type: "boolean", description: "Also link every future meeting in its recurring series. Default false." },
      },
      required: ["meeting_id", "projects"],
    },
    annotations: WRITE,
    async run(u, a) {
      const meetingId = id(a, "meeting_id");
      const names = strings(a, "projects");
      if (!names.length) throw new UserError('Give at least one project in "projects".');
      const { data: m } = await u.db.from("meetings").select("id, title, series_id").eq("id", meetingId).maybeSingle();
      if (!m) throw new UserError("No meeting with that id that you can see.");
      const projects = await projectIds(u, names);
      const move = a.move_action_items === true;
      const series = a.whole_series === true;
      if (series && !m.series_id) throw new UserError("That meeting isn't part of a recurring meeting. Leave out whole_series.");

      const out: string[] = [];
      for (const p of projects) {
        const { error } = await u.db.rpc("link_meeting", { p_meeting: meetingId, p_project: p.id, p_move: move, p_series: series });
        if (!error) {
          out.push(`Linked to ${p.name}.`);
          continue;
        }
        if (isMissingFn(error.message, "link_meeting")) {
          // Before the database has linking functions: link the way it used to.
          const { error: e2 } = await u.db.from("meeting_projects").insert({ meeting_id: meetingId, project_id: p.id });
          if (!e2 || e2.code === "23505") {
            out.push(`Linked to ${p.name} (this meeting only).`);
            continue;
          }
          out.push(`Not linked to ${p.name}: ${e2.message}`);
        } else if (/privilege|permission|row-level/i.test(error.message ?? "")) {
          out.push(`Not linked to ${p.name}: only people who can edit the meeting and are in the project can link them.`);
        } else out.push(`Not linked to ${p.name}: ${error.message}`);
      }
      const extra = [move && "action items not in a project moved into it", series && "future meetings in the series linked too"].filter(Boolean);
      return `${out.join("\n")}${extra.length ? `\n(${extra.join("; ")})` : ""}\n${siteUrl()}/meetings/${meetingId}`;
    },
  },
  {
    name: "set_action_item_project",
    description:
      "Move one of a meeting's action items into one of the projects, campaigns or partnerships the meeting is linked to. Link the meeting first with link_meeting_to_projects.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The action item's task id (from get_meeting)." },
        project: { type: "string", description: "Name of a project the meeting is linked to." },
      },
      required: ["task_id", "project"],
    },
    annotations: WRITE,
    async run(u, a) {
      const taskId = id(a, "task_id");
      const name = str(a, "project", 200);
      if (!name) throw new UserError('Give the "project" to move it into.');
      const { data: t } = await u.db.from("tasks").select("id, title, meeting_id").eq("id", taskId).maybeSingle();
      if (!t) throw new UserError("No task with that id that you can see.");
      if (!t.meeting_id) throw new UserError("That task isn't a meeting action item. Use update_task to change its project.");
      const { data: links } = await u.db.from("meeting_projects").select("project:projects(id, name, slug)").eq("meeting_id", t.meeting_id as string);
      const linked = ((links ?? []) as unknown as { project: { id: string; name: string; slug: string } | null }[]).map((l) => l.project).filter((p) => !!p) as {
        id: string;
        name: string;
        slug: string;
      }[];
      const q = name.toLowerCase();
      const hit =
        linked.find((p) => p.name.toLowerCase() === q || p.slug === q) ??
        (linked.filter((p) => p.name.toLowerCase().includes(q)).length === 1 ? linked.find((p) => p.name.toLowerCase().includes(q)) : undefined);
      const project = hit ?? (await findProject(u, name));
      const { error } = await u.db.rpc("set_action_item_project", { p_task: taskId, p_project: project.id });
      if (error) {
        if (/link the meeting/i.test(error.message ?? ""))
          throw new UserError(`The meeting isn't linked to ${project.name}. Link it first with link_meeting_to_projects.${linked.length ? ` Linked now: ${linked.map((p) => p.name).join(", ")}.` : ""}`);
        if (/privilege|permission|only people/i.test(error.message ?? "")) throw new UserError("Only people who can edit the meeting can move its action items.");
        failed(error, "move that action item");
      }
      return `Moved "${t.title}" into ${project.name}. ${siteUrl()}/meetings/${t.meeting_id}`;
    },
  },
  {
    name: "set_up_recurring_meeting",
    description:
      "Set up a recurring (or one-off) meeting in a team, with its invite list. This sends real Outlook calendar invites to everyone invited: the invited people, every member of the invited teams, outside guests and you. Check the details with the person before calling it.",
    inputSchema: {
      type: "object",
      properties: seriesProps,
      required: ["title", "team", "frequency", "start_date", "time"],
    },
    annotations: { ...WRITE, openWorldHint: true },
    async run(u, a) {
      const title = str(a, "title", 200);
      const teamName = str(a, "team");
      const frequency = oneOf(a, "frequency", FREQUENCIES);
      const start = date(a, "start_date");
      const t = time(a, "time");
      if (!title || !teamName || !frequency || !start || !t) throw new UserError("Give the title, team, frequency, start date and time.");
      const kind = (oneOf(a, "kind", ["internal", "external"]) ?? "internal") as "internal" | "external";
      const guests = emails(a, "external_emails");
      if (guests.length && kind !== "external") throw new UserError('Outside guests need kind "external".');
      const team = await findTeam(u, teamName);
      const depts = await teamIds(u, strings(a, "invite_teams"));
      const people = await personIds(u, strings(a, "invite_people"));
      const projects = a.projects ? await projectIds(u, strings(a, "projects")) : [];

      const row = {
        title,
        department_id: team.id,
        kind,
        frequency,
        start_date: start,
        meeting_time: t,
        duration_minutes: duration(a) ?? 60,
        external_emails: [...new Set(guests)],
        created_by: u.userId,
      };
      const { data, error } = await u.db.from("meeting_series").insert(row).select("id").single();
      if (error || !data) failed(error, `set up a meeting in ${team.name}`);
      const seriesId = data!.id as string;
      await addInvitesAndLinks(u, seriesId, depts, people, projects.map((p) => p.id));
      syncLater(() => syncSeries(seriesId));
      return [
        `Set up ${seriesSummary({ id: seriesId, ...row })}`,
        `Team: ${team.name}.${projects.length ? ` Linked to ${projects.map((p) => p.name).join(", ")}.` : ""}`,
        "Outlook invites go out to everyone invited in a moment.",
      ].join("\n");
    },
  },
  {
    name: "update_recurring_meeting",
    description:
      "Change a recurring meeting: title, team, internal or external, frequency, start date, time, duration, and add outside guests, invited teams, invited people or linked projects. Only the fields you give change; nobody is taken off the invite. This updates the Outlook invite and sends it to everyone invited, including anyone new. Only whoever set it up, or the team admin, can change it. Find it by name or id, or by one meeting in it.",
    inputSchema: {
      type: "object",
      properties: {
        recurring_meeting: { type: "string", description: "Its name or id." },
        meeting_id: { type: "string", description: "Or one meeting in the series." },
        ...seriesProps,
        external_emails: { type: "array", items: { type: "string" }, description: "Outside guests to add (external meetings only)." },
        invite_teams: { type: "array", items: { type: "string" }, description: "Teams to add to the invite." },
        invite_people: { type: "array", items: { type: "string" }, description: "People to add to the invite: names or emails." },
        projects: { type: "array", items: { type: "string" }, description: "Projects, campaigns or partnerships to link. Existing links stay." },
      },
    },
    annotations: { ...WRITE, openWorldHint: true },
    async run(u, a) {
      const s = await findSeries(u, a);
      if (a.start_date === null) throw new UserError("A meeting needs a start date.");
      const team = str(a, "team") ? await findTeam(u, str(a, "team")!) : null;
      const kind = (oneOf(a, "kind", ["internal", "external"]) ?? s.kind) as "internal" | "external";
      const guests = emails(a, "external_emails");
      if (kind === "internal" && s.external_emails.length)
        throw new UserError("This meeting has outside guests, so it stays external. Change it to internal in Highfy Tasks if you mean to take them off.");
      if (kind === "internal" && guests.length) throw new UserError('Outside guests need kind "external".');
      const depts = await teamIds(u, strings(a, "invite_teams"));
      const people = await personIds(u, strings(a, "invite_people"));
      const projects = a.projects ? await projectIds(u, strings(a, "projects")) : [];

      const row = {
        title: str(a, "title", 200) ?? s.title,
        department_id: team?.id ?? s.department_id,
        kind,
        frequency: oneOf(a, "frequency", FREQUENCIES) ?? s.frequency,
        start_date: date(a, "start_date") ?? s.start_date,
        meeting_time: time(a, "time") ?? String(s.meeting_time).slice(0, 5),
        duration_minutes: duration(a) ?? s.duration_minutes,
        external_emails: [...new Set([...s.external_emails, ...guests])],
      };
      if (row.external_emails.length > 100) throw new UserError("At most 100 outside guests.");
      const changed = (Object.keys(row) as (keyof typeof row)[]).filter((k) =>
        k === "external_emails" ? row.external_emails.length !== s.external_emails.length : k === "meeting_time" ? row[k] !== String(s.meeting_time).slice(0, 5) : row[k] !== s[k],
      );
      if (!changed.length && !depts.length && !people.length && !projects.length) throw new UserError("Nothing to change.");

      if (changed.length) {
        const { data, error } = await u.db.from("meeting_series").update(row).eq("id", s.id).select("id");
        if (error) failed(error, "change that meeting");
        if (!data?.length) throw new UserError("Only whoever set this meeting up, or the team admin, can change it.");
      }
      // Adding people or links alone: the database still checks who can manage it.
      await addInvitesAndLinks(u, s.id, depts, people, projects.map((p) => p.id));
      syncLater(() => syncSeries(s.id));
      const added = [
        guests.length && `${guests.length} outside guest${guests.length === 1 ? "" : "s"}`,
        depts.length && `${depts.length} team${depts.length === 1 ? "" : "s"}`,
        people.length && `${people.length} ${people.length === 1 ? "person" : "people"}`,
      ].filter(Boolean);
      return [
        `Updated ${seriesSummary({ id: s.id, ...row })}`,
        added.length ? `Invited: ${added.join(", ")}.` : null,
        projects.length ? `Linked to ${projects.map((p) => p.name).join(", ")}.` : null,
        "The Outlook invite updates for everyone invited in a moment.",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
];
