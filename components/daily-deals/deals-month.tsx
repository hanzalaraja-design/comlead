"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ClipboardPaste, ExternalLink, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { STATUS_CHIP } from "@/components/placements/styles";
import { parseDate } from "@/components/placements/schedule";
import { datesText, statusOf, statusText, type Placement } from "@/lib/placements";
import { formatDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { saveDailyDeal, saveDailyDeals, type DealRow, type DealSlot } from "@/app/(app)/placements/actions";

export type DealDay = {
  date: string;
  campaigns: { id: string; name: string; href: string }[];
  announcement: Placement | null;
  hero1: Placement | null;
  hero2: Placement | null;
};

const SLOTS: { key: DealSlot; label: string }[] = [
  { key: "announcement", label: "Announcement banner" },
  { key: "hero1", label: "Hero banner 1" },
  { key: "hero2", label: "Hero banner 2" },
];

/** The month as a sheet: one row per day, a cell per banner. */
export function DealsMonth({ days, today, month }: { days: DealDay[]; today: string; month: string }) {
  const [pasting, setPasting] = useState(false);
  // Campaign days have no daily deals: back-to-back days of the same campaign become one row.
  const groups: ({ kind: "day"; day: DealDay } | { kind: "campaign"; days: DealDay[] })[] = [];
  const keyOf = (d: DealDay) => d.campaigns.map((c) => c.id).sort().join(",");
  for (const d of days) {
    const last = groups[groups.length - 1];
    if (!d.campaigns.length) groups.push({ kind: "day", day: d });
    else if (last?.kind === "campaign" && keyOf(last.days[0]) === keyOf(d)) last.days.push(d);
    else groups.push({ kind: "campaign", days: [d] });
  }
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">Click a cell and type. Enter saves. Clear the text to remove it.</p>
        <Button variant="outline" size="sm" onClick={() => setPasting(true)}>
          <ClipboardPaste className="h-4 w-4" /> Paste from the sheet
        </Button>
      </div>
      <div className="overflow-x-auto surface">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="bg-subtle text-left text-[13px] font-bold text-ink">
              <th className="w-48 px-3 py-2.5">Date</th>
              {SLOTS.map((s) => (
                <th key={s.key} className="px-3 py-2.5">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) =>
              g.kind === "day" ? (
                <DayRow key={g.day.date} d={g.day} today={today} />
              ) : (
                <CampaignRow key={g.days[0].date} days={g.days} today={today} />
              ),
            )}
          </tbody>
        </table>
      </div>
      <Sheet open={pasting} onOpenChange={setPasting}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto bg-white p-0 sm:max-w-xl">
          <SheetHeader className="px-5 pb-2 pt-5">
            <SheetDescription className="text-xs">Daily deals</SheetDescription>
            <SheetTitle className="pr-8 text-xl text-ink">Paste from the sheet</SheetTitle>
          </SheetHeader>
          <div className="px-5 pb-6">{pasting && <PasteSheet month={month} today={today} onDone={() => setPasting(false)} />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function DayRow({ d, today }: { d: DealDay; today: string }) {
  const isToday = d.date === today;
  return (
    <tr className={cn("border-t border-line align-top", isToday && "bg-brand-bg/50", d.date < today && "text-ink-muted")}>
      <td className="px-3 py-2">
        <span className="font-semibold text-ink">{formatDate(d.date, "EEE d MMM")}</span>
        {isToday && <span className="ml-1.5 rounded-full bg-brand-primary px-1.5 text-[11px] font-semibold text-white">Today</span>}
      </td>
      {SLOTS.map((s) => (
        <td key={s.key} className="px-1.5 py-1">
          <DealCell day={d.date} slot={s.key} booking={d[s.key]} today={today} label={s.label} />
        </td>
      ))}
    </tr>
  );
}

/** Days a campaign runs: one row across the banner columns, with the way to its folder and its homepage. */
function CampaignRow({ days, today }: { days: DealDay[]; today: string }) {
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const running = today >= first && today <= last;
  // The homepage on today if it's running, else on its first day here.
  const homepageDay = running ? today : first;
  const booked = days.flatMap((d) => SLOTS.map((s) => d[s.key]).filter((b): b is Placement => !!b));
  const bookedCount = new Set(booked.map((b) => b.id)).size;
  return (
    <tr className="border-t border-line align-top">
      <td className="px-3 py-3">
        <span className="block font-semibold text-ink">
          {days.length === 1 ? formatDate(first, "EEE d MMM") : `${formatDate(first, "EEE d")} – ${formatDate(last, "EEE d MMM")}`}
        </span>
        <span className="text-xs text-ink-muted">
          {days.length} day{days.length === 1 ? "" : "s"}
          {running && <span className="ml-1.5 rounded-full bg-brand-primary px-1.5 text-[11px] font-semibold text-white">Today</span>}
        </span>
      </td>
      <td colSpan={SLOTS.length} className="px-1.5 py-1.5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#f6d2b0] bg-[#fdf3e8] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#c25b00]">{days[0].campaigns.length > 1 ? "Campaigns" : "Campaign"}</p>
            <p className="text-base font-semibold text-ink">{days[0].campaigns.map((c) => c.name).join(" + ")}</p>
            <p className="text-xs text-ink-muted">
              No daily deals these days.
              {bookedCount > 0 && ` ${bookedCount} homepage banner${bookedCount === 1 ? "" : "s"} booked.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {days[0].campaigns.map((c) => (
              <Button key={c.id} asChild size="sm">
                <Link href={c.href}>
                  Open {c.name} <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ))}
            <Button asChild size="sm" variant="outline">
              <Link href={`/placements?tab=web&date=${homepageDay}`}>
                <Images className="h-3.5 w-3.5" /> Homepage placements
              </Link>
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function DealCell({ day, slot, booking, today, label }: { day: string; slot: DealSlot; booking: Placement | null; today: string; label: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const text = booking ? booking.comms || booking.brand : "";
  const multiDay = !!booking && booking.starts_on !== booking.ends_on;

  function save(value: string) {
    setEditing(false);
    if (value.trim() === text.trim()) return;
    start(async () => {
      const res = await saveDailyDeal(day, slot, value, booking?.id);
      if (!res.ok) toast.error(res.error);
    });
  }

  if (editing)
    return (
      <input
        ref={input}
        autoFocus
        defaultValue={text}
        aria-label={`${label}, ${formatDate(day, "d MMM")}`}
        maxLength={120}
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-9 w-full rounded-[8px] border border-brand-primary bg-white px-2 text-sm text-ink outline-none"
      />
    );

  if (multiDay)
    return (
      <Link href={`/placements?tab=web&open=${booking!.id}`} title="Runs over several days. Change it in Placements." className="block rounded-[8px] px-2 py-1.5 hover:bg-subtle">
        <span className="block text-ink">{text}</span>
        <span className="text-[11px] text-ink-muted">{datesText(booking!, today)}</span>
      </Link>
    );

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => setEditing(true)}
      className={cn("block min-h-9 w-full rounded-[8px] px-2 py-1.5 text-left hover:bg-subtle", !booking && "text-ink-muted/60")}
    >
      {booking ? (
        <>
          <span className="block text-ink">{text}</span>
          <span className={cn("mt-0.5 inline-block rounded-full px-1.5 text-[10.5px] font-semibold", STATUS_CHIP[statusOf(booking, today)])}>
            {statusText(statusOf(booking, today), booking, today)}
          </span>
        </>
      ) : (
        <span className="text-[13px]">{pending ? "Saving…" : "—"}</span>
      )}
    </button>
  );
}

/** Rows copied from Excel: Date, Announcement, Hero 1, Hero 2 (a header row is skipped). */
function PasteSheet({ month, today, onDone }: { month: string; today: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const rows: DealRow[] = [];
  const bad: string[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const [d, announcement, hero1, hero2] = line.split("\t");
    const day = parseDate(d ?? "", `${month}-01` > today ? `${month}-01` : today);
    if (!day) {
      if (!/date/i.test(d ?? "")) bad.push(d ?? line);
      continue;
    }
    rows.push({ date: day, announcement, hero1, hero2 });
  }
  const cells = rows.reduce((n, r) => n + [r.announcement, r.hero1, r.hero2].filter((x) => x?.trim()).length, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Copy the rows from Excel (columns: <b>Date</b>, <b>Announcement</b>, <b>Hero 1</b>, <b>Hero 2</b>) and paste them here. Days that already have something keep it.
      </p>
      <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Date\tAnnouncement\tHero 1\tHero 2\n1-Nov\tFree delivery over 2,999\tCOSRX 30% off\tMaybelline new in"} className="font-mono text-xs" />
      {text.trim() && (
        <p className="text-sm text-ink">
          {rows.length} day{rows.length === 1 ? "" : "s"}, {cells} banner{cells === 1 ? "" : "s"}.
          {bad.length > 0 && <span className="text-danger"> Couldn&apos;t read the date on: {bad.slice(0, 3).join(", ")}.</span>}
        </p>
      )}
      <Button
        disabled={pending || !cells}
        onClick={() =>
          start(async () => {
            const res = await saveDailyDeals(rows);
            if (!res.ok) return void toast.error(res.error);
            const { saved, failed } = res.data!;
            if (failed.length) toast.error(`${saved} added. ${failed.length} skipped: ${failed[0]}${failed.length > 1 ? "…" : ""}`);
            else toast.success(`${saved} added. Design has been told.`);
            onDone();
          })
        }
      >
        {pending ? "Adding…" : "Add them"}
      </Button>
    </div>
  );
}
