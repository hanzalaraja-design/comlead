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

export const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  blocked: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  done: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  cancelled: "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-400",
};

export const PRIORITY_STYLES: Record<TaskPriority, string> = {
  urgent: "bg-red-600 text-white",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  medium: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  low: "bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300",
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
