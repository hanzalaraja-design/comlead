/**
 * Presentation screenshots of Highfy Tasks, taken from a throwaway local copy
 * of the app filled with made-up demo data.
 *
 *   npm run screenshots
 *
 * What it does, all on this machine:
 *   1. Creates a temporary Postgres database, applies the migrations and
 *      supabase/seed.sql, then adds demo people, tasks, meetings and activity.
 *   2. Starts PostgREST and a tiny stand-in for Supabase's gateway and auth.
 *   3. Builds the app into .next-demo (your normal .next is left alone) and
 *      starts it against the stand-in, never the real Supabase project.
 *   4. Signs in as the demo Admin with a session minted here, so there is no
 *      Microsoft login. That session is signed with a secret made up for this
 *      run, which only the stand-in knows: the real project would reject it.
 *   5. Saves PNGs to screenshots/, then stops everything and drops the database.
 *
 * Needs: a local Postgres you can reach as a superuser (PGURL, default
 * postgres://postgres:postgres@localhost:5432/postgres), `psql`, a PostgREST
 * binary (POSTGREST_BIN, default `postgrest` on PATH), and a Playwright
 * Chromium (`npx playwright install chromium`, or CHROMIUM_PATH for one you
 * already have).
 *
 * Optional: SCALE (pixel density of the PNGs, default 2), KEEP_DB=1 to keep
 * the database for a look afterwards.
 *
 * Demo mode exists only inside this script. Nothing in the app changes and
 * the script refuses to run on Vercel or against a database that isn't local.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "screenshots");
const DIST = ".next-demo";
const SCALE = Number(process.env.SCALE ?? 2);

// ---------------------------------------------------------------------------
// Guards: demo mode is for a developer's machine only.
// ---------------------------------------------------------------------------

if (process.env.VERCEL || process.env.VERCEL_ENV) fail("This is a Vercel environment. Demo mode only runs locally.");
const PGURL = new URL(process.env.PGURL ?? "postgres://postgres:postgres@localhost:5432/postgres");
if (!["localhost", "127.0.0.1", "[::1]", ""].includes(PGURL.hostname))
  fail(`PGURL must point at a local Postgres, not ${PGURL.hostname}.`);
const POSTGREST = process.env.POSTGREST_BIN ?? "postgrest";
for (const [bin, hint] of [
  ["psql", "Install the Postgres client tools."],
  [POSTGREST, "Download PostgREST from https://github.com/PostgREST/postgrest/releases and set POSTGREST_BIN."],
] as const) {
  if (spawnSync(bin, ["--version"], { stdio: "ignore" }).status !== 0) fail(`Can't run ${bin}. ${hint}`);
}

function fail(message: string): never {
  console.error(`screenshots: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const log = (m: string) => console.log(`· ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(url: string, what: string, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`${what} didn't start in time (${url})`);
}

function dbUrl(name: string) {
  const u = new URL(PGURL);
  u.pathname = `/${name}`;
  return u.toString();
}

function psql(url: string, args: string[]) {
  const r = spawnSync("psql", [url, "-qX", "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.split("\n").filter((l) => !l.includes("NOTICE")).join("\n")}`);
  return r.stdout;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

function signJwt(payload: Record<string, unknown>, secret: string) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  if (createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url") !== sig) return null;
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  return typeof claims.exp === "number" && claims.exp * 1000 > Date.now() ? claims : null;
}

const q = (v: string | null | undefined) => (v == null ? "null" : `'${v.replace(/'/g, "''")}'`);

// ---------------------------------------------------------------------------
// Demo data. Dates are relative to today in Pakistan time.
// ---------------------------------------------------------------------------

const PKT_MS = 5 * 3600_000;
const today = new Date(Date.now() + PKT_MS).toISOString().slice(0, 10);
const day = (offset: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

type Person = { key: string; id: string; name: string; email: string };
const people: Person[] = [
  ["sara", "Sara Malik"],
  ["usman", "Usman Raza"],
  ["faisal", "Faisal Qureshi"],
  ["hamza", "Hamza Siddiqui"],
  ["zainab", "Zainab Hussain"],
  ["bilal", "Bilal Ahmed"],
  ["hina", "Hina Tariq"],
  ["mehwish", "Mehwish Iqbal"],
  ["areeba", "Areeba Javed"],
  ["ali", "Ali Haider"],
  ["nida", "Nida Farooq"],
  ["kamran", "Kamran Sheikh"],
].map(([key, name]) => ({ key, id: randomUUID(), name, email: `${key}@highfy.pk` }));
const P = Object.fromEntries(people.map((p) => [p.key, p])) as Record<string, Person>;
const ADMIN = P.sara;

// [department slug, person, role]
const memberships: [string, string, "lead" | "member"][] = [
  ["commercial", "sara", "lead"],
  ["commercial", "usman", "member"],
  ["ops", "faisal", "lead"],
  ["ops", "hamza", "member"],
  ["finance", "zainab", "lead"],
  ["marketing", "bilal", "lead"],
  ["marketing", "hina", "member"],
  ["marketing", "areeba", "member"],
  ["content", "mehwish", "lead"],
  ["content", "areeba", "member"],
  ["brand", "ali", "lead"],
  ["hr", "nida", "lead"],
  ["hr", "sara", "member"],
  ["customer-experience", "kamran", "lead"],
];

type Meeting = {
  key: string;
  id: string;
  seriesId: string;
  title: string;
  dept: string;
  frequency: "weekly" | "fortnightly" | "monthly";
  date: string;
  time: string;
  attendees: string[];
  agenda: string[];
  minutes: [string, string[]][];
};

const meetings: Meeting[] = [
  {
    key: "mkt",
    id: randomUUID(),
    seriesId: randomUUID(),
    title: "Marketing weekly",
    dept: "marketing",
    frequency: "weekly",
    date: day(0),
    time: "11:00",
    attendees: ["bilal", "hina", "areeba", "sara"],
    agenda: ["Black Friday plan", "Winter drop influencers", "SEO audit status", "Affiliate payouts"],
    minutes: [
      ["Black Friday", [
        "Agreed to run a 5-email sequence from 20 November, with early access for the VIP list.",
        "Hina will share the creative brief with Brand by Wednesday.",
      ]],
      ["Winter drop", [
        "Shortlisted three influencer agencies. Bilal to brief the preferred one this week.",
        "Budget stays at PKR 1.2m, split 60/40 between Instagram and TikTok.",
      ]],
      ["SEO and affiliates", [
        "SEO technical audit is 70% done; remaining work is on collection pages.",
        "Affiliate payouts are still waiting on Finance. Raised it with Zainab.",
      ]],
    ],
  },
  {
    key: "com",
    id: randomUUID(),
    seriesId: randomUUID(),
    title: "Commercial weekly",
    dept: "commercial",
    frequency: "weekly",
    date: day(-4),
    time: "10:00",
    attendees: ["sara", "usman"],
    agenda: ["Wholesale pipeline", "Karachi Traders agreement", "November targets"],
    minutes: [
      ["Wholesale", [
        "Packages Mall store asked for a revised quote with a 5% volume discount.",
        "Three wholesale invoices are past 30 days. Usman is following up.",
      ]],
      ["Distribution", ["Karachi Traders accepted the draft terms. Sara to sign this week."]],
    ],
  },
  {
    key: "fin",
    id: randomUUID(),
    seriesId: randomUUID(),
    title: "Finance monthly review",
    dept: "finance",
    frequency: "monthly",
    date: day(-5),
    time: "15:00",
    attendees: ["zainab", "sara", "faisal"],
    agenda: ["September close", "Affiliate payouts", "Q3 tax filing"],
    minutes: [
      ["September close", ["Accounts closed on time. Gross margin was 41%, up two points on August."]],
      ["Payables", [
        "Affiliate payouts for September are approved internally and waiting on the bank.",
        "Q3 tax filing pack to be ready before the end of the month.",
      ]],
    ],
  },
];
const M = Object.fromEntries(meetings.map((m) => [m.key, m])) as Record<string, Meeting>;

type Task = {
  key: string;
  id: string;
  title: string;
  dept: string | null; // null: a private task
  owner: string;
  status: "todo" | "in_progress" | "blocked" | "done";
  priority: "urgent" | "high" | "medium" | "low";
  due: number | null; // days from today
  created: number; // days ago
  completed?: number; // days ago, for done tasks
  blocked?: string;
  meeting?: string;
  collaborators?: string[];
  tags?: string[];
};

const task = (t: Omit<Task, "id">): Task => ({ ...t, id: randomUUID() });
const tasks: Task[] = [
  // Sara (the Admin, whose My tasks page is captured)
  task({ key: "budget", title: "Approve Q4 marketing budget", dept: "commercial", owner: "sara", status: "in_progress", priority: "high", due: -2, created: 9, tags: ["Q4"] }),
  task({ key: "karachi", title: "Sign distributor agreement with Karachi Traders", dept: "commercial", owner: "sara", status: "todo", priority: "urgent", due: 0, created: 4, meeting: "com" }),
  task({ key: "targets", title: "Review November sales targets with Usman", dept: "commercial", owner: "sara", status: "todo", priority: "medium", due: 2, created: 4, meeting: "com" }),
  task({ key: "design", title: "Interview shortlisted Head of Design candidates", dept: "hr", owner: "sara", status: "in_progress", priority: "high", due: 3, created: 6 }),
  task({ key: "pricing", title: "Finalise wholesale pricing for 2027", dept: "commercial", owner: "sara", status: "todo", priority: "medium", due: 12, created: 3 }),
  task({ key: "board", title: "Draft October board update", dept: "commercial", owner: "sara", status: "todo", priority: "low", due: null, created: 2 }),
  task({ key: "flights", title: "Book flights for the Lahore store visit", dept: null, owner: "sara", status: "todo", priority: "medium", due: 1, created: 1 }),
  task({ key: "creatives", title: "Approve Winter campaign creatives", dept: "marketing", owner: "sara", status: "done", priority: "high", due: 0, created: 5, completed: 0 }),
  // Commercial
  task({ key: "quote", title: "Send revised quote to Packages Mall store", dept: "commercial", owner: "usman", status: "todo", priority: "high", due: -3, created: 4, meeting: "com", collaborators: ["sara"] }),
  task({ key: "invoices", title: "Follow up on three overdue wholesale invoices", dept: "commercial", owner: "usman", status: "in_progress", priority: "medium", due: 1, created: 4, meeting: "com" }),
  // Ops
  task({ key: "grn", title: "Receive GRN for October stock shipment", dept: "ops", owner: "faisal", status: "blocked", priority: "urgent", due: -1, created: 6, blocked: "Waiting on the supplier's invoice" }),
  task({ key: "stock", title: "Reconcile warehouse inventory count", dept: "ops", owner: "hamza", status: "in_progress", priority: "medium", due: 4, created: 3 }),
  task({ key: "courier", title: "Renew courier contract with TCS", dept: "ops", owner: "faisal", status: "todo", priority: "high", due: 6, created: 8 }),
  // Finance
  task({ key: "close", title: "Close September accounts", dept: "finance", owner: "zainab", status: "done", priority: "high", due: -4, created: 14, completed: 2 }),
  task({ key: "payouts", title: "Release affiliate payouts for September", dept: "finance", owner: "zainab", status: "blocked", priority: "high", due: 1, created: 5, meeting: "fin", blocked: "Awaiting bank approval", collaborators: ["bilal"] }),
  task({ key: "tax", title: "Prepare Q3 tax filing pack", dept: "finance", owner: "zainab", status: "todo", priority: "medium", due: 9, created: 5, meeting: "fin" }),
  // Marketing
  task({ key: "seo", title: "Finish SEO technical audit", dept: "marketing", owner: "bilal", status: "in_progress", priority: "high", due: -2, created: 12, tags: ["SEO"] }),
  task({ key: "bf", title: "Launch Black Friday email sequence", dept: "marketing", owner: "hina", status: "todo", priority: "urgent", due: 5, created: 0, meeting: "mkt", collaborators: ["areeba"], tags: ["Black Friday"] }),
  task({ key: "influencer", title: "Brief influencer agency on the Winter drop", dept: "marketing", owner: "bilal", status: "todo", priority: "medium", due: 2, created: 0, meeting: "mkt" }),
  task({ key: "payout-schedule", title: "Share revised affiliate payout schedule with Finance", dept: "marketing", owner: "bilal", status: "done", priority: "medium", due: 0, created: 0, meeting: "mkt", completed: 0 }),
  task({ key: "meta", title: "Set up Meta retargeting campaign", dept: "marketing", owner: "hina", status: "done", priority: "medium", due: -3, created: 10, completed: 3 }),
  // Content
  task({ key: "blogs", title: "Publish four blog posts for the Winter collection", dept: "content", owner: "mehwish", status: "in_progress", priority: "medium", due: 7, created: 6 }),
  task({ key: "skus", title: "Write product descriptions for 30 new SKUs", dept: "content", owner: "areeba", status: "todo", priority: "high", due: 0, created: 3 }),
  // Brand
  task({ key: "guidelines", title: "Refresh the brand guidelines deck", dept: "brand", owner: "ali", status: "todo", priority: "low", due: 14, created: 7 }),
  task({ key: "packaging", title: "Approve packaging artwork for gift boxes", dept: "brand", owner: "ali", status: "in_progress", priority: "high", due: -1, created: 8 }),
  // HR
  task({ key: "jobad", title: "Post job ad for Performance Marketing Lead", dept: "hr", owner: "nida", status: "todo", priority: "medium", due: 1, created: 2 }),
  task({ key: "onboarding", title: "Run onboarding for two new joiners", dept: "hr", owner: "nida", status: "done", priority: "medium", due: 0, created: 4, completed: 0 }),
  // Customer Experience
  task({ key: "frt", title: "Bring first-response time under 2 hours", dept: "customer-experience", owner: "kamran", status: "in_progress", priority: "high", due: 10, created: 9 }),
  task({ key: "callbacks", title: "Call back customers with delayed orders", dept: "customer-experience", owner: "kamran", status: "todo", priority: "urgent", due: 0, created: 1 }),
];
const T = Object.fromEntries(tasks.map((t) => [t.key, t])) as Record<string, Task>;

const deptId = (slug: string | null) => (slug ? `(select id from public.departments where slug = ${q(slug)})` : "null");
const ts = (daysAgo: number, hour = 10) => `(${q(day(-daysAgo))}::date + time '${String(hour).padStart(2, "0")}:00') at time zone 'Asia/Karachi'`;

function minutesHtml(sections: [string, string[]][]) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return sections.map(([h, pts]) => `<h3>${esc(h)}</h3><ul>${pts.map((p) => `<li><p>${esc(p)}</p></li>`).join("")}</ul>`).join("");
}

/** A day of activity, spread over the hours before now (always today in PKT). */
function activitySql(): string {
  const meetingLabel = (m: Meeting) => `${m.title}, ${new Date(`${m.date}T00:00:00Z`).toUTCString().slice(5, 11).trim()}`;
  type A = { actor: string; action: string; type: string; label: string; dept: string | null; task?: Task; meeting?: Meeting; old?: object; new?: object; subject?: string };
  const t = (actor: string, action: string, x: Task, extra: Partial<A> = {}): A => ({ actor, action, type: "task", label: x.title, dept: x.dept, task: x, ...extra });
  const entries: A[] = [
    t("faisal", "task.status_changed", T.grn, { old: { status: "in_progress" }, new: { status: "blocked", blocked_reason: T.grn.blocked } }),
    t("hamza", "task.status_changed", T.stock, { old: { status: "todo" }, new: { status: "in_progress" } }),
    { actor: "bilal", action: "meeting.minutes_edited", type: "meeting", label: meetingLabel(M.mkt), dept: "marketing", meeting: M.mkt },
    t("bilal", "task.created", T.bf, { new: { source: "meeting" }, meeting: M.mkt }),
    t("bilal", "task.created", T.influencer, { new: { source: "meeting" }, meeting: M.mkt }),
    t("bilal", "task.completed", T["payout-schedule"]),
    t("nida", "task.completed", T.onboarding),
    t("sara", "task.created", T.karachi),
    t("usman", "comment.added", T.quote, { type: "comment" }),
    t("zainab", "task.status_changed", T.payouts, { old: { status: "in_progress" }, new: { status: "blocked", blocked_reason: T.payouts.blocked } }),
    t("sara", "task.reassigned", T.skus, { old: { owner_id: P.mehwish.id }, new: { owner_id: P.areeba.id } }),
    t("hina", "task.collaborator_added", T.bf, { subject: "areeba" }),
    t("ali", "task.edited", T.packaging, { old: { priority: "medium" }, new: { priority: "high" } }),
    t("mehwish", "task.status_changed", T.blogs, { old: { status: "todo" }, new: { status: "in_progress" } }),
    t("kamran", "task.due_changed", T.frt, { old: { due_date: day(5) }, new: { due_date: day(10) } }),
    t("sara", "task.completed", T.creatives),
  ];
  // From 9 am where the clock allows (earlier only if it's run before then), up to a few minutes ago.
  const startOfDay = Date.parse(`${today}T00:00:00Z`) - PKT_MS;
  const end = Date.now() - 5 * 60_000;
  const start = Math.max(startOfDay + 60_000, Math.min(startOfDay + 9 * 3600_000, end - 2 * 3600_000));
  const step = Math.min(35 * 60_000, (end - start) / (entries.length - 1));
  return entries
    .map((e, i) => {
      const at = new Date(end - (entries.length - 1 - i) * step).toISOString();
      return `insert into public.activity_log (created_at, actor_id, action, entity_type, entity_id, entity_label, department_id, task_id, meeting_id, subject_user_id, old_value, new_value)
values (${q(at)}, ${q(P[e.actor].id)}, ${q(e.action)}, ${q(e.type)}, ${q(e.task?.id ?? e.meeting?.id ?? null)}, ${q(e.label)}, ${deptId(e.dept)},
  ${q(e.task?.id ?? null)}, ${q(e.meeting?.id ?? (e.task?.meeting ? M[e.task.meeting].id : null))}, ${q(e.subject ? P[e.subject].id : null)},
  ${e.old ? `${q(JSON.stringify(e.old))}::jsonb` : "null"}, ${e.new ? `${q(JSON.stringify(e.new))}::jsonb` : "null"});`;
    })
    .join("\n");
}

