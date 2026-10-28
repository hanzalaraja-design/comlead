"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DeleteDialog } from "@/components/delete-dialog";
import { backTo } from "@/components/return-to";
import { deleteTask } from "@/app/(app)/tasks/actions";

/** The ⋯ on a task: copy its link, and Delete for its owner. */
export function TaskMenu({
  taskId,
  title,
  subtasks,
  canDelete,
  fallback,
}: {
  taskId: string;
  title: string;
  subtasks: number;
  canDelete: boolean;
  /** Where to go after deleting, when we don't know where it was opened from. */
  fallback: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="More actions" className="px-2.5">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={async () => {
              try {
                await navigator.clipboard.writeText(`${location.origin}/tasks/${taskId}`);
                toast.success("Link copied");
              } catch {
                toast.error("Couldn't copy the link.");
              }
            }}
          >
            <Link2 className="h-4 w-4" /> Copy link
          </DropdownMenuItem>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => setConfirming(true)}>
                <Trash2 className="h-4 w-4" /> Delete task…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canDelete && (
        <DeleteDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Delete this task?"
          button="Delete task"
          action={() => deleteTask(taskId)}
          onDeleted={() => {
            toast.success("Task deleted");
            router.push(backTo(taskId, fallback));
          }}
        >
          <p>
            “{title}”{subtasks > 0 ? ` and its ${subtasks} subtask${subtasks === 1 ? "" : "s"}` : ""} will be removed from every view. The
            activity log keeps a record.
          </p>
        </DeleteDialog>
      )}
    </>
  );
}
