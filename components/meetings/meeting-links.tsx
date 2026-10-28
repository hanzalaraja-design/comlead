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
import { setMeetingProjects } from "@/app/(app)/meetings/actions";

type Item = { id: string; name: string; slug: string; kind: ProjectKind };

/** "Linked to" on a meeting: the projects, campaigns and partnerships it's about. */
export function MeetingLinks({ meetingId, linked, options, editable }: { meetingId: string; linked: Item[]; options: Item[]; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ids = linked.map((l) => l.id);
  const q = query.trim().toLowerCase();

  function save(next: string[], done: string) {
    startTransition(async () => {
      const res = await setMeetingProjects(meetingId, next);
      if (res.ok) {
        toast.success(done);
        router.refresh();
      } else toast.error(res.error);
    });
  }

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
              onClick={() => save(ids.filter((x) => x !== l.id), `Unlinked ${l.name}.`)}
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
              <Plus className="h-3.5 w-3.5" /> Link
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
                          save([...ids, o.id], `Linked to ${o.name}. New action items land there too.`);
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
    </span>
  );
}
