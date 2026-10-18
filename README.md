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
| My tasks: one inbox for tasks assigned to you, tasks you collaborate on and @mentions; quick add (type and press Enter); weekly progress ring | `/my` |
| List view with combinable, shareable URL filters (less-used ones under "More") | `/tasks` |
| Status board across departments, and per department | `/tasks/board`, `/departments/[slug]` |
| Calendar view | `/tasks/calendar` |
| Overdue across departments | `/overdue` |
| Task detail: comments with @mentions, attachments, history | `/tasks/[id]` |
| Meetings: set up one-off, weekly, fortnightly or monthly meetings (internal or external), sent to Outlook; upcoming list; archive and search; agenda, minutes, action items, last time's carry-forward | `/meetings`, `/meetings/new`, `/meetings/series/[id]`, `/meetings/[id]` |
| Activity: per person per day with summary, team view per day | `/activity` |
| CEO dashboard with department leaderboard (click any number for the list behind it) | `/admin` |
| People approval, per-team roles, departments and project teams | `/admin/users`, `/departments/[slug]/team` |

### Access rules (enforced in the database with RLS)

- **Admin** (company-wide): everything.
- **Dept admin** (per department, stored as role `lead`): full control of that department. Can add/remove Members.
- **Member** (per department): can create tasks, and edit tasks they own, collaborate on or created.
- Work is organised in **teams**: a team is either a **department** or a **project team** (people from several departments working together). Both work the same way. There are no sub-teams.
- People see **only the teams they belong to**, plus any task they own or collaborate on. A person can be in any number of teams, as Member in some and Dept admin in others.
- **@mentions** add the tagged person as a collaborator (so they can open the task) and put it in their inbox.
- **Meetings**: any department member can set one up for their department and invite other departments, people and (for external meetings) outside email addresses. Whoever set it up and the department's admins can change or cancel it. Everyone invited can open its agenda and minutes; anyone in the meeting can write them and add action items.
- Only Dept admins/Admin reassign someone else's (non-meeting) task or move tasks between departments.
- Activity log: Admin sees all, Dept admins their departments, Members their own. Nobody can edit or delete entries (not even the database owner).
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

Meetings set up under **Meetings** are sent as Outlook invites (recurring or
one-off) from a shared mailbox, and kept in step when they change or are cancelled; people can also switch on "Show my tasks in Outlook" under **My
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

### 6. Meeting assistant (optional)

The meeting editor can use Claude to:

- **Tidy up**: turn rough notes into structured minutes.
- **Suggest action items**: with owner, due date and priority. Each one has a
  **Create task** button.
- **Draft agenda**: built from last week's open action items and the
  department's overdue or blocked tasks. It runs on its own when a meeting
  with no agenda or minutes is opened for editing.

Everything it produces is a draft. Nothing changes until someone clicks
**Use this agenda**, **Replace my notes** or **Create task**, and replaced
notes can be undone until you save. Only people who can edit the meeting
(attendees, the department admin, Admin) see the buttons, and the server checks
the same rule before every call.

To turn it on, add `ANTHROPIC_API_KEY` in Vercel (Settings, Environment
Variables, type **Secret**) and redeploy. Without it the buttons are hidden.
If Claude declines a request, the API retries it once on Anthropic's
recommended fallback model.

### 7. First login

`hanzala@highfy.pk` becomes an active Admin on first sign-in. Everyone else
lands on "Waiting for approval" until an Admin approves them under **People**
and adds them to a department (as Member or Dept admin).

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
