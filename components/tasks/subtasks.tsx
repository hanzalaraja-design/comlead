"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, Plus, TriangleAlert, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/person-avatar";
import { CompleteButton } from "@/components/tasks/complete-button";
import { InlineDue, InlineOwner, PeopleProvider } from "@/components/tasks/inline-edit";
import { StatusBadge } from "@/components/tasks/task-badges";
import { OPEN_STATUSES, personName } from "@/lib/labels";
import { formatDate, todayPKT } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { PersonRef, TaskStatus } from "@/lib/types";
import { addSubtask } from "@/app/(app)/tasks/actions";

/**
 * "Needed from others": pieces of a task given to people from any team, each
 * with their own deadline. Each one is a task of its own for that person.
 */

/** Pick one person, with search. */
export function PersonPicker({
  people,
  value,
  onChange,
  placeholder = "Who?",
  className,
}: {
  people: PersonRef[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const chosen = people.find((p) => p.id === value) ?? null;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? people.filter((p) => personName(p).toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) : people;
  }, [people, query]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("flex h-10 min-w-0 items-center gap-2 field px-3 text-left text-sm", className)}>
          {chosen ? <PersonAvatar person={chosen} className="h-5 w-5" /> : null}
          <span className={cn("flex-1 truncate", !chosen && "text-ink-muted")}>{chosen ? personName(chosen) : placeholder}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
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
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-subtle"
              >
                <PersonAvatar person={p} className="h-5 w-5" />
                <span className="flex-1 truncate">{personName(p)}</span>
                {p.id === value && <Check className="h-4 w-4 text-brand-primary" />}
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-2 py-1.5 text-sm text-ink-muted">No one by that name.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export type SubtaskDraft = { title: string; owner_id: string; due_date: string };

const blank = (): SubtaskDraft => ({ title: "", owner_id: "", due_date: "" });

/** One row: what, who, by when. */
function DraftRow({
  draft,
  people,
  onChange,
  onRemove,
  autoFocus,
}: {
  draft: SubtaskDraft;
  people: PersonRef[];
  onChange: (d: SubtaskDraft) => void;
  onRemove?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_9.5rem_auto]">
      <input
        aria-label="What's needed"
        value={draft.title}
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
        placeholder="What's needed, e.g. Final banner sizes"
        maxLength={300}
        autoFocus={autoFocus}
        className="h-10 min-w-0 field px-3 text-sm"
      />
      <PersonPicker people={people} value={draft.owner_id} onChange={(owner_id) => onChange({ ...draft, owner_id })} />
      <input
        type="date"
        aria-label="Needed by"
        value={draft.due_date}
        onChange={(e) => onChange({ ...draft, due_date: e.target.value })}
        className="h-10 field px-2 text-sm"
      />
      {onRemove ? (
        <button type="button" aria-label="Remove" onClick={onRemove} className="hidden h-10 w-8 items-center justify-center text-ink-muted hover:text-ink sm:flex">
          <X className="h-4 w-4" />
        </button>
      ) : (
        <span className="hidden sm:block sm:w-8" />
      )}
    </div>
  );
}

/** In the new task form: ask people for things as you create the task. */
export function NeededFromOthers({
  people,
  drafts,
  onChange,
  disabledReason,
}: {
  people: PersonRef[];
  drafts: SubtaskDraft[];
  onChange: (d: SubtaskDraft[]) => void;
  disabledReason?: string;
}) {
  return (
    <div className="space-y-2">
      {drafts.length > 0 && (
        <p className="text-sm font-medium text-ink">
          Needed from others <span className="font-normal text-ink-muted">· each person gets it as a task with their own deadline</span>
        </p>
      )}
      {!disabledReason &&
        drafts.map((d, i) => (
          <DraftRow
            key={i}
            draft={d}
            people={people}
            autoFocus={i === drafts.length - 1 && !d.title}
            onChange={(next) => onChange(drafts.map((x, j) => (j === i ? next : x)))}
            onRemove={() => onChange(drafts.filter((_, j) => j !== i))}
          />
        ))}
      {disabledReason && drafts.length > 0 ? (
        <p className="text-xs text-ink-muted">{disabledReason}</p>
      ) : (
        <button
          type="button"
          onClick={() => onChange([...drafts, blank()])}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-primary hover:underline"
        >
          <Plus className="h-4 w-4" /> {drafts.length ? "Someone else" : "Need something from someone?"}
        </button>
      )}
    </div>
  );
}

