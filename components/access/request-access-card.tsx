"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { requestAccess } from "@/app/(app)/access/actions";

export type AccessInfo = {
  type: "task" | "project";
  title: string;
  kind?: string;
  owner: string | null;
  teams: string[];
  people: string[];
  project?: string | null;
  locked?: boolean;
  asked: boolean;
};

const NOUN: Record<string, string> = { task: "task", project: "project", campaign: "campaign", partnership: "partnership" };

/** What you see when you open something you can't: who has access now, and a button to ask. */
export function RequestAccessCard({ info, accessKey }: { info: AccessInfo; accessKey: string }) {
  const [reason, setReason] = useState("");
  const [asked, setAsked] = useState(info.asked);
  const [pending, start] = useTransition();
  const noun = NOUN[info.type === "task" ? "task" : info.kind ?? "project"];
  const rows: [string, string][] = [
    ["Owner", info.owner ?? "Nobody yet"],
    ...(info.teams.length ? ([["Teams", info.teams.join(", ")]] as [string, string][]) : []),
    ...(info.people.length ? ([[info.type === "task" ? "Collaborators" : "People", info.people.join(", ")]] as [string, string][]) : []),
  ];

  return (
    <div className="surface mx-auto max-w-lg space-y-5 p-6 md:p-8">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle">
        <Lock className="h-5 w-5 text-ink" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold text-ink">You don&apos;t have access to this {noun}</h1>
        <p className="text-[15px] text-ink-muted">
          &ldquo;{info.title}&rdquo;{info.project ? ` in ${info.project}` : ""}. Ask for access and {info.owner ?? "its owner"} can let you in.
        </p>
      </div>
      <div className="space-y-2 rounded-[14px] bg-canvas px-4 py-3 text-sm">
        <p className="font-semibold text-ink">Who has access now</p>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {asked ? (
        <div role="status" className="rounded-[14px] bg-success-soft px-4 py-3 text-[15px] text-success-ink">
          <p className="font-semibold">Request sent</p>
          <p>You&apos;ll get a notification when you&apos;re in.</p>
        </div>
      ) : (
        <>
          <label className="block space-y-1.5 text-sm font-medium text-ink">
            Why you need it (optional)
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} placeholder="e.g. I'm writing the banner copy for this" />
          </label>
          <div className="flex justify-end">
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await requestAccess(info.type, accessKey, reason.trim());
                  if (res.ok) setAsked(true);
                  else toast.error(res.error);
                })
              }
            >
              {pending ? "Sending…" : "Request access"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
