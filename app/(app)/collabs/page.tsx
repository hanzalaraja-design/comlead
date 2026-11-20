import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { RateCard } from "@/components/collabs/rate-card";
import { CollabTerms } from "@/components/collabs/terms";
import { getPeople } from "@/lib/auth";
import { collabAccess } from "@/lib/collabs-server";
import { COLUMNS, REQUEST_COLUMNS, teamList, totalText, type CollabItem, type CollabRate, type CollabRequest } from "@/lib/collabs";
import { personName } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, formatDate, startOfDayPKT, todayPKT } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata = { title: "Paid social · Highfy Tasks" };

const TABS = [
  { key: "requests", label: "Requests" },
  { key: "kit", label: "Media kit" },
  { key: "terms", label: "Terms" },
] as const;

/** Paid social: Commercial (and any team picked to ask) asks, Content plans and delivers, the askers approve and get the report. */
export default async function CollabsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab: raw }, access] = await Promise.all([searchParams, collabAccess()]);
  const tab = TABS.some((t) => t.key === raw) ? raw! : "requests";
  const header = (
    <PageHeader
      breadcrumb={["Paid social"]}
      title="Paid social"
      description={`${teamList(access.askers)} ${access.askers.length > 1 ? "ask" : "asks"} for content, Content plans it from the media kit, ${teamList(access.askers, "or")} approves, Content delivers and reports.`}
      actions={
        access.commercial && (
          <Button asChild size="sm">
            <Link href="/collabs/new">
              <Plus className="h-4 w-4" /> New request
            </Link>
          </Button>
        )
      }
    />
  );
  if (!access.can)
    return (
      <>
        {header}
        <EmptyState>Paid social is for {teamList([...access.askers, "Content"])}. Ask an Admin if you need it.</EmptyState>
      </>
    );

  const supabase = await createClient();
  const [{ data: reqData }, { data: itemData }, { data: rateData }, people] = await Promise.all([
    supabase.from("collab_requests").select(REQUEST_COLUMNS).order("go_live").then((r) => (r.error ? { data: [] } : r)),
    supabase.from("collab_items").select("id, request_id, live_url, owner_id").then((r) => (r.error ? { data: [] } : r)),
    supabase.from("collab_rates").select("*").eq("archived", false).order("sort").then((r) => (r.error ? { data: [] } : r)),
    getPeople(),
  ]);
  const requests = (reqData ?? []) as unknown as CollabRequest[];
  const items = (itemData ?? []) as Pick<CollabItem, "id" | "request_id" | "live_url" | "owner_id">[];
  const rates = (rateData ?? []) as CollabRate[];
  const byId = new Map(people.map((p) => [p.id, p]));
  const today = todayPKT();
  // Reports older than 60 days drop off the board.
  const cutoff = startOfDayPKT(addDaysISO(today, -60));
  const recent = (r: CollabRequest) => r.status !== "reported" || (r.reported_at ?? "") > cutoff;

  const line = (r: CollabRequest) => {
    const mine = items.filter((i) => i.request_id === r.id);
    switch (r.status) {
      case "requested":
        return { text: "Waiting for Content's plan", tone: "text-ink-muted" };
      case "changes":
        return { text: "Changes asked: Content to update the plan", tone: "text-danger-ink" };
      case "planned":
        return { text: `${totalText(r)} · waiting for ${teamList(access.askers, "or")} to approve`, tone: "text-warning-ink" };
      case "approved":
        return { text: `${mine.filter((i) => i.live_url).length} of ${mine.length} live`, tone: "text-ink" };
      case "live":
        return { text: "All live · report due", tone: "text-info-ink" };
      default:
        return { text: `Report shared · ${totalText(r)}`, tone: "text-success-ink" };
    }
  };

  return (
    <>
      {header}
      <nav aria-label="Paid social" className="-mx-4 mb-4 flex gap-5 border-b border-line px-4 md:mx-0 md:px-0">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "requests" ? "/collabs" : `/collabs?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-1 pb-2.5 text-[15px] font-semibold", tab === t.key ? "border-brand-primary text-ink" : "border-transparent text-ink-muted hover:text-ink")}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "kit" && (
        <div className="max-w-2xl">
          <RateCard rates={rates} editable={access.admin} />
        </div>
      )}
      {tab === "terms" && <CollabTerms />}
      {tab === "requests" &&
        (requests.length ? (
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-5 md:px-0">
            {COLUMNS.map((c) => {
              const list = requests.filter((r) => c.statuses.includes(r.status) && recent(r));
              return (
                <section key={c.key} className="w-[17rem] shrink-0 md:w-auto">
                  <h2 className="mb-2 flex items-center gap-2 text-[13px] font-bold text-ink">
                    {c.title}
                    <span className="rounded-full bg-subtle px-2 text-xs">{list.length}</span>
                  </h2>
                  <div className="space-y-2.5">
                    {list.map((r) => {
                      const l = line(r);
                      const late = r.status !== "reported" && r.status !== "live" && r.go_live < today;
                      return (
                        <Link key={r.id} href={`/collabs/${r.id}`} className="block rounded-[14px] border border-line bg-white p-3 hover:border-ink/30">
                          <span className="block font-semibold leading-snug text-ink">{r.brand}</span>
                          <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink">{r.promote}</span>
                          <span className="mt-1.5 block text-xs text-ink-muted">
                            {personName(byId.get(r.requested_by))} · live by{" "}
                            <span className={late ? "font-semibold text-danger-ink" : undefined}>{formatDate(r.go_live, "d MMM")}</span>
                          </span>
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {r.goals.slice(0, 2).map((g) => (
                              <span key={g} className="rounded-md bg-[#fdeedd] px-1.5 text-[11px] font-semibold text-[#c25b00]">
                                {g}
                              </span>
                            ))}
                          </span>
                          <span className={cn("mt-2 block text-xs font-semibold", l.tone)}>{l.text}</span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <EmptyState
            action={
              access.commercial && (
                <Button asChild size="sm">
                  <Link href="/collabs/new">New request</Link>
                </Button>
              )
            }
          >
            No requests yet. {teamList(access.askers, "or")} starts one with what to promote, and Content comes back with a plan.
          </EmptyState>
        ))}
    </>
  );
}
