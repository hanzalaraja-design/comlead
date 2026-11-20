"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { requestAccess } from "@/app/(app)/access/actions";

/**
 * A Placements tab you can't see: what you can still see here (your own
 * requests), who gives access, and a button to ask.
 */
export function TabLock({
  tab,
  label,
  owner,
  teams,
  asked: asked0,
  ownNoun,
}: {
  tab: string;
  label: string;
  owner: string | null;
  teams: string[];
  asked: boolean;
  /** "requests" or "bookings": what of yours still shows below. */
  ownNoun: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [asked, setAsked] = useState(asked0);
  const [pending, start] = useTransition();
  return (
    <div className="mb-5 rounded-[16px] border border-line bg-white p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-subtle">
          <Lock className="h-4 w-4 text-ink" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-[15px] font-semibold text-ink">{label} is for {teams.length ? teams.join(", ") : "its team"}</p>
          <p className="text-sm text-ink-muted">
            You only see your own {ownNoun} here. {owner ? `${owner} can` : "The team lead or an Admin can"} give you access to everything in {label}.
          </p>
        </div>
        {asked ? (
          <span role="status" className="rounded-full bg-success-soft px-3 py-1.5 text-sm font-semibold text-success-ink">
            Request sent
          </span>
        ) : (
          !open && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Request access
            </Button>
          )
        )}
      </div>
      {open && !asked && (
        <div className="mt-3 space-y-2 pl-12">
          <label className="block space-y-1.5 text-sm font-medium text-ink">
            Why you need it (optional)
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} placeholder="e.g. I'm planning the CRM pushes for the sale" />
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await requestAccess("placement_tab", tab, reason.trim());
                  if (!res.ok) return void toast.error(res.error);
                  setAsked(true);
                  setOpen(false);
                })
              }
            >
              {pending ? "Sending…" : "Request access"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
