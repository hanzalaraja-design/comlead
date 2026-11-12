"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { markNotificationsRead } from "@/app/(app)/notifications/actions";

export function MarkAllRead() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await markNotificationsRead();
          if (!res.ok) toast.error(res.error);
        })
      }
      className="text-sm font-medium text-brand-primary hover:underline"
    >
      Mark all read
    </button>
  );
}
