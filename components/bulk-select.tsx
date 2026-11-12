"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tick rows, or Select all, then act on them together from the bar at the
 * bottom. Used by task lists and placements; each passes its own actions.
 */

type Ctx = { selected: Set<string>; toggle: (id: string) => void; ids: string[]; setAll: (on: boolean) => void; clear: () => void };
const BulkContext = createContext<Ctx | null>(null);

export const useBulk = () => useContext(BulkContext);

export function BulkProvider({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Rows that left the page (done, deleted) drop out of the selection.
  const live = useMemo(() => new Set([...selected].filter((id) => ids.includes(id))), [selected, ids]);
  const value: Ctx = {
    selected: live,
    ids,
    toggle: (id) =>
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    setAll: (on) => setSelected(on ? new Set(ids) : new Set()),
    clear: () => setSelected(new Set()),
  };
  return <BulkContext.Provider value={value}>{children}</BulkContext.Provider>;
}

/** A row's tick box; nothing outside a BulkProvider. */
export function RowCheck({ id, label, className }: { id: string; label: string; className?: string }) {
  const ctx = useBulk();
  if (!ctx) return null;
  return (
    <input
      type="checkbox"
      aria-label={`Select ${label}`}
      checked={ctx.selected.has(id)}
      onChange={() => ctx.toggle(id)}
      onClick={(e) => e.stopPropagation()}
      className={cn("relative z-10 h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--brand-primary))]", className)}
    />
  );
}

/** "Select all (24)" / "Unselect all", above a list. */
export function SelectAll({ noun = "tasks" }: { noun?: string }) {
  const ctx = useBulk();
  if (!ctx || !ctx.ids.length) return null;
  const all = ctx.selected.size === ctx.ids.length;
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
      <input
        type="checkbox"
        checked={all}
        ref={(el) => {
          if (el) el.indeterminate = ctx.selected.size > 0 && !all;
        }}
        onChange={() => ctx.setAll(!all)}
        className="h-4 w-4 accent-[hsl(var(--brand-primary))]"
      />
      {all ? "Unselect all" : `Select all ${ctx.ids.length} ${noun}`}
    </label>
  );
}

/** The bar that appears once something is ticked. */
export function BulkBar({ children, noun = "task" }: { children: React.ReactNode; noun?: string }) {
  const ctx = useBulk();
  if (!ctx || !ctx.selected.size) return null;
  const n = ctx.selected.size;
  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-40 flex justify-center px-3 md:bottom-6">
      <div role="toolbar" aria-label="Selected" className="flex max-w-full flex-wrap items-center gap-2 rounded-[16px] bg-ink px-3 py-2 text-sm text-white shadow-xl">
        <span className="px-1 font-semibold">
          {n} {noun}
          {n === 1 ? "" : "s"} selected
        </span>
        {n < ctx.ids.length && (
          <button type="button" onClick={() => ctx.setAll(true)} className="rounded-[10px] px-2 py-1 text-white/80 underline-offset-2 hover:underline">
            Select all {ctx.ids.length}
          </button>
        )}
        <span className="mx-1 hidden h-5 w-px bg-white/20 sm:block" />
        {children}
        <button type="button" onClick={ctx.clear} aria-label="Unselect all" className="ml-1 rounded-full p-1.5 text-white/80 hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export const BAR_BUTTON = "inline-flex h-8 items-center gap-1.5 rounded-[10px] bg-white/10 px-3 font-semibold text-white hover:bg-white/20 disabled:opacity-50";
