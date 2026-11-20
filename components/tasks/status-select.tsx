"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { STATUSES, STATUS_STYLES } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { TaskStatus } from "@/lib/types";
import { saveStatus } from "@/components/tasks/subtask-prompt";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useBulk } from "@/components/bulk-select";
import { useBulkTasks } from "@/components/tasks/bulk-tasks";
import { TASK_DONE_EVENT, type TaskDoneDetail } from "@/components/progress/celebrate";

/**
 * Compact status dropdown that saves immediately. Asks for a reason when
 * Blocked. When this task is ticked along with others, the change goes to
 * every ticked task.
 */
export function StatusSelect({
  taskId,
  status,
  disabled,
  className,
  dueByToday = false,
}: {
  /** Due today or earlier: finishing it counts towards clearing today. */
  dueByToday?: boolean;
  taskId: string;
  status: TaskStatus;
  disabled?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState(status);
  const [pending, startTransition] = useTransition();
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState("");
  const bulk = useBulk();
  const { run } = useBulkTasks();
  const many = !!bulk && bulk.selected.has(taskId) && bulk.selected.size > 1;

  function save(next: TaskStatus, blockedReason?: string) {
    if (many) {
      const label = STATUSES.find((s) => s.value === next)?.label ?? next;
      run({ kind: "status", status: next, blocked_reason: blockedReason }, `set to ${label}`);
      return;
    }
    const previous = value;
    setValue(next);
    if (next === "done") window.dispatchEvent(new CustomEvent<TaskDoneDetail>(TASK_DONE_EVENT, { detail: { dueByToday } }));
    startTransition(async () => {
      const res = await saveStatus(taskId, next, blockedReason);
      if (!res.ok) {
        setValue(previous);
        if (res.error) toast.error(res.error);
      }
    });
  }

  return (
    <>
      <span className="relative inline-flex">
      <select
        aria-label={many ? `Status of all ${bulk!.selected.size} ticked tasks` : "Status"}
        value={value}
        disabled={disabled || pending}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const next = e.target.value as TaskStatus;
          if (next === "blocked") {
            setAskReason(true);
            return;
          }
          save(next);
        }}
        className={cn(
          "h-7 cursor-pointer appearance-none rounded-full border-0 px-2.5 pr-6 text-xs font-medium outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-80",
          STATUS_STYLES[value],
          className,
        )}
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 opacity-60" />
      </span>

      <Dialog open={askReason} onOpenChange={setAskReason}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>What&apos;s blocking this?</DialogTitle>
          </DialogHeader>
          <Textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Waiting for Finance to approve the budget"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAskReason(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setAskReason(false);
                save("blocked", reason);
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
