"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Check, LayoutList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { addDaysISO, formatDate } from "@/lib/time";
import {
  ROLE_LABELS,
  SURFACE_LABELS,
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
  surfacesText,
  usesProducts,
  type Placement,
  type PlacementRole,
  type Section,
  type Surface,
  type ProjectLink,
} from "@/lib/placements";
import { hideSection, makeLiveOn, markOnFigma, markTakenDown, orderSections, addSectionSlot, removeSectionSlot } from "@/app/(app)/placements/actions";
import { HomepageMap, type LayoutEdit } from "./homepage-map";
import { AddSectionForm } from "./section-editor";
import { PlacementPanel, useArtworkUpload, type PanelMode } from "./placement-panel";
import { STATUS_CHIP } from "./styles";
import { BulkAdd, SchedulePlanner } from "./schedule";
import { GridView } from "./grid-view";

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
  design: "Only what needs a banner or a change. When it's on Figma, tap Uploaded on Figma and Tech takes it from there.",
  tech: "Banners Design has put on Figma, ready to go on the site, and what needs to come off it.",
};

export function PlacementsBoard({
  sections,
  placements,
  urls,
  roles,
  defaultRole,
  today,
  openId,
  startDate,
  canEditLayout = false,
  links = [],
}: {
  sections: Section[];
  placements: Placement[];
  urls: Record<string, string>;
  roles: PlacementRole[];
  defaultRole: PlacementRole;
  today: string;
  openId: string | null;
  /** Show the homepage on this day (yyyy-MM-dd) instead of today. */
  startDate?: string;
  /** Commercial and Admins can move, add and hide sections. */
  canEditLayout?: boolean;
  /** Projects, campaigns and partnerships a booking can be linked to. */
  links?: ProjectLink[];
}) {
  const router = useRouter();
  const wide = useWide();
  const [role, setRole] = useState<PlacementRole>(defaultRole);
  const [tab, setTab] = useState<"map" | "list" | "grid" | "schedule">("map");
  const [bulk, setBulk] = useState(false);
  // A given day, else the day a booking opened from a link starts (if it's still to come), else today.
  const [date, setDate] = useState(() => {
    if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) return startDate;
    const opened = openId ? placements.find((p) => p.id === openId) : undefined;
    return opened && opened.starts_on > today ? opened.starts_on : today;
  });
  const [mode, setMode] = useState<PanelMode | null>(() => (openId && placements.some((p) => p.id === openId) ? { kind: "view", id: openId } : null));
  const upload = useArtworkUpload();
  const [pending, start] = useTransition();
  // Edit layout: the order as moved here, saved as you go.
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const shownSections = editing && order ? order.map((k) => sections.find((s) => s.key === k)).filter((s): s is Section => !!s) : sections;
  const saveOrder = (keys: string[]) => {
    setOrder(keys);
    start(async () => {
      const res = await orderSections(keys);
      if (!res.ok) {
        toast.error(res.error);
        setOrder(sections.map((s) => s.key));
      }
      router.refresh();
    });
  };
  const layoutEdit: LayoutEdit | undefined = editing
    ? {
        busy: pending,
        onMove: (key, dir) => {
          const keys = shownSections.map((s) => s.key);
          const i = keys.indexOf(key);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= keys.length) return;
          [keys[i], keys[j]] = [keys[j], keys[i]];
          saveOrder(keys);
        },
        onDrop: (key, beforeKey) => {
          const keys = shownSections.map((s) => s.key).filter((k) => k !== key);
          const from = shownSections.findIndex((s) => s.key === key);
          const to = shownSections.findIndex((s) => s.key === beforeKey);
          // Dropped on a section below: it goes after it; above: before it.
          keys.splice(keys.indexOf(beforeKey) + (from < to ? 1 : 0), 0, key);
          saveOrder(keys);
        },
        onHide: (sec) => {
          const current = placements.filter((p) => p.section_key === sec.key).length;
          const warn = current
            ? ` It has ${current} booking${current === 1 ? "" : "s"} that ${current === 1 ? "isn't" : "aren't"} over yet: ${current === 1 ? "it stays" : "they stay"}, but won't show on this board (or for Tech) until the section is back. Take any live banner down first.`
            : " Its bookings and history stay.";
          if (!window.confirm(`Hide "${sec.name}" from the homepage?${warn} An Admin can bring it back from Admin > Placements.`)) return;
          start(async () => {
            const res = await hideSection(sec.key, true);
            if (!res.ok) return void toast.error(res.error);
            setOrder((o) => (o ?? shownSections.map((x) => x.key)).filter((k) => k !== sec.key));
            toast.success(`${sec.name} is hidden.`);
            router.refresh();
          });
        },
        onAdd: () => setAdding(true),
        onAddSlot: (sec) =>
          start(async () => {
            const res = await addSectionSlot(sec.key);
            if (!res.ok) return void toast.error(res.error);
            router.refresh();
          }),
        onRemoveSlot: (sec, n) => {
          if (!window.confirm(`Remove ${slotLabel(sec, n)} from ${sec.name}? The ones after it move up one, with their bookings.`)) return;
          start(async () => {
            const res = await removeSectionSlot(sec.key, n);
            if (!res.ok) return void toast.error(res.error);
            router.refresh();
          });
        },
      }
    : undefined;

  // Drop "?open=" from the address once it's been used.
  useEffect(() => {
    if (openId) router.replace("/placements?tab=web", { scroll: false });
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
      if (!p) {
        if (!s.optional) sum.empty++;
      }
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
      sections={shownSections}
      edit={layoutEdit}
      editToggle={
        canEditLayout ? (
          <button
            type="button"
            onClick={() => {
              setOrder(sections.map((x) => x.key));
              setEditing((e) => !e);
            }}
            aria-pressed={editing}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold",
              editing ? "bg-brand-primary text-white" : "text-brand-primary hover:bg-brand-bg",
            )}
          >
            {editing ? <Check className="h-4 w-4" /> : <LayoutList className="h-4 w-4" />}
            {editing ? "Done" : "Edit layout"}
          </button>
        ) : undefined
      }
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
                    <Button size="sm" className="flex-1" disabled={pending} onClick={() => act(() => markOnFigma(p.id), "Done. Tech has been told it's on Figma.")}>
                      <Check className="h-4 w-4" /> Uploaded on Figma
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
                  sub: `${slotName(sectionOf(p.section_key), p.position)} · ${surfacesText(p.shows_on)} · goes live ${relativeDay(p.starts_on, today)}`,
                  action: (
                    <>
                      {(p.shows_on.length ? p.shows_on : (["web"] as Surface[])).map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          className="flex-1"
                          variant={p.live_on.includes(s) ? "outline" : "default"}
                          disabled={pending || p.live_on.includes(s)}
                          onClick={() => act(() => makeLiveOn(p.id, s), `${p.brand} is live on the ${SURFACE_LABELS[s].toLowerCase()}.`)}
                        >
                          {p.live_on.includes(s) ? `Live on ${SURFACE_LABELS[s]} ✓` : `Make live on ${SURFACE_LABELS[s]}`}
                        </Button>
                      ))}
                    </>
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

      {/* Phones: one thing at a time. Desktop: the homepage with its list, or the month. */}
      <div className="flex gap-5 border-b border-line">
        {(["map", "list", "grid", "schedule"] as const).map((t) => {
          // On desktop the list sits beside the homepage, so "Homepage" covers both.
          const on = tab === t || (wide && t === "map" && tab === "list");
          return (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={on}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-1 text-[15px] font-semibold",
              t === "list" && "lg:hidden",
              on ? "border-brand-primary text-ink" : "border-transparent text-ink-muted",
            )}
          >
            {t === "map" ? "Homepage" : t === "list" ? QUEUE_TITLE[role] : t === "grid" ? "Grid" : "Schedule"}
            {t === "list" && queueCount > 0 && (
              <span className="rounded-full bg-brand-primary px-1.5 text-xs leading-5 text-white">{queueCount}</span>
            )}
          </button>
          );
        })}
      </div>

      {tab === "grid" ? (
        <div className="flex flex-col gap-4">
          {controls}
          <GridView sections={sections} placements={placements} urls={urls} date={date} today={today} onOpen={open} />
        </div>
      ) : tab === "schedule" ? (
        <SchedulePlanner
          sections={sections}
          placements={placements}
          today={today}
          canBook={canBook}
          onOpen={open}
          onBook={(s, n, from) => book(s, n, from)}
          onAddMany={() => setBulk(true)}
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)] lg:items-start">
          <div className={cn("flex min-w-0 flex-col gap-3", tab !== "map" && "max-lg:hidden")}>
            {controls}
            {map}
          </div>
          <div className={cn("flex min-w-0 flex-col gap-3", tab !== "list" && "max-lg:hidden")}>
            <h2 className="hidden items-center gap-2 text-lg font-semibold text-ink lg:flex">
              {QUEUE_TITLE[role]}
              {queueCount > 0 && <span className="rounded-full bg-brand-primary px-2 text-xs leading-5 text-white">{queueCount}</span>}
            </h2>
            {list}
          </div>
        </div>
      )}

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent
          side={wide ? "right" : "bottom"}
          className={cn("gap-0 overflow-y-auto bg-white p-0", wide ? "w-full sm:max-w-md" : "max-h-[92svh] rounded-t-[22px]")}
        >
          <SheetHeader className="px-5 pb-2 pt-5">
            <SheetDescription className="text-xs">Homepage layout</SheetDescription>
            <SheetTitle className="pr-8 text-xl text-ink">Add a section</SheetTitle>
          </SheetHeader>
          <div className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {adding && (
              <AddSectionForm
                onDone={(key) => {
                  setAdding(false);
                  if (key) {
                    setOrder((o) => [...(o ?? sections.map((x) => x.key)), key]);
                    router.refresh();
                  }
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={bulk} onOpenChange={setBulk}>
        <SheetContent
          side={wide ? "right" : "bottom"}
          className={cn("gap-0 overflow-y-auto bg-white p-0", wide ? "w-full sm:max-w-5xl" : "max-h-[92svh] rounded-t-[22px]")}
        >
          <SheetHeader className="px-5 pb-2 pt-5">
            <SheetDescription className="text-xs">Schedule</SheetDescription>
            <SheetTitle className="pr-8 text-xl text-ink">Add many bookings</SheetTitle>
          </SheetHeader>
          <div className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {bulk && <BulkAdd sections={sections} placements={placements} today={today} onDone={() => setBulk(false)} />}
          </div>
        </SheetContent>
      </Sheet>

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
                links={links}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