function demoSql(): string {
  const s: string[] = ["begin;"];
  // People: the auth trigger creates each profile, then they're approved.
  for (const p of people)
    s.push(`insert into auth.users (id, email, raw_user_meta_data) values (${q(p.id)}, ${q(p.email)}, ${q(JSON.stringify({ full_name: p.name }))}::jsonb);`);
  s.push(`update public.profiles set status = 'active', is_admin = (id = ${q(ADMIN.id)});`);
  for (const [slug, who, role] of memberships)
    s.push(`insert into public.department_members (department_id, user_id, role) values (${deptId(slug)}, ${q(P[who].id)}, ${q(role)});`);

  for (const m of meetings) {
    s.push(`insert into public.meeting_series (id, title, department_id, kind, frequency, start_date, meeting_time, duration_minutes, created_by, created_at)
values (${q(m.seriesId)}, ${q(m.title)}, ${deptId(m.dept)}, 'internal', ${q(m.frequency)}, ${q(m.date)}, ${q(m.time)}, 60, ${q(P[m.attendees[0]].id)}, ${ts(30)});`);
    s.push(`insert into public.meeting_series_departments (series_id, department_id) values (${q(m.seriesId)}, ${deptId(m.dept)});`);
    s.push(`insert into public.meetings (id, series_id, department_id, title, meeting_date, meeting_time, agenda, minutes, created_by)
values (${q(m.id)}, ${q(m.seriesId)}, ${deptId(m.dept)}, ${q(m.title)}, ${q(m.date)}, ${q(m.time)}, ${q(m.agenda.join("\n"))}, ${q(minutesHtml(m.minutes))}, ${q(P[m.attendees[0]].id)});`);
    for (const a of m.attendees) s.push(`insert into public.meeting_attendees (meeting_id, user_id) values (${q(m.id)}, ${q(P[a].id)});`);
  }
  // Two meetings coming up, so the list has more than repeats.
  const upcoming = [
    { title: "Distributor call with Karachi Traders", dept: "commercial", kind: "external", frequency: "once", date: day(2), time: "16:00", by: "sara" },
    { title: "All-hands", dept: "hr", kind: "internal", frequency: "monthly", date: day(9), time: "17:00", by: "nida" },
  ];
  for (const u of upcoming)
    s.push(`insert into public.meeting_series (title, department_id, kind, frequency, start_date, meeting_time, duration_minutes, created_by, external_emails)
values (${q(u.title)}, ${deptId(u.dept)}, ${q(u.kind)}, ${q(u.frequency)}, ${q(u.date)}, ${q(u.time)}, 30, ${q(P[u.by].id)}, ${u.kind === "external" ? `array['ahmed@karachitraders.pk']` : "'{}'"});`);

  for (const t of tasks) {
    s.push(`insert into public.tasks (id, title, department_id, owner_id, status, priority, due_date, source, meeting_id, tags, blocked_reason, created_by, created_at)
values (${q(t.id)}, ${q(t.title)}, ${deptId(t.dept)}, ${q(P[t.owner].id)}, ${q(t.status)}, ${q(t.priority)}, ${t.due === null ? "null" : q(day(t.due))},
  ${t.meeting ? "'meeting'" : "'manual'"}, ${t.meeting ? q(M[t.meeting].id) : "null"}, ${q(`{${(t.tags ?? []).map((x) => `"${x}"`).join(",")}}`)}, ${q(t.blocked ?? null)},
  ${q(P[t.meeting ? M[t.meeting].attendees[0] : t.owner].id)}, ${ts(t.created, 9)});`);
    // completed_at is set to now() on insert; move it back to when it happened.
    if (t.status === "done" && t.completed) s.push(`update public.tasks set completed_at = ${ts(t.completed, 16)} where id = ${q(t.id)};`);
    for (const c of t.collaborators ?? []) s.push(`insert into public.task_collaborators (task_id, user_id) values (${q(t.id)}, ${q(P[c].id)});`);
  }

  // A comment that mentions Sara, so My tasks shows "Mentioned".
  const commentId = randomUUID();
  s.push(`insert into public.task_comments (id, task_id, author_id, body, created_at) values (${q(commentId)}, ${q(T.quote.id)}, ${q(P.usman.id)},
  ${q(`@${ADMIN.name} can you approve the 5% volume discount before I send this?`)}, now() - interval '50 minutes');`);
  s.push(`insert into public.task_mentions (comment_id, task_id, user_id, mentioned_by, created_at) values (${q(commentId)}, ${q(T.quote.id)}, ${q(ADMIN.id)}, ${q(P.usman.id)}, now() - interval '50 minutes');`);

  // The triggers logged all of the above as "System" just now. Replace that
  // with a believable day of activity by real people.
  s.push("alter table public.activity_log disable trigger user;", "delete from public.activity_log;", "alter table public.activity_log enable trigger user;");
  s.push(activitySql());
  s.push("commit;");
  return s.join("\n");
}

