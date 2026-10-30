"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CornerDownLeft, Plus } from "lucide-react";
import { quickAddTask } from "@/app/(app)/tasks/actions";
import { cn } from "@/lib/utils";

/** Type, press Enter, done. From My tasks it's yours; elsewhere team tasks go to the team's admin. */
export function QuickAdd({
  departments,
  defaultDepartmentId = null,
  mine = false,
  projectId,
}: {
  departments: { id: string; name: string }[];
  defaultDepartmentId?: string | null;
  /** On My tasks: what you add is yours, in whichever team you pick. */
  mine?: boolean;
  /** Inside a project: the task goes in it, and it's yours. */
  projectId?: string;
}) {
  const [title, setTitle] = useState("");
  const [dept, setDept] = useState<string>(defaultDepartmentId ?? departments[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function add() {
    if (!title.trim()) return;
    const value = title;
    setTitle("");
    startTransition(async () => {
      const res = await quickAddTask(value, dept || null, projectId, mine);
      if (res.ok)
        toast.success(
          res.data!.done
            ? "Logged as done."
            : projectId
            ? "Added to the project. It's yours."
            : res.data!.owner === "you"
              ? "Added. It's yours."
              : res.data!.owner
                ? `Added for ${res.data!.owner} to hand out.`
                : "Added to the team, unassigned.",
        );
      else {
        setTitle(value);
        toast.error(res.error);
      }
      input.current?.focus();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      className="surface flex flex-col gap-2 p-2 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
        <Plus className="h-4 w-4 shrink-0 text-ink-muted" />
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task. Try: Send quote to Ali tomorrow!"
          aria-label="New task"
          maxLength={320}
          className="h-10 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
        />
      </div>
      {/* On phones the picker and button appear once you start typing. */}
      <div className={cn("flex items-center gap-2", !title.trim() && "hidden sm:flex")}>
        {/* Only asked when it isn't obvious. */}
        {!projectId && departments.length > 1 && (
          <select
            aria-label="Team"
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="h-9 field max-w-[11rem] px-2 text-sm"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[12px] bg-brand-primary px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          Add <CornerDownLeft className="h-3.5 w-3.5" />
        </button>
      </div>
    </form>
  );
}
