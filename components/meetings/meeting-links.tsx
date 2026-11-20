"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProjectTag } from "@/components/tasks/task-badges";
import { DOMAINS, domainHref } from "@/lib/domains";
import type { ProjectKind } from "@/lib/types";
import { linkMeeting, unlinkMeeting } from "@/app/(app)/meetings/actions";
import { LinkConfirm } from "@/components/meetings/link-confirm";

type Item = { id: string; name: string; slug: string; kind: ProjectKind };

/** "Linked to" on a meeting: the projects, campaigns and partnerships it's about. */
export function MeetingLinks({
  meetingId,
  linked,
  options,
  editable,
  unlinkedItems = 0,
  recurring = false,
}: {
  meetingId: string;
  linked: Item[];
  options: Item[];
  editable: boolean;
  /** Action items not in any project yet: offered to move when linking. */
  unlinkedItems?: number;
  /** Part of a recurring series: offer to link every future meeting too. */
  recurring?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Item | null>(null);
  const ids = linked.map((l) => l.id);
  const q = query.trim().toLowerCase();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(done);
        setPicked(null);
        router.refresh();
      } else toast.error(res.error ?? "Couldn't change that.");
    });
  }
  const link = (o: Item) => {
    if (unlinkedItems > 0 || recurring) return setPicked(o);
    run(() => linkMeeting(meetingId, o.id), `Linked to ${o.name}. New action items land there too.`);
  };
  const unlink = (l: Item) => {
    const series = recurring && window.confirm(`Also unlink every future meeting in this series from ${l.name}? (Cancel unlinks just this one.)`);
    run(() => unlinkMeeting(meetingId, l.id, series), `Unlinked ${l.name}.`);
  };

  if (!linked.length && !editable) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      <span className="text-[13px] font-semibold text-ink-muted">Linked to</span>
      {linked.map((l) => (
        <span key={l.id} className="inline-flex items-center gap-1">
          <Link href={domainHref(l)} className="hover:opacity-80">
            <ProjectTag name={l.name} kind={l.kind} prefix={DOMAINS[l.kind].label} size="md" />
          </Link>
          {editable && (
            <button
              type="button"
              aria-label={`Unlink ${l.name}`}
              disabled={pending}
              onClick={() => unlink(l)}
              className="text-ink-muted hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      ))}
      {editable && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-line px-2.5 text-[13px] font-semibold text-ink-muted hover:text-ink">
              <Plus className="h-3.5 w-3.5" /> Link to a project, campaign or partnership
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <div className="border-b p-2">
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Project, campaign or partnership…" className="h-8 w-full rounded-md bg-muted px-2 text-sm outline-none" />
            </div>
            <div className="max-h-80 overflow-y-auto p-1">
              {(["campaign", "partnership", "project"] as const).map((k) => {
                const list = options.filter((o) => o.kind === k && !ids.includes(o.id) && (!q || o.name.toLowerCase().includes(q)));
                return list.length ? (
                  <div key={k}>
                    <p className="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted">{DOMAINS[k].plural}</p>
                    {list.slice(0, 8).map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          setQuery("");
                          link(o);
                        }}
                        className="flex w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-subtle"
                      >
                        <span className="truncate">{o.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null;
              })}
            </div>
          </PopoverContent>
        </Popover>
            )}
      {picked && (
        <LinkConfirm
          open
          title={`Link to ${picked.name}`}
          projectName={picked.name}
          unlinkedItems={unlinkedItems}
          recurring={recurring}
          pending={pending}
          onCancel={() => setPicked(null)}
          onConfirm={(o) => run(() => linkMeeting(meetingId, picked.id, o), `Linked to ${picked.name}.`)}
        />
      )}
    </span>
  );
}
