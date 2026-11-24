"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Plus, Tag as TagIcon, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS } from "@/lib/domains";
import type { PartnerCategory } from "@/lib/types";
import { createPartnershipTag, deletePartnershipTag, setPartnershipLabels, setPartnershipTag, updatePartnershipTag, type TagColor } from "@/app/(app)/partnerships/actions";

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
 * The "+" on a partnership row: type to find its tags (the ones in its
 * categories), click to add or take one off, or press Enter to create one.
 */
export function TagPicker({
  projectId,
  categories,
  tags,
  selected,
  uses = {},
}: {
  projectId: string;
  /** The partnership's categories; its tags come from these. */
  categories: PartnerCategory[];
  /** Every tag, in every category. */
  tags: Tag[];
  selected: string[];
  uses?: Record<string, number>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [on, setOn] = useState(new Set(selected));
  const [pending, start] = useTransition();
  const query = q.trim().toLowerCase();
  const own = useMemo(() => tags.filter((t) => categories.includes(t.category)), [tags, categories]);
  const shown = own.filter((t) => !query || t.name.toLowerCase().includes(query));
  const exact = own.some((t) => t.name.toLowerCase() === query);

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
  const create = (category: PartnerCategory) =>
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
          aria-label="Add a tag"
          title="Add a tag"
          className="relative z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-line text-ink-muted hover:border-brand-primary hover:text-brand-primary"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (shown.length === 1 && query) toggle(shown[0]);
              else create(categories[0]);
            }
          }}
          placeholder="Find or create a tag"
          aria-label="Find or create a tag"
          maxLength={40}
          className="mb-1 h-9 w-full rounded-[10px] border border-line px-2.5 text-sm"
        />
        <div className="max-h-64 overflow-y-auto">
          {categories.map((c) => {
            const list = shown.filter((t) => t.category === c);
            return (
              <div key={c}>
                {(categories.length > 1 || list.length > 0) && (
                  <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{CATEGORY_LABELS[c]} tags</p>
                )}
                {list.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(t)}
                    className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-subtle"
                  >
                    <TagChip tag={t} />
                    <span className="flex items-center gap-2 text-xs text-ink-muted">
                      {!!uses[t.id] && `on ${uses[t.id]}`}
                      {on.has(t.id) && <Check className="h-4 w-4 text-success" />}
                    </span>
                  </button>
                ))}
                {query && !exact && (
                  <button type="button" disabled={pending} onClick={() => create(c)} className="flex w-full items-center gap-2 rounded-[8px] bg-brand-bg/60 px-2 py-1.5 text-left text-sm">
                    Create <TagChip tag={{ name: q.trim(), color: "gray" }} />
                    {categories.length > 1 && <span className="text-xs text-ink-muted">in {CATEGORY_LABELS[c]}</span>}
                  </button>
                )}
              </div>
            );
          })}
          {!own.length && !query && <p className="px-2 py-1.5 text-sm text-ink-muted">No tags yet. Type one to create it.</p>}
        </div>
        <p className="mt-1 border-t border-line px-1 pt-1.5 text-[11px] text-ink-muted">Shared with everyone. Rename, recolour or delete tags from Tags at the top.</p>
      </PopoverContent>
    </Popover>
  );
}

