"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPeople, requireViewer } from "@/lib/auth";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { AiError, VOICE, structuredCall } from "@/lib/ai/claude";
import { htmlToText, minutesToHtml } from "@/lib/ai/format";
import { personName, statusLabel } from "@/lib/labels";
import { formatDate, todayPKT } from "@/lib/time";
import { syncLater } from "@/lib/calendar/schedule";
import { syncTasksForMeeting } from "@/lib/calendar/sync";
import type { Meeting, TaskPriority, TaskStatus } from "@/lib/types";

/**
 * Meeting assistant. Every function here returns a draft only; nothing is
 * written until the person accepts it in the editor. Each one first checks
 * that the viewer may edit this meeting (the same rule the database enforces).
 */

const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const priority = z.enum(["urgent", "high", "medium", "low"]);
const MAX_MINUTES_CHARS = 60_000;

type Ctx = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  viewerId: string;
  meeting: Meeting;
};

async function editableMeeting(meetingId: string): Promise<Ctx | { error: string }> {
  const viewer = await requireViewer();
  if (!uuid.safeParse(meetingId).success) return { error: "Meeting not found." };
  const supabase = await createClient();
  const [{ data: meeting }, { data: canEdit }] = await Promise.all([
    supabase.from("meetings").select("*").eq("id", meetingId).maybeSingle(),
    supabase.rpc("can_edit_meeting", { p_meeting_id: meetingId }),
  ]);
  if (!meeting) return { error: "Meeting not found." };
  if (!canEdit) return { error: "Only people in this meeting, its department admin can use the assistant here." };
  return { supabase, viewerId: viewer.id, meeting: meeting as Meeting };
}

async function run<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AiError) return { ok: false, error: error.message };
    throw error;
  }
}

function meetingLabel(m: Meeting) {
  return `${m.title || "Weekly meeting"}, ${formatDate(m.meeting_date, "EEEE d MMMM yyyy")}`;
}

async function attendeeNames(ctx: Ctx) {
  const [{ data }, people] = await Promise.all([
    ctx.supabase.from("meeting_attendees").select("user_id").eq("meeting_id", ctx.meeting.id),
    getPeople(),
  ]);
  const ids = new Set((data ?? []).map((a) => a.user_id as string));
  return people.filter((p) => ids.has(p.id)).map((p) => personName(p));
}

// ---------------------------------------------------------------------------
// 1. Tidy up minutes
// ---------------------------------------------------------------------------

const tidySchema = {
  type: "object",
  additionalProperties: false,
  required: ["sections"],
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "points"],
        properties: {
          heading: { type: "string" },
          points: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const tidyParser = z.object({
  sections: z
    .array(z.object({ heading: z.string().trim().max(200), points: z.array(z.string().trim().max(2000)).max(60) }))
    .max(30),
});

export type TidyDraft = { html: string };

export async function tidyMinutes(meetingId: string, minutesHtml: string): Promise<ActionResult<TidyDraft>> {
  return run(async () => {
    const ctx = await editableMeeting(meetingId);
    if ("error" in ctx) return { ok: false, error: ctx.error };
    const notes = htmlToText(minutesHtml);
    if (!notes) return { ok: false, error: "Write some notes first, then tidy them up." };
    if (notes.length > MAX_MINUTES_CHARS) return { ok: false, error: "These notes are too long to tidy in one go." };

    const names = await attendeeNames(ctx);
    const out = await structuredCall({
      label: "tidy",
      effort: "low",
      parser: tidyParser,
      schema: tidySchema,
      system: `You turn rough meeting notes into clear, structured minutes for Highfy, a company in Pakistan.

${VOICE}

How to structure the minutes:
- Group the notes into a few short sections by topic. Each heading is a short noun phrase, such as "Q3 sales" or "Hiring".
- Each point is one complete, short sentence in past tense, saying what was discussed or agreed and by whom where the notes say so.
- Keep every fact from the notes. Drop only filler and repetition. Do not add facts, opinions, owners or dates the notes do not contain.
- Expand obvious shorthand ("w/" to "with", "mtg" to "meeting"), but keep names, numbers and acronyms as written.
- Do not include a section for action items; those are handled separately.
- Where something was agreed, say so plainly in the relevant point ("Agreed to launch on 1 Nov.").
- The notes may mix English and Roman Urdu. Write the minutes in English.`,
      prompt: `Meeting: ${meetingLabel(ctx.meeting)}
Attendees: ${names.join(", ") || "not recorded"}

Rough notes:
<notes>
${notes}
</notes>`,
    });

    const sections = out.sections.filter((s) => s.points.some((p) => p));
    if (!sections.length) return { ok: false, error: "The assistant found nothing to tidy." };
    return {
      ok: true,
      data: { html: minutesToHtml(sections) },
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Suggested action items
// ---------------------------------------------------------------------------

const suggestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "owner_id", "due_date", "priority", "reason"],
        properties: {
          title: { type: "string" },
          owner_id: { type: ["string", "null"] },
          due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
          priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
          reason: { type: "string" },
        },
      },
    },
  },
};

