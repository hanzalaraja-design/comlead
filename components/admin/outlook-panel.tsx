"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Check } from "@/lib/calendar/diagnostics";
import { checkOutlook, syncEverythingNow } from "@/app/(app)/admin/outlook/actions";

export function OutlookPanel({ initial }: { initial: Check[] }) {
  const [checks, setChecks] = useState(initial);
  const [sync, setSync] = useState<Awaited<ReturnType<typeof syncEverythingNow>> | null>(null);
  const [pending, startTransition] = useTransition();
  const allOk = checks.every((c) => c.ok);

  return (
    <div className="space-y-6">
      <section className="surface p-4 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="kicker">Connection</h2>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(async () => setChecks(await checkOutlook()))}>
            <RefreshCw className="h-4 w-4" /> Check again
          </Button>
        </div>
        <ul className="space-y-3">
          {checks.map((c) => (
            <li key={c.name} className="flex gap-3">
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
              )}
              <div>
                <p className="font-semibold">{c.name}</p>
                <p className="text-[13px] text-ink-muted">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="surface p-4 md:p-6">
        <h2 className="kicker mb-1">Sync everything now</h2>
        <p className="mb-4 text-[13px] text-ink-muted">
          Sends or updates the Outlook invite for every meeting set up here, and the task events of people who switched them on. The same thing
          runs every night at 2am.
        </p>
        <Button disabled={pending || !allOk} onClick={() => startTransition(async () => setSync(await syncEverythingNow()))}>
          {pending ? "Working…" : "Sync now"}
        </Button>
        {!allOk && <p className="mt-2 text-[13px] text-ink-muted">Fix the connection above first.</p>}
        {sync && (
          <div className="mt-4 space-y-2 text-sm">
            <p>
              Checked {sync.departments} meetings and {sync.tasks} tasks.{" "}
              {sync.errors.length ? `${sync.errors.length} problem${sync.errors.length === 1 ? "" : "s"}:` : "No problems."}
            </p>
            {sync.errors.length > 0 && (
              <ul className="space-y-2">
                {sync.errors.map((e, i) => (
                  <li key={i} className="rounded-[12px] bg-subtle px-3 py-2 text-[13px]">
                    <span className="font-semibold">{e.label}:</span> {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
