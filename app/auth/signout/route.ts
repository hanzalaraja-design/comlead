import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const reason = request.nextUrl.searchParams.get("reason");
  const target = reason === "domain" ? "/auth/error?reason=domain" : "/login";
  return NextResponse.redirect(new URL(target, request.url), { status: 303 });
}

// POST from the app's sign-out button.
export const POST = signOut;

// GET only for the proxy's forced sign-out of a non-Highfy session.
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("reason") !== "domain") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return signOut(request);
}
