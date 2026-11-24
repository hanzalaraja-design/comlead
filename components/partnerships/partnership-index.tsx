import Link from "next/link";
import { FolderKanban, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { LabelPicker, ManageTags, RemovableTag, TagPicker, type Tag } from "@/components/partnerships/tags";
import { PartnershipFilters } from "@/components/partnerships/partnership-filters";
import { addDaysISO, formatDate, todayPKT } from "@/lib/time";
import { requireViewer } from "@/lib/auth";
import { CATEGORIES, CATEGORY_LABELS, DOMAINS, isCategory } from "@/lib/domains";
import { createClient } from "@/lib/supabase/server";
import type { PartnerCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

type Raw = Record<string, string | string[] | undefined>;
type Stage = "draft" | "in_talks" | "agreed" | "live" | "ended";
type Row = {
  id: string;
  name: string;
  slug: string;
  category: PartnerCategory | null;
  categories?: PartnerCategory[];
  archived: boolean;
  locked: boolean;
  owner: string | null;
  can_open: boolean;
  /** Its current term (none before the database has it, or with no terms yet). */
  term_stage?: Stage | null;
  term_starts?: string | null;
  term_ends?: string | null;
};

const STAGE: Record<Stage | "none", { label: string; pill: string; dot: string; order: number }> = {
  live: { label: "Live", pill: "bg-success-soft text-success-ink", dot: "bg-success", order: 1 },
  agreed: { label: "Agreed", pill: "bg-info-soft text-info-ink", dot: "bg-info", order: 2 },
  in_talks: { label: "In talks", pill: "bg-warning-soft text-warning-ink", dot: "bg-warning", order: 3 },
  draft: { label: "Draft", pill: "bg-subtle text-ink", dot: "bg-ink-muted", order: 4 },
  none: { label: "No terms yet", pill: "bg-subtle text-ink-muted", dot: "bg-line", order: 5 },
  ended: { label: "Ended", pill: "bg-subtle text-ink-muted", dot: "bg-line", order: 6 },
};
const stageOf = (r: Row): Stage | "none" => r.term_stage ?? "none";
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const initials = (name: string | null) =>
  (name ?? "?")
    .split(",")[0]
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** "1 Nov – 31 Dec 2026", "Starts 1 Dec 2026", "From 1 Jan 2026". */
function datesText(start?: string | null, end?: string | null): string | null {
  if (start && end) {
    const sameYear = start.slice(0, 4) === end.slice(0, 4);
    return `${formatDate(start, sameYear ? "d MMM" : "d MMM yyyy")} – ${formatDate(end, "d MMM yyyy")}`;
  }
  if (end) return `Until ${formatDate(end, "d MMM yyyy")}`;
  if (start) return `From ${formatDate(start, "d MMM yyyy")}`;
  return null;
}

/** Its categories (several once the database has them; else the one). */
const catsOf = (r: Row): PartnerCategory[] => (r.categories?.length ? r.categories : r.category ? [r.category] : []);


/**
 * Brand partnerships: every partnership, for everyone (name, category, status
 * and dates from its current term, tags, owner). Ones you're not in show a
 * lock; opening one asks for access.
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

  const today = todayPKT();
  const soon = addDaysISO(today, 30);
  const ending = (r: Row) => r.term_stage === "live" && !!r.term_ends && r.term_ends <= soon;
  const cat = typeof raw.cat === "string" && (isCategory(raw.cat) || raw.cat === "none") ? raw.cat : "all";
  const tagId = typeof raw.tag === "string" && tagById.has(raw.tag) ? raw.tag : null;
  const status = typeof raw.status === "string" ? raw.status : "";
  const q = typeof raw.q === "string" ? raw.q.trim().toLowerCase() : "";
  const inCat = (r: Row) => cat === "all" || (cat === "none" ? !catsOf(r).length : catsOf(r).includes(cat as PartnerCategory));
  const inStatus = (r: Row) => !status || (status === "ending" ? ending(r) : stageOf(r) === status);
  const shown = rows
    .filter((r) => inCat(r) && inStatus(r) && (!tagId || (tagsOf.get(r.id) ?? []).includes(tagId)) && (!q || r.name.toLowerCase().includes(q)))
    // Live (ending soonest first), then agreed, in talks, draft, no terms, ended.
    .sort((a, b) => {
      const d = STAGE[stageOf(a)].order - STAGE[stageOf(b)].order;
      if (d) return d;
      if (stageOf(a) === "live") return (a.term_ends ?? "9999").localeCompare(b.term_ends ?? "9999");
      if (stageOf(a) === "ended") return (b.term_ends ?? "").localeCompare(a.term_ends ?? "");
      return a.name.localeCompare(b.name);
    });
  const liveCount = rows.filter((r) => r.term_stage === "live").length;
  const endingCount = rows.filter(ending).length;
  const noCategory = rows.filter((r) => !catsOf(r).length).length;
  const tabs = [
    { key: "all", label: "All", n: rows.length },
    ...CATEGORIES.map((c) => ({ key: c as string, label: CATEGORY_LABELS[c], n: rows.filter((r) => catsOf(r).includes(c)).length })),
    ...(noCategory ? [{ key: "none", label: "No category yet", n: noCategory }] : []),
  ];
  const href = (c: string) => {
    const p = new URLSearchParams();
    if (c !== "all") p.set("cat", c);
    if (status) p.set("status", status);
    if (q) p.set("q", q);
    const qs = p.toString();
    return qs ? `${d.path}?${qs}` : d.path;
  };

  const COLS = "md:grid md:grid-cols-[minmax(0,1.5fr)_128px_200px_minmax(0,1.4fr)_40px] md:items-center md:gap-x-4";
  const row = (r: Row) => {
    const mine = (tagsOf.get(r.id) ?? []).map((id) => tagById.get(id)).filter((t): t is Tag => !!t);
    const st = STAGE[stageOf(r)];
    const dates = datesText(r.term_starts, r.term_ends);
    const left = r.term_stage === "live" && r.term_ends ? daysBetween(today, r.term_ends) : null;
    return (
      <li key={r.id} className={cn("relative flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3 first:border-t-0 hover:bg-canvas/60 md:px-5", COLS)}>
        <div className="min-w-0 basis-full md:basis-auto">
          <Link href={`${d.path}/${r.slug}`} className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold text-ink after:absolute after:inset-0">
            <span className="truncate">{r.name}</span>
            {!r.can_open && <Lock className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-label="No access" />}
          </Link>
          <p className="truncate text-xs text-ink-muted">
            {catsOf(r).map((c) => CATEGORY_LABELS[c]).join(", ") || "No category yet"}
            {!r.can_open && " · ask for access"}
            {r.locked && " · locked"}
          </p>
        </div>
        <span>
          <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold", st.pill)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} aria-hidden />
            {st.label}
          </span>
        </span>
        <span className="min-w-0 text-sm">
          {dates ? (
            r.term_stage === "in_talks" || r.term_stage === "agreed" || r.term_stage === "draft" ? (
              r.term_starts && !r.term_ends ? `Starts ${formatDate(r.term_starts, "d MMM yyyy")}` : dates
            ) : (
              <span className={cn(r.term_stage === "ended" && "text-ink-muted")}>{dates}</span>
            )
          ) : (
            <span className="text-ink-muted">No dates yet</span>
          )}
          {left !== null && (
            <span className={cn("block text-xs", left < 0 ? "font-semibold text-danger-ink" : left <= 14 ? "font-semibold text-danger-ink" : "text-ink-muted")}>
              {left < 0 ? `End date passed ${-left} day${left === -1 ? "" : "s"} ago` : left <= 14 ? `Ends in ${left} day${left === 1 ? "" : "s"} · renew?` : `${left} days left`}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {mine.map((t) => (
            <RemovableTag key={t.id} projectId={r.id} tag={t} removable={r.can_open} />
          ))}
          {r.can_open &&
            (catsOf(r).length ? (
              <TagPicker projectId={r.id} categories={catsOf(r)} tags={tags} selected={mine.map((t) => t.id)} uses={uses} />
            ) : (
              <LabelPicker projectId={r.id} categories={CATEGORIES} tags={tags} selectedCategories={catsOf(r)} selectedTags={mine.map((t) => t.id)} uses={uses} />
            ))}
        </span>
        <span
          title={r.owner ?? "No owner"}
          className="hidden h-7 w-7 items-center justify-center rounded-full bg-brand-bg text-[11px] font-bold text-brand-primary md:inline-flex"
        >
          {initials(r.owner)}
        </span>
      </li>
    );
  };
  const table = (list: Row[]) => (
    <div className="surface overflow-hidden">
      <div className={cn("hidden h-10 bg-[#F7F6F4] px-5 text-xs font-semibold uppercase tracking-wide text-ink-muted", COLS)}>
        <span>Partner</span>
        <span>Status</span>
        <span>Dates</span>
        <span>Tags</span>
        <span>Owner</span>
      </div>
      <ul>{list.map(row)}</ul>
    </div>
  );

  return (
    <>
      <PageHeader
        breadcrumb={["Domains", d.plural]}
        title={d.plural}
        description={`${rows.length} partnership${rows.length === 1 ? "" : "s"} · ${liveCount} live${endingCount ? ` · ${endingCount} ending in 30 days` : ""}. Everyone sees the list; open one you're not in to ask for access.`}
        actions={
          <div className="flex items-center gap-2">
            <ManageTags tags={tags} uses={uses} categories={CATEGORIES} />
            <Button asChild size="sm">
              <Link href={`${d.path}/new`}>
                <Plus className="h-4 w-4" /> New {d.label.toLowerCase()}
              </Link>
            </Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Category" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
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
      <PartnershipFilters tags={(isCategory(cat) ? tags.filter((t) => t.category === cat) : tags).map((t) => ({ id: t.id, name: t.name, category: t.category }))} path={d.path} />
      </div>
      {dir.error && <p className="mb-3 text-sm text-danger">The list needs the latest database update. Ask an Admin to run it.</p>}
      {shown.length ? (
        table(shown)
      ) : (
        <EmptyState>
          <span className="flex flex-col items-center gap-2">
            <FolderKanban className="h-6 w-6 text-ink-muted" />
            {tagId || status || q ? "No partnerships match." : `Nothing here yet. Start one with “New ${d.label.toLowerCase()}”.`}
          </span>
        </EmptyState>
      )}
      {archived.length > 0 && (
        <details className="mt-8">
          <summary className="kicker cursor-pointer text-ink">Archived · {archived.length}</summary>
          <div className="mt-3 opacity-80">{table(archived)}</div>
        </details>
      )}
    </>
  );
}
