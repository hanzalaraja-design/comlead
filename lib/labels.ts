import type { TaskPriority, TaskSource, TaskStatus } from "./types";

export const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

export const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const SOURCES: { value: TaskSource; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "meeting", label: "Meeting" },
  { value: "whatsapp", label: "WhatsApp" },
];

export const statusLabel = (s: TaskStatus) => STATUSES.find((x) => x.value === s)?.label ?? s;
export const priorityLabel = (p: TaskPriority) => PRIORITIES.find((x) => x.value === p)?.label ?? p;
export const sourceLabel = (s: TaskSource) => SOURCES.find((x) => x.value === s)?.label ?? s;

// Pills are mostly grey. Purple marks work in progress; orange marks what
// needs attention (blocked, urgent, overdue).
export const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "border border-line bg-white text-ink",
  in_progress: "bg-info-soft text-info-ink",
  blocked: "bg-warning-soft text-warning-ink",
  done: "bg-success-soft text-success-ink",
  cancelled: "border border-line bg-white text-ink-muted line-through",
};

export const PRIORITY_STYLES: Record<TaskPriority, string> = {
  urgent: "bg-danger-soft text-danger-ink",
  high: "bg-warning-soft text-warning-ink",
  medium: "bg-subtle text-ink",
  low: "text-ink-muted",
};

export const OPEN_STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked"];

export function personName(p: { full_name: string | null; email: string } | null | undefined): string {
  if (!p) return "Unassigned";
  return p.full_name || p.email.split("@")[0];
}

export function initials(p: { full_name: string | null; email: string } | null | undefined): string {
  const name = personName(p);
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
