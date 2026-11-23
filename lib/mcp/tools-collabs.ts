import "server-only";
import { siteUrl } from "@/lib/calendar/sync";
import { personName } from "@/lib/labels";
import { formatDate } from "@/lib/time";
import { BUDGETS, GOALS, STATUS_LABELS, money, priceText, totalText, type CollabItem, type CollabRate, type CollabRequest, type CollabStatus, type CollabWant } from "@/lib/collabs";
import { str, date, oneOf, findPerson, findProject, failed, listOf, READ, WRITE, UserError, UUID, type Tool, type Args } from "@/lib/mcp/helpers";
import type { KeyUser } from "@/lib/mcp/keys";

/**
 * Paid social (content collabs): Commercial asks Content for content pieces,
 * Content sends a plan from the media kit, Commercial approves or asks for
 * changes, Content marks pieces live and shares the report. Each step is a
 * database function that checks who may do it and sends the notifications,
 * exactly as the app's own actions do. Nothing here deletes or touches rates.
 */

const STATUSES = Object.keys(STATUS_LABELS) as CollabStatus[];
const collabUrl = (rid: string) => `${siteUrl()}/collabs/${rid}`;

function uid(a: Args, k: string, what: string): string {
  const v = str(a, k, 60);
  if (!v || !UUID.test(v)) throw new UserError(`"${k}" should be a ${what} id (from list_collabs or get_collab).`);
  return v;
}

type Person = { id: string; email: string; full_name: string | null };

async function names(u: KeyUser, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const { data } = await u.db.from("profiles").select("id, email, full_name").in("id", want);
  return new Map(((data ?? []) as Person[]).map((p) => [p.id, personName(p)]));
}

async function rates(u: KeyUser): Promise<CollabRate[]> {
  const { data } = await u.db.from("collab_rates").select("*").eq("archived", false).order("sort");
  return (data ?? []) as CollabRate[];
}

function findRate(all: CollabRate[], name: string): CollabRate {
  const q = name.trim().toLowerCase();
  const exact = all.filter((r) => r.name.toLowerCase() === q);
  const loose = exact.length ? exact : all.filter((r) => r.name.toLowerCase().includes(q));
  if (loose.length === 1) return loose[0];
  const kit = all.map((r) => r.name).join(", ");
  if (!loose.length) throw new UserError(`"${name}" isn't in the media kit. Pieces: ${kit}.`);
  throw new UserError(`"${name}" matches several pieces: ${loose.map((r) => r.name).join(", ")}. Use the full name.`);
}

function qtyOf(a: Args): number {
  const v = a.qty === undefined || a.qty === null ? 1 : a.qty;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 50) throw new UserError(`"qty" should be a whole number from 1 to 50.`);
  return v;
}

async function getRequest(u: KeyUser, rid: string): Promise<CollabRequest> {
  const { data, error } = await u.db.from("collab_requests").select("*").eq("id", rid).maybeSingle();
  if (error) failed(error, "read that request");
  if (!data) throw new UserError("No content request with that id that you can see. Use list_collabs.");
  return data as CollabRequest;
}

async function getItems(u: KeyUser, rid: string): Promise<CollabItem[]> {
  const { data } = await u.db.from("collab_items").select("*").eq("request_id", rid).order("sort");
  return (data ?? []) as CollabItem[];
}

const statusText = (s: string) => STATUS_LABELS[s as CollabStatus] ?? s;