export type SubtaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  due_date: string | null;
  due_time: string | null;
  overdue: boolean;
  owner: PersonRef | null;
};

/** On the task page: who the task is waiting on, and adding more. */
export function SubtaskSection({
  parentId,
  parentDue,
  subtasks,
  people,
  canAdd,
}: {
  parentId: string;
  parentDue: string | null;
  subtasks: SubtaskRow[];
  people: PersonRef[];
  canAdd: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<SubtaskDraft | null>(null);
  const [pending, startTransition] = useTransition();
  const today = todayPKT();
  const open = subtasks.filter((s) => OPEN_STATUSES.includes(s.status));
  const done = subtasks.filter((s) => s.status === "done").length;
  const next = [...open].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))[0];

  function save() {
    if (!draft) return;
    if (!draft.title.trim()) return toast.error("Say what's needed.");
    if (!draft.owner_id) return toast.error("Pick who it's needed from.");
    startTransition(async () => {
      const res = await addSubtask(parentId, { title: draft.title, owner_id: draft.owner_id, due_date: draft.due_date || null });
      if (res.ok) {
        const who = people.find((p) => p.id === draft.owner_id);
        toast.success(`Sent to ${personName(who ?? null)}.`);
        setDraft(null);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  if (!subtasks.length && !canAdd) return null;
  return (
    <section className="surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold text-ink">Needed from others</h2>
        {subtasks.length > 0 && (
          <span className="text-sm text-ink-muted">
            {done} of {subtasks.length} done
            {next?.owner && (
              <>
                {" · "}waiting on <span className="font-medium text-ink">{personName(next.owner)}</span>
                {next.due_date && ` (due ${formatDate(next.due_date, "EEE d MMM")})`}
              </>
            )}
          </span>
        )}
      </div>

      {subtasks.length > 0 && (
        <PeopleProvider people={people}>
          <ul className="divide-y divide-line">
            {subtasks.map((s) => {
              const late = !!parentDue && !!s.due_date && s.due_date > parentDue && OPEN_STATUSES.includes(s.status);
              return (
                <li key={s.id} className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                  {OPEN_STATUSES.includes(s.status) ? (
                    <CompleteButton taskId={s.id} title={s.title} dueByToday={!!s.due_date && s.due_date <= today} />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-white">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                  <Link
                    href={`/tasks/${s.id}`}
                    className={cn("min-w-0 flex-1 basis-40 font-medium text-ink hover:underline", s.status === "done" && "text-ink-muted line-through")}
                  >
                    {s.title}
                  </Link>
                  {s.status !== "todo" && s.status !== "done" && <StatusBadge status={s.status} />}
                  <InlineOwner taskId={s.id} owner={s.owner} />
                  <InlineDue taskId={s.id} date={s.due_date} time={s.due_time} overdue={s.overdue} />
                  {late && (
                    <span className="inline-flex basis-full items-center gap-1 pl-8 text-xs font-medium text-warning-ink">
                      <TriangleAlert className="h-3.5 w-3.5" /> Due after the main task ({formatDate(parentDue!, "d MMM")})
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </PeopleProvider>
      )}

      {canAdd &&
        (draft ? (
          <div className="mt-3 space-y-2">
            <DraftRow draft={draft} people={people} onChange={setDraft} autoFocus />
            <div className="flex gap-2">
              <Button size="sm" disabled={pending} onClick={save}>
                {pending ? "Sending…" : "Send"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDraft(blank())}
            className={cn("inline-flex items-center gap-1 text-sm font-medium text-brand-primary hover:underline", subtasks.length > 0 && "mt-2")}
          >
            <Plus className="h-4 w-4" /> {subtasks.length ? "Need something else" : "Need something from someone? Add it here"}
          </button>
        ))}
    </section>
  );
}
