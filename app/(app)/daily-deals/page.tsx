import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DealsMonth, type DealDay } from "@/components/daily-deals/deals-month";
import { requireViewer } from "@/lib/auth";
import { domainHref, getProjects } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import { PLACEMENT_COLUMNS, type Placement } from "@/lib/placements";
import { addDaysISO, formatDate, todayPKT } from "@/lib/time";

export const metadata = { title: "Daily deals · Highfy Tasks" };

/** First and last day of a yyyy-MM month, and the months either side. */
function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    first: iso(new Date(Date.UTC(y, m - 1, 1))),
    last: iso(new Date(Date.UTC(y, m, 0))),
    prev: iso(new Date(Date.UTC(y, m - 2, 1))).slice(0, 7),
    next: iso(new Date(Date.UTC(y, m, 1))).slice(0, 7),
  };
}

/**
 * The month's homepage sheet: for each day, what's on the announcement bar and
 * hero slides 1 and 2, and which campaigns are running. Every cell is a real
 * booking, so the Placements map shows the same thing.
 */
export default async function DailyDealsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const [, supabase, sp] = await Promise.all([requireViewer(), createClient(), searchParams]);
  const today = todayPKT();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const { first, last, prev, next } = monthBounds(month);

  const [{ data }, projects] = await Promise.all([
    supabase
      .from("placements")
      .select(PLACEMENT_COLUMNS)
      .or("and(section_key.eq.announcement,position.eq.1),and(section_key.eq.hero,position.in.(1,2))")
      .lte("starts_on", last)
      .or(`ends_on.is.null,ends_on.gte.${first}`),
    getProjects(),
  ]);
  const bookings = (data ?? []) as unknown as Placement[];
  const campaigns = projects.filter(
    (p) => p.kind === "campaign" && !p.archived && p.start_date && p.start_date <= last && (p.end_date ?? p.start_date) >= first,
  );

  // The booking showing in a slot on a day (the latest one starting, if two overlap).
  const on = (day: string, key: string, position: number) =>
    bookings
      .filter((b) => b.section_key === key && b.position === position && b.stage !== "ended" && b.starts_on <= day && (b.ends_on ?? "9999") >= day)
      .sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0] ??
    bookings.find((b) => b.section_key === key && b.position === position && b.stage === "ended" && b.starts_on <= day && (b.ends_on ?? "9999") >= day);

  const days: DealDay[] = [];
  for (let d = first; d <= last; d = addDaysISO(d, 1)) {
    days.push({
      date: d,
      campaigns: campaigns
        .filter((c) => c.start_date! <= d && (c.end_date ?? c.start_date!) >= d)
        .map((c) => ({ id: c.id, name: c.name, href: domainHref(c) })),
      announcement: on(d, "announcement", 1) ?? null,
      hero1: on(d, "hero", 1) ?? null,
      hero2: on(d, "hero", 2) ?? null,
    });
  }

  return (
    <>
      <PageHeader
        breadcrumb={["Domains", "Daily deals"]}
        title="Daily deals"
        description="What's on the homepage each day: the announcement bar and hero banners 1 and 2. It updates Placements as you type."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">{formatDate(first, "MMMM yyyy")}</h2>
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon" aria-label="Previous month">
            <Link href={`/daily-deals?month=${prev}`}>
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/daily-deals">This month</Link>
          </Button>
          <Button asChild variant="outline" size="icon" aria-label="Next month">
            <Link href={`/daily-deals?month=${next}`}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
      <DealsMonth key={month} days={days} today={today} month={month} />
    </>
  );
}
