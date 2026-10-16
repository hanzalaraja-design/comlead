import { NextResponse, type NextRequest } from "next/server";
import { isCalendarConfigured } from "@/lib/calendar/graph";
import { reconcileAll } from "@/lib/calendar/sync";

// Nightly repair of the Outlook sync (see vercel.json). Vercel sends
// "Authorization: Bearer $CRON_SECRET" with scheduled requests.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isCalendarConfigured()) {
    return NextResponse.json({ skipped: "calendar not configured" });
  }
  const result = await reconcileAll();
  return NextResponse.json({ ok: true, ...result });
}
