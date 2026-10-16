"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
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
export function KanbanBoard({ tasks: initial, canEdit }: { tasks: TaskListRow[]; canEdit: boolean }) {
  const [tasks, setTasks] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [blockTarget, setBlockTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [, startTransition] = useTransition();

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
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
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
                "flex w-[82vw] shrink-0 snap-start flex-col rounded-lg bg-muted/40 p-2 sm:w-72 md:w-auto",
                over === col && "ring-2 ring-primary",
              )}
            >
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                {statusLabel(col)}
                <span className="rounded-full bg-background px-2 text-xs font-normal text-muted-foreground">{items.length}</span>
              </h2>
              <ul className="flex min-h-16 flex-col gap-2">
                {items.map((t) => (
                  <li
                    key={t.id}
                    draggable={canEdit}
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                    className={cn(
                      "relative rounded-md border bg-background p-3 shadow-sm",
                      canEdit && "md:cursor-grab",
                      dragId === t.id && "opacity-50",
                    )}
                  >
                    <Link href={`/tasks/${t.id}`} className="block text-sm font-medium leading-snug after:absolute after:inset-0">
                      {t.title}
                    </Link>
                    {t.sub_team && <p className="mt-1 text-xs text-muted-foreground">{t.sub_team.name}</p>}
                    {t.status === "blocked" && t.blocked_reason && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t.blocked_reason}</p>
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