const suggestParser = z.object({
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        owner_id: z.string().nullable(),
        due_date: z.string().nullable(),
        priority,
        reason: z.string().trim().max(500),
      }),
    )
    .max(20),
});

export type SuggestedItem = {
  key: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  priority: TaskPriority;
  reason: string;
};

export async function suggestActionItems(
  meetingId: string,
  minutesHtml: string,
  existingTitles: string[],
): Promise<ActionResult<SuggestedItem[]>> {
  return run(async () => {
    const ctx = await editableMeeting(meetingId);
    if ("error" in ctx) return { ok: false, error: ctx.error };
    const notes = htmlToText(minutesHtml);
    if (!notes) return { ok: false, error: "Write some minutes first, then ask for action items." };
    if (notes.length > MAX_MINUTES_CHARS) return { ok: false, error: "These minutes are too long to read in one go." };

    // Owners can only be people in the meeting or in its department.
    const [{ data: attendees }, { data: members }, people] = await Promise.all([
      ctx.supabase.from("meeting_attendees").select("user_id").eq("meeting_id", meetingId),
      ctx.supabase.from("department_members").select("user_id").eq("department_id", ctx.meeting.department_id),
      getPeople(),
    ]);
    const allowed = new Set([...(attendees ?? []), ...(members ?? [])].map((r) => r.user_id as string));
    const candidates = people.filter((p) => allowed.has(p.id));
    const today = todayPKT();

    const out = await structuredCall({
      label: "suggest",
      effort: "low",
      parser: suggestParser,
      schema: suggestSchema,
      system: `You read meeting minutes for Highfy, a company in Pakistan, and pick out the concrete follow-up work as task suggestions. A person reviews each one before it becomes a task.

${VOICE}

Rules:
- Only suggest work the minutes actually call for. Do not invent tasks. Ten at most; fewer is fine; none is fine.
- Skip anything that is already in the list of existing action items, even if worded differently.
- title: a short instruction starting with a verb, under 80 characters, such as "Send revised quote to Packages Ltd".
- owner_id: the id of the person the minutes say will do it, chosen only from the people list. Use null if the minutes do not make the owner clear. Never guess from job titles.
- due_date: YYYY-MM-DD, only when the minutes give a date or a clear relative date ("by Friday", "next week" means the Friday of next week). Work relative dates out from the meeting date. Otherwise null.
- priority: "urgent" only if the minutes say it is urgent or blocking; "high" if it has a near deadline or a customer waiting; "low" if it is explicitly a nice to have; otherwise "medium".
- reason: one short sentence quoting or paraphrasing the part of the minutes this comes from.`,
      prompt: `Meeting: ${meetingLabel(ctx.meeting)} (meeting date ${ctx.meeting.meeting_date}, today is ${today})

People who can own tasks (id | name | email):
${candidates.map((p) => `${p.id} | ${personName(p)} | ${p.email}`).join("\n") || "none"}

Existing action items:
${existingTitles.filter(Boolean).map((t) => `- ${t}`).join("\n") || "none"}

Minutes:
<minutes>
${notes}
</minutes>`,
    });

    const items: SuggestedItem[] = out.items.map((item) => ({
      key: crypto.randomUUID(),
      title: item.title,
      owner_id: item.owner_id && allowed.has(item.owner_id) ? item.owner_id : null,
      due_date: item.due_date && dateStr.safeParse(item.due_date).success && !isNaN(Date.parse(item.due_date)) ? item.due_date : null,
      priority: item.priority,
      reason: item.reason,
    }));
    return { ok: true, data: items };
  });
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  owner_id: uuid.nullable(),
  due_date: dateStr.nullable(),
  priority,
});

export type CreatedItem = {
  id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
};

