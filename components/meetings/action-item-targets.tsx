"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setActionItemProject } from "@/app/(app)/meetings/actions";

type Item = { id: string; title: string; projectId: string | null };

/**
 * Where each action item goes: one of the projects, campaigns or partnerships
 * the meeting is linked to, or only the meeting.
 */
export function ActionItemTargets({ items, linked, editable }: { items: Item[]; linked: { id: string; name: string }[]; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!items.length || !linked.length) return null;
  return (
    <div className="mt-3 surface overflow-hidden">
      <p className="bg-subtle px-4 py-2 text-[13px] font-bold text-ink">Where each action item goes</p>
      <ul className="divide-y divide-line">
        {items.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{t.title}</span>
            <select
              aria-label={`Where "${t.title}" goes`}
              disabled={!editable || pending}
              value={t.projectId && linked.some((l) => l.id === t.projectId) ? t.projectId : ""}
              onChange={(e) =>
                start(async () => {
                  const res = await setActionItemProject(t.id, e.target.value || null);
                  if (!res.ok) toast.error(res.error);
                  else toast.success(e.target.value ? `Moved to ${linked.find((l) => l.id === e.target.value)?.name}'s tasks.` : "Now only in this meeting.");
                  router.refresh();
                })
              }
              className="h-8 rounded-full border-0 bg-brand-bg px-3 text-xs font-semibold text-brand-primary disabled:opacity-70"
            >
              {linked.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}&apos;s tasks
                </option>
              ))}
              <option value="">Only in this meeting</option>
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}
