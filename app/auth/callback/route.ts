import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";

// OAuth return from Microsoft (via Supabase Auth).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // Supabase reports errors here, e.g. when the database refuses to create
  // an account for a non-Highfy email.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    const reason = /database error|highfy/i.test(providerError) ? "domain" : "provider";
    return NextResponse.redirect(`${origin}/auth/error?reason=${reason}`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error?reason=provider`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/auth/error?reason=provider`);
  }

  // Server-side domain check: anyone else is signed straight back out.
  const { data } = await supabase.auth.getUser();
  if (!isAllowedEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/auth/error?reason=domain`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
