import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

/** Opening a notification (here or from a push) marks it read and goes where it points. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  let to = "/notifications";
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const { data } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).select("href").maybeSingle();
    if (data?.href) to = data.href;
  }
  return NextResponse.redirect(new URL(safeNext(to), request.url));
}
