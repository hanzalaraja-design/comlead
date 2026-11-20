"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS } from "@/lib/domains";
import type { PartnerCategory } from "@/lib/types";
import { createPartnershipTag, setPartnershipTag, type TagColor } from "@/app/(app)/partnerships/actions";

export type Tag = { id: string; name: string; color: TagColor; category: PartnerCategory };

/** Soft tag colours (tinted background, darker text), like Notion. */
export const TAG_STYLE: Record<TagColor, string> = {
  gray: "bg-[#F2F1EE] text-[#4A4642]",
  purple: "bg-[#F6E7F8] text-[#6A0F78]",
  blue: "bg-[#E8F0FE] text-[#1F4FB8]",
  green: "bg-[#E3F5EB] text-[#13703F]",
  amber: "bg-[#FEF4DC] text-[#8F5600]",
  pink: "bg-[#FCE7F0] text-[#9C2457]",
  teal: "bg-[#E0F4F2] text-[#0F6B63]",
};

export function TagChip({ tag, className }: { tag: Pick<Tag, "name" | "color">; className?: string }) {
  return <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium", TAG_STYLE[tag.color], className)}>{tag.name}</span>;
}

/**
 * The small "+" on a partnership: pick its tags, or type a new one and press
 * Enter to create it (shared with everyone, in this category).
 */
export function TagPicker({
  projectId,
  category,
  tags,
  selected,
}: {
  projectId: string;
  category: PartnerCategory | null;
  /** Every tag in this partnership's category. */
  tags: Tag[];
  selected: string[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [on, setOn] = useState(new Set(selected));
  const [pending, start] = useTransition();
  const query = q.trim().toLowerCase();
  const shown = useMemo(() => tags.filter((t) => !query || t.name.toLowerCase().includes(query)), [tags, query]);
  const exact = tags.some((t) => t.name.toLowerCase() === query);

  const toggle = (t: Tag) =>
    start(async () => {
      const next = !on.has(t.id);
      setOn((s) => {
        const n = new Set(s);
        if (next) n.add(t.id);
        else n.delete(t.id);
        return n;
      });
      const res = await setPartnershipTag(projectId, t.id, next);
      if (!res.ok) toast.error(res.error);
      router.refresh();
    });
  const create = () =>
    category &&
    query &&
    !exact &&
    start(async () => {
      const res = await createPartnershipTag(category, q, projectId);
      if (!res.ok) return void toast.error(res.error);
      setOn((s) => new Set(s).add(res.data!.id));
      setQ("");
      router.refresh();
    });

  return (
    <Popover onOpenChange={() => setQ("")}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Tags"
          className="relative z-10 inline-flex h-6 w-6 items-center justify-center rounded-full bg-subtle text-ink-muted hover:text-ink"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        {category ? (
          <>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                }
              }}
              placeholder={`Search or create a ${CATEGORY_LABELS[category]} tag`}
              aria-label="Search or create a tag"
              maxLength={40}
              className="mb-1 h-9 w-full rounded-[10px] border border-line px-2.5 text-sm"
            />
            <div className="max-h-60 overflow-y-auto">
              {shown.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={pending}
                  onClick={() => toggle(t)}
                  className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-subtle"
                >
                  <TagChip tag={t} />
                  {on.has(t.id) && <Check className="h-4 w-4 text-success" />}
                </button>
              ))}
              {query && !exact && (
                <button type="button" disabled={pending} onClick={create} className="flex w-full items-center gap-2 rounded-[8px] bg-subtle px-2 py-1.5 text-left text-sm">
                  Create <TagChip tag={{ name: q.trim(), color: "gray" }} />
                </button>
              )}
              {!shown.length && !query && <p className="px-2 py-1.5 text-sm text-ink-muted">No tags yet. Type one to create it.</p>}
            </div>
            <p className="mt-1 border-t border-line px-1 pt-1.5 text-[11px] text-ink-muted">New tags are shared with everyone.</p>
          </>
        ) : (
          <p className="p-1 text-sm text-ink-muted">Pick a category for this partnership first (Edit), then add tags.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
