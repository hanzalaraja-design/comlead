"use server";

import { requireAdmin } from "@/lib/auth";
import { isCalendarConfigured } from "@/lib/calendar/graph";
import { explain, runChecks, type Check } from "@/lib/calendar/diagnostics";
import { collectSyncErrors, reconcileAll } from "@/lib/calendar/sync";

export async function checkOutlook(): Promise<Check[]> {
  await requireAdmin();
  return runChecks();
}

export async function syncEverythingNow(): Promise<{ departments: number; tasks: number; errors: { label: string; message: string }[] }> {
  await requireAdmin();
  if (!isCalendarConfigured()) return { departments: 0, tasks: 0, errors: [{ label: "Settings", message: "Outlook isn't configured in this deployment." }] };
  const { result, errors } = await collectSyncErrors(() => reconcileAll());
  return { ...result, errors: errors.slice(0, 20).map((e) => ({ label: e.label, message: explain(e.message) })) };
}
