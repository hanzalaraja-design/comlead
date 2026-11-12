import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";
import { flushPush } from "@/lib/push";
import { addDaysISO, todayPKT } from "@/lib/time";

// Task reminders (see vercel.json): ?run=morning at 9:30 is what's due today
// and overdue; ?run=evening at 6 pm is what's due tomorrow. Each person's own
// open tasks. Vercel sends "Authorization: Bearer $CRON_SECRET".
export const maxDuration = 60;

type Row = { id: string; title: string; owner_id: string; due_date: string };

const names = (rows: Row[]) => rows.slice(0, 3).map((t) => `“${t.title}”`).join(", ") + (rows.length > 3 ? ` and ${rows.length - 3} more` : "");

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const evening = request.nextUrl.searchParams.get("run") === "evening";
  const today = todayPKT();
  const db = createAdminClient();
  let q = db
    .from("tasks")
    .select("id, title, owner_id, due_date")
    .is("deleted_at", null)
    .in("status", ["todo", "in_progress", "blocked"])
    .not("owner_id", "is", null);
  q = evening ? q.eq("due_date", addDaysISO(today, 1)) : q.lte("due_date", today);
  const { data, error } = await q.order("due_date").limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byOwner = new Map<string, Row[]>();
  for (const t of (data ?? []) as Row[]) byOwner.set(t.owner_id, [...(byOwner.get(t.owner_id) ?? []), t]);

  for (const [owner, rows] of byOwner) {
    if (evening) {
      await notify([owner], "due_tomorrow", {
        title: `${rows.length} task${rows.length === 1 ? "" : "s"} due tomorrow`,
        body: names(rows),
        href: rows.length === 1 ? `/tasks/${rows[0].id}` : "/my?period=next_week",
      });
    } else {
      const due = rows.filter((t) => t.due_date === today);
      const late = rows.filter((t) => t.due_date < today);
      const parts = [due.length && `${due.length} due today`, late.length && `${late.length} overdue`].filter(Boolean).join(", ");
      await notify([owner], "roundup", {
        title: `Good morning: ${parts}`,
        body: names([...due, ...late]),
        href: "/my?period=today",
      });
    }
  }
  await flushPush();
  return NextResponse.json({ ok: true, people: byOwner.size });
}
