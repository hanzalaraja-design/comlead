import "server-only";
import { formatDate, todayPKT } from "@/lib/time";
import { PLACEMENT_COLUMNS, SURFACE_LABELS, slotName, type Placement, type Section, type Surface } from "@/lib/placements";
import { CHANNEL_LABELS, CREATIVE_COLUMNS, type CreativeRequest } from "@/lib/creative";
import { notifyPersonLater, notifyTeamLater, placementsPath, placementsUrl, requestPath, requestUrl } from "@/lib/notify";
import type { KeyUser } from "@/lib/mcp/keys";
import { UserError, UUID, str, date, oneOf, findPerson, failed, idsOf, WRITE, type Args, type Tool } from "@/lib/mcp/helpers";

/**
 * Homepage bookings and design requests, the steps after booking: comments,
 * dates on many bookings, Design taking and completing requests, banners on
 * Figma and live. Nothing here deletes, cancels, ends early or takes down.
 * Every call runs as the person whose key it is, under the database's rules.
 */

type Db = { message?: string; code?: string } | null;

/** An id argument, with wording for what it is. */
function idOf(a: Args, k: string, what: string): string {
  const v = str(a, k, 60);
  if (!v || !UUID.test(v)) throw new UserError(`"${k}" should be a ${what} id (from ${what === "booking" ? "get_homepage" : "list_requests"}).`);
  return v;
}

/** Database refusals (RLS or the guard triggers) as a plain message. */
function refused(e: Db, denied: string, what: string): never {
  if (e?.code === "42501" || /row-level security|permission|only /i.test(e?.message ?? "")) throw new UserError(denied);
  failed(e, what);
}

async function loadBooking(u: KeyUser, bid: string): Promise<{ p: Placement; section: Section | null }> {
  const { data } = await u.db.from("placements").select(PLACEMENT_COLUMNS).eq("id", bid).maybeSingle();
  if (!data) throw new UserError("No booking with that id. Use get_homepage.");
  const p = data as unknown as Placement;
  const { data: s } = await u.db.from("placement_sections").select("*").eq("key", p.section_key).maybeSingle();
  return { p, section: (s as Section | null) ?? null };
}

const where = (b: { p: Placement; section: Section | null }) => (b.section ? slotName(b.section, b.p.position) : b.p.section_key);

async function loadRequest(u: KeyUser, rid: string): Promise<CreativeRequest> {
  const { data } = await u.db.from("creative_requests").select(CREATIVE_COLUMNS).eq("id", rid).maybeSingle();
  if (!data) throw new UserError("No design request with that id. Use list_requests.");
  return data as unknown as CreativeRequest;
}

const summary = (r: CreativeRequest) => [r.formats, r.needed_by && `needed ${formatDate(r.needed_by, "EEE d MMM")}`].filter(Boolean).join(" · ");

/** In the Design team (or an Admin), as the app's rules see it. */
async function inDesign(u: KeyUser): Promise<boolean> {
  const { data } = await u.db.rpc("in_placement_team", { p_role: "design" });
  if (data === true) return true;
  const { data: me } = await u.db.from("profiles").select("is_admin").eq("id", u.userId).maybeSingle();
  return !!me?.is_admin;
}

const NOT_DESIGN = "Only the Design team can do this. Ask someone in Design.";

