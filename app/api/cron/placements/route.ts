import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailHtml, escapeHtml, isEmailConfigured, placementsUrl, sendEmail, teamEmails } from "@/lib/notify";
import { ENDING_DAYS, PLACEMENT_COLUMNS, nextAfter, relativeDay, slotName, toPutLive, toTakeDown, type Placement, type Section } from "@/lib/placements";
import { addDaysISO, todayPKT } from "@/lib/time";

// Morning reminders (see vercel.json): Commercial hears about bookings ending
// in 3 days and today with nothing after them; Tech about banners to put up
// or take down today. Vercel sends "Authorization: Bearer $CRON_SECRET".
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
    await sendEmail(await teamEmails("commercial"), `${ending.length} placement${ending.length === 1 ? "" : "s"} ending soon`, html);
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

  return NextResponse.json({ ok: true, sent });
}
