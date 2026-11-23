import Link from "next/link";
import { FolderKanban, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { CATEGORY_STYLE, LabelPicker, TagChip, type Tag } from "@/components/partnerships/tags";
import { requireViewer } from "@/lib/auth";
import { CATEGORIES, CATEGORY_LABELS, DOMAINS, isCategory } from "@/lib/domains";
import { createClient } from "@/lib/supabase/server";
import type { PartnerCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

type Raw = Record<string, string | string[] | undefined>;
type Row = { id: string; name: string; slug: string; category: PartnerCategory | null; categories?: PartnerCategory[]; archived: boolean; locked: boolean; owner: string | null; can_open: boolean };

/** Its categories (several once the database has them; else the one). */
const catsOf = (r: Row): PartnerCategory[] => (r.categories?.length ? r.categories : r.category ? [r.category] : []);


/**
 * Brand partnerships: every partnership, for everyone (name, category, tags,
 * owner). Ones you're not in show a lock; opening one asks for access.
 */
export async function PartnershipIndexPage({ raw }: { raw: Raw }) {
  const d = DOMAINS.partnership;
  const supabase = await createClient();
  await requireViewer();
  const [dir, tagRes, linkRes] = await Promise.all([
    supabase.rpc("partnership_directory"),
    supabase.from("partnership_tags").select("id, name, color, category").order("created_at"),
    supabase.from("project_tags").select("project_id, tag_id"),
  ]);
  const rows = ((dir.data ?? []) as Row[]).filter((r) => !r.archived);
  const archived = ((dir.data ?? []) as Row[]).filter((r) => r.archived);
  const tags = (tagRes.data ?? []) as Tag[];
  const tagsOf = new Map<string, string[]>();
  for (const l of (linkRes.data ?? []) as { project_id: string; tag_id: string }[]) tagsOf.set(l.project_id, [...(tagsOf.get(l.project_id) ?? []), l.tag_id]);
  const tagById = new Map(tags.map((t) => [t.id, t]));
  // How many partnerships each tag is on (for the delete warning).
  const uses: Record<string, number> = {};
  for (const l of (linkRes.data ?? []) as { tag_id: string }[]) uses[l.tag_id] = (uses[l.tag_id] ?? 0) + 1;

  const cat = typeof raw.cat === "string" && (isCategory(raw.cat) || raw.cat === "none") ? raw.cat : "all";
  const tagId = typeof raw.tag === "string" && tagById.has(raw.tag) ? raw.tag : null;
  const inCat = (r: Row) => cat === "all" || (cat === "none" ? !catsOf(r).length : catsOf(r).includes(cat as PartnerCategory));
  const shown = rows.filter((r) => inCat(r) && (!tagId || (tagsOf.get(r.id) ?? []).includes(tagId)));
  const noCategory = rows.filter((r) => !catsOf(r).length).length;
  const tabs = [
    { key: "all", label: "All", n: rows.length },
    ...CATEGORIES.map((c) => ({ key: c as string, label: CATEGORY_LABELS[c], n: rows.filter((r) => catsOf(r).includes(c)).length })),
    ...(noCategory ? [{ key: "none", label: "No category yet", n: noCategory }] : []),
  ];
  const href = (c: string, t?: string | null) => {
    const p = new URLSearchParams();
    if (c !== "all") p.set("cat", c);
    if (t) p.set("tag", t);
    const q = p.toString();
    return q ? `${d.path}?${q}` : d.path;
  };

  const card = (r: Row) => {
    const mine = (tagsOf.get(r.id) ?? []).map((id) => tagById.get(id)).filter((t): t is Tag => !!t);
    return (
      <li key={r.id} className="relative flex flex-col gap-3 surface p-4 transition-shadow hover:shadow-md">
        <Link href={`${d.path}/${r.slug}`} className="flex min-w-0 items-center gap-1.5 text-[17px] font-semibold leading-snug text-ink after:absolute after:inset-0">
          {!r.can_open && <Lock className="h-4 w-4 shrink-0 text-ink-muted" aria-label="No access" />}
          <span className="truncate">{r.name}</span>
        </Link>
        {/* Categories, then tags, on one line. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {catsOf(r).map((c) => (
            <span key={c} className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", CATEGORY_STYLE[c])}>
              {CATEGORY_LABELS[c]}
            </span>
          ))}
          {mine.map((t) => (
            <TagChip key={t.id} tag={t} />
          ))}
          {r.can_open && <LabelPicker projectId={r.id} categories={CATEGORIES} tags={tags} selectedCategories={catsOf(r)} selectedTags={mine.map((t) => t.id)} uses={uses} />}
        </div>
        <p className="mt-auto text-[13px] text-ink-muted">
          {r.owner ?? "No owner"}
          {!r.can_open && " · No access yet"}
          {r.locked && " · Locked"}
        </p>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        breadcrumb={["Domains", d.plural]}
        title={d.plural}
        description="Everyone can see the list. Open one you're not in to ask for access."
        actions={
          <Button asChild size="sm">
            <Link href={`${d.path}/new`}>
              <Plus className="h-4 w-4" /> New {d.label.toLowerCase()}
            </Link>
          </Button>
        }
      />
      <nav aria-label="Category" className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={cat === t.key ? "page" : undefined}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold",
              cat === t.key ? "border-brand-primary bg-brand-primary text-white" : "border-line bg-white text-ink hover:border-ink-muted",
            )}
          >
            {t.label} <span className="opacity-70">{t.n}</span>
          </Link>
        ))}
      </nav>
      {isCategory(cat) && tags.some((t) => t.category === cat) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-muted">Filter by tag</span>
          {tags
            .filter((t) => t.category === cat)
            .map((t) => (
              <Link key={t.id} href={href(cat, tagId === t.id ? null : t.id)} aria-current={tagId === t.id ? "true" : undefined}>
                <TagChip tag={t} className={cn("h-8 px-3 text-sm", tagId === t.id && "ring-2 ring-current")} />
              </Link>
            ))}
        </div>
      )}
      {dir.error && <p className="mb-3 text-sm text-danger">The list needs the latest database update. Ask an Admin to run it.</p>}
      {shown.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{shown.map(card)}</ul>
      ) : (
        <EmptyState>
          <span className="flex flex-col items-center gap-2">
            <FolderKanban className="h-6 w-6 text-ink-muted" />
            {tagId ? "No partnerships with this tag." : `Nothing here yet. Start one with “New ${d.label.toLowerCase()}”.`}
          </span>
        </EmptyState>
      )}
      {archived.length > 0 && (
        <details className="mt-8">
          <summary className="kicker cursor-pointer text-ink">Archived · {archived.length}</summary>
          <ul className="mt-3 grid gap-3 opacity-80 sm:grid-cols-2 xl:grid-cols-3">{archived.map(card)}</ul>
        </details>
      )}
    </>
  );
}
