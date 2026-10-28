"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DeleteDialog } from "@/components/delete-dialog";
import { deleteProject } from "@/app/(app)/projects/actions";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The ⋯ on a project, campaign or partnership: copy its link, and Delete for its owners. */
export function ProjectMenu({
  projectId,
  name,
  kindLabel,
  listHref,
  tasks,
  meetings,
  canDelete,
}: {
  projectId: string;
  name: string;
  /** "campaign", "project" or "partnership". */
  kindLabel: string;
  listHref: string;
  tasks: number;
  meetings: number;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const kept = [tasks && plural(tasks, "task"), meetings && plural(meetings, "linked meeting")].filter(Boolean).join(" and ");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="More actions" className="px-2.5">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onSelect={async () => {
              try {
                await navigator.clipboard.writeText(location.origin + location.pathname);
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
                <Trash2 className="h-4 w-4" /> Delete {kindLabel}…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canDelete && (
        <DeleteDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete “${name}”?`}
          button={`Delete ${kindLabel}`}
          confirmText={name}
          action={() => deleteProject(projectId)}
          onDeleted={() => {
            toast.success(`${name} deleted`);
            router.push(listHref);
          }}
        >
          <p>
            The {kindLabel} page goes away for everyone.
            {kept
              ? ` Nothing inside is deleted: its ${kept} will stay with their owners, just no longer linked to ${name}.`
              : " Nothing else is linked to it."}
          </p>
        </DeleteDialog>
      )}
    </>
  );
}
