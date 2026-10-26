"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { openSubtaskCount } from "@/lib/tasks/open-subtasks";
import { setTaskStatus } from "@/app/(app)/tasks/actions";
import type { ActionResult } from "@/lib/action-result";
import type { TaskStatus } from "@/lib/types";

type Choice = "close" | "keep";
type Ask = { count: number; resolve: (c: Choice | null) => void };

// One dialog for the whole app; anything that finishes a task can ask through it.
let show: ((ask: Ask) => void) | null = null;

/** "2 subtasks are still open": close them too, keep them, or cancel (null). */
export function askAboutOpenSubtasks(count: number): Promise<Choice | null> {
  return new Promise((resolve) => (show ? show({ count, resolve }) : resolve("keep")));
}

/**
 * Change a task's status. Finishing a task with open subtasks asks first.
 * A cancelled ask comes back as { ok: false, error: "" }: nothing to show.
 */
export async function saveStatus(taskId: string, status: TaskStatus, blockedReason?: string): Promise<ActionResult> {
  const res = await setTaskStatus(taskId, status, blockedReason);
  if (res.ok) return res;
  const count = openSubtaskCount(res.error);
  if (count === null) return res;
  const choice = await askAboutOpenSubtasks(count);
  if (!choice) return { ok: false, error: "" };
  return setTaskStatus(taskId, status, blockedReason, choice);
}

export function SubtaskPrompt() {
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    show = setAsk;
    return () => {
      show = null;
    };
  }, []);
  const answer = (c: Choice | null) => {
    ask?.resolve(c);
    setAsk(null);
  };
  const n = ask?.count ?? 0;
  return (
    <Dialog open={!!ask} onOpenChange={(open) => !open && answer(null)}>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>
            {n === 1 ? "1 subtask is" : `${n} subtasks are`} still open
          </DialogTitle>
          <DialogDescription>{n === 1 ? "Close it too, or leave it with the person doing it?" : "Close them too, or leave them with the people doing them?"}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => answer(null)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => answer("keep")}>
            Keep {n === 1 ? "it" : "them"} open
          </Button>
          <Button onClick={() => answer("close")}>Close {n === 1 ? "it" : "them"} too</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
