"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setOutlookTasks } from "@/app/(app)/settings/actions";

export function OutlookTasksToggle({ enabled, available }: { enabled: boolean; available: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="font-semibold">Show my tasks in Outlook</p>
        <p className="mt-1 text-[13px] text-ink-muted">
          Tasks you own with a due date appear in your Outlook calendar and update when the task changes. Tasks with a time
          get a 30 minute slot and a reminder; the rest show as all-day. Done or cancelled tasks are removed.
        </p>
        {!available && <p className="mt-2 text-[13px] text-ink-muted">Outlook isn&apos;t connected yet. Ask an Admin.</p>}
      </div>
      <Switch
        checked={on}
        disabled={pending || !available}
        aria-label="Show my tasks in Outlook"
        onCheckedChange={(next) => {
          setOn(next);
          startTransition(async () => {
            const res = await setOutlookTasks(next);
            if (res.ok) toast.success(next ? "Your tasks will appear in Outlook shortly." : "Task events removed from Outlook.");
            else {
              setOn(!next);
              toast.error(res.error);
            }
          });
        }}
      />
    </div>
  );
}
