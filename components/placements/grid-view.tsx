"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Download, Rocket, Trash2 } from "lucide-react";
import { BAR_BUTTON, BulkBar, BulkProvider, RowCheck, useBulk } from "@/components/bulk-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { activeOn, slotLabel, statusOf, toPutLive, toTakeDown, type Placement, type Section } from "@/lib/placements";
import { bulkPlacements, type BulkPlacementOp } from "@/app/(app)/placements/actions";

type Need = "put_live" | "new_banner" | "take_down" | "live" | "to_design" | "empty";
const NEED: Record<Need, { label: string; chip: string }> = {
  put_live: { label: "Put live", chip: "bg-info-soft text-info-ink" },
  new_banner: { label: "New banner", chip: "bg-brand-bg text-brand-primary" },
  take_down: { label: "Take down", chip: "bg-warning-soft text-warning-ink" },
  live: { label: "Live", chip: "bg-success-soft text-success-ink" },
  to_design: { label: "To design", chip: "bg-subtle text-ink" },
  empty: { label: "Empty", chip: "bg-subtle text-ink-muted" },
};

function needOf(p: Placement | undefined, today: string): Need {
  if (!p) return "empty";
  if (p.changed_from && p.stage !== "ended") return "new_banner";
  if (p.stage === "ready") return "put_live";
  if (p.stage === "live" && p.ends_on !== null && p.ends_on < today) return "take_down";
  if (p.stage === "booked") return "to_design";
  return statusOf(p, today) === "ending" || p.stage === "live" ? "live" : "to_design";
}
const UPDATING: Need[] = ["put_live", "new_banner", "take_down"];

/**
 * Every slot laid out like the Figma file, with the banner Design uploaded:
 * what to put live, what has a new banner and what comes down. Tick slots to
 * act on several at once.
 */
