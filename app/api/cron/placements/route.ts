import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailHtml, escapeHtml, isEmailConfigured, placementsUrl, sendEmail, teamEmails } from "@/lib/notify";
import { ENDING_DAYS, PLACEMENT_COLUMNS, nextAfter, relativeDay, slotName, toPutLive, toTakeDown, type Placement, type Section } from "@/lib/placements";
import { addDaysISO, todayPKT } from "@/lib/time";
import { siteUrl } from "@/lib/calendar/sync";
import { CHANNEL_LABELS, CREATIVE_COLUMNS, designGroups, type CreativeRequest } from "@/lib/creative";
import { personName } from "@/lib/labels";

// Morning reminders (see vercel.json): Commercial (and whoever booked) hear about bookings ending
// in 3 days and today with nothing after them; Tech about banners to put up
// or take down today; the Design team about what's late, due or sent back. Vercel sends "Authorization: Bearer $CRON_SECRET".
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isEmailConfigured()) return NextResponse.json({ skipped: "email not configured" });

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
  const list = (items: Placement[], line: (p: Placement) => string) =>
    `<ul>${items.map((p) => `<li><b>${escapeHtml(p.brand)}</b>, ${escapeHtml(where(p))}: ${escapeHtml(line(p))}</li>`).join("")}</ul>`;
  const sent: Record<string, number> = {};

  const ending = all.filter(
    (p) => p.stage === "live" && (p.ends_on === today || p.ends_on === addDaysISO(today, ENDING_DAYS)) && !nextAfter(all, p),
  );
  if (ending.length) {
    const html = emailHtml({ intro: "These bookings end soon and nothing is booked after them:", link: placementsUrl(), linkLabel: "Book the next brands" }).replace(
      "</p>",
      `</p>${list(ending, (p) => `ends ${relativeDay(p.ends_on!, today)}`)}`,
    );
    // Commercial, and whoever booked each one.
    const bookers = [...new Set(ending.map((p) => p.created_by).filter((x): x is string => !!x))];
    const { data: bookerRows } = bookers.length ? await db.from("profiles").select("email, status").in("id", bookers) : { data: [] };
    const to = [...new Set([...(await teamEmails("commercial")), ...(bookerRows ?? []).filter((b) => b.status === "active").map((b) => b.email as string)])];
    await sendEmail(to, `${ending.length} placement${ending.length === 1 ? "" : "s"} ending soon`, html);
    sent.commercial = ending.length;
  }

  const goLive = toPutLive(all).filter((p) => p.starts_on <= today);
  const takeDown = toTakeDown(all, today);
  if (goLive.length || takeDown.length) {
    const html = emailHtml({ intro: "On the homepage today:", link: placementsUrl(), linkLabel: "Open placements" }).replace(
      "</p>",
      `</p>${goLive.length ? `<p><b>Put live</b></p>${list(goLive, (p) => `from ${relativeDay(p.starts_on, today)}`)}` : ""}${
        takeDown.length ? `<p><b>Take down</b></p>${list(takeDown, (p) => `ended ${relativeDay(p.ends_on!, today)}`)}` : ""
      }`,
    );
    await sendEmail(await teamEmails("tech"), `Homepage today: ${goLive.length} to put live, ${takeDown.length} to take down`, html);
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
      `<li><b>${escapeHtml(r.title)}</b> (${CHANNEL_LABELS[r.channel]}, ${escapeHtml(name(r.designer_id))})${
        r.change_note ? `: revision asked, “${escapeHtml(r.change_note)}”` : r.needed_by ? `: due ${escapeHtml(relativeDay(r.needed_by, today))}` : ""
      }</li>`;
    const html = emailHtml({ intro: "Design today:", link: `${siteUrl()}/placements?tab=design`, linkLabel: "Open the Design list" }).replace(
      "</p>",
      `</p>${g.due.length ? `<p><b>Late or due today</b></p><ul>${g.due.map(line).join("")}</ul>` : ""}${
        g.changes.length ? `<p><b>Revision asked</b></p><ul>${g.changes.map(line).join("")}</ul>` : ""
      }`,
    );
    await sendEmail(await teamEmails("design"), `Design today: ${g.due.length + g.changes.length} to do`, html);
    sent.design = g.due.length + g.changes.length;
  }

  return NextResponse.json({ ok: true, sent });
}
