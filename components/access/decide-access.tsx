"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { decideAccess } from "@/app/(app)/access/actions";

/** Give access / Decline, for the owner. */
export function DecideAccess({ requestId, name }: { requestId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const decide = (give: boolean) =>
    start(async () => {
      const res = await decideAccess(requestId, give);
      if (!res.ok) return void toast.error(res.error);
      toast.success(give ? `${name} has access now.` : `Declined. ${name} is told.`);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button disabled={pending} onClick={() => decide(true)}>
        Give access
      </Button>
      <Button variant="outline" disabled={pending} onClick={() => decide(false)}>
        Decline
      </Button>
    </div>
  );
}
