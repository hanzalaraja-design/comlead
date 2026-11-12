import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { cache } from "react";
import { flushPush } from "@/lib/push";

/**
 * Changes made by a server action may have raised notifications (the database
 * writes them); push them once the response is sent. Once per request.
 */
const pushAfterAction = cache(async () => {
  try {
    if ((await headers()).has("next-action")) after(() => flushPush().catch((e) => console.error("[push]", e)));
  } catch {
    // Not in a request (build time): nothing to push.
  }
});

/**
 * Especially important if using Fluid compute: Don't put this client in a
 * global variable. Always create a new client within each function when using
 * it.
 */
export async function createClient() {
  const cookieStore = await cookies();
  await pushAfterAction();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have proxy refreshing
            // user sessions.
          }
        },
      },
    },
  );
}
