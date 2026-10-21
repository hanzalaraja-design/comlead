"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ClipboardPaste, Plus, Trash2 } from "lucide-react";
import { addMonths, format, getDaysInMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { addDaysISO, parseISODate } from "@/lib/time";
import { slotLabel, slotName, statusOf, usesProducts, type Placement, type Section } from "@/lib/placements";
import { bookMany } from "@/app/(app)/placements/actions";
import { STATUS_CHIP } from "./styles";

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const DAY = 30; // px per day column

/**
 * The month at a glance: one row per slot, one column per day, each booking a
 * bar across its dates. Commercial taps an empty day to book from it.
 */
export function SchedulePlanner({
  sections,
  placements,
  today,
  canBook,
  onOpen,
  onBook,
  onAddMany,
}: {
  sections: Section[];
  placements: Placement[];
  today: string;
  canBook: boolean;
  onOpen: (p: Placement) => void;
  onBook: (s: Section, position: number, from: string) => void;
  onAddMany: () => void;
}) {
  const [month, setMonth] = useState(today.slice(0, 7) + "-01");
  const first = parseISODate(month);
  const days = getDaysInMonth(first);
  const last = iso(new Date(first.getFullYear(), first.getMonth(), days));
  const dates = Array.from({ length: days }, (_, i) => addDaysISO(month, i));
  const cols = `minmax(150px,190px) repeat(${days}, ${DAY}px)`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="Previous month" onClick={() => setMonth(iso(addMonths(first, -1)))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-36 text-center text-base font-semibold text-ink">{format(first, "MMMM yyyy")}</span>
          <Button size="icon" variant="outline" aria-label="Next month" onClick={() => setMonth(iso(addMonths(first, 1)))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {canBook && (
          <Button className="ml-auto" onClick={onAddMany}>
            <Plus className="h-4 w-4" /> Add many
          </Button>
        )}
      </div>
      <p className="text-sm text-ink-muted">
        {canBook ? "Tap an empty day to book a slot from that date, or use Add many to plan the month in one go." : "Tap a bar to see the booking."}
      </p>

      <div className="surface overflow-x-auto">
        <div className="min-w-max text-xs">
          {/* Day numbers */}
          <div className="sticky top-0 z-20 grid border-b border-line bg-white" style={{ gridTemplateColumns: cols }}>
            <div className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold text-ink-muted">Slot</div>
            {dates.map((d) => (
              <div
                key={d}
                className={cn(
                  "py-1 text-center leading-tight",
                  d === today ? "font-bold text-brand-primary" : "text-ink-muted",
                  [0, 6].includes(parseISODate(d).getDay()) && "bg-subtle/60",
                )}
              >
                <div>{format(parseISODate(d), "EEEEE")}</div>
                <div>{Number(d.slice(8))}</div>
              </div>
            ))}
          </div>

          {sections.map((s) => (
            <div key={s.key}>
              <div className="sticky left-0 border-b border-line bg-subtle/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                {s.name}
              </div>
              {Array.from({ length: s.slots }, (_, i) => i + 1).map((n) => {
                const bars = placements.filter(
                  (p) => p.section_key === s.key && p.position === n && p.starts_on <= last && (p.ends_on === null || p.ends_on >= month),
                );
                const taken = (d: string) => bars.some((p) => p.starts_on <= d && (p.ends_on === null || p.ends_on >= d));
                return (
                  <div key={n} className="grid h-9 border-b border-line last:border-0" style={{ gridTemplateColumns: cols }}>
                    <div className="sticky left-0 z-10 flex items-center truncate bg-white px-3 text-ink" style={{ gridRow: 1, gridColumn: 1 }}>
                      {s.slots === 1 ? s.name : slotLabel(s, n)}
                    </div>
                    {dates.map((d, i) =>
                      taken(d) ? null : (
                        <button
                          key={d}
                          type="button"
                          disabled={!canBook || d < today}
                          onClick={() => onBook(s, n, d)}
                          aria-label={`Book ${slotName(s, n)} from ${d}`}
                          className={cn(
                            "border-l border-line/60",
                            [0, 6].includes(parseISODate(d).getDay()) && "bg-subtle/40",
                            canBook && d >= today ? "hover:bg-brand-bg" : "cursor-default",
                          )}
                          style={{ gridRow: 1, gridColumn: i + 2 }}
                        />
                      ),
                    )}
                    {bars.map((p) => {
                      const start = p.starts_on < month ? 0 : Number(p.starts_on.slice(8)) - 1;
                      const end = p.ends_on === null || p.ends_on > last ? days - 1 : Number(p.ends_on.slice(8)) - 1;
                      const k = statusOf(p, today);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => onOpen(p)}
                          title={`${p.brand}${p.comms ? ` · ${p.comms}` : ""}`}
                          className={cn(
                            "z-[5] my-1 truncate rounded-[8px] px-2 text-left text-[11px] font-semibold",
                            STATUS_CHIP[k],
                            p.starts_on < month && "rounded-l-none",
                            (p.ends_on === null || p.ends_on > last) && "rounded-r-none",
                          )}
                          style={{ gridRow: 1, gridColumn: `${start + 2} / ${end + 3}` }}
                        >
                          {p.brand}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add many at once
// ---------------------------------------------------------------------------

type Row = { slot: string; brand: string; from: string; until: string; words: string; notes: string };
const blank = (from: string): Row => ({ slot: "", brand: "", from, until: "", words: "", notes: "" });
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Understands 2026-11-01, 1/11/2026, 1-11-26, 1 Nov, Nov 1, 1 November 2026. Blank or "ongoing" → "". */
function parseDate(text: string, today: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t || /^(ongoing|open|none|-)$/.test(t)) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = (y?: string) => (!y ? Number(today.slice(0, 4)) : y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/); // day first, as in Pakistan
  if (m) return `${year(m[3])}-${pad(+m[2])}-${pad(+m[1])}`;
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s*(\d{2,4})?$/);
  if (m && MONTHS.includes(m[2])) return `${year(m[3])}-${pad(MONTHS.indexOf(m[2]) + 1)}-${pad(+m[1])}`;
  m = t.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{2,4})?$/);
  if (m && MONTHS.includes(m[1])) return `${year(m[3])}-${pad(MONTHS.indexOf(m[1]) + 1)}-${pad(+m[2])}`;
  return null;
}

export function BulkAdd({
  sections,
  placements,
  today,
  onDone,
}: {
  sections: Section[];
  placements: Placement[];
  today: string;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([blank(today), blank(today), blank(today)]);
  const [paste, setPaste] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<number, string>>({});
  const [pending, start] = useTransition();

  const slots = useMemo(
    () =>
      sections.flatMap((s) =>
        Array.from({ length: s.slots }, (_, i) => {
          const n = i + 1;
          const names = [slotName(s, n), s.labels[i], `${s.name} ${n}`, `${s.name.split(" ")[0]} ${n}`, s.slots === 1 ? s.name : ""]
            .filter(Boolean)
            .map((x) => norm(x!));
          return { id: `${s.key}:${n}`, section: s, position: n, label: slotName(s, n), names };
        }),
      ),
    [sections],
  );
  const findSlot = (text: string) => {
    const t = norm(text);
    return (slots.find((x) => x.names.includes(t)) ?? slots.find((x) => x.names.some((n) => n.startsWith(t) || t.startsWith(n))))?.id ?? "";
  };

  // Problems shown before saving: missing fields, bad dates, clashes.
  const problems = rows.map((r, i): string | null => {
    const filled = r.slot || r.brand || r.words;
    if (!filled) return null;
    if (!r.slot) return "Pick a slot.";
    if (!r.brand.trim()) return "Add the brand.";
    if (!r.from) return "Add a start date.";
    if (r.until && r.until < r.from) return "Ends before it starts.";
    const [key, pos] = r.slot.split(":");
    const overlaps = (a: { from: string; until: string | null }) => a.from <= (r.until || "9999") && (a.until ?? "9999") >= r.from;
    const clash = placements.find(
      (p) => p.section_key === key && p.position === Number(pos) && p.stage !== "ended" && overlaps({ from: p.starts_on, until: p.ends_on }),
    );
    if (clash) return `Clashes with ${clash.brand} already booked.`;
    const twin = rows.findIndex((o, j) => j !== i && o.slot === r.slot && o.brand && overlaps({ from: o.from, until: o.until || null }));
    if (twin !== -1) return `Clashes with row ${twin + 1}.`;
    return serverErrors[i] ?? null;
  });
  const ready = rows.filter((r, i) => (r.slot || r.brand || r.words) && !problems[i]);

  const set = (i: number, patch: Partial<Row>) => {
    setServerErrors({});
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  function applyPaste(text: string) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const parsed: Row[] = [];
    let skipped = 0;
    for (const [i, line] of lines.entries()) {
      const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
      if (i === 0 && /slot|placement|section/i.test(cells[0])) continue; // header row
      const [slot = "", brand = "", from = "", until = "", words = "", notes = ""] = cells;
      const f = parseDate(from, today);
      const u = parseDate(until, today);
      if (!brand && !slot) continue;
      if (f === null || u === null) skipped++;
      parsed.push({ slot: findSlot(slot), brand, from: f || today, until: u ?? "", words, notes });
    }
    if (!parsed.length) return toast.error("Couldn't read any rows. Columns: Slot, Brand, From, Until, Comms, Notes.");
    setRows((rs) => [...rs.filter((r) => r.slot || r.brand || r.words), ...parsed]);
    setPaste(null);
    toast.success(`${parsed.length} row${parsed.length === 1 ? "" : "s"} added. Check them before saving.${skipped ? ` ${skipped} had a date I couldn't read.` : ""}`);
  }

  function save() {
    const indexes = rows.map((r, i) => i).filter((i) => (rows[i].slot || rows[i].brand || rows[i].words) && !problems[i]);
    start(async () => {
      const res = await bookMany(
        indexes.map((i) => {
          const r = rows[i];
          const [key, pos] = r.slot.split(":");
          const products = usesProducts(sections.find((s) => s.key === key)!);
          return {
            section_key: key,
            position: Number(pos),
            brand: r.brand,
            starts_on: r.from,
            ends_on: r.until || null,
            comms: products ? null : r.words,
            products: products ? r.words : null,
            notes: r.notes,
            inspo_paths: [],
          };
        }),
      );
      if (!res.ok) return void toast.error(res.error);
      const { saved, failed } = res.data!;
      if (saved) toast.success(`${saved} booked. Design has been told.`);
      if (!failed.length) return onDone();
      // Keep only the rows that didn't save, with the reason.
      const keep = failed.map((f) => indexes[f.row]);
      setRows(keep.map((i) => rows[i]));
      setServerErrors(Object.fromEntries(failed.map((f, j) => [j, f.error])));
      toast.error(`${failed.length} couldn't be saved. They're still here with the reason.`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        One row per booking. Leave <b>Until</b> empty for ongoing. The same slot can have different brands on different dates.
      </p>

      {paste === null ? (
        <Button variant="outline" onClick={() => setPaste("")} className="self-start">
          <ClipboardPaste className="h-4 w-4" /> Paste from Excel or Google Sheets
        </Button>
      ) : (
        <div className="space-y-2 rounded-[14px] bg-subtle p-3">
          <p className="text-sm text-ink">
            Copy the rows from your sheet and paste them here. Columns in this order: <b>Slot, Brand, From, Until, Comms, Notes</b>. Slots can be
            written like “Hero 3”, “Must-Haves 2”, “Announcement bar” or “Skincare”.
          </p>
          <Textarea rows={6} autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Hero 1\tCOSRX\t1 Nov\t7 Nov\tUp to 40% off\nHero 1\tAnua\t8 Nov\t15 Nov\tUp to 35% off"} />
          <div className="flex gap-2">
            <Button onClick={() => applyPaste(paste)} disabled={!paste.trim()}>
              Add these rows
            </Button>
            <Button variant="ghost" onClick={() => setPaste(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="hidden grid-cols-[1.5fr_1fr_8.5rem_8.5rem_1.5fr_1fr_2rem] gap-2 px-1 text-xs font-medium text-ink-muted md:grid">
        <span>Slot</span>
        <span>Brand</span>
        <span>From</span>
        <span>Until</span>
        <span>Comms or products</span>
        <span>Notes</span>
        <span />
      </div>
      <ol className="flex flex-col gap-3 md:gap-2">
        {rows.map((r, i) => (
          <li key={i} className="rounded-[14px] border border-line p-2 md:border-0 md:p-0">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-[1.5fr_1fr_8.5rem_8.5rem_1.5fr_1fr_2rem]">
              <select
                aria-label={`Row ${i + 1} slot`}
                value={r.slot}
                onChange={(e) => set(i, { slot: e.target.value })}
                className="col-span-2 h-10 field px-2 text-sm md:col-span-1"
              >
                <option value="">Slot…</option>
                {sections.map((s) => (
                  <optgroup key={s.key} label={s.name}>
                    {slots
                      .filter((x) => x.section.key === s.key)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {s.slots === 1 ? s.name : slotLabel(s, x.position)}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <Input aria-label={`Row ${i + 1} brand`} placeholder="Brand" value={r.brand} onChange={(e) => set(i, { brand: e.target.value })} className="col-span-2 md:col-span-1" />
              <Input aria-label={`Row ${i + 1} from`} type="date" value={r.from} onChange={(e) => set(i, { from: e.target.value })} />
              <Input aria-label={`Row ${i + 1} until`} type="date" value={r.until} min={r.from} onChange={(e) => set(i, { until: e.target.value })} />
              <Input aria-label={`Row ${i + 1} comms`} placeholder="Comms or products" value={r.words} onChange={(e) => set(i, { words: e.target.value })} className="col-span-2 md:col-span-1" />
              <Input aria-label={`Row ${i + 1} notes`} placeholder="Notes" value={r.notes} onChange={(e) => set(i, { notes: e.target.value })} />
              <button
                type="button"
                aria-label={`Remove row ${i + 1}`}
                onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [blank(today)]))}
                className="flex h-10 items-center justify-center rounded-[10px] text-ink-muted hover:bg-subtle hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {problems[i] && <p className="mt-1 px-1 text-xs font-medium text-danger">Row {i + 1}: {problems[i]}</p>}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setRows((rs) => [...rs, blank(rs.at(-1)?.until ? addDaysISO(rs.at(-1)!.until, 1) : today)])}>
          <Plus className="h-4 w-4" /> Add row
        </Button>
        <Button className="ml-auto" disabled={pending || ready.length === 0 || problems.some(Boolean)} onClick={save}>
          {pending ? "Saving…" : `Book ${ready.length || ""} ${ready.length === 1 ? "slot" : "slots"}`.replace("  ", " ")}
        </Button>
      </div>
      {problems.some(Boolean) && <p className="text-right text-xs text-danger">Fix the rows in red to save.</p>}
    </div>
  );
}
