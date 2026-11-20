"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Check, CircleDot, FolderInput, Route, Trash2, UserRound } from "lucide-react";
import { BAR_BUTTON, BulkBar, useBulk } from "@/components/bulk-select";
import { DeleteDialog } from "@/components/delete-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DOMAINS } from "@/lib/domains";
import { STATUSES, personName } from "@/lib/labels";
import type { PersonRef, ProjectKind } from "@/lib/types";
import { bulkTasks, type BulkTaskOp } from "@/app/(app)/tasks/actions";

export type MoveTarget = { id: string; name: string; kind: ProjectKind };
/** Journeys (or terms) of the project the list is in. */
export type PartTarget = { id: string; name: string };

const MENU_ITEM = "block w-full rounded-[8px] px-3 py-2 text-left text-sm hover:bg-subtle";

/** Run one change on every ticked task and say how it went. */
export function useBulkTasks() {
  const ctx = useBulk();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (op: BulkTaskOp, done: string, ids = ctx ? [...ctx.selected] : []) =>
    start(async () => {
      const res = await bulkTasks(ids, op);
      if (!res.ok) return void toast.error(res.error);
      const { changed, skipped } = res.data!;
      const n = `${changed} task${changed === 1 ? "" : "s"}`;
      if (skipped) toast.warning(`${n} ${done}. ${skipped} skipped: locked, or not yours to change.`);
      else toast.success(`${n} ${done}.`);
      ctx?.clear();
      router.refresh();
    });
  return { run, pending };
}

/** Mark done, change status, move the date, give to someone, move to a project, or delete the ticked tasks. */
export function BulkTasksBar({ people, projects = [], parts = [] }: { people: PersonRef[]; projects?: MoveTarget[]; parts?: PartTarget[] }) {
  const ctx = useBulk();
  const { run, pending } = useBulkTasks();
  const [deleting, setDeleting] = useState(false);
  const [date, setDate] = useState("");
  const [q, setQ] = useState("");
  if (!ctx) return null;
  const ids = [...ctx.selected];
  const shownPeople = people.filter((p) => !q || personName(p).toLowerCase().includes(q.toLowerCase()));
  const shownProjects = projects.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <BulkBar>
        <button type="button" disabled={pending} onClick={() => run({ kind: "status", status: "done" }, "marked done")} className={BAR_BUTTON}>
          <Check className="h-4 w-4" /> Mark done
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" disabled={pending} className={BAR_BUTTON}>
              <CircleDot className="h-4 w-4" /> Status
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" side="top">
            {STATUSES.map((s) => (
              <button key={s.value} type="button" onClick={() => run({ kind: "status", status: s.value }, `set to ${s.label}`)} className={MENU_ITEM}>
                {s.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
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
              <button type="button" disabled={pending} onClick={() => run({ kind: "due", due_date: null }, "now have no date")} className="h-8 rounded-[10px] border border-line px-3 text-sm">
                No date
              </button>
            </div>
          </PopoverContent>
        </Popover>
        <Popover onOpenChange={() => setQ("")}>
          <PopoverTrigger asChild>
            <button type="button" disabled={pending} className={BAR_BUTTON}>
              <UserRound className="h-4 w-4" /> Give to
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1" side="top">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find someone" aria-label="Find someone" className="mb-1 h-9 w-full rounded-[8px] border border-line px-2 text-sm" />
            <div className="max-h-64 overflow-y-auto">
              {shownPeople.map((p) => (
                <button key={p.id} type="button" onClick={() => run({ kind: "owner", owner_id: p.id }, `given to ${personName(p)}`)} className={MENU_ITEM}>
                  {personName(p)}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {projects.length > 0 && (
          <Popover onOpenChange={() => setQ("")}>
            <PopoverTrigger asChild>
              <button type="button" disabled={pending} className={BAR_BUTTON}>
                <FolderInput className="h-4 w-4" /> Move to
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-1" side="top">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Project, campaign or partnership" aria-label="Find a project, campaign or partnership" className="mb-1 h-9 w-full rounded-[8px] border border-line px-2 text-sm" />
              <div className="max-h-64 overflow-y-auto">
                {shownProjects.map((p) => (
                  <button key={p.id} type="button" onClick={() => run({ kind: "project", project_id: p.id }, `moved to ${p.name}`)} className={MENU_ITEM}>
                    {p.name} <span className="text-xs text-ink-muted">· {DOMAINS[p.kind].label}</span>
                  </button>
                ))}
                <button type="button" onClick={() => run({ kind: "project", project_id: null }, "taken out of their project")} className={`${MENU_ITEM} text-ink-muted`}>
                  Not in a project
                </button>
              </div>
            </PopoverContent>
          </Popover>
        )}
        {parts.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" disabled={pending} className={BAR_BUTTON}>
                <Route className="h-4 w-4" /> Journey
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-1" side="top">
              {parts.map((p) => (
                <button key={p.id} type="button" onClick={() => run({ kind: "part", part_id: p.id }, `moved to ${p.name}`)} className={MENU_ITEM}>
                  {p.name}
                </button>
              ))}
              <button type="button" onClick={() => run({ kind: "part", part_id: null }, "moved to Other tasks")} className={`${MENU_ITEM} text-ink-muted`}>
                Not in a journey (Other tasks)
              </button>
            </PopoverContent>
          </Popover>
        )}
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
        onDeleted={() => ctx.clear()}
      >
        <p>They go from every list, with their subtasks. An Admin can still see them in the activity log.</p>
      </DeleteDialog>
    </>
  );
}
