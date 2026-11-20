"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { HighfyLogo } from "@/components/brand";
import { cn } from "@/lib/utils";
import {
  activeOn,
  slotLabel,
  statusOf,
  statusText,
  surfacesText,
  usesProducts,
  type Placement,
  type Section,
} from "@/lib/placements";
import { SLOT, STATUS_CARD, STATUS_CHIP, WRAP } from "./styles";
import { SectionEditBar } from "./section-editor";

/** Moving, hiding and adding sections (Commercial and Admins, in edit mode). */
export type LayoutEdit = {
  busy: boolean;
  onMove: (key: string, dir: -1 | 1) => void;
  onDrop: (key: string, beforeKey: string) => void;
  onHide: (s: Section) => void;
  onAdd: () => void;
};

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
  edit,
  editToggle,
}: {
  sections: Section[];
  placements: Placement[];
  urls: Record<string, string>;
  date: string;
  today: string;
  canBook: boolean;
  onOpen: (p: Placement) => void;
  onBook: (s: Section, position: number) => void;
  edit?: LayoutEdit;
  /** "Edit layout" / "Done", for people who can change the layout. */
  editToggle?: React.ReactNode;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="surface flex flex-col gap-4 overflow-hidden p-3">
      <div className="flex min-h-8 items-center justify-between gap-2 px-0.5">
        <span className="flex items-end gap-2">
          <HighfyLogo className="w-20" />
          <span className="text-xs text-ink-muted">highfy.pk</span>
        </span>
        {editToggle}
      </div>
      {edit && (
        <p className="rounded-[12px] bg-brand-bg px-3 py-2 text-sm text-ink">
          Drag a section by its handle, or use the arrows. Moving sections changes the order for everyone.
        </p>
      )}
      {sections.map((s, i) => (
        <section
          key={s.key}
          className={cn(
            "flex min-w-0 flex-col gap-1.5",
            edit && "rounded-[14px]",
            edit && dragging && over === s.key && dragging !== s.key && "outline-2 outline-offset-4 outline-dashed outline-brand-primary",
          )}
          onDragOver={
            edit && dragging
              ? (e) => {
                  e.preventDefault();
                  setOver(s.key);
                }
              : undefined
          }
          onDrop={
            edit && dragging
              ? (e) => {
                  e.preventDefault();
                  if (dragging !== s.key) edit.onDrop(dragging, s.key);
                  setDragging(null);
                  setOver(null);
                }
              : undefined
          }
          onDragEnd={edit ? () => (setDragging(null), setOver(null)) : undefined}
        >
          {edit ? (
            <SectionEditBar
              section={s}
              first={i === 0}
              last={i === sections.length - 1}
              busy={edit.busy}
              onMove={(dir) => edit.onMove(s.key, dir)}
              onHide={() => edit.onHide(s)}
              onDragStart={() => setDragging(s.key)}
            />
          ) : (
          <h3 className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            <span>
              {s.name}
              {s.optional && <span className="ml-1.5 font-medium normal-case tracking-normal">(optional)</span>}
            </span>
            <span className="flex items-center gap-1.5">
              {s.slots > 1 && <span className="font-medium normal-case tracking-normal">{s.slots} slots</span>}
              {(s.kind === "carousel" || s.kind === "icons") && s.slots > 2 && <ScrollButtons target={s.key} name={s.name} />}
            </span>
          </h3>
          )}
          <div className={cn(WRAP[s.kind], edit && "pointer-events-none opacity-60")} data-scroll-row={s.key} aria-hidden={edit ? true : undefined}>
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
                  {s.kind !== "icons" && (
                    <span className="absolute right-1.5 top-[26px] rounded-full bg-white/90 px-1.5 text-[10px] font-semibold leading-[18px] text-ink">
                      {surfacesText(p.shows_on?.length ? p.shows_on : ["web"])}
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
      {edit && (
        <button
          type="button"
          onClick={edit.onAdd}
          disabled={edit.busy}
          className="flex h-12 items-center justify-center gap-1.5 rounded-[12px] border-[1.5px] border-dashed border-line text-sm font-semibold text-brand-primary hover:border-brand-primary disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add a section
        </button>
      )}
    </div>
  );
}

/**
 * Left and right buttons for a carousel row, for people using a mouse (a
 * trackpad or a phone can still swipe).
 */
function ScrollButtons({ target, name }: { target: string; name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const move = (dir: 1 | -1) => {
    const row = ref.current?.closest("section")?.querySelector<HTMLElement>(`[data-scroll-row="${target}"]`);
    if (row) row.scrollBy({ left: dir * Math.max(160, row.clientWidth * 0.8), behavior: "smooth" });
  };
  const btn = "inline-flex h-6 w-6 items-center justify-center rounded-full border border-line bg-white text-ink hover:bg-subtle";
  return (
    <span ref={ref} className="flex gap-1 normal-case tracking-normal">
      <button type="button" aria-label={`Scroll ${name} left`} onClick={() => move(-1)} className={btn}>
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label={`Scroll ${name} right`} onClick={() => move(1)} className={btn}>
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
