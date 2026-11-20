"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LinkConfirm } from "@/components/meetings/link-confirm";
import { linkMeeting, unlinkMeeting } from "@/app/(app)/meetings/actions";

export type MeetingOption = { id: string; title: string; when: string; recurring: boolean; unlinkedItems: number };

/** "+ Link a meeting" on a project, campaign or partnership. */
export function LinkMeetingButton({ projectId, projectName, options }: { projectId: string; projectName: string; options: MeetingOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<MeetingOption | null>(null);
  const [pending, start] = useTransition();
  const shown = options.filter((o) => !q.trim() || o.title.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30);
  const link = (o: MeetingOption, opts: { move: boolean; series: boolean }) =>
    start(async () => {
      const res = await linkMeeting(o.id, projectId, opts);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Linked "${o.title}" to ${projectName}.`);
      setPicked(null);
      router.refresh();
    });
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4" /> Link a meeting
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="border-b p-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search meetings" aria-label="Search meetings" className="h-8 w-full rounded-md bg-muted px-2 text-sm outline-none" />
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {shown.length ? (
              shown.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setQ("");
                    if (o.unlinkedItems > 0 || o.recurring) setPicked(o);
                    else link(o, { move: false, series: false });
                  }}
                  className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-subtle"
                >
                  <span className="truncate text-sm font-medium text-ink">{o.title}</span>
                  <span className="text-xs text-ink-muted">
                    {o.when}
                    {o.recurring ? " · recurring" : ""}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-2 py-2 text-sm text-ink-muted">No meetings you can link. You need to be at the meeting (or its team admin).</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {picked && (
        <LinkConfirm
          open
          title={`Link "${picked.title}" to ${projectName}`}
          projectName={projectName}
          unlinkedItems={picked.unlinkedItems}
          recurring={picked.recurring}
          pending={pending}
          onCancel={() => setPicked(null)}
          onConfirm={(o) => link(picked, o)}
        />
      )}
    </>
  );
}

/** Unlink one meeting from the project (and, for a series, optionally the future ones). */
export function UnlinkMeetingButton({ meetingId, projectId, title, recurring }: { meetingId: string; projectId: string; title: string; recurring: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Unlink "${title}"? Its action items leave this project's tasks.`)) return;
        const series = recurring && window.confirm("Also unlink every future meeting in this series? (Cancel unlinks just this one.)");
        start(async () => {
          const res = await unlinkMeeting(meetingId, projectId, series);
          if (!res.ok) toast.error(res.error);
          router.refresh();
        });
      }}
      className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-line px-2.5 text-xs font-medium text-ink-muted hover:text-ink"
    >
      <Unlink className="h-3.5 w-3.5" /> Unlink
    </button>
  );
}
