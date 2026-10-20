"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { addDaysISO, formatDate } from "@/lib/time";
import {
  ROLE_LABELS,
  activeOn,
  datesText,
  emptySlots,
  endingSoon,
  nextAfter,
  relativeDay,
  slotLabel,
  slotName,
  statusOf,
  statusText,
  toDesign,
  toPutLive,
  toTakeDown,
  usesProducts,
  type Placement,
  type PlacementRole,
  type Section,
} from "@/lib/placements";
import { markLive, markTakenDown } from "@/app/(app)/placements/actions";
import { HomepageMap } from "./homepage-map";
import { PlacementPanel, useArtworkUpload, type PanelMode } from "./placement-panel";
import { STATUS_CHIP } from "./styles";

const subscribeWide = (cb: () => void) => {
  const m = window.matchMedia("(min-width: 1024px)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const useWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );

const QUEUE_TITLE: Record<PlacementRole, string> = { commercial: "Needs you", design: "To design", tech: "To put live" };
const QUEUE_INTRO: Record<PlacementRole, string> = {
  commercial: "Bookings ending in the next 3 days with nothing after them, and empty slots. You also get these by email.",
  design: "Only what needs a banner or a change. Live placements stay out of your way.",
  tech: "Only what needs to go on the site or come off it.",
};

export function PlacementsBoard({
  sections,
  placements,
  urls,
  roles,
  defaultRole,
  today,
  openId,
}: {
  sections: Section[];
  placements: Placement[];
  urls: Record<string, string>;
  roles: PlacementRole[];
  defaultRole: PlacementRole;
  today: string;
  openId: string | null;
}) {
  const router = useRouter();
  const wide = useWide();
  const [role, setRole] = useState<PlacementRole>(defaultRole);
  const [tab, setTab] = useState<"map" | "list">("map");
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<PanelMode | null>(() => (openId && placements.some((p) => p.id === openId) ? { kind: "view", id: openId } : null));
  const upload = useArtworkUpload();
  const [pending, start] = useTransition();

  // Drop "?open=" from the address once it's been used.
  useEffect(() => {
    if (openId) router.replace("/placements", { scroll: false });
  }, [openId, router]);

  const canBook = role === "commercial";
  const sectionOf = (key: string) => sections.find((s) => s.key === key)!;
  const open = (p: Placement) => setMode({ kind: "view", id: p.id });
  const book = (s: Section, n: number, from = date) => setMode({ kind: "new", key: s.key, position: n, startsOn: from });

  // Counts for the day shown on the map.
  const sum = { live: 0, ending: 0, notReady: 0, empty: 0 };
  for (const s of sections)
    for (let n = 1; n <= s.slots; n++) {
      const p = activeOn(placements, s.key, n, date);
      if (!p) sum.empty++;
      else {
        const k = statusOf(p, today);
        if (k === "live") sum.live++;
        else if (k === "ending") sum.ending++;
        else if (k === "late") sum.notReady++;
      }
    }

  const queueCount =
    role === "commercial" ? endingSoon(placements, today).length : role === "design" ? toDesign(placements).length : toPutLive(placements).length + toTakeDown(placements, today).length;

  const panelTitle = (() => {
    if (!mode) return "";
    if (mode.kind === "new") return "Book this slot";
    const p = placements.find((x) => x.id === mode.id);
    return mode.kind === "edit" ? `Edit ${p?.brand ?? "booking"}` : (p?.brand ?? "Booking");
  })();
  const panelKicker = (() => {
    if (!mode) return "";
    if (mode.kind === "new") return slotName(sectionOf(mode.key), mode.position);
    const p = placements.find((x) => x.id === mode.id);
    return p ? slotName(sectionOf(p.section_key), p.position) : "";
  })();

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) toast.success(done);
      else toast.error(res.error ?? "Something went wrong.");
    });

  const dayChips: [string, string][] = [
    [today, "Today"],
    [addDaysISO(today, 1), "Tomorrow"],
    [addDaysISO(today, 7), "In a week"],
  ];

  const controls = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {dayChips.map(([d, label]) => (
          <button
            key={label}
            type="button"
            onClick={() => setDate(d)}
            aria-pressed={date === d}
            className={cn(
              "h-9 rounded-full border px-3.5 text-sm font-medium transition-colors",
              date === d ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-subtle",
            )}
          >
            {label}
          </button>
        ))}
        <label
          className={cn(
            "relative flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
            dayChips.some(([d]) => d === date) ? "border-line bg-white text-ink" : "border-ink bg-ink text-white",
          )}
        >
          <CalendarDays className="h-4 w-4" />
          <span>{dayChips.some(([d]) => d === date) ? "Pick a date" : formatDate(date, "EEE d MMM")}</span>
          <input
            type="date"
            aria-label="Show the homepage on a date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-ink-muted">{formatDate(date, "EEEE d MMMM")}:</span>
        <span className={cn("rounded-full px-2 text-xs font-semibold leading-6", STATUS_CHIP.live)}>{sum.live} live</span>
        <span className={cn("rounded-full px-2 text-xs font-semibold leading-6", STATUS_CHIP.ending)}>{sum.ending} ending soon</span>
        <span className={cn("rounded-full px-2 text-xs font-semibold leading-6", STATUS_CHIP.late)}>{sum.notReady} not designed</span>
        <span className={cn("rounded-full px-2 text-xs font-semibold leading-6", STATUS_CHIP.empty)}>{sum.empty} empty</span>
      </div>
    </div>
  );

  const map = (
    <HomepageMap
      sections={sections}
      placements={placements}
      urls={urls}
      date={date}
      today={today}
      canBook={canBook}
      onOpen={open}
      onBook={(s, n) => book(s, n)}
    />
  );

  type Item = {
    key: string;
    title: string;
    sub: string;
    chip: string;
    chipClass: string;
    body?: React.ReactNode;
    thumb?: string;
    action: React.ReactNode;
    onOpen?: () => void;
  };
  const card = (p: Placement, extra: Partial<Item> & Pick<Item, "action">): Item => {
    const s = sectionOf(p.section_key);
    const k = statusOf(p, today);
    const words = usesProducts(s) ? p.products : p.comms;
    return {
      key: p.id,
      title: p.brand,
      sub: `${slotName(s, p.position)} · ${datesText(p, today)}`,
      chip: statusText(k, p, today),
      chipClass: STATUS_CHIP[k],
      thumb: p.artwork_path ? urls[p.artwork_path] : undefined,
      body: (
        <>
          {p.changed_from && (
            <p className="rounded-[10px] bg-brand-bg px-3 py-2 text-sm text-brand-primary">
              Changed: “{(usesProducts(s) ? p.changed_from.products : p.changed_from.comms) || "nothing"}” → “{words || "nothing"}”
            </p>
          )}
          {!p.changed_from && words && <p className="whitespace-pre-line text-sm text-ink">“{words}”</p>}
          {p.notes && <p className="whitespace-pre-line rounded-[10px] bg-subtle px-3 py-2 text-sm text-ink-muted">{p.notes}</p>}
          {s.size_hint && <p className="text-xs text-ink-muted">Size: {s.size_hint}</p>}
        </>
      ),
      onOpen: () => open(p),
      ...extra,
    };
  };

  const groups: { title: string; items: Item[]; empty: string }[] =
    role === "commercial"
      ? [
          {
            title: "Ending soon",
            empty: "Nothing ends in the next 3 days without a follow-up.",
            items: endingSoon(placements, today).map((p) =>
              card(p, {
                action: (
                  <Button size="sm" className="flex-1" onClick={() => book(sectionOf(p.section_key), p.position, addDaysISO(p.ends_on!, 1))}>
                    Book next
                  </Button>
                ),
              }),
            ),
          },
          {
            title: "Empty today",
            empty: "Every slot is booked.",
            items: emptySlots(sections, placements, today).map(({ section: s, positions }) => ({
              key: s.key,
              title: s.name,
              sub: s.slots === 1 ? "Empty today" : `${positions.map((n) => slotLabel(s, n)).join(", ")} empty today`,
              chip: `${positions.length} free`,
              chipClass: STATUS_CHIP.empty,
              action: (
                <Button size="sm" className="flex-1" onClick={() => book(s, positions[0], today)}>
                  Book {s.slots === 1 ? "it" : slotLabel(s, positions[0]).toLowerCase()}
                </Button>
              ),
            })),
          },
        ]
      : role === "design"
        ? [
            {
              title: "To design",
              empty: "Nothing to design right now.",
              items: toDesign(placements).map((p) =>
                card(p, {
                  action: (
                    <Button size="sm" className="flex-1" onClick={() => upload.pick(p.id)} disabled={upload.busy === p.id}>
                      <Upload className="h-4 w-4" /> {upload.busy === p.id ? "Uploading…" : "Upload banner"}
                    </Button>
                  ),
                }),
              ),
            },
          ]
        : [
            {
              title: "To put live",
              empty: "Nothing waiting to go live.",
              items: toPutLive(placements).map((p) =>
                card(p, {
                  sub: `${slotName(sectionOf(p.section_key), p.position)} · goes live ${relativeDay(p.starts_on, today)}`,
                  action: (
                    <Button size="sm" className="flex-1" disabled={pending} onClick={() => act(() => markLive(p.id), `${p.brand} is live.`)}>
                      Mark live
                    </Button>
                  ),
                }),
              ),
            },
            {
              title: "Take down",
              empty: "Nothing to take down.",
              items: toTakeDown(placements, today).map((p) => {
                const next = nextAfter(placements, p);
                return card(p, {
                  sub: `${slotName(sectionOf(p.section_key), p.position)} · ${p.ends_on! < today ? `ended ${relativeDay(p.ends_on!, today)}` : "ends today"}`,
                  body: <p className="text-sm text-ink">{next ? `Next up: ${next.brand} from ${relativeDay(next.starts_on, today)}` : "Nothing booked after it."}</p>,
                  action: (
                    <Button size="sm" variant="outline" className="flex-1" disabled={pending} onClick={() => act(() => markTakenDown(p.id), `${p.brand} is taken down.`)}>
                      Taken down
                    </Button>
                  ),
                });
              }),
            },
          ];

  const list = (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">{QUEUE_INTRO[role]}</p>
      {groups.map((g) => (
        <section key={g.title} className="flex flex-col gap-2">
          <h2 className="kicker text-ink">
            {g.title} · {g.items.length}
          </h2>
          {g.items.length === 0 && <p className="surface px-4 py-5 text-sm text-ink-muted">{g.empty}</p>}
          {g.items.map((it) => (
            <article key={it.key} className="surface flex flex-col gap-2.5 p-4">
              <div className="flex items-start gap-3">
                {it.thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.thumb} alt="" className="h-14 w-20 shrink-0 rounded-[8px] bg-subtle object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{it.title}</p>
                  <p className="text-sm text-ink-muted">{it.sub}</p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2 text-xs font-semibold leading-6", it.chipClass)}>{it.chip}</span>
              </div>
              {it.body}
              <div className="flex gap-2">
                {it.action}
                {it.onOpen && (
                  <Button size="sm" variant="outline" onClick={it.onOpen}>
                    Details
                  </Button>
                )}
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {upload.element}
      {roles.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">View as</span>
          <div role="radiogroup" aria-label="View as" className="flex gap-1 rounded-full bg-subtle p-1">
            {roles.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={role === r}
                onClick={() => setRole(r)}
                className={cn(
                  "h-8 rounded-full px-3.5 text-sm font-medium transition-colors",
                  role === r ? "bg-brand-primary text-white" : "text-ink hover:bg-white",
                )}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Phones: one thing at a time. */}
      <div className="flex gap-5 border-b border-line lg:hidden">
        {(["map", "list"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-1 text-[15px] font-semibold",
              tab === t ? "border-brand-primary text-ink" : "border-transparent text-ink-muted",
            )}
          >
            {t === "map" ? "Homepage" : QUEUE_TITLE[role]}
            {t === "list" && queueCount > 0 && (
              <span className="rounded-full bg-brand-primary px-1.5 text-xs leading-5 text-white">{queueCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(360px,420px)_1fr] lg:items-start">
        <div className={cn("flex flex-col gap-3", tab !== "map" && "max-lg:hidden")}>
          {controls}
          {map}
        </div>
        <div className={cn("flex flex-col gap-3", tab !== "list" && "max-lg:hidden")}>
          <h2 className="hidden items-center gap-2 text-lg font-semibold text-ink lg:flex">
            {QUEUE_TITLE[role]}
            {queueCount > 0 && <span className="rounded-full bg-brand-primary px-2 text-xs leading-5 text-white">{queueCount}</span>}
          </h2>
          {list}
        </div>
      </div>

      <Sheet open={!!mode} onOpenChange={(o) => !o && setMode(null)}>
        <SheetContent
          side={wide ? "right" : "bottom"}
          className={cn("gap-0 overflow-y-auto bg-white p-0", wide ? "w-full sm:max-w-md" : "max-h-[90svh] rounded-t-[22px]")}
        >
          <SheetHeader className="px-5 pb-2 pt-5">
            <SheetDescription className="text-xs">{panelKicker}</SheetDescription>
            <SheetTitle className="pr-8 text-xl text-ink">{panelTitle}</SheetTitle>
          </SheetHeader>
          <div className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {mode && (
              <PlacementPanel
                mode={mode}
                sections={sections}
                placements={placements}
                urls={urls}
                today={today}
                role={role}
                onMode={setMode}
                onClose={() => setMode(null)}
                upload={upload}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
