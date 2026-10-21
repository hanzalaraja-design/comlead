"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { markMentionsRead } from "@/app/(app)/my/actions";
import { cn } from "@/lib/utils";

/** Clears one mention (with an id) or all of them. */
export function MarkMentionsRead({ id, className }: { id?: string; className?: string }) {
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await markMentionsRead(id);
      if (!res.ok) toast.error(res.error);
    });
  if (!id)
    return (
      <button type="button" onClick={run} disabled={pending} className={cn("text-sm font-medium text-brand-primary hover:underline", className)}>
        Mark all read
      </button>
    );
  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      aria-label="Mark as read"
      title="Mark as read"
      className={cn("relative z-10 rounded-full p-1.5 text-ink-muted hover:bg-subtle hover:text-ink", className)}
    >
      <Check className="h-4 w-4" />
    </button>
  );
}
