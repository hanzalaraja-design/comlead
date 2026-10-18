"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/person-avatar";
import { DueLabel, PriorityBadge, TagList } from "@/components/tasks/task-badges";
import { StatusSelect } from "@/components/tasks/status-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { statusLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/types";
import type { TaskListRow } from "@/lib/tasks/queries";
import { setTaskStatus } from "@/app/(app)/tasks/actions";

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

/** Drag cards between columns on desktop; use the status pill on phones. */
export function KanbanBoard({
  tasks: initial,
  canEdit,
  showDepartment = false,
}: {
  tasks: TaskListRow[];
  canEdit: boolean;
  showDepartment?: boolean;
}) {
  const [tasks, setTasks] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [blockTarget, setBlockTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [, startTransition] = useTransition();
  const board = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const lastPos = useRef(new Map<string, { x: number; y: number; status: TaskStatus }>());

  // When a card changes column, slide it from where it was to where it is now
  // (positions are measured against the board, so page scrolling doesn't count).
  useLayoutEffect(() => {
    const root = board.current?.getBoundingClientRect();
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, { x: number; y: number; status: TaskStatus }>();
    for (const t of tasks) {
      const el = cards.current.get(t.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const pos = { x: r.left - root.left, y: r.top - root.top, status: t.status };
      next.set(t.id, pos);
      const prev = lastPos.current.get(t.id);
      if (!prev || reduce) continue;
      const dx = prev.x - pos.x;
      const dy = prev.y - pos.y;
      if (prev.status !== t.status) {
        // The card that moved: lift, glide across, settle with a brief highlight.
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(1.03)`, boxShadow: "0 12px 28px rgba(30,28,26,.18)", zIndex: 20 },
            { transform: "translate(0, 0) scale(1)", boxShadow: "0 0 0 2px hsl(var(--brand-primary) / .35)", zIndex: 20, offset: 0.85 },
            { transform: "translate(0, 0) scale(1)", boxShadow: "0 0 0 0 transparent", zIndex: 20 },
          ],
          { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      } else if (Math.abs(dy) > 1 || Math.abs(dx) > 1) {
        // Cards that shuffle up or down to make room.
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
          duration: 300,
          easing: "ease-out",
        });
      }
    }
    lastPos.current = next;
  }, [tasks]);

  // Take fresh server data after a refresh.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setTasks(initial);
  }

  function move(id: string, status: TaskStatus, blockedReason?: string) {
    const before = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status, blocked_reason: blockedReason ?? t.blocked_reason } : t)));
    startTransition(async () => {
      const res = await setTaskStatus(id, status, blockedReason);
      if (!res.ok) {
        setTasks(before);
        toast.error(res.error);
      }
    });
  }

  function drop(status: TaskStatus) {
    setOver(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    if (status === "blocked") {
      setBlockTarget(id);
      return;
    }
    move(id, status);
  }

  return (
    <>
      <div ref={board} className="relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col);
          return (
            <section
              key={col}
              onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setOver(col);
              }}
              onDragLeave={() => setOver((o) => (o === col ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(col);
              }}
              className={cn(
                "flex w-[82vw] shrink-0 snap-start flex-col rounded-[20px] bg-subtle p-2 sm:w-72 md:w-auto",
                over === col && "ring-2 ring-primary",
              )}
            >
              <h2 className="kicker mb-2 flex items-center justify-between px-2 pt-1 text-ink">
                {statusLabel(col)}
                <span className="rounded-full bg-white px-2 text-xs font-normal text-muted-foreground">{items.length}</span>
              </h2>
              <ul className="flex min-h-16 flex-col gap-2">
                {items.map((t) => (
                  <li
                    key={t.id}
                    ref={(el) => {
                      if (el) cards.current.set(t.id, el);
                      else cards.current.delete(t.id);
                    }}
                    draggable={canEdit}
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                    className={cn(
                      "relative rounded-[12px] border border-line bg-white p-3",
                      canEdit && "md:cursor-grab",
                      dragId === t.id && "opacity-50",
                    )}
                  >
                    <Link href={`/tasks/${t.id}`} className="block text-sm font-medium leading-snug after:absolute after:inset-0">
                      {t.title}
                    </Link>
                    {showDepartment && t.department && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t.department.name}
                      </p>
                    )}
                    {t.status === "blocked" && t.blocked_reason && (
                      <p className="mt-1 text-xs font-medium text-ink">Blocked: {t.blocked_reason}</p>
                    )}
                    <div className="mt-2">
                      <TagList tags={t.tags} />
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <PriorityBadge priority={t.priority} />
                      <DueLabel date={t.due_date} time={t.due_time} overdue={t.overdue} />
                      <PersonAvatar person={t.owner} className="ml-auto" />
                    </div>
                    <div className="mt-2 md:hidden">
                      <StatusSelect taskId={t.id} status={t.status} className="relative z-10" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <Dialog open={!!blockTarget} onOpenChange={(o) => !o && setBlockTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What&apos;s blocking this?</DialogTitle>
          </DialogHeader>
          <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (blockTarget) move(blockTarget, "blocked", reason);
                setBlockTarget(null);
                setReason("");
              }}
            >
              Mark blocked
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
