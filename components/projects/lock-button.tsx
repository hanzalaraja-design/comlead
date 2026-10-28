"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setProjectLocked } from "@/app/(app)/projects/actions";

/** Owners lock it so only they can change it. Others just see that it's locked. */
export function LockButton({ projectId, locked, canToggle }: { projectId: string; locked: boolean; canToggle: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (!canToggle && !locked) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={locked}
      disabled={!canToggle || pending}
      title={canToggle ? (locked ? "Unlock so everyone in it can change it" : "Lock so only the owners can change it") : "Only its owners can unlock it"}
      onClick={() =>
        startTransition(async () => {
          const res = await setProjectLocked(projectId, !locked);
          if (res.ok) {
            toast.success(locked ? "Unlocked. Everyone in it can change it." : "Locked. Only the owners can change it now.");
            router.refresh();
          } else toast.error(res.error);
        })
      }
    >
      {locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
      {locked ? "Locked" : "Lock"}
    </Button>
  );
}
