import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";

const ALLOWED_DOMAIN = "@highfy.pk";

/**
 * The proxy verifies the session on every request and passes who it is to the
 * page in this header, so pages don't verify it a second time. Any copy sent
 * by the browser is removed first. Data access is still checked by the
 * database against the person's own token.
 */
export const VIEWER_HEADER = "x-highfy-viewer";

// Reachable without a session.
const PUBLIC_PATHS = ["/login", "/auth/", "/api/cron/"];

export async function updateSession(request: NextRequest) {
  request.headers.delete(VIEWER_HEADER);
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip proxy check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  // Domain lock: a session for any other domain is ended immediately.
  if (user && !String(user.email ?? "").toLowerCase().endsWith(ALLOWED_DOMAIN) && path !== "/auth/signout") {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/signout";
    url.search = "?reason=domain";
    return copyCookies(supabaseResponse, NextResponse.redirect(url));
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return copyCookies(supabaseResponse, NextResponse.redirect(url));
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  if (!user) return supabaseResponse;
  const headers = new Headers(request.headers);
  headers.set(VIEWER_HEADER, JSON.stringify({ sub: user.sub, email: user.email ?? null }));
  return copyCookies(supabaseResponse, NextResponse.next({ request: { headers } }));
}

function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}
