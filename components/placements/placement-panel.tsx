"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, ImagePlus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { addDaysISO } from "@/lib/time";
import {
  datesText,
  needsDesign,
  nextAfter,
  relativeDay,
  slotName,
  statusOf,
  statusText,
  usesProducts,
  type Placement,
  type PlacementRole,
  type Section,
} from "@/lib/placements";
import {
  bookPlacement,
  cancelPlacement,
  endPlacementToday,
  markLive,
  markTakenDown,
  submitArtwork,
  updatePlacement,
} from "@/app/(app)/placements/actions";
import { STATUS_CHIP } from "./styles";

const BUCKET = "placement-files";
const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80);

/** Upload files under "<placement id>/<folder>/", returning their paths. */
async function uploadFiles(id: string, folder: "inspo" | "artwork", files: File[]): Promise<string[]> {
  const supabase = createClient();
  const paths: string[] = [];
  for (const file of files) {
    const path = `${id}/${folder}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
    if (error) throw new Error(`Couldn't upload ${file.name}: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

/** Design's one-tap upload: pick the file, it goes up, Tech is told. */
export function useArtworkUpload() {
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pick = (id: string) => {
    target.current = id;
    input.current?.click();
  };
  const element = (
    <input
      ref={input}
      type="file"
      accept="image/*,.pdf,.gif,.webp,.svg"
      hidden
      onChange={async (e) => {
        const file = e.target.files?.[0];
        const id = target.current;
        e.target.value = "";
        if (!file || !id) return;
        setBusy(id);
        try {
          const [path] = await uploadFiles(id, "artwork", [file]);
          const res = await submitArtwork(id, path);
          if (res.ok) toast.success("Banner uploaded. Tech has been told.");
          else toast.error(res.error);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Upload failed.");
        } finally {
          setBusy(null);
        }
      }}
    />
  );
  return { pick, busy, element };
}

type Mode = { kind: "view"; id: string } | { kind: "edit"; id: string } | { kind: "new"; key: string; position: number; startsOn: string };

export type PanelMode = Mode;

export function PlacementPanel({
  mode,
  sections,
  placements,
  urls,
  today,
  role,
  onMode,
  onClose,
  upload,
}: {
  mode: Mode;
  sections: Section[];
  placements: Placement[];
  urls: Record<string, string>;
  today: string;
  role: PlacementRole;
  onMode: (m: Mode | null) => void;
  onClose: () => void;
  upload: ReturnType<typeof useArtworkUpload>;
}) {
  const p = mode.kind === "new" ? undefined : placements.find((x) => x.id === mode.id);
  const section = sections.find((s) => s.key === (mode.kind === "new" ? mode.key : p?.section_key));
  if (!section || (mode.kind !== "new" && !p)) return <p className="p-4 text-sm text-ink-muted">This booking is no longer there.</p>;

  if (mode.kind === "view") return <Details p={p!} section={section} {...{ placements, urls, today, role, onMode, onClose, upload }} />;
  return (
    <BookingForm
      key={mode.kind === "new" ? `${mode.key}-${mode.position}-${mode.startsOn}` : mode.id}
      section={section}
      position={mode.kind === "new" ? mode.position : p!.position}
      existing={p}
      startsOn={mode.kind === "new" ? mode.startsOn : p!.starts_on}
      urls={urls}
      today={today}
      onDone={(id) => (id ? onMode({ kind: "view", id }) : onClose())}
    />
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 whitespace-pre-line break-words text-ink">{children}</dd>
    </>
  );
}

function Details({
  p,
  section,
  placements,
  urls,
  today,
  role,
  onMode,
  onClose,
  upload,
}: {
  p: Placement;
  section: Section;
  placements: Placement[];
  urls: Record<string, string>;
  today: string;
  role: PlacementRole;
  onMode: (m: Mode | null) => void;
  onClose: () => void;
  upload: ReturnType<typeof useArtworkUpload>;
}) {
  const [pending, start] = useTransition();
  const k = statusOf(p, today);
  const next = nextAfter(placements, p);
  const art = p.artwork_path ? urls[p.artwork_path] : undefined;
  const step = { booked: 0, ready: 1, live: 2, ended: 2 }[p.stage];
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string, close = true) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong.");
      toast.success(done);
      if (close) onClose();
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-[14px] bg-subtle">
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt={`${p.brand} banner`} className="max-h-56 w-full object-contain" />
        ) : (
          <div className="flex h-28 flex-col justify-end p-3">
            <span className="text-lg font-bold text-ink">{p.brand}</span>
            <span className="text-sm text-ink-muted">No banner yet</span>
          </div>
        )}
        <span className={cn("absolute right-2 top-2 rounded-full px-2 text-xs font-semibold leading-6", STATUS_CHIP[k])}>
          {statusText(k, p, today)}
        </span>
      </div>

      <ol className="grid grid-cols-3 gap-1 text-center text-[11px] font-semibold" aria-label="Progress">
        {["Booked", "Banner ready", "Live"].map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "rounded-[8px] px-1 py-1.5",
              i < step ? "bg-success-soft text-success-ink" : i === step ? "bg-brand-primary text-white" : "bg-subtle text-ink-muted",
            )}
          >
            {label}
          </li>
        ))}
      </ol>

      {p.changed_from && (
        <p className="rounded-[10px] bg-brand-bg px-3 py-2 text-sm text-brand-primary">
          Changed after the banner was made.
          {p.changed_from.comms !== p.comms && <> Was “{p.changed_from.comms || "no comms"}”.</>}
          {p.changed_from.products !== p.products && <> Products were “{p.changed_from.products || "none"}”.</>}
        </p>
      )}

      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-sm">
        <Row label="Dates">{datesText(p, today)}</Row>
        {usesProducts(section) ? <Row label="Products">{p.products || "—"}</Row> : <Row label="Comms">{p.comms || "—"}</Row>}
        {p.notes && <Row label="Notes">{p.notes}</Row>}
        {section.size_hint && <Row label="Size">{section.size_hint}</Row>}
        <Row label="Next">{next ? `${next.brand} from ${relativeDay(next.starts_on, today)}` : "Nothing booked yet"}</Row>
      </dl>

      {p.inspo_paths.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm text-ink-muted">Inspo</p>
          <div className="flex flex-wrap gap-2">
            {p.inspo_paths.map((path) =>
              urls[path] ? (
                <a key={path} href={urls[path]} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-[10px] bg-subtle">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={urls[path]} alt="Inspo" className="h-full w-full object-cover" />
                </a>
              ) : null,
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {role === "commercial" && (
          <>
            <Button variant="outline" onClick={() => onMode({ kind: "edit", id: p.id })}>
              Edit booking
            </Button>
            {p.ends_on && !next && (
              <Button onClick={() => onMode({ kind: "new", key: p.section_key, position: p.position, startsOn: addDaysISO(p.ends_on!, 1) })}>
                Book the next brand from {relativeDay(addDaysISO(p.ends_on, 1), today)}
              </Button>
            )}
            {p.stage === "live" && p.starts_on <= today && (p.ends_on === null || p.ends_on > today) && (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => confirm("End this today? Tech will be asked to take it down.") && run(() => endPlacementToday(p.id), "Ends today. Tech has it in their list.", false)}
              >
                End it today
              </Button>
            )}
            {(p.stage === "booked" || p.stage === "ready") && (
              <Button
                variant="ghost"
                className="text-danger hover:text-danger/80"
                disabled={pending}
                onClick={() => confirm("Cancel this booking?") && run(() => cancelPlacement(p.id), "Booking cancelled.")}
              >
                Cancel booking
              </Button>
            )}
          </>
        )}
        {role === "design" && (
          <Button onClick={() => upload.pick(p.id)} disabled={upload.busy === p.id}>
            <Upload className="h-4 w-4" />
            {upload.busy === p.id ? "Uploading…" : needsDesign(p) ? "Upload banner" : "Replace banner"}
          </Button>
        )}
        {role === "tech" && p.stage === "ready" && (
          <Button disabled={pending} onClick={() => run(() => markLive(p.id), `${p.brand} is live.`)}>
            Mark live
          </Button>
        )}
        {role === "tech" && p.stage === "live" && (
          <Button variant="outline" disabled={pending} onClick={() => run(() => markTakenDown(p.id), `${p.brand} is taken down.`)}>
            Taken down
          </Button>
        )}
        {art && (
          <Button asChild variant="ghost">
            <a href={art} download target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" /> Download banner
            </a>
          </Button>
        )}
      </div>
      <p className="text-center text-xs text-ink-muted">{slotName(section, p.position)}</p>
    </div>
  );
}