function goalsOf(a: Args): string[] | undefined {
  const v = a.goals;
  if (v === undefined || v === null) return undefined;
  const list = typeof v === "string" ? [v] : v;
  if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) throw new UserError(`"goals" should be a list.`);
  const out: string[] = [];
  for (const g of list as string[]) {
    const hit = GOALS.find((x) => x.toLowerCase() === g.trim().toLowerCase());
    if (!hit) throw new UserError(`"${g}" isn't a goal. Goals: ${GOALS.join(", ")}.`);
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

export const COLLAB_TOOLS: Tool[] = [
  {
    name: "list_collabs",
    description:
      "Paid social content requests (Commercial asks the Content team for content for a brand): brand, what to promote, go-live date, status and plan total. Only Commercial, Content, the teams picked to ask and Admins can see them.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "all", ...STATUSES], description: "Default open (everything but reported)." },
        brand: { type: "string", description: "Only requests for this brand." },
        mine: { type: "boolean", description: "Only ones you asked for." },
      },
    },
    annotations: READ,
    async run(u, a) {
      const status = oneOf(a, "status", ["open", "all", ...STATUSES]) ?? "open";
      let q = u.db.from("collab_requests").select("*").order("go_live").limit(100);
      if (status === "open") q = q.neq("status", "reported");
      else if (status !== "all") q = q.eq("status", status);
      const brand = str(a, "brand", 120);
      if (brand) q = q.ilike("brand", `%${brand.replace(/[%_]/g, "")}%`);
      if (a.mine === true) q = q.eq("requested_by", u.userId);
      const { data, error } = await q;
      if (error) failed(error, "read content requests");
      const rows = (data ?? []) as CollabRequest[];
      if (!rows.length) return "No content requests match. (Only Commercial, Content, the teams picked to ask and Admins can see them.)";
      const who = await names(u, rows.map((r) => r.requested_by));
      return rows
        .map(
          (r) =>
            `- ${r.brand}: ${r.promote} (${statusText(r.status)} · live by ${formatDate(r.go_live, "EEE d MMM yyyy")} · asked by ${who.get(r.requested_by) ?? "someone"}${r.total ? ` · plan ${totalText(r)}` : ""})\n  id: ${r.id} · ${collabUrl(r.id)}`,
        )
        .join("\n");
    },
  },
  {
    name: "get_collab",
    description: "One content request in full: the brief, what was picked from the media kit, the plan pieces (with piece ids, who, when, live links and numbers), notes, the report and the comments.",
    inputSchema: { type: "object", properties: { collab_id: { type: "string" } }, required: ["collab_id"] },
    annotations: READ,
    async run(u, a) {
      const rid = uid(a, "collab_id", "request");
      const r = await getRequest(u, rid);
      const [items, { data: c }] = await Promise.all([
        getItems(u, rid),
        u.db.from("collab_comments").select("id, author_id, body, image_paths, created_at").eq("request_id", rid).order("created_at"),
      ]);
      const comments = (c ?? []) as { id: string; author_id: string; body: string; image_paths: string[]; created_at: string }[];
      const who = await names(u, [r.requested_by, r.planned_by, r.approved_by, ...items.map((i) => i.owner_id), ...comments.map((x) => x.author_id)]);
      const campaign = r.project_id ? (await u.db.from("projects").select("name").eq("id", r.project_id).maybeSingle()).data : null;
      const wants = (r.wants ?? []) as CollabWant[];
      const out = [
        `${r.brand}: ${r.promote}`,
        `Status: ${statusText(r.status)} · ${collabUrl(r.id)}`,
        `Asked by ${who.get(r.requested_by) ?? "someone"} on ${formatDate(r.created_at.slice(0, 10), "d MMM yyyy")}`,
        `Goals: ${r.goals.join(", ")}`,
        `Live by: ${formatDate(r.go_live, "EEE d MMM yyyy")}`,
        `Budget: ${r.budget}`,
        `Audience: ${r.audience}`,
        `Key message: ${r.key_message}`,
        r.link ? `Link: ${r.link}` : null,
        r.refs ? `References: ${r.refs}` : null,
        campaign ? `Campaign: ${campaign.name}` : null,
        r.notes ? `Notes: ${r.notes}` : null,
        wants.length ? `Picked from the media kit: ${wants.map((w) => `${w.name} ×${w.qty}`).join(", ")}` : null,
        r.wants_other ? `Also wanted: ${r.wants_other}` : null,
      ];
      if (items.length) {
        out.push("", `Plan${r.planned_by ? ` from ${who.get(r.planned_by) ?? "Content"}` : ""}: ${totalText(r)}${r.approved_by ? ` · approved by ${who.get(r.approved_by) ?? "Commercial"}` : ""}`);
        if (r.plan_note) out.push(`Plan note: ${r.plan_note}`);
        for (const i of items) {
          const bits = [
            `Rs ${priceText(i.unit_price * i.qty, i.unit_price_max ? i.unit_price_max * i.qty : null)}`,
            i.is_addon ? "add-on" : i.owner_id ? who.get(i.owner_id) ?? null : null,
            i.due_date ? `due ${formatDate(i.due_date, "d MMM")}` : null,
            i.live_url ? `live: ${i.live_url}` : i.is_addon ? null : "not live yet",
            i.reach !== null ? `reach ${money(i.reach)}` : null,
            i.views !== null ? `views ${money(i.views)}` : null,
          ].filter(Boolean);
          out.push(`- ${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}${i.idea ? `: ${i.idea}` : ""} (${bits.join(" · ")})\n  piece id: ${i.id}${i.task_id ? ` · task ${siteUrl()}/tasks/${i.task_id}` : ""}`);
        }
      } else out.push("", "No plan yet.");
      if (r.change_note && r.status === "changes") out.push(`Changes asked: ${r.change_note}`);
      if (r.report_summary) out.push("", `Report: ${r.report_summary}${r.report_images?.length ? ` (${r.report_images.length} image${r.report_images.length === 1 ? "" : "s"} in the app)` : ""}`);
      if (comments.length) {
        out.push("", "Comments:");
        for (const x of comments)
          out.push(`- ${who.get(x.author_id) ?? "Someone"}, ${formatDate(x.created_at.slice(0, 10), "d MMM")}: ${x.body || "(image)"}${x.body && x.image_paths?.length ? " (with images)" : ""}`);
      }
      return out.filter((x) => x !== null).join("\n");
    },
  },
  {
    name: "save_collab_request",
    description:
      `Ask the Content team for content (Commercial and the teams picked to ask), or edit your request before the plan is sent. Content is told about a new request. For a new one give brand, promote, goals, go_live, budget, audience and key_message. To edit, give collab_id and only what changes. Goals: ${GOALS.join(", ")}. Budget is one of ${BUDGETS.join(", ")}, or a range in rupees. "wants" are pieces from the media kit (by name, e.g. "Static post", "Micro influencer reel").`,
    inputSchema: {
      type: "object",
      properties: {
        collab_id: { type: "string", description: "Only to edit an existing request." },
        brand: { type: "string" },
        promote: { type: "string", description: "The product, launch or offer." },
        goals: { type: "array", items: { type: "string", enum: [...GOALS] } },
        go_live: { type: "string", description: "YYYY-MM-DD." },
        budget: { type: "string" },
        audience: { type: "string" },
        key_message: { type: "string" },
        link: { type: "string", description: "Instagram or website." },
        references: { type: "string", description: "Creative references." },
        campaign: { type: "string", description: "Campaign name, optional." },
        notes: { type: "string" },
        wants: {
          type: "array",
          items: { type: "object", properties: { rate: { type: "string", description: "Piece name from the media kit." }, qty: { type: "number" } }, required: ["rate"] },
          description: "Replaces what was picked before.",
        },
        wants_other: { type: "string", description: "Anything else they'd like." },
      },
    },
    annotations: WRITE,
    async run(u, a) {
      const rid = a.collab_id ? uid(a, "collab_id", "request") : null;
      const cur = rid ? await getRequest(u, rid) : null;
      if (cur && !["requested", "changes"].includes(cur.status)) throw new UserError("The plan has been sent, so the brief can't change now. Add a comment instead.");
      const pick = (k: string, max: number, key: keyof CollabRequest = k as keyof CollabRequest): string => {
        const v = str(a, k, max);
        return v ?? ((cur?.[key] as string | null | undefined) ?? "");
      };
      let projectId = cur?.project_id ?? "";
      const campaign = str(a, "campaign", 200);
      if (campaign) {
        const p = await findProject(u, campaign);
        if (p.kind !== "campaign") throw new UserError(`"${p.name}" isn't a campaign.`);
        projectId = p.id;
      }
      let wants: CollabWant[] = (cur?.wants ?? []) as CollabWant[];
      if (a.wants !== undefined) {
        const kit = await rates(u);
        wants = [];
        for (const w of listOf(a, "wants", 30)) {
          const rate = findRate(kit, str(w, "rate", 120) ?? "");
          const qty = qtyOf(w);
          const same = wants.find((x) => x.rate_id === rate.id);
          if (same) same.qty = Math.min(50, same.qty + qty);
          else wants.push({ rate_id: rate.id, name: rate.name, qty });
        }
      }
      const p = {
        brand: pick("brand", 120),
        promote: pick("promote", 500),
        goals: goalsOf(a) ?? cur?.goals ?? [],
        go_live: date(a, "go_live") ?? cur?.go_live ?? "",
        budget: pick("budget", 80),
        audience: pick("audience", 300),
        key_message: pick("key_message", 300),
        link: pick("link", 500),
        refs: pick("references", 2000, "refs"),
        project_id: projectId,
        notes: pick("notes", 2000),
        wants,
        wants_other: pick("wants_other", 1000),
      };
      const missing: string[] = (["brand", "promote", "go_live", "budget", "audience", "key_message"] as const).filter((k) => !p[k]);
      if (!p.goals.length) missing.push("goals");
      if (missing.length) throw new UserError(`Give ${missing.join(", ")}.`);
      const { data, error } = await u.db.rpc("collab_save_request", { p_id: rid, p });
      if (error || !data) failed(error, rid ? "change that request" : "send the request");
      const newId = data as string;
      return rid
        ? `Updated the request for ${p.brand}. ${collabUrl(newId)}`
        : `Asked the Content team for content for ${p.brand}, live by ${formatDate(p.go_live, "EEE d MMM")}. Content has been told.\nid: ${newId} · ${collabUrl(newId)}`;
    },
  },
  {
    name: "send_collab_plan",
    description:
      "Content team: send (or re-send) the plan for a content request, priced from the media kit. Each piece: rate (media kit name), qty, idea, owner (name or email, default whoever sends the plan) and due_date (default the go-live date). Re-sending replaces the earlier plan; it can't change once approved. Whoever asked is told.",
    inputSchema: {
      type: "object",
      properties: {
        collab_id: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { rate: { type: "string" }, qty: { type: "number" }, idea: { type: "string" }, owner: { type: "string" }, due_date: { type: "string" } },
            required: ["rate"],
          },
        },
        note: { type: "string", description: "A note on the plan for Commercial." },
      },
      required: ["collab_id", "items"],
    },
    annotations: WRITE,
    async run(u, a) {
      const rid = uid(a, "collab_id", "request");
      const r = await getRequest(u, rid);
      const rows = listOf(a, "items", 30);
      if (!rows.length) throw new UserError("Add at least one piece.");
      const kit = await rates(u);
      const items: { rate_id: string; qty: number; idea: string; owner_id: string; due_date: string }[] = [];
      let total = 0;
      for (const it of rows) {
        const rate = findRate(kit, str(it, "rate", 120) ?? "");
        const qty = qtyOf(it);
        const owner = str(it, "owner") ? (await findPerson(u, str(it, "owner")!)).id : "";
        items.push({ rate_id: rate.id, qty, idea: str(it, "idea", 500) ?? "", owner_id: owner, due_date: date(it, "due_date") ?? "" });
        total += rate.price * qty;
      }
      const { error } = await u.db.rpc("collab_send_plan", { p_id: rid, p_items: items, p_note: (str(a, "note", 1000) ?? "").slice(0, 1000) });
      if (error) failed(error, "send the plan");
      return `Sent the plan for ${r.brand}: ${items.length} piece${items.length === 1 ? "" : "s"}, from Rs ${money(total)}. Whoever asked has been told. ${collabUrl(rid)}`;
    },
  },
  {
    name: "ask_collab_changes",
    description: "Commercial (or a team picked to ask): ask the Content team to change the plan they sent, saying what should change. Whoever planned it is told.",
    inputSchema: { type: "object", properties: { collab_id: { type: "string" }, note: { type: "string", description: "What should change." } }, required: ["collab_id", "note"] },
    annotations: WRITE,
    async run(u, a) {
      const rid = uid(a, "collab_id", "request");
      const note = str(a, "note", 1000);
      if (!note) throw new UserError("Say what should change.");
      const r = await getRequest(u, rid);
      const { error } = await u.db.rpc("collab_ask_changes", { p_id: rid, p_note: note });
      if (error) failed(error, "ask for changes");
      return `Asked for changes to the plan for ${r.brand}. Content has been told. ${collabUrl(rid)}`;
    },
  },
  {
    name: "approve_collab_plan",
    description: "Commercial (or a team picked to ask): approve the plan Content sent. Each piece becomes a task for whoever does it, in the Content team, and Content is told.",
    inputSchema: { type: "object", properties: { collab_id: { type: "string" } }, required: ["collab_id"] },
    annotations: WRITE,
    async run(u, a) {
      const rid = uid(a, "collab_id", "request");
      const r = await getRequest(u, rid);
      const { error } = await u.db.rpc("collab_approve", { p_id: rid });
      if (error) failed(error, "approve the plan");
      return `Approved the plan for ${r.brand} (${totalText(r)}). The pieces are now tasks and Content has been told. ${collabUrl(rid)}`;
    },
  },
  {
    name: "mark_collab_live",
    description: "Content team (or whoever does the piece): mark a piece of an approved plan live with the link to the post. Its task is done and whoever asked is told. Get the piece id from get_collab.",
    inputSchema: { type: "object", properties: { piece_id: { type: "string" }, url: { type: "string", description: "Link to the live post (https://...)." } }, required: ["piece_id", "url"] },
    annotations: WRITE,
    async run(u, a) {
      const pid = uid(a, "piece_id", "piece");
      const url = str(a, "url", 1000);
      if (!url || !/^https?:\/\//i.test(url)) throw new UserError("Give the link to the live post, starting with https://.");
      const { data: it } = await u.db.from("collab_items").select("id, request_id, name").eq("id", pid).maybeSingle();
      if (!it) throw new UserError("No piece with that id. Use get_collab.");
      const { error } = await u.db.rpc("collab_mark_live", { p_item: pid, p_url: url });
      if (error) failed(error, "mark it live");
      const rest = (await getItems(u, it.request_id as string)).filter((x) => !x.is_addon && !x.live_url).length;
      return `Marked ${it.name} live. ${rest ? `${rest} piece${rest === 1 ? "" : "s"} still to go live.` : "Every piece is live, so the report is due."} ${collabUrl(it.request_id as string)}`;
    },
  },
  {
    name: "share_collab_report",
    description:
      "Content team: once every piece is live, share the report: a short summary and reach and views for each piece (piece ids from get_collab). Whoever asked is told. Screenshots can only be added in the app; any already there are kept.",
    inputSchema: {
      type: "object",
      properties: {
        collab_id: { type: "string" },
        summary: { type: "string" },
        pieces: {
          type: "array",
          items: { type: "object", properties: { piece_id: { type: "string" }, reach: { type: "number" }, views: { type: "number" } }, required: ["piece_id"] },
        },
      },
      required: ["collab_id", "summary"],
    },
    annotations: WRITE,
    async run(u, a) {
      const rid = uid(a, "collab_id", "request");
      const summary = str(a, "summary", 3000);
      if (!summary) throw new UserError("Write a short summary.");
      const r = await getRequest(u, rid);
      const items = await getItems(u, rid);
      const byId = new Map(items.map((i) => [i.id, i]));
      const count = (v: unknown, k: string): string | undefined => {
        if (v === undefined || v === null || v === "") return undefined;
        const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d]/g, ""));
        if (!Number.isFinite(n) || n < 0 || n > 2_000_000_000) throw new UserError(`"${k}" should be a number.`);
        return String(Math.round(n));
      };
      const numbers = listOf(a, "pieces", 50).map((p) => {
        const pid = uid(p, "piece_id", "piece");
        const it = byId.get(pid);
        if (!it) throw new UserError(`Piece ${pid} isn't part of this request. Use get_collab.`);
        // Keep what's already there for anything not given.
        return {
          id: pid,
          reach: count(p.reach, "reach") ?? (it.reach !== null ? String(it.reach) : ""),
          views: count(p.views, "views") ?? (it.views !== null ? String(it.views) : ""),
        };
      });
      const { error } = await u.db.rpc("collab_report", { p_id: rid, p_summary: summary, p_images: r.report_images ?? [], p_numbers: numbers });
      if (error) failed(error, "share the report");
      return `Shared the report for ${r.brand}. Whoever asked has been told. ${collabUrl(rid)}`;
    },
  },
  {
    name: "comment_collab",
    description: "Add a comment to a content request, for example to agree something outside the brief.",
    inputSchema: { type: "object", properties: { collab_id: { type: "string" }, text: { type: "string" } }, required: ["collab_id", "text"] },
    annotations: WRITE,
    async run(u, a) {
      const rid = uid(a, "collab_id", "request");
      const text = str(a, "text", 10000);
      if (!text) throw new UserError("Write a comment first.");
      const r = await getRequest(u, rid);
      const { error } = await u.db.from("collab_comments").insert({ request_id: rid, author_id: u.userId, body: text, image_paths: [] });
      if (error) failed(error, "comment on that request");
      return `Commented on the request for ${r.brand}. ${collabUrl(rid)}`;
    },
  },
];
