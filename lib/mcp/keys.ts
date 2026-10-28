import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Personal keys for the Claude connector. A key is shown once; only its hash
 * is stored. A request with a valid key gets a short-lived session for that
 * person, so every query runs under their own permissions (RLS), exactly as
 * in the app.
 */

export const KEY_PREFIX = "hft_";

export function newKey(): { key: string; hash: string; prefix: string } {
  const key = KEY_PREFIX + randomBytes(24).toString("base64url");
  return { key, hash: hashKey(key), prefix: key.slice(0, 10) };
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export type KeyUser = { userId: string; email: string; name: string; db: SupabaseClient };

// Sessions are reused while they last, per key (an instance may serve many calls).
const sessions = new Map<string, { token: string; expires: number }>();

function userClient(token: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** The person behind a key, with a database client acting as them. Null for an unknown or revoked key. */
export async function userForKey(key: string | null): Promise<KeyUser | null> {
  if (!key || !key.startsWith(KEY_PREFIX) || key.length > 100) return null;
  const hash = hashKey(key);
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("api_keys")
    .select("id, user_id, last_used_at, revoked_at, profile:profiles!inner(email, full_name, status)")
    .eq("key_hash", hash)
    .maybeSingle();
  const profile = row?.profile as unknown as { email: string; full_name: string | null; status: string } | undefined;
  if (!row || row.revoked_at || !profile || profile.status !== "active" || !profile.email.toLowerCase().endsWith("@highfy.pk")) return null;

  // Note when it was last used (at most every few minutes).
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at as string).getTime() > 5 * 60_000) {
    await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  }

  let session = sessions.get(hash);
  if (!session || session.expires < Date.now() + 60_000) {
    // Sign in as them without sending anything: make a one-time link and use it straight away.
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: profile.email });
    if (error || !link.properties?.hashed_token) throw new Error("Couldn't start a session for this key.");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verified, error: vErr } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
    if (vErr || !verified.session) throw new Error("Couldn't start a session for this key.");
    session = { token: verified.session.access_token, expires: (verified.session.expires_at ?? 0) * 1000 };
    sessions.set(hash, session);
  }

  return { userId: row.user_id as string, email: profile.email, name: profile.full_name || profile.email.split("@")[0], db: userClient(session.token) };
}
