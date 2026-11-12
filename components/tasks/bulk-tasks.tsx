"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Check, Trash2, UserRound } from "lucide-react";
import { BAR_BUTTON, BulkBar, useBulk } from "@/components/bulk-select";
import { DeleteDialog } from "@/components/delete-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { personName } from "@/lib/labels";
import type { PersonRef } from "@/lib/types";
import { bulkTasks, type BulkTaskOp } from "@/app/(app)/tasks/actions";

/** Mark done, move the date, give to someone, or delete the ticked tasks. */
export function BulkTasksBar({ people }: { people: PersonRef[] }) {
  const ctx = useBulk();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const [date, setDate] = useState("");
  if (!ctx) return null;
  const ids = [...ctx.selected];

  const run = (op: BulkTaskOp, done: string) =>
    start(async () => {
      const res = await bulkTasks(ids, op);
      if (!res.ok) return void toast.error(res.error);
      const { changed, skipped } = res.data!;
      if (skipped) toast.warning(`${changed} ${done}. ${skipped} skipped: locked or not yours to change.`);
      else toast.success(`${changed} ${done}.`);
      ctx.clear();
      router.refresh();
    });

  return (
    <>
      <BulkBar>
        <button type="button" disabled={pending} onClick={() => run({ kind: "done" }, "marked done")} className={BAR_BUTTON}>
          <Check className="h-4 w-4" /> Mark done
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" disabled={pending} className={BAR_BUTTON}>
              <CalendarDays className="h-4 w-4" /> Due date
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2 p-3" side="top">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="New due date" className="h-9 w-full rounded-[10px] border border-line px-2 text-sm" />
            <div className="flex gap-2">
              <button type="button" disabled={!date || pending} onClick={() => run({ kind: "due", due_date: date }, "moved")} className="h-8 flex-1 rounded-[10px] bg-brand-primary text-sm font-semibold text-white disabled:opacity-50">
                Set date
              </button>
              <button type="button" disabled={pending} onClick={() => run({ kind: "due", due_date: null }, "cleared")} className="h-8 rounded-[10px] border border-line px-3 text-sm">
                No date
              </button>
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" disabled={pending} className={BAR_BUTTON}>
              <UserRound className="h-4 w-4" /> Give to
            </button>
          </PopoverTrigger>
          <PopoverContent className="max-h-72 w-60 overflow-y-auto p-1" side="top">
            {people.map((p) => (
              <button key={p.id} type="button" onClick={() => run({ kind: "owner", owner_id: p.id }, `given to ${personName(p)}`)} className="block w-full rounded-[8px] px-3 py-2 text-left text-sm hover:bg-subtle">
                {personName(p)}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <button type="button" disabled={pending} onClick={() => setDeleting(true)} className={`${BAR_BUTTON} hover:bg-danger`}>
          <Trash2 className="h-4 w-4" /> Delete
        </button>
      </BulkBar>
      <DeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${ids.length} task${ids.length === 1 ? "" : "s"}?`}
        button="Delete"
        action={async () => {
          const res = await bulkTasks(ids, { kind: "delete" });
          if (res.ok && res.data!.skipped) toast.warning(`${res.data!.changed} deleted. ${res.data!.skipped} skipped: not yours to delete.`);
          return res.ok ? { ok: true } : res;
        }}
        onDeleted={() => {
          ctx.clear();
          router.refresh();
        }}
      >
        <p>They go from every list, with their subtasks. An Admin can still see them in the activity log.</p>
      </DeleteDialog>
    </>
  );
}
