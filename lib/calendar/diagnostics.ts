import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { GraphError, calendarMailbox, graph, resetTokenCache, userPath } from "./graph";

export type Check = { name: string; ok: boolean; detail: string };

const VARS = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_CALENDAR_MAILBOX", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"] as const;

/** Turn Microsoft's error text into a plain next step. */
export function explain(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("aadsts7000215") || m.includes("invalid client secret"))
    return "Microsoft rejected the client secret. In Vercel, MS_CLIENT_SECRET must be the secret's Value (not its Secret ID). Create a new secret if unsure, update Vercel, then redeploy.";
  if (m.includes("aadsts700016") || m.includes("application with identifier"))
    return "Microsoft doesn't recognise MS_CLIENT_ID in this tenant. Check MS_CLIENT_ID and MS_TENANT_ID against the app's Overview page.";
  if (m.includes("aadsts90002") || m.includes("tenant") && m.includes("not found"))
    return "MS_TENANT_ID is wrong. Copy the Directory (tenant) ID from the app's Overview page.";
  if (m.includes("erroraccessdenied") || m.includes("access is denied") || m.includes("403"))
    return "Microsoft denied calendar access. In the app registration, add Calendars.ReadWrite as an Application permission (not Delegated) and click Grant admin consent. It can take a few minutes to apply.";
  if (m.includes("mailboxnotenabledforrestapi") || m.includes("mailbox") && m.includes("not"))
    return "That mailbox isn't ready for the calendar API yet. New shared mailboxes can take up to an hour. Check MS_CALENDAR_MAILBOX is exactly tasks@highfy.pk.";
  if (m.includes("errorinvaliduser") || m.includes("resourcenotfound") || m.includes("404"))
    return "Microsoft can't find that mailbox. Check MS_CALENDAR_MAILBOX (e.g. tasks@highfy.pk) and that the shared mailbox exists.";
  if (m.includes("invalid api key") || m.includes("jwt") || m.includes("service_role"))
    return "Supabase rejected SUPABASE_SERVICE_ROLE_KEY. Copy the service_role (or secret) key again from Supabase → Project Settings → API Keys.";
  return message.slice(0, 300);
}

export async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const missing = VARS.filter((v) => !process.env[v]);
  checks.push({
    name: "Settings in Vercel",
    ok: missing.length === 0,
    detail: missing.length
      ? `Missing in this deployment: ${missing.join(", ")}. If you added them already, redeploy (Vercel → Deployments → ⋯ → Redeploy).`
      : "All six are set.",
  });
  if (missing.length) return checks;

  try {
    const db = createAdminClient();
    const { count, error } = await db.from("calendar_links").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    checks.push({ name: "Database", ok: true, detail: `Connected. ${count ?? 0} Outlook events are being tracked.` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({
      name: "Database",
      ok: false,
      detail: /calendar_links/.test(msg)
        ? "The calendar table is missing. Run highfy-update-3-outlook.sql in the Supabase SQL Editor."
        : explain(msg),
    });
    return checks;
  }

  const mailbox = calendarMailbox();
  resetTokenCache(); // sign in fresh, so a changed secret is really tested
  try {
    await graph("GET", `${userPath(mailbox)}/calendar?$select=id,name`);
    checks.push({ name: "Microsoft access", ok: true, detail: `Signed in to Microsoft and can open ${mailbox}'s calendar.` });
  } catch (e) {
    const msg = e instanceof GraphError || e instanceof Error ? e.message : String(e);
    checks.push({ name: "Microsoft access", ok: false, detail: explain(msg) });
  }
  return checks;
}
