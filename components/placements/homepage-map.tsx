"use client";

import { Plus } from "lucide-react";
import { HighfyLogo } from "@/components/brand";
import { cn } from "@/lib/utils";
import {
  activeOn,
  slotLabel,
  statusOf,
  statusText,
  usesProducts,
  type Placement,
  type Section,
} from "@/lib/placements";
import { SLOT, STATUS_CARD, STATUS_CHIP, WRAP } from "./styles";

/**
 * The highfy.pk homepage, section by section, as it is (or will be) on one
 * day. Slots show the real banner once Design has uploaded it.
 */
export function HomepageMap({
  sections,
  placements,
  urls,
  date,
  today,
  canBook,
  onOpen,
  onBook,
}: {
  sections: Section[];
  placements: Placement[];
  urls: Record<string, string>;
  date: string;
  today: string;
  canBook: boolean;
  onOpen: (p: Placement) => void;
  onBook: (s: Section, position: number) => void;
}) {
  return (
    <div className="surface flex flex-col gap-4 overflow-hidden p-3">
      <div className="flex items-end justify-between px-0.5">
        <HighfyLogo className="w-20" />
        <span className="text-xs text-ink-muted">highfy.pk</span>
      </div>
      {sections.map((s) => (
        <section key={s.key} className="flex min-w-0 flex-col gap-1.5">
          <h3 className="flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            <span>{s.name}</span>
            {s.slots > 1 && <span className="font-medium normal-case tracking-normal">{s.slots} slots</span>}
          </h3>
          <div className={WRAP[s.kind]}>
            {Array.from({ length: s.slots }, (_, i) => i + 1).map((n) => {
              const p = activeOn(placements, s.key, n, date);
              const label = slotLabel(s, n);
              if (!p) {
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => canBook && onBook(s, n)}
                    disabled={!canBook}
                    aria-label={`${s.name}, ${label}: empty${canBook ? ". Book it" : ""}`}
                    className={cn(
                      SLOT[s.kind],
                      "relative flex items-center justify-center gap-1 border-[1.5px] border-dashed border-line bg-white text-xs font-semibold text-ink-muted",
                      canBook ? "hover:border-brand-primary hover:text-brand-primary" : "cursor-default",
                    )}
                  >
                    {s.kind === "icons" ? (
                      <span className="px-1 text-center text-[11px] leading-tight">{label}</span>
                    ) : (
                      <>
                        {s.slots > 1 && <span className="absolute left-2 top-1.5 text-[10px] font-medium">{label}</span>}
                        {canBook ? (
                          <>
                            <Plus className="h-3.5 w-3.5" /> Book
                          </>
                        ) : (
                          "Empty"
                        )}
                      </>
                    )}
                  </button>
                );
              }
              const k = statusOf(p, today);
              const art = p.artwork_path && (p.stage === "ready" || p.stage === "live") ? urls[p.artwork_path] : undefined;
              const words = usesProducts(s) ? p.products : p.comms;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => onOpen(p)}
                  aria-label={`${s.name}, ${label}: ${p.brand}, ${statusText(k, p, today)}`}
                  className={cn(
                    SLOT[s.kind],
                    "relative flex flex-col justify-end overflow-hidden px-2.5 py-2 text-left",
                    s.kind === "icons" && "items-center justify-center p-1.5 text-center",
                    art ? "bg-subtle" : STATUS_CARD[k],
                  )}
                >
                  {art && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                  {s.kind !== "icons" && (
                    <span
                      className={cn(
                        "absolute right-1.5 top-1.5 rounded-full px-1.5 text-[10px] font-semibold leading-[18px]",
                        STATUS_CHIP[k],
                      )}
                    >
                      {statusText(k, p, today)}
                    </span>
                  )}
                  {s.kind === "icons" && art && (
                    <span className={cn("absolute inset-0 rounded-full ring-2 ring-inset", k === "live" ? "ring-transparent" : "ring-warning")} />
                  )}
                  {!art && (
                    <>
                      {s.slots > 1 && s.kind !== "icons" && (
                        <span className="absolute left-2 top-1.5 text-[10px] font-medium opacity-75">{label}</span>
                      )}
                      {s.kind === "text" || s.kind === "badge" ? (
                        <span className="pr-24 text-xs font-medium leading-snug">{words || p.brand}</span>
                      ) : (
                        <>
                          <span className={cn("font-bold leading-tight", s.kind === "icons" ? "text-[11px]" : "text-sm")}>
                            {s.kind === "icons" ? label : p.brand}
                          </span>
                          {s.kind !== "icons" && words && <span className="line-clamp-2 text-[11px] leading-snug opacity-85">{words}</span>}
                        </>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