function BookingForm({
  section,
  position,
  existing,
  startsOn,
  urls,
  today,
  onDone,
}: {
  section: Section;
  position: number;
  existing?: Placement;
  startsOn: string;
  urls: Record<string, string>;
  today: string;
  onDone: (id: string | null) => void;
}) {
  const [id] = useState(() => existing?.id ?? crypto.randomUUID());
  const start0 = existing ? existing.starts_on : startsOn < today ? today : startsOn;
  const [brand, setBrand] = useState(existing?.brand ?? "");
  const [from, setFrom] = useState(start0);
  const [until, setUntil] = useState(existing ? existing.ends_on ?? "" : addDaysISO(start0, 6));
  const [ongoing, setOngoing] = useState(existing ? existing.ends_on === null : false);
  const [words, setWords] = useState((usesProducts(section) ? existing?.products : existing?.comms) ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [inspo, setInspo] = useState<string[]>(existing?.inspo_paths ?? []);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const products = usesProducts(section);

  async function addInspo(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const list = [...files].slice(0, 10 - inspo.length);
      const paths = await uploadFiles(id, "inspo", list);
      setPreviews((p) => ({ ...p, ...Object.fromEntries(paths.map((path, i) => [path, URL.createObjectURL(list[i])])) }));
      setInspo((x) => [...x, ...paths]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      brand,
      starts_on: from,
      ends_on: ongoing ? null : until || null,
      comms: products ? (existing?.comms ?? null) : words,
      products: products ? words : (existing?.products ?? null),
      notes,
      inspo_paths: inspo,
    };
    start(async () => {
      const res = existing ? await updatePlacement(existing.id, input) : await bookPlacement(id, section.key, position, input);
      if (!res.ok) return void toast.error(res.error);
      toast.success(existing ? "Saved." : "Booked. Design has been told.");
      onDone(existing ? existing.id : null);
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="pl-brand">Brand</Label>
        <Input id="pl-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. COSRX" required autoFocus={!existing} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pl-from">From</Label>
          <Input id="pl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pl-until">Until</Label>
          <Input
            id="pl-until"
            type="date"
            value={ongoing ? "" : until}
            min={from}
            onChange={(e) => setUntil(e.target.value)}
            disabled={ongoing}
            required={!ongoing}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} className="size-4 accent-[hsl(var(--brand-primary))]" />
        Ongoing, no end date
      </label>
      <div className="space-y-1.5">
        <Label htmlFor="pl-words">{products ? "Products to show" : "Comms on the banner"}</Label>
        {products ? (
          <Textarea id="pl-words" rows={3} value={words} onChange={(e) => setWords(e.target.value)} placeholder="Product names or links, one per line" />
        ) : (
          <Input id="pl-words" value={words} onChange={(e) => setWords(e.target.value)} placeholder="e.g. Flat 20% off · Only for today" />
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pl-notes">
          Instructions or inspo <span className="font-normal text-ink-muted">(optional)</span>
        </Label>
        <Textarea id="pl-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything Design should know" />
      </div>
      {inspo.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {inspo.map((path) => (
            <div key={path} className="relative size-16 overflow-hidden rounded-[10px] bg-subtle">
              {(previews[path] || urls[path]) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews[path] || urls[path]} alt="Inspo" className="h-full w-full object-cover" />
              )}
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => setInspo((x) => x.filter((y) => y !== path))}
                className="absolute right-0.5 top-0.5 rounded-full bg-ink/70 p-0.5 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => addInspo(e.target.files).finally(() => (e.target.value = ""))} />
      <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={uploading || inspo.length >= 10}>
        <ImagePlus className="h-4 w-4" /> {uploading ? "Uploading…" : "Add inspo images"}
      </Button>
      <Button type="submit" disabled={pending || uploading}>
        {pending ? "Saving…" : existing ? "Save changes" : "Book slot"}
      </Button>
      <p className="text-center text-xs text-ink-muted">
        {existing
          ? existing.stage === "booked"
            ? "Design sees the latest version."
            : "If the comms change, Design is asked to update the banner."
          : "Design is told when you book, in the app and by email."}
      </p>
      <p className="text-center text-xs text-ink-muted">{slotName(section, position)}</p>
    </form>
  );
}
