"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveStatus } from "@/components/tasks/subtask-prompt";
import { TASK_DONE_EVENT, type TaskDoneDetail } from "@/components/progress/celebrate";

/** One click to finish a task: the circle fills green, then the row moves on. */
export function CompleteButton({ taskId, title, dueByToday, className }: { taskId: string; title: string; dueByToday: boolean; className?: string }) {
  const [done, setDone] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label={`Mark "${title}" done`}
      aria-pressed={done}
      disabled={done}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDone(true);
        window.dispatchEvent(new CustomEvent<TaskDoneDetail>(TASK_DONE_EVENT, { detail: { dueByToday } }));
        startTransition(async () => {
          const res = await saveStatus(taskId, "done");
          if (!res.ok) {
            setDone(false);
            if (res.error) toast.error(res.error);
          }
        });
      }}
      className={cn(
        "group relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300",
        done ? "scale-110 border-success bg-success text-white" : "border-line bg-white text-transparent hover:border-success hover:text-success",
        className,
      )}
    >
      <Check className={cn("h-3 w-3 transition-transform duration-300", done ? "scale-100" : "scale-75")} strokeWidth={3} />
    </button>
  );
}