// ---------------------------------------------------------------------------
// Stand-in for the Supabase gateway: /rest/v1 → PostgREST, /auth/v1/user.
// ---------------------------------------------------------------------------

function startGateway(port: number, restPort: number, secret: string): Promise<http.Server> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/auth/v1/user")) {
      const claims = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer /i, ""), secret);
      const p = claims && byId.get(String(claims.sub));
      if (!p) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ code: 401, msg: "invalid token" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(authUser(p)));
      return;
    }
    if (!url.startsWith("/rest/v1")) {
      res.writeHead(404).end("not available in demo mode");
      return;
    }
    const up = http.request(
      { host: "127.0.0.1", port: restPort, path: url.slice("/rest/v1".length) || "/", method: req.method, headers: { ...req.headers, host: `127.0.0.1:${restPort}` } },
      (u) => {
        res.writeHead(u.statusCode ?? 502, u.headers);
        u.pipe(res);
      },
    );
    up.on("error", (e) => res.writeHead(502).end(String(e)));
    req.pipe(up);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

function authUser(p: Person) {
  return {
    id: p.id,
    aud: "authenticated",
    role: "authenticated",
    email: p.email,
    app_metadata: { provider: "azure", providers: ["azure"] },
    user_metadata: { full_name: p.name },
    created_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const procs: ChildProcess[] = [];
let gateway: http.Server | null = null;
const dbName = `highfy_demo_${randomBytes(4).toString("hex")}`;
const roleName = `${dbName}_auth`;
const rolePassword = randomBytes(18).toString("hex");
let dbCreated = false;

function start(cmd: string, args: string[], env: NodeJS.ProcessEnv, logFile: string): ChildProcess {
  const out = fs.openSync(logFile, "w");
  const p = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", out, out] });
  procs.push(p);
  return p;
}

async function cleanup() {
  for (const p of procs) p.kill("SIGTERM");
  gateway?.close();
  await sleep(500);
  if (dbCreated && process.env.KEEP_DB !== "1") {
    try {
      psql(PGURL.toString(), ["-c", `drop database if exists ${dbName} with (force)`, "-c", `drop role if exists ${roleName}`]);
    } catch (e) {
      console.error(String(e));
    }
  }
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "highfy-demo-"));
  const secret = randomBytes(32).toString("hex");
  const [restPort, gatewayPort, appPort] = [await freePort(), await freePort(), await freePort()];
  const now = Math.floor(Date.now() / 1000);
  const anonKey = signJwt({ role: "anon", iss: "highfy-demo", iat: now, exp: now + 86400 }, secret);
  const serviceKey = signJwt({ role: "service_role", iss: "highfy-demo", iat: now, exp: now + 86400 }, secret);

  log(`database ${dbName}`);
  psql(PGURL.toString(), [
    "-c", `create database ${dbName}`,
    "-c", `create role ${roleName} login noinherit password '${rolePassword}'`,
  ]);
  dbCreated = true;
  const db = dbUrl(dbName);
  psql(db, ["-f", path.join(ROOT, "supabase/tests/local/supabase_shim.sql")]);
  for (const f of fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort())
    psql(db, ["-f", path.join(ROOT, "supabase/migrations", f)]);
  psql(db, ["-f", path.join(ROOT, "supabase/seed.sql")]);
  psql(db, ["-c", `grant anon, authenticated, service_role to ${roleName}`, "-c", "grant usage on schema auth to anon, authenticated, service_role"]);
  const seedFile = path.join(tmp, "demo.sql");
  fs.writeFileSync(seedFile, demoSql());
  psql(db, ["-f", seedFile]);
  log(`demo data: ${people.length} people, ${tasks.length} tasks, ${meetings.length} meetings with minutes`);

  const restDb = new URL(db);
  restDb.username = roleName;
  restDb.password = rolePassword;
  start(POSTGREST, [], {
    NODE_ENV: "production",
    PATH: process.env.PATH,
    PGRST_DB_URI: restDb.toString(),
    PGRST_DB_SCHEMAS: "public",
    PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: secret,
    PGRST_SERVER_HOST: "127.0.0.1",
    PGRST_SERVER_PORT: String(restPort),
  }, path.join(tmp, "postgrest.log"));
  await waitFor(`http://127.0.0.1:${restPort}/`, "PostgREST", 30_000);
  gateway = await startGateway(gatewayPort, restPort, secret);

  // Everything the app could reach is pointed at this machine. Values set
  // here win over .env.local, so no real key is ever picked up.
  const appEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VERCEL|NEXT_PUBLIC_|SUPABASE_|MS_|ANTHROPIC_|CRON_)/.test(k))),
    NEXT_DIST_DIR: DIST,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${gatewayPort}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    NEXT_PUBLIC_SITE_URL: `http://localhost:${appPort}`,
    // Outlook off. The assistant's buttons show, but any call goes nowhere.
    MS_TENANT_ID: "",
    MS_CLIENT_ID: "",
    MS_CLIENT_SECRET: "",
    MS_CALENDAR_MAILBOX: "",
    ANTHROPIC_API_KEY: "demo-offline",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
    CRON_SECRET: "",
  };

  // `next build` may point tsconfig.json and next-env.d.ts at the demo build; put them back after.
  const keep = ["tsconfig.json", "next-env.d.ts"].map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")] as const);
  log("building the app into .next-demo (a minute or two)");
  const next = path.join(ROOT, "node_modules/.bin/next");
  const build = spawnSync(next, ["build"], { cwd: ROOT, env: appEnv, encoding: "utf8" });
  for (const [f, text] of keep) fs.writeFileSync(path.join(ROOT, f), text);
  if (build.status !== 0) throw new Error(`next build failed:\n${(build.stdout + build.stderr).slice(-3000)}`);
  start(next, ["start", "-p", String(appPort), "-H", "localhost"], appEnv, path.join(tmp, "next.log"));
  const BASE = `http://localhost:${appPort}`;
  await waitFor(`${BASE}/login`, "the app");

  // Signed in as the demo Admin: the same cookie @supabase/ssr writes after a real login.
  const session = {
    access_token: signJwt(
      { sub: ADMIN.id, email: ADMIN.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 86400, session_id: randomUUID(), app_metadata: { provider: "azure" }, user_metadata: { full_name: ADMIN.name } },
      secret,
    ),
    token_type: "bearer",
    expires_in: 86400,
    expires_at: now + 86400,
    refresh_token: "demo",
    user: authUser(ADMIN),
  };
  const cookieValue = `base64-${b64url(JSON.stringify(session))}`;
  const cookieName = "sb-localhost-auth-token";
  const chunks = cookieValue.length <= 3180 ? [[cookieName, cookieValue]] : (cookieValue.match(/.{1,3180}/g) ?? []).map((c, i) => [`${cookieName}.${i}`, c]);
  const cookies = chunks.map(([name, value]) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" as const }));

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const shot = async (page: Page, url: string, file: string, prepare?: (page: Page) => Promise<void>) => {
      await page.goto(BASE + url, { waitUntil: "networkidle" });
      if (new URL(page.url()).pathname === "/login") throw new Error(`Not signed in on ${url}`);
      await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }" });
      await page.evaluate(() => document.fonts.ready);
      if (prepare) await prepare(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, file) });
      log(`screenshots/${file}`);
    };

    const desktop = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: SCALE, colorScheme: "light", reducedMotion: "reduce", locale: "en-GB", timezoneId: "Asia/Karachi" });
    await desktop.addCookies(cookies);
    const page = await desktop.newPage();
    await shot(page, "/my", "01-my-tasks.png");
    await shot(page, "/tasks/board", "02-board.png");
    await shot(page, "/meetings", "03-meetings.png");
    await shot(page, `/meetings/${M.mkt.id}`, "04-meeting-minutes.png", async (p) => {
      // Start at the attendees so the minutes and action items fit in the same frame.
      await p.getByText("Attendees", { exact: true }).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 48));
    });
    await shot(page, "/activity?view=team", "05-activity-today.png");
    await shot(page, "/admin", "06-admin-dashboard.png");

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, colorScheme: "light", reducedMotion: "reduce", locale: "en-GB", timezoneId: "Asia/Karachi" });
    await phone.addCookies(cookies);
    await shot(await phone.newPage(), "/my", "07-my-tasks-phone.png");
  } finally {
    await browser.close();
  }
}

try {
  await run();
  console.log(`Done. ${SCALE}x PNGs are in screenshots/.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await cleanup();
}
