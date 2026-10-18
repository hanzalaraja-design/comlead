import "server-only";

/**
 * Minimal Microsoft Graph client using app-only (client credentials) auth.
 * Needs the Calendars.ReadWrite application permission with admin consent.
 * MS_GRAPH_URL / MS_LOGIN_URL can point at a stand-in for testing.
 */

const GRAPH = () => process.env.MS_GRAPH_URL ?? "https://graph.microsoft.com/v1.0";
const LOGIN = () => process.env.MS_LOGIN_URL ?? "https://login.microsoftonline.com";

/** A setting from Vercel, minus stray spaces or line breaks from pasting. */
export function msEnv(name: "MS_TENANT_ID" | "MS_CLIENT_ID" | "MS_CLIENT_SECRET" | "MS_CALENDAR_MAILBOX"): string {
  return process.env[name]?.trim() ?? "";
}

export function isCalendarConfigured(): boolean {
  return Boolean(
    msEnv("MS_TENANT_ID") &&
      msEnv("MS_CLIENT_ID") &&
      msEnv("MS_CLIENT_SECRET") &&
      msEnv("MS_CALENDAR_MAILBOX") &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function calendarMailbox(): string {
  return msEnv("MS_CALENDAR_MAILBOX").toLowerCase();
}

let cached: { token: string; expires: number } | null = null;

/** Forget the cached token so the next call signs in again (used by the Admin check). */
export function resetTokenCache() {
  cached = null;
}

async function token(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${LOGIN()}/${msEnv("MS_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: msEnv("MS_CLIENT_ID"),
      client_secret: msEnv("MS_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new GraphError(res.status, `token: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

export class GraphError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`Graph ${status}: ${message}`);
  }
}

export async function graph<T = unknown>(method: string, path: string, body?: unknown): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${GRAPH()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
        // Times are sent and returned in Pakistan time.
        Prefer: 'outlook.timezone="Pakistan Standard Time"',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Throttled or briefly unavailable: wait and retry.
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const wait = Number(res.headers.get("Retry-After") ?? 2) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
      continue;
    }
    if (!res.ok) throw new GraphError(res.status, await res.text());
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }
  throw new GraphError(503, "retries exhausted");
}

export const userPath = (mailbox: string) => `/users/${encodeURIComponent(mailbox)}`;