/** "Create task" on a suggestion: creates it as an action item of this meeting. */
export async function createSuggestedTask(
  meetingId: string,
  input: z.input<typeof createSchema>,
): Promise<ActionResult<CreatedItem>> {
  const ctx = await editableMeeting(meetingId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some values aren't valid." };
  const { data, error } = await ctx.supabase
    .from("tasks")
    .insert({
      ...parsed.data,
      department_id: ctx.meeting.department_id,
      sub_team_id: ctx.meeting.sub_team_id,
      meeting_id: meetingId,
      source: "meeting",
      created_by: ctx.viewerId,
    })
    .select("id, title, owner_id, due_date, priority, status")
    .single();
  if (error || !data) return { ok: false, error: friendlyError(error) };
  revalidatePath("/", "layout");
  syncLater(() => syncTasksForMeeting(meetingId));
  return { ok: true, data: data as CreatedItem };
}

// ---------------------------------------------------------------------------
// 3. Draft agenda
// ---------------------------------------------------------------------------

const agendaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["topics"],
  properties: { topics: { type: "array", items: { type: "string" } } },
};
const agendaParser = z.object({ topics: z.array(z.string().trim().min(1).max(300)).max(25) });

type TaskLine = {
  id: string;
  title: string;
  status: TaskStatus;
  due_date: string | null;
  blocked_reason: string | null;
  owner_id: string | null;
};

export async function draftAgenda(meetingId: string): Promise<ActionResult<string>> {
  return run(async () => {
    const ctx = await editableMeeting(meetingId);
    if ("error" in ctx) return { ok: false, error: ctx.error };
    const { supabase, meeting } = ctx;
    const today = todayPKT();
    const cols = "id, title, status, due_date, blocked_reason, owner_id";

    const [{ data: prev }, { data: stuck }, people] = await Promise.all([
      supabase
        .from("meetings")
        .select("id, title, meeting_date")
        .eq(meeting.series_id ? "series_id" : "department_id", meeting.series_id ?? meeting.department_id)
        .or(`meeting_date.lt.${meeting.meeting_date},and(meeting_date.eq.${meeting.meeting_date},created_at.lt."${meeting.created_at}")`)
        .order("meeting_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // The department's overdue or blocked work, whichever meeting it came from.
      supabase
        .from("tasks")
        .select(cols)
        .eq("department_id", meeting.department_id)
        .is("deleted_at", null)
        .in("status", ["todo", "in_progress", "blocked"])
        .or(`status.eq.blocked,due_date.lt.${today}`)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(40),
      getPeople(),
    ]);

    let open: TaskLine[] = [];
    if (prev) {
      const { data } = await supabase
        .from("tasks")
        .select(cols)
        .eq("meeting_id", prev.id)
        .is("deleted_at", null)
        .in("status", ["todo", "in_progress", "blocked"])
        .order("created_at");
      open = (data ?? []) as TaskLine[];
    }
    const openIds = new Set(open.map((t) => t.id));
    const others = ((stuck ?? []) as TaskLine[]).filter((t) => !openIds.has(t.id));
    if (!open.length && !others.length)
      return { ok: false, error: "Nothing open from last week and nothing overdue or blocked, so there's nothing to draft from." };

    const byId = new Map(people.map((p) => [p.id, p]));
    const line = (t: TaskLine) =>
      [
        `- ${t.title}`,
        `owner: ${t.owner_id ? personName(byId.get(t.owner_id)) : "unassigned"}`,
        `status: ${statusLabel(t.status)}`,
        t.due_date ? `due ${t.due_date}${t.due_date < today ? " (overdue)" : ""}` : "no due date",
        t.status === "blocked" && t.blocked_reason ? `blocked because: ${t.blocked_reason}` : null,
      ]
        .filter(Boolean)
        .join("; ");

    const out = await structuredCall({
      label: "agenda",
      effort: "low",
      parser: agendaParser,
      schema: agendaSchema,
      system: `You draft the agenda for a department's weekly meeting at Highfy, a company in Pakistan. A person reviews and edits it before it is saved.

${VOICE}

Rules:
- Each topic is one line under 100 characters. No numbering or bullets; the app adds those.
- Start with blocked work, then overdue work, then the rest of last week's open items.
- Group closely related tasks into one topic where it reads better, naming the people involved.
- Name the owner where it helps, for example "Packaging quote: blocked on supplier reply (Ayesha)".
- Only use the tasks given. Do not invent topics, apart from a final "Any other business" line.
- At most 12 topics.`,
      prompt: `Meeting: ${meetingLabel(meeting)}, today is ${today}
${prev ? `Previous meeting: ${prev.title || "Weekly meeting"}, ${prev.meeting_date}` : "No previous meeting recorded."}

Last week's action items that are still open:
${open.map(line).join("\n") || "none"}

Other overdue or blocked tasks in this department:
${others.map(line).join("\n") || "none"}`,
    });

    if (!out.topics.length) return { ok: false, error: "The assistant couldn't draft an agenda from this." };
    return { ok: true, data: out.topics.join("\n") };
  });
}
