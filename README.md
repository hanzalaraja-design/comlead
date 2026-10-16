# Highfy Tasks

Internal web app where every Highfy department tracks its to-dos, keeps weekly
meeting minutes, and turns meeting action items into tasks. Admin gets a
dashboard and a daily activity log of who did what. See [SPEC.md](SPEC.md).

Built on Vercel's official [Next.js + Supabase starter](https://github.com/vercel/next.js/tree/canary/examples/with-supabase):
Next.js (App Router, TypeScript), Supabase (Postgres, Auth, RLS, Storage),
Tailwind CSS and shadcn/ui. All dates and "today" logic use Asia/Karachi (PKT).

## What's in Phase 1

| Area | Where |
|---|---|
| Sign in with Microsoft, `@highfy.pk` only, pending approval | `/login`, `app/auth/*`, `lib/supabase/proxy.ts`, `/pending` |
| My Tasks (Overdue / Today / This week / Later / No date) | `/my` |
| List view with combinable, shareable URL filters and saved views | `/tasks` |
| Status board across departments, and per department | `/tasks/board`, `/departments/[slug]` |
| Timeline (Gantt): start date → due date, by department or person | `/tasks/timeline` |
| Calendar view | `/tasks/calendar` |
| Overdue across departments | `/overdue` |
| Task detail: comments, attachments, history | `/tasks/[id]` |
| Meetings: archive, full-text search, minutes, decisions, action items, last week's carry-forward | `/meetings`, `/meetings/[id]` |
| Activity: per person per day with summary, team view per day | `/activity` |
| CEO dashboard (click any number for the list behind it) | `/admin` |
| People approval and per-department roles | `/admin/users` |
| Departments, sub-teams, weekly meeting schedule | `/admin/departments`, `/departments/[slug]/team` |

### Access rules (enforced in the database with RLS)

- **Admin**: everything.
- **Lead** (per department): full control of their department; read-only view of other departments' tasks and meetings. Can add/remove Members and set the meeting schedule.
- **Member**: only their own departments. Can create tasks, and edit tasks they own, collaborate on or created. Cannot see other departments at all.
- Any department member can start a meeting. **Anyone in the meeting** (attendees, the person who started it, the department's Leads, Admin) can write the minutes, decisions and action items, and reassign action items. Attendees from other departments can open that meeting. Only Leads/Admin delete meetings.
- Only Leads/Admin reassign someone else's (non-meeting) task or move tasks between departments.
- Activity log: Admin sees all, Leads their departments, Members their own. Nobody can edit or delete entries (not even the database owner).
- The `@highfy.pk` domain is checked in four places: Microsoft single-tenant app, the OAuth callback, every request (proxy), and the database (sign-up is rejected and every policy checks the JWT email).

## Setup

### 1. Supabase database

Migrations live in `supabase/migrations`, the department seed in `supabase/seed.sql`.

Either with the Supabase CLI (needs a direct database connection):

```bash
npx supabase link --project-ref jdeseulxkqvokujcopsm
npx supabase db push --include-seed
```

or over HTTPS with the Management API (works anywhere):

```bash
# .env.local: NEXT_PUBLIC_SUPABASE_URL=... and SUPABASE_ACCESS_TOKEN=sbp_...
npm run db:push -- --seed
npm run db:test        # RLS test suite; leaves no data behind
```

### 2. Microsoft (Azure) app registration

In the [Azure portal](https://portal.azure.com) → Microsoft Entra ID → App registrations → **New registration**:

1. **Supported account types**: *Accounts in this organizational directory only (Highfy only - Single tenant)*.
2. **Redirect URI** (Web): `https://jdeseulxkqvokujcopsm.supabase.co/auth/v1/callback`
3. Note the **Application (client) ID** and **Directory (tenant) ID**.
4. **Certificates & secrets** → New client secret → copy the *Value*.
5. **Token configuration** → Add optional claim → ID token → `email` and `xms_edov` (lets Supabase trust the email address).

### 3. Supabase Auth settings

Supabase dashboard → Authentication:

- **Sign In / Providers → Azure**: enable; Client ID and Secret from step 2; **Azure Tenant URL** `https://login.microsoftonline.com/<tenant-id>` (this keeps sign-in to Highfy's directory).
- Turn **off** Email sign-up and other providers.
- **URL Configuration**: Site URL = your production URL; add `https://<your-domain>/auth/callback`, `https://*-<your-team>.vercel.app/auth/callback` (previews) and `http://localhost:3000/auth/callback` to Redirect URLs.

### 4. Vercel

Import the GitHub repo in Vercel and add environment variables (Production and Preview):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- optional `NEXT_PUBLIC_SITE_URL`

Never add `SUPABASE_ACCESS_TOKEN` or a service-role key to Vercel; the app doesn't use them.

### 5. Outlook calendar (optional, Phase 2)

Weekly department meetings are sent as recurring Outlook invites from a shared
mailbox; people can also switch on "Show my tasks in Outlook" under **My
settings**. Sync runs after each change and nightly (`vercel.json` cron, 02:00 PKT).

1. Create a shared mailbox, e.g. `tasks@highfy.pk`.
2. In the Highfy Tasks app registration: **API permissions → Microsoft Graph →
   Application permissions → Calendars.ReadWrite**, then **Grant admin consent**.
3. **Certificates & secrets → New client secret.**
4. Vercel environment variables (server only):
   `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_CALENDAR_MAILBOX`,
   `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and `NEXT_PUBLIC_SITE_URL`
   (e.g. `https://tasks.highfy.pk`, used for links in invites).

Until those are set, the sync is switched off and the app works as before.
The app only edits events it created (tracked in `calendar_links`).

### 6. First login

`hanzala@highfy.pk` becomes an active Admin on first sign-in. Everyone else
lands on "Waiting for approval" until an Admin approves them under **People**
and adds them to a department (as Member or Lead).

## Development

```bash
npm install
cp .env.example .env.local   # fill in
npm run dev
```

Checks:

```bash
npm run typecheck
npm run lint
npm run build
npm run db:test:local   # migrations + RLS tests on a local Postgres (no Docker needed)
```

`db:test:local` creates a throwaway database, applies a small stand-in for
Supabase's `auth`/`storage` schemas (`supabase/tests/local/supabase_shim.sql`),
all migrations and the seed, then runs `supabase/tests/rls_test.sql`.
Set `PGURL` to a superuser connection string if it isn't
`postgres://postgres@localhost:5432/postgres`.

## Notes

- Deleting a task is a soft delete (`delete_task()`), so the activity log keeps pointing at something.
- Action items *are* tasks with `meeting_id` set; editing either place edits the same record.
- Rich text (task descriptions, minutes) is stored as HTML and sanitized on save and again on render.
- Attachments go to the private `task-attachments` bucket under `<task_id>/…`; storage policies mirror task access.