/** A tag on a partnership row, with a cross to take it off (for people in the partnership). */
export function RemovableTag({ projectId, tag, removable }: { projectId: string; tag: Tag; removable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span className={cn("group/tag relative z-10 inline-flex h-6 items-center whitespace-nowrap rounded-full pl-2.5 text-xs font-medium", removable ? "pr-1" : "pr-2.5", TAG_STYLE[tag.color])}>
      {tag.name}
      {removable && (
        <button
          type="button"
          disabled={pending}
          aria-label={`Take ${tag.name} off`}
          title="Take this tag off"
          onClick={() =>
            start(async () => {
              const res = await setPartnershipTag(projectId, tag.id, false);
              if (!res.ok) toast.error(res.error);
              router.refresh();
            })
          }
          className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full opacity-50 hover:bg-black/10 hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

const COLOR_ORDER: TagColor[] = ["gray", "purple", "blue", "green", "amber", "pink", "teal"];

/** "Tags" at the top of the page: rename, recolour or delete any tag. */
export function ManageTags({ tags, uses, categories }: { tags: Tag[]; uses: Record<string, number>; categories: PartnerCategory[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      if (done) toast.success(done);
      router.refresh();
    });
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-[12px] border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-subtle">
          <TagIcon className="h-4 w-4" /> Tags
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tags</DialogTitle>
          <DialogDescription>Shared by everyone. Changes show on every partnership straight away.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {categories.map((c) => {
            const list = tags.filter((t) => t.category === c);
            return (
              <div key={c}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{CATEGORY_LABELS[c]}</p>
                {!list.length && <p className="text-sm text-ink-muted">No tags yet.</p>}
                <ul className="divide-y divide-line rounded-[12px] border border-line">
                  {list.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <input
                        defaultValue={t.name}
                        maxLength={40}
                        aria-label={`Rename ${t.name}`}
                        disabled={pending}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== t.name) run(() => updatePartnershipTag(t.id, { name: v }), "Renamed.");
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        className="h-8 min-w-0 flex-1 rounded-[8px] border border-transparent px-2 text-sm hover:border-line focus:border-line"
                      />
                      <span className="flex gap-1">
                        {COLOR_ORDER.map((col) => (
                          <button
                            key={col}
                            type="button"
                            disabled={pending}
                            aria-label={`Make ${t.name} ${col}`}
                            onClick={() => col !== t.color && run(() => updatePartnershipTag(t.id, { color: col }))}
                            className={cn("h-5 w-5 rounded-full border", TAG_STYLE[col], col === t.color ? "ring-2 ring-ink ring-offset-1" : "border-line")}
                          />
                        ))}
                      </span>
                      <span className="w-10 text-right text-xs text-ink-muted">{uses[t.id] ? `on ${uses[t.id]}` : ""}</span>
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Delete ${t.name}`}
                        onClick={() => {
                          const n = uses[t.id] ?? 0;
                          if (!window.confirm(`Delete the tag "${t.name}" for everyone?${n ? ` It comes off ${n} partnership${n === 1 ? "" : "s"}.` : ""}`)) return;
                          run(() => deletePartnershipTag(t.id), `Deleted "${t.name}".`);
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-ink-muted hover:bg-danger-soft hover:text-danger-ink"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <p className="text-xs text-ink-muted">To add a tag, use the + on a partnership.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Category colours on cards and in the picker. */
export const CATEGORY_STYLE: Record<PartnerCategory, string> = {
  associations: "bg-[#F6E7F8] text-[#6A0F78]",
  referral: "bg-[#FEF4DC] text-[#8F5600]",
  fintech: "bg-[#E8F0FE] text-[#1F4FB8]",
};

/** A main tag (category) on a partnership row: coloured, with a cross to take it (and its sub-tags) off. */
export function CategoryChip({
  projectId,
  category,
  categories,
  tagIds,
  tags,
  removable,
}: {
  projectId: string;
  category: PartnerCategory;
  /** All its categories now. */
  categories: PartnerCategory[];
  /** Its sub-tags now. */
  tagIds: string[];
  tags: Tag[];
  removable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span className={cn("relative z-10 inline-flex h-6 items-center whitespace-nowrap rounded-full pl-2.5 text-xs font-semibold", removable ? "pr-1" : "pr-2.5", CATEGORY_STYLE[category])}>
      {CATEGORY_LABELS[category]}
      {removable && (
        <button
          type="button"
          disabled={pending}
          aria-label={`Take ${CATEGORY_LABELS[category]} off`}
          title="Take this off (and its sub-tags)"
          onClick={() =>
            start(async () => {
              const keep = categories.filter((c) => c !== category);
              const keepTags = tagIds.filter((id) => tags.find((t) => t.id === id)?.category !== category);
              const res = await setPartnershipLabels(projectId, keep, keepTags);
              if (!res.ok) toast.error(res.error);
              router.refresh();
            })
          }
          className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full opacity-50 hover:bg-black/10 hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/**
 * One "+" for both: every category with its tags under it, all tickable, like
 * a Notion multi-select. Ticking a tag ticks its category too. Type to find a
 * tag, or create one under a category.
 */
export function LabelPicker({
  projectId,
  categories,
  tags,
  selectedCategories,
  selectedTags,
  uses = {},
}: {
  projectId: string;
  categories: PartnerCategory[];
  /** Every tag, in every category. */
  tags: Tag[];
  selectedCategories: PartnerCategory[];
  selectedTags: string[];
  /** How many partnerships each tag is on, for the delete warning. */
  uses?: Record<string, number>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cats, setCats] = useState(new Set(selectedCategories));
  const [on, setOn] = useState(new Set(selectedTags));
  const [pending, start] = useTransition();
  const query = q.trim().toLowerCase();

  const save = (nextCats: Set<PartnerCategory>, nextTags: Set<string>) => {
    setCats(nextCats);
    setOn(nextTags);
    start(async () => {
      const res = await setPartnershipLabels(projectId, [...nextCats], [...nextTags]);
      if (!res.ok) toast.error(res.error);
      router.refresh();
    });
  };
  const toggleCat = (c: PartnerCategory) => {
    const n = new Set(cats);
    const t = new Set(on);
    if (n.has(c)) {
      n.delete(c);
      // Its tags go with it.
      for (const tag of tags) if (tag.category === c) t.delete(tag.id);
    } else n.add(c);
    save(n, t);
  };
  const toggleTag = (tag: Tag) => {
    const t = new Set(on);
    const n = new Set(cats);
    if (t.has(tag.id)) t.delete(tag.id);
    else {
      t.add(tag.id);
      n.add(tag.category);
    }
    save(n, t);
  };
  const create = (c: PartnerCategory) =>
    start(async () => {
      const res = await createPartnershipTag(c, q);
      if (!res.ok) return void toast.error(res.error);
      setQ("");
      const t = new Set(on).add(res.data!.id);
      save(new Set(cats).add(c), t);
    });

  const remove = (tag: Tag) => {
    const n = uses[tag.id] ?? 0;
    if (!window.confirm(`Delete the tag "${tag.name}" for everyone?${n ? ` It comes off ${n} partnership${n === 1 ? "" : "s"}.` : ""}`)) return;
    start(async () => {
      const res = await deletePartnershipTag(tag.id);
      if (!res.ok) return void toast.error(res.error);
      setOn((x) => {
        const t = new Set(x);
        t.delete(tag.id);
        return t;
      });
      toast.success(`Deleted "${tag.name}".`);
      router.refresh();
    });
  };

  return (
    <Popover onOpenChange={() => setQ("")}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Categories and tags" title="Add a tag" className="relative z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-line text-ink-muted hover:border-brand-primary hover:text-brand-primary">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search or create a tag"
          aria-label="Search or create a tag"
          maxLength={40}
          className="mb-1 h-9 w-full rounded-[10px] border border-line px-2.5 text-sm"
        />
        <div className="max-h-80 overflow-y-auto">
          {categories.map((c) => {
            const list = tags.filter((t) => t.category === c && (!query || t.name.toLowerCase().includes(query)));
            const exact = tags.some((t) => t.category === c && t.name.toLowerCase() === query);
            return (
              <div key={c} className="py-0.5">
                <button type="button" disabled={pending} onClick={() => toggleCat(c)} className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-subtle">
                  <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", CATEGORY_STYLE[c])}>{CATEGORY_LABELS[c]}</span>
                  {cats.has(c) && <Check className="h-4 w-4 text-success" />}
                </button>
                {list.map((t) => (
                  <div key={t.id} className="group/tag flex items-center rounded-[8px] hover:bg-subtle">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => toggleTag(t)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1 pl-6 pr-1 text-left"
                    >
                      <TagChip tag={t} />
                      {on.has(t.id) && <Check className="h-4 w-4 text-success" />}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(t)}
                      aria-label={`Delete the tag ${t.name}`}
                      title="Delete this tag for everyone"
                      className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-ink-muted hover:bg-danger-soft hover:text-danger-ink md:opacity-0 md:focus-visible:opacity-100 md:group-hover/tag:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {query && !exact && (
                  <button type="button" disabled={pending} onClick={() => create(c)} className="flex w-full items-center gap-1.5 rounded-[8px] py-1 pl-6 pr-2 text-left text-xs text-ink-muted hover:bg-subtle">
                    Create <TagChip tag={{ name: q.trim(), color: "gray" }} /> under {CATEGORY_LABELS[c]}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-1 border-t border-line px-1 pt-1.5 text-[11px] text-ink-muted">Tags are shared with everyone. Type to create one; the bin deletes one everywhere.</p>
      </PopoverContent>
    </Popover>
  );
}
