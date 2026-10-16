// Small helper for the Supabase Management API (HTTPS only, no direct
// Postgres connection needed). Needs:
//   SUPABASE_ACCESS_TOKEN   personal access token (sbp_...)
//   SUPABASE_PROJECT_REF    or NEXT_PUBLIC_SUPABASE_URL to derive it
import fs from "node:fs";

// Load .env.local / .env if present (no dependency on dotenv).
for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const m = url && url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!m) throw new Error("Set SUPABASE_PROJECT_REF or NEXT_PUBLIC_SUPABASE_URL");
  return m[1];
}

export async function runSql(query) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("Set SUPABASE_ACCESS_TOKEN (a personal access token from supabase.com/dashboard/account/tokens)");
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef()}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {}
    throw new Error(`${res.status}: ${message}`);
  }
  return text ? JSON.parse(text) : null;
}