export function GridView({
  sections,
  placements,
  urls,
  date,
  today,
  onOpen,
}: {
  sections: Section[];
  placements: Placement[];
  urls: Record<string, string>;
  date: string;
  today: string;
  onOpen: (p: Placement) => void;
}) {
  const [onlyTodo, setOnlyTodo] = useState(false);
  const putLive = toPutLive(placements).length;
  const changed = placements.filter((p) => p.changed_from && p.stage !== "ended").length;
  const down = toTakeDown(placements, today).length;

  const rows = sections.map((s) => ({
    s,
    slots: Array.from({ length: s.slots }, (_, i) => i + 1)
      .map((n) => {
        const p = activeOn(placements, s.key, n, date);
        return { n, p, need: needOf(p, today) };
      })
      .filter((x) => !onlyTodo || UPDATING.includes(x.need)),
  }));
  const ids = rows.flatMap((r) => r.slots.map((x) => x.p?.id).filter((x): x is string => !!x));

  return (
    <BulkProvider ids={ids}>
      <div className="flex flex-col gap-5">
        <div className="surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[15px] font-semibold text-ink">To update</span>
            <span className={cn("rounded-full px-2.5 text-xs font-semibold leading-7", NEED.put_live.chip)}>{putLive} to put live</span>
            <span className={cn("rounded-full px-2.5 text-xs font-semibold leading-7", NEED.new_banner.chip)}>
              {changed} new banner{changed === 1 ? "" : "s"}
            </span>
            <span className={cn("rounded-full px-2.5 text-xs font-semibold leading-7", NEED.take_down.chip)}>{down} to take down</span>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} className="size-4 accent-[hsl(var(--brand-primary))]" />
            Only show what needs updating
          </label>
        </div>

        {rows
          .filter((r) => r.slots.length)
          .map(({ s, slots }) => (
            <section key={s.key} className="flex flex-col gap-2">
              <h2 className="flex items-baseline gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-brand-primary">{s.name}</span>
                <span className="text-xs text-ink-muted">
                  {s.slots} slot{s.slots === 1 ? "" : "s"}
                  {s.size_hint ? ` · ${s.size_hint}` : ""}
                  {s.optional ? " · optional" : ""}
                </span>
              </h2>
              <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                {slots.map(({ n, p, need }) => {
                  const art = p?.artwork_path ? urls[p.artwork_path] : undefined;
                  return (
                    <li key={n} className={cn("relative flex flex-col gap-2 rounded-[14px] border bg-white p-2.5", s.slots === 1 && "sm:col-span-2")}>
                      <div className="flex items-center gap-2 text-xs text-ink-muted">
                        {p && <RowCheck id={p.id} label={`${s.name} ${slotLabel(s, n)}`} />}
                        <span className="truncate">{s.slots > 1 ? slotLabel(s, n) : s.name}</span>
                      </div>
                      <button
                        type="button"
                        disabled={!p}
                        onClick={() => p && onOpen(p)}
                        className={cn(
                          "relative flex aspect-[16/10] flex-col justify-end overflow-hidden rounded-[10px] p-2 text-left",
                          p ? "bg-subtle" : "cursor-default border-[1.5px] border-dashed border-line bg-canvas",
                        )}
                        aria-label={p ? `${p.brand}: open details` : "Empty slot"}
                      >
                        {art && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        )}
                        {!art && <span className="relative text-sm font-semibold text-ink">{p ? p.brand : "Nothing booked"}</span>}
                      </button>
                      <div className="flex items-center justify-between gap-1.5">
                        <span className={cn("rounded-full px-2 text-[11px] font-semibold leading-6", NEED[need].chip)}>{NEED[need].label}</span>
                        {art && (
                          <a href={art} download target="_blank" rel="noreferrer" aria-label={`Download the ${p!.brand} banner`} className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-line text-ink hover:bg-subtle">
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        <GridBulkBar placements={placements} urls={urls} />
      </div>
    </BulkProvider>
  );
}

function GridBulkBar({ placements, urls }: { placements: Placement[]; urls: Record<string, string> }) {
  const ctx = useBulk();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  if (!ctx) return null;
  const ids = [...ctx.selected];
  const run = (op: BulkPlacementOp, done: string) =>
    start(async () => {
      const res = await bulkPlacements(ids, op);
      if (!res.ok) return void toast.error(res.error);
      const { changed, skipped } = res.data!;
      if (skipped) toast.warning(`${changed} ${done}. ${skipped} skipped: not ready for that, or not yours to change.`);
      else toast.success(`${changed} ${done}.`);
      ctx.clear();
      router.refresh();
    });
  const download = () => {
    const files = ids.map((id) => placements.find((p) => p.id === id)).flatMap((p) => (p?.artwork_path && urls[p.artwork_path] ? [{ url: urls[p.artwork_path], name: p.brand }] : []));
    if (!files.length) return void toast.error("None of these has a banner yet.");
    files.forEach((f, i) =>
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = f.url;
        a.download = f.name;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.click();
      }, i * 400),
    );
  };
  return (
    <BulkBar noun="booking">
      <button type="button" disabled={pending} onClick={() => run({ kind: "live" }, "made live")} className={BAR_BUTTON}>
        <Rocket className="h-4 w-4" /> Mark live
      </button>
      <button type="button" disabled={pending} onClick={download} className={BAR_BUTTON}>
        <Download className="h-4 w-4" /> Download banners
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" disabled={pending} className={BAR_BUTTON}>
            <CalendarDays className="h-4 w-4" /> Change dates
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-72 space-y-2 p-3">
          <label className="block space-y-1 text-xs font-semibold text-ink-muted">
            From (leave empty to keep)
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full rounded-[10px] border border-line px-2 text-sm text-ink" />
          </label>
          <label className="block space-y-1 text-xs font-semibold text-ink-muted">
            Until (leave empty to keep)
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="h-9 w-full rounded-[10px] border border-line px-2 text-sm text-ink" />
          </label>
          <button
            type="button"
            disabled={pending || (!from && !until)}
            onClick={() => run({ kind: "dates", ...(from ? { starts_on: from } : {}), ...(until ? { ends_on: until } : {}) }, "moved")}
            className="h-8 w-full rounded-[10px] bg-brand-primary text-sm font-semibold text-white disabled:opacity-50"
          >
            Change dates
          </button>
        </PopoverContent>
      </Popover>
      <button
        type="button"
        disabled={pending}
        onClick={() => confirm(`Remove ${ids.length} booking${ids.length === 1 ? "" : "s"}? Ones not live yet are cancelled; live ones end today and Tech takes them down.`) && run({ kind: "remove" }, "removed")}
        className={`${BAR_BUTTON} hover:bg-danger`}
      >
        <Trash2 className="h-4 w-4" /> Remove bookings
      </button>
    </BulkBar>
  );
}
