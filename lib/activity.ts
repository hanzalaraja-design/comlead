import { personName, priorityLabel, statusLabel } from "@/lib/labels";
import { formatDue } from "@/lib/time";
import type { ActivityEntry, PersonRef, TaskPriority, TaskStatus } from "@/lib/types";

type Lookup = { person: (id: unknown) => PersonRef | null };

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** One-line, human description of an activity entry (without the actor). */
export function describeActivity(e: ActivityEntry, { person }: Lookup): string {
  const o = e.old_value ?? {};
  const n = e.new_value ?? {};
  const label = e.entity_label ?? "";

  switch (e.action) {
    case "task.created":
      return n.source === "meeting" ? `added action item “${label}”` : `created task “${label}”`;
    case "task.completed":
      return `completed “${label}”`;
    case "task.status_changed":
      return `moved “${label}” from ${statusLabel(s(o.status) as TaskStatus)} to ${statusLabel(s(n.status) as TaskStatus)}${
        n.status === "blocked" && n.blocked_reason ? ` (${s(n.blocked_reason)})` : ""
      }`;
    case "task.reassigned":
      return `reassigned “${label}” from ${personName(person(o.owner_id))} to ${personName(person(n.owner_id))}`;
    case "task.due_changed":
      return `changed due date of “${label}” from ${formatDue(s(o.due_date) || null, s(o.due_time) || null)} to ${formatDue(
        s(n.due_date) || null,
        s(n.due_time) || null,
      )}`;
    case "task.edited": {
      const fields = Object.keys(n);
      const parts = fields.map((f) => {
        if (f === "priority") return `priority ${priorityLabel(s(o.priority) as TaskPriority)} → ${priorityLabel(s(n.priority) as TaskPriority)}`;
        if (f === "title") return `title (was “${s(o.title)}”)`;
        if (f === "sub_team_id") return "sub-team";
        if (f === "start_date") return `start date → ${s(n.start_date) ? formatDue(s(n.start_date), null) : "none"}`;
        if (f === "department_id") return "department";
        if (f === "blocked_reason") return "blocked reason";
        if (f === "meeting_id") return "linked meeting";
        return f;
      });
      return `edited “${label}”: ${parts.join(", ")}`;
    }
    case "task.deleted":
      return `deleted task “${label}”`;
    case "task.collaborator_added":
      return `added ${personName(person(e.subject_user_id))} to “${label}”`;
    case "task.collaborator_removed":
      return `removed ${personName(person(e.subject_user_id))} from “${label}”`;
    case "comment.added":
      return `commented on “${label}”`;
    case "attachment.added":
      return `attached ${s(n.file_name)} to “${label}”`;
    case "meeting.created":
      return `created meeting ${label}`;
    case "meeting.minutes_edited":
      return `updated minutes for ${label}`;
    case "meeting.action_item_added":
      return `added action item “${s(n.title)}” to ${label}`;
    case "membership.added":
      return `added ${label} (${s(n.role) === "lead" ? "Dept admin" : "Member"})`;
    case "membership.removed":
      return `removed ${label}`;
    case "membership.role_changed":
      return `changed ${label} to ${s(n.role) === "lead" ? "Dept admin" : "Member"}`;
    default:
      return `${e.action} ${label}`;
  }
}

export function activityHref(e: ActivityEntry): string | null {
  if (e.action === "task.deleted") return null;
  if (e.task_id && e.entity_type !== "meeting") return `/tasks/${e.task_id}`;
  if (e.meeting_id) return `/meetings/${e.meeting_id}`;
  return null;
}

/** "Completed 6 tasks, created 3, updated 2 meetings" */
export function summarizeActivity(entries: ActivityEntry[]): string {
  const count = (pred: (e: ActivityEntry) => boolean) => entries.filter(pred).length;
  const completed = count((e) => e.action === "task.completed");
  const created = count((e) => e.action === "task.created");
  const updated = count((e) =>
    ["task.status_changed", "task.reassigned", "task.due_changed", "task.edited", "task.collaborator_added", "task.collaborator_removed"].includes(e.action),
  );
  const comments = count((e) => e.action === "comment.added");
  const meetings = new Set(
    entries.filter((e) => e.action.startsWith("meeting.")).map((e) => e.meeting_id),
  ).size;

  const parts: string[] = [];
  if (completed) parts.push(`Completed ${completed} task${completed === 1 ? "" : "s"}`);
  if (created) parts.push(`created ${created}`);
  if (updated) parts.push(`updated ${updated}`);
  if (comments) parts.push(`${comments} comment${comments === 1 ? "" : "s"}`);
  if (meetings) parts.push(`worked on ${meetings} meeting${meetings === 1 ? "" : "s"}`);
  if (!parts.length) return "No activity";
  const text = parts.join(", ");
  return text[0].toUpperCase() + text.slice(1);
}

