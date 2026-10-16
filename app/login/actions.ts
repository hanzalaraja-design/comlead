"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

export async function signInWithMicrosoft(formData: FormData) {
  const next = safeNext(String(formData.get("next") ?? ""));
  const h = await headers();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    h.get("origin") ||
    `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      scopes: "openid email profile offline_access",
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: {
        // Pre-select work accounts; the app registration itself is single tenant.
        domain_hint: "highfy.pk",
        prompt: "select_account",
      },
    },
  });

  if (error || !data.url) {
    redirect(`/auth/error?reason=provider`);
  }
  redirect(data.url);
}
