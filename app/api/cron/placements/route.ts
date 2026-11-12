import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify, placementsPath, teamMembers } from "@/lib/notify";
import { flushPush } from "@/lib/push";
import { ENDING_DAYS, PLACEMENT_COLUMNS, nextAfter, relativeDay, slotName, toPutLive, toTakeDown, type Placement, type Section } from "@/lib/placements";
import { addDaysISO, todayPKT } from "@/lib/time";
import { CHANNEL_LABELS, CREATIVE_COLUMNS, designGroups, type CreativeRequest } from "@/lib/creative";
import { personName } from "@/lib/labels";

// Morning notifications (see vercel.json): Commercial (and whoever booked) hear about bookings ending
// in 3 days and today with nothing after them; Tech about banners to put up
// or take down today; the Design team about what's late, due or sent back. Vercel sends "Authorization: Bearer $CRON_SECRET".
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const [{ data: sectionData }, { data: placementData }] = await Promise.all([
    db.from("placement_sections").select("*"),
    db.from("placements").select(PLACEMENT_COLUMNS).neq("stage", "ended"),
  ]);
  const sections = (sectionData ?? []) as Section[];
  const all = (placementData ?? []) as unknown as Placement[];
  const today = todayPKT();
  const where = (p: Placement) => {
    const s = sections.find((x) => x.key === p.section_key);
    return s ? slotName(s, p.position) : p.section_key;
  };
  const list = (items: Placement[], line: (p: Placement) => string) => {
    const parts = items.map((p) => `${p.brand}, ${where(p)}: ${line(p)}`);
    return parts.slice(0, 4).join("; ") + (parts.length > 4 ? ` and ${parts.length - 4} more` : "");
  };
  const sent: Record<string, number> = {};

  const ending = all.filter(
    (p) => p.stage === "live" && (p.ends_on === today || p.ends_on === addDaysISO(today, ENDING_DAYS)) && !nextAfter(all, p),
  );
  if (ending.length) {
    // Commercial, and whoever booked each one.
    const bookers = ending.map((p) => p.created_by);
    await notify([...(await teamMembers("commercial")), ...bookers], "ending", {
      title: `${ending.length} placement${ending.length === 1 ? "" : "s"} ending soon, nothing booked after`,
      body: list(ending, (p) => `ends ${relativeDay(p.ends_on!, today)}`),
      href: placementsPath(),
    });
    sent.commercial = ending.length;
  }

  const goLive = toPutLive(all).filter((p) => p.starts_on <= today);
  const takeDown = toTakeDown(all, today);
  if (goLive.length || takeDown.length) {
    await notify(await teamMembers("tech"), "homepage_today", {
      title: `Homepage today: ${goLive.length} to put live, ${takeDown.length} to take down`,
      body: [goLive.length && `Put live: ${list(goLive, (p) => `from ${relativeDay(p.starts_on, today)}`)}`, takeDown.length && `Take down: ${list(takeDown, (p) => `ended ${relativeDay(p.ends_on!, today)}`)}`]
        .filter(Boolean)
        .join(" · "),
      href: placementsPath(),
    });
    sent.tech = goLive.length + takeDown.length;
  }

  // The Design team: what's late or due today, and what was sent back (whoever is on it).
  const { data: requestData } = await db
    .from("creative_requests")
    .select(CREATIVE_COLUMNS)
    .in("status", ["requested", "in_design"])
    .then((r) => (r.error ? { data: [] } : r));
  const g = designGroups((requestData ?? []) as unknown as CreativeRequest[], today);
  if (g.due.length || g.changes.length) {
    const { data: people } = await db.from("profiles").select("id, full_name, email");
    const name = (id: string | null) => {
      const p = (people ?? []).find((x) => x.id === id);
      return p ? personName(p as { full_name: string | null; email: string }) : "nobody on it yet";
    };
    const line = (r: CreativeRequest) =>
      `${r.title} (${CHANNEL_LABELS[r.channel]}, ${name(r.designer_id)})${r.change_note ? `: revision asked` : r.needed_by ? `: due ${relativeDay(r.needed_by, today)}` : ""}`;
    const items = [...g.changes, ...g.due].map(line);
    await notify(await teamMembers("design"), "design_new", {
      title: `Design today: ${g.due.length + g.changes.length} to do`,
      body: items.slice(0, 4).join("; ") + (items.length > 4 ? ` and ${items.length - 4} more` : ""),
      href: "/placements?tab=design",
    });
    sent.design = g.due.length + g.changes.length;
  }

  await flushPush();
  return NextResponse.json({ ok: true, sent });
}