export const HOMEPAGE_TOOLS: Tool[] = [
  {
    name: "comment_booking",
    description: "Comment on a homepage booking (from get_homepage). Whoever booked it and others on the thread are told.",
    inputSchema: { type: "object", properties: { booking_id: { type: "string" }, text: { type: "string" } }, required: ["booking_id", "text"] },
    annotations: WRITE,
    async run(u, a) {
      const bid = idOf(a, "booking_id", "booking");
      const text = str(a, "text", 5000);
      if (!text) throw new UserError("Write the comment in \"text\".");
      const b = await loadBooking(u, bid);
      // The author is the signed-in person; the database tells the people on the booking.
      const { error } = await u.db.from("placement_comments").insert({ placement_id: bid, body: text });
      if (error) refused(error, "You can't comment on that booking.", "comment on that booking");
      return `Comment added to ${b.p.brand} (${where(b)}). ${placementsUrl(bid)}`;
    },
  },
  {
    name: "change_booking_dates",
    description:
      "Change the start and/or end date on several homepage bookings at once (up to 50 ids from get_homepage). Only bookings you made (or any, if you're in Commercial). end_date null means ongoing. A booking that's already live can't start later or end sooner here; do that in the app.",
    inputSchema: {
      type: "object",
      properties: {
        booking_ids: { type: "array", items: { type: "string" } },
        start_date: { type: "string", description: "YYYY-MM-DD. Leave out to keep each one's start." },
        end_date: { type: ["string", "null"], description: "YYYY-MM-DD, or null for ongoing. Leave out to keep each one's end." },
      },
      required: ["booking_ids"],
    },
    annotations: WRITE,
    async run(u, a) {
      const ids = [...new Set(idsOf(a, "booking_ids"))];
      if (!ids.length) throw new UserError("Give at least one booking id.");
      const start = date(a, "start_date") ?? undefined;
      const end = date(a, "end_date");
      if (start === undefined && end === undefined) throw new UserError("Give start_date, end_date or both.");
      if (start && end && end < start) throw new UserError("The end date has to be on or after the start date.");
      const today = todayPKT();
      const out: string[] = [];
      let changed = 0;
      for (const bid of ids) {
        const { data } = await u.db.from("placements").select("id, brand, stage, starts_on, ends_on").eq("id", bid).maybeSingle();
        if (!data) {
          out.push(`- ${bid}: not found`);
          continue;
        }
        const p = data as { id: string; brand: string; stage: string; starts_on: string; ends_on: string | null };
        const starts = start ?? p.starts_on;
        const ends = end === undefined ? p.ends_on : end;
        if (p.stage === "ended") {
          out.push(`- ${p.brand}: skipped, it has already ended`);
          continue;
        }
        if (ends && ends < starts) {
          out.push(`- ${p.brand}: skipped, the end would be before the start`);
          continue;
        }
        if (p.stage === "live") {
          const shorter = ends !== null && (p.ends_on === null || ends < p.ends_on);
          if (shorter || starts > today) {
            out.push(`- ${p.brand}: skipped, it's live, so it can't start later or end sooner from here`);
            continue;
          }
        }
        if (starts === p.starts_on && ends === p.ends_on) {
          out.push(`- ${p.brand}: already on those dates`);
          continue;
        }
        const { data: upd, error } = await u.db.from("placements").update({ starts_on: starts, ends_on: ends }).eq("id", bid).select("id");
        if (error) {
          out.push(`- ${p.brand}: ${error.code === "42501" ? "only whoever booked it (or Commercial) can change it" : error.message}`);
          continue;
        }
        if (!upd?.length) {
          out.push(`- ${p.brand}: only whoever booked it (or Commercial) can change it`);
          continue;
        }
        changed++;
        out.push(`- ${p.brand}: now ${formatDate(starts, "d MMM")}${ends ? ` to ${formatDate(ends, "d MMM")}` : " onwards"}`);
      }
      return `Changed ${changed} of ${ids.length} booking${ids.length === 1 ? "" : "s"}.\n${out.join("\n")}\n${placementsUrl()}`;
    },
  },
  {
    name: "take_request",
    description:
      "Design team only: take a design request yourself, or give it to a designer (name or email). It moves to In design. The designer is told if it isn't you.",
    inputSchema: {
      type: "object",
      properties: { request_id: { type: "string" }, designer: { type: "string", description: "Name or email. Default you." } },
      required: ["request_id"],
    },
    annotations: WRITE,
    async run(u, a) {
      const rid = idOf(a, "request_id", "request");
      const r = await loadRequest(u, rid);
      if (!(await inDesign(u))) throw new UserError(NOT_DESIGN);
      if (r.status !== "requested" && r.status !== "in_design") throw new UserError("It can only be taken while it's requested or in design.");
      const who = await findPerson(u, str(a, "designer") ?? "me");
      const { data, error } = await u.db
        .from("creative_requests")
        .update({ designer_id: who.id, status: "in_design" })
        .eq("id", rid)
        .in("status", ["requested", "in_design"])
        .select("id");
      if (error) refused(error, NOT_DESIGN, "take that request");
      if (!data?.length) throw new UserError(NOT_DESIGN);
      if (who.id !== u.userId)
        notifyPersonLater(who.id, "design_new", {
          title: `${u.name} gave you ${r.title} (${CHANNEL_LABELS[r.channel]}, via Claude)`,
          body: summary(r),
          href: requestPath(r.channel, rid),
          actorId: u.userId,
        });
      return `${who.id === u.userId ? "You're on" : `${who.label} is on`} ${r.title}. It's in design now.${who.id !== u.userId ? " They've been told." : ""} ${requestUrl(r.channel, rid)}`;
    },
  },
  {
    name: "complete_request",
    description:
      "Design team only: mark a design request complete, whether or not it went through review (for example, the files were sent another way). Whoever asked is told.",
    inputSchema: { type: "object", properties: { request_id: { type: "string" } }, required: ["request_id"] },
    annotations: WRITE,
    async run(u, a) {
      const rid = idOf(a, "request_id", "request");
      const r = await loadRequest(u, rid);
      if (!(await inDesign(u))) throw new UserError(NOT_DESIGN);
      if (!["requested", "in_design", "in_review", "approved"].includes(r.status)) throw new UserError(`It's already ${r.status === "done" ? "complete" : r.status === "live" ? "live" : "cancelled"}.`);
      const { data, error } = await u.db
        .from("creative_requests")
        .update({ status: "done", designer_id: r.designer_id ?? u.userId })
        .eq("id", rid)
        .in("status", ["requested", "in_design", "in_review", "approved"])
        .select("id");
      if (error) refused(error, NOT_DESIGN, "mark it complete");
      if (!data?.length) throw new UserError(NOT_DESIGN);
      if (r.requested_by !== u.userId)
        notifyPersonLater(r.requested_by, "my_requests", {
          title: `${u.name} completed ${r.title}`,
          body: r.art_paths.length ? "The files are on the request." : null,
          href: requestPath(r.channel, rid),
          actorId: u.userId,
        });
      return `Marked ${r.title} complete.${r.requested_by !== u.userId ? " Whoever asked has been told." : ""} ${requestUrl(r.channel, rid)}`;
    },
  },
  {
    name: "mark_on_figma",
    description:
      "Design team only: the banner for a homepage booking is on Figma (new, or updated after a change). Tech is told to put it live.",
    inputSchema: { type: "object", properties: { booking_id: { type: "string" } }, required: ["booking_id"] },
    annotations: WRITE,
    async run(u, a) {
      const bid = idOf(a, "booking_id", "booking");
      const b = await loadBooking(u, bid);
      if (b.p.stage === "ended") throw new UserError("That booking has ended.");
      if (b.p.stage === "ready" && !b.p.changed_from) throw new UserError("It's already on Figma, waiting for Tech.");
      const denied = "Only the Design team can mark a banner as on Figma.";
      const { data, error } = await u.db.from("placements").update({ stage: "ready", changed_from: null }).eq("id", bid).select("id");
      if (error) refused(error, denied, "mark it on Figma");
      if (!data?.length) throw new UserError(denied);
      const update = b.p.stage === "live";
      notifyTeamLater("tech", "design_new", {
        title: `${update ? "Updated banner" : "Banner"} on Figma: ${b.p.brand}, ${where(b)}. Put it live`,
        href: placementsPath(bid),
        actorId: u.userId,
      });
      return `${b.p.brand} (${where(b)}) is on Figma. Tech has been told. ${placementsUrl(bid)}`;
    },
  },
  {
    name: "make_live",
    description:
      "Tech team only: a homepage banner that's on Figma is now live on the website, the app, or both. Leave out \"on\" for everywhere it shows. Once it's live everywhere it shows, the booking is Live.",
    inputSchema: {
      type: "object",
      properties: { booking_id: { type: "string" }, on: { type: "string", enum: ["website", "app", "both"], description: "Default everywhere it shows." } },
      required: ["booking_id"],
    },
    annotations: WRITE,
    async run(u, a) {
      const bid = idOf(a, "booking_id", "booking");
      const on = oneOf(a, "on", ["website", "app", "both"]);
      const b = await loadBooking(u, bid);
      if (b.p.stage === "live") throw new UserError("It's already live.");
      if (b.p.stage !== "ready") throw new UserError("It needs its banner on Figma before it can go live.");
      const shows: Surface[] = b.p.shows_on?.length ? b.p.shows_on : ["web"];
      const surfaces: Surface[] = on === undefined ? shows : on === "both" ? ["web", "app"] : on === "app" ? ["app"] : ["web"];
      const live_on = [...new Set([...(b.p.live_on ?? []), ...surfaces])];
      const denied = "Only the Tech team can put a banner live.";
      const { data, error } = await u.db.from("placements").update({ live_on }).eq("id", bid).eq("stage", "ready").select("stage, live_on");
      if (error) refused(error, denied, "put it live");
      if (!data?.length) throw new UserError(denied);
      const now = data[0] as { stage: string; live_on: Surface[] };
      const text = surfaces.map((s) => SURFACE_LABELS[s]).join(" and ");
      return now.stage === "live"
        ? `${b.p.brand} (${where(b)}) is live. ${placementsUrl(bid)}`
        : `${b.p.brand} (${where(b)}) is live on the ${text.toLowerCase()}. Still to go live: ${shows.filter((s) => !now.live_on.includes(s)).map((s) => SURFACE_LABELS[s].toLowerCase()).join(" and ")}. ${placementsUrl(bid)}`;
    },
  },
];
