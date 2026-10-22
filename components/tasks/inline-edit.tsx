"use client";

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PersonAvatar } from "@/components/person-avatar";
import { DueLabel } from "@/components/tasks/task-badges";
import { PRIORITIES, PRIORITY_STYLES, personName } from "@/lib/labels";
import { addDaysISO, todayPKT } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { PersonRef, TaskPriority } from "@/lib/types";
import { updateTaskInline } from "@/app/(app)/tasks/actions";

/**
 * Owner, due date and priority, changed right in a task list.
 * Each saves at once and goes back if the change isn't allowed.
 */

const PeopleContext = createContext<PersonRef[]>([]);

export function PeopleProvider({ people, children }: { people: PersonRef[]; children: React.ReactNode }) {
  return <PeopleContext.Provider value={people}>{children}</PeopleContext.Provider>;
}

// Sits above the row's full-size link.
const ABOVE = "relative z-10";

function useSave<T>(initial: T, toPatch: (v: T) => Parameters<typeof updateTaskInline>[1], taskId: string) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  function save(next: T) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const res = await updateTaskInline(taskId, toPatch(next));
      if (!res.ok) {
        setValue(previous);
        toast.error(res.error);
      }
    });
  }
  return { value, save, pending };
}

export function InlineOwner({ taskId, owner, compact = false }: { taskId: string; owner: PersonRef | null; compact?: boolean }) {
  const people = useContext(PeopleContext);
  const { value, save, pending } = useSave<PersonRef | null>(owner, (p) => ({ owner_id: p?.id ?? null }), taskId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? people.filter((p) => personName(p).toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) : people;
  }, [people, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Owner: ${value ? personName(value) : "Unassigned"}. Change`}
          disabled={pending}
          className={cn(ABOVE, "flex min-w-0 items-center gap-2 rounded-full py-0.5 pr-2 text-left text-sm hover:bg-subtle", compact && "pr-0.5")}
        >
          <PersonAvatar person={value} className={compact ? "h-5 w-5" : undefined} />
          {!compact && <span className="truncate">{value ? personName(value) : <span className="text-ink-muted">Unassigned</span>}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0" onClick={(e) => e.stopPropagation()}>
        <div className="border-b p-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            className="h-8 w-full rounded-md bg-muted px-2 text-sm outline-none"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto p-1">
          {[null, ...shown].map((p) => (
            <li key={p?.id ?? "none"}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                  if ((p?.id ?? null) !== (value?.id ?? null)) save(p);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-subtle"
              >
                {p ? <PersonAvatar person={p} className="h-5 w-5" /> : <span className="h-5 w-5" />}
                <span className="flex-1 truncate">{p ? personName(p) : "Unassigned"}</span>
                {(p?.id ?? null) === (value?.id ?? null) && <Check className="h-4 w-4 text-brand-primary" />}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function InlineDue({
  taskId,
  date,
  time,
  overdue,
}: {
  taskId: string;
  date: string | null;
  time: string | null;
  overdue?: boolean;
}) {
  const { value, save, pending } = useSave<string | null>(date, (d) => ({ due_date: d }), taskId);
  const [open, setOpen] = useState(false);
  const today = todayPKT();
  const pick = (d: string | null) => {
    setOpen(false);
    if (d !== value) save(d);
  };
  const quick = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDaysISO(today, 1) },
    { label: "In a week", date: addDaysISO(today, 7) },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Due date. Change" disabled={pending} className={cn(ABOVE, "rounded-full hover:ring-2 hover:ring-line")}>
          {/* Overdue only holds while the date hasn't moved. */}
          <DueLabel date={value} time={value === date ? time : null} overdue={value === date ? overdue : !!value && value < today} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 space-y-2 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <button key={q.label} type="button" onClick={() => pick(q.date)} className="rounded-full bg-subtle px-2.5 py-1 text-xs font-medium hover:bg-line">
              {q.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          aria-label="Pick a date"
          defaultValue={value ?? ""}
          onChange={(e) => e.target.value && pick(e.target.value)}
          className="h-9 w-full field px-2 text-sm"
        />
        {value && (
          <button type="button" onClick={() => pick(null)} className="text-xs font-medium text-ink-muted hover:text-ink">
            Remove date
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function InlinePriority({ taskId, priority }: { taskId: string; priority: TaskPriority }) {
  const { value, save, pending } = useSave<TaskPriority>(priority, (p) => ({ priority: p }), taskId);
  return (
    <span className={cn(ABOVE, "inline-flex")}>
      <select
        aria-label="Priority"
        value={value}
        disabled={pending}
        onChange={(e) => save(e.target.value as TaskPriority)}
        className={cn(
          "h-6 cursor-pointer appearance-none rounded-full border-0 py-0 pl-2 pr-5 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
          PRIORITY_STYLES[value],
        )}
      >
        {PRIORITIES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none -ml-4 h-3 w-3 self-center opacity-60" />
    </span>
  );
}
