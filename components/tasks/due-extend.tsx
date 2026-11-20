"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addDaysISO, formatDate, todayPKT } from "@/lib/time";
import { cn } from "@/lib/utils";
import { extendDeadline, getDueHistory, type DueMove } from "@/app/(app)/tasks/actions";

/** Clock with a forward arrow. */
function ExtendIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="7" cy="8.5" r="5" />
      <path d="M7 6v2.5l1.5 1" />
      <path d="M12.5 2.5v3h-3" />
    </svg>
  );
}

/**
 * The small clock-arrow next to a due date: pick a new date, optionally say
 * why. Shows on hover (the row needs the `group/row` class); always on phones.
 */
export function DueExtend({ taskId, title, date, className }: { taskId: string; title: string; date: string | null; className?: string }) {
  const router = useRouter();
  const today = todayPKT();
  const start0 = () => addDaysISO(date && date >= today ? date : today, 1);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(start0);
  const [why, setWhy] = useState("");
  const [pending, start] = useTransition();
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setTo(start0());
          setWhy("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Extend the deadline of "${title}"`}
          title="Extend deadline"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-line bg-white text-ink-muted hover:text-ink",
            "md:opacity-0 md:transition-opacity md:focus-visible:opacity-100 md:group-hover/row:opacity-100",
            open && "md:opacity-100",
            className,
          )}
        >
          <ExtendIcon className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2.5 p-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-ink-muted">{date ? `Due ${formatDate(date, "EEE d MMM")}${date < today ? " (overdue)" : ""}.` : "No deadline yet."}</p>
        <label className="block space-y-1 text-xs font-medium text-ink-muted">
          New due date
          <input type="date" value={to} min={today} onChange={(e) => setTo(e.target.value)} className="h-9 w-full rounded-[10px] border border-line px-2 text-sm text-ink" />
        </label>
        <input
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          maxLength={500}
          placeholder="Why? (optional, added as a comment)"
          aria-label="Why it's moving"
          className="h-9 w-full rounded-[10px] border border-line px-2.5 text-sm"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-[10px] border border-line px-3 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || !to}
            onClick={() =>
              start(async () => {
                const res = await extendDeadline(taskId, to, why);
                if (!res.ok) return void toast.error(res.error);
                toast.success(`Moved to ${formatDate(to, "EEE d MMM")}.`);
                setOpen(false);
                router.refresh();
              })
            }
            className="h-8 rounded-[10px] bg-brand-primary px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {to ? `Move to ${formatDate(to, "EEE d MMM")}` : "Move"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** "+2" under a due date: how often it was pushed later. Click for the history. */
export function MovedMark({ taskId, count }: { taskId: string; count: number }) {
  const [moves, setMoves] = useState<DueMove[] | null>(null);
  const [pending, start] = useTransition();
  if (!count) return null;
  return (
    <Popover
      onOpenChange={(o) =>
        o &&
        !moves &&
        start(async () => {
          const res = await getDueHistory(taskId);
          setMoves(res.ok ? res.data! : []);
        })
      }
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Deadline moved ${count} time${count === 1 ? "" : "s"}`}
          aria-label={`Deadline moved ${count} time${count === 1 ? "" : "s"}. Show history`}
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 text-[11px] font-medium text-ink-muted/80 underline decoration-dotted underline-offset-2 hover:text-ink"
        >
          +{count}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2 p-3" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold text-ink">Due date history</p>
        {pending || !moves ? (
          <p className="text-xs text-ink-muted">Loading…</p>
        ) : moves.length ? (
          <ul className="space-y-1.5">
            {moves.map((m, i) => (
              <li key={i} className="text-sm text-ink">
                {m.from ?? "No date"} → {m.to}
                <span className="block text-[11px] text-ink-muted">
                  {m.who}, {m.when}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-muted">No history you can see.</p>
        )}
        <p className="text-[11px] text-ink-muted">Reasons, when given, are in the task&apos;s comments.</p>
      </PopoverContent>
    </Popover>
  );
}
