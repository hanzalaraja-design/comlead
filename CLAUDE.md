# Highfy Tasks: guide for Claude sessions

Internal task app for Highfy (beauty e-commerce, Pakistan), live at
**tasks.highfy.pk**. Owner: Hanzala (Admin). Read this first; README.md and
SPEC.md describe the original Phase 1 and are partly out of date.

## How we work with Hanzala

- Plain language, short answers, no jargon. Hanzala is not a developer.
- Big or visual changes: show a preview first (a quick HTML mockup or a
  screenshot of the real page), then build.
- Every change goes through a pull request on `hanzalaraja-design/comlead`.
  **Merge only when Hanzala says "merge" (or "done" right after running the SQL).**
  Merge with `gh api -X PUT repos/hanzalaraja-design/comlead/pulls/<n>/merge -f merge_method=merge`,
  then watch `gh api repos/hanzalaraja-design/comlead/commits/<sha>/status` until both
  Vercel checks pass.
- **Go-live order:** if a PR has a SQL file, Hanzala runs it in Supabase → SQL Editor
  first (send the file with the file-sending tool), then merge. Say clearly when a PR
  needs no SQL.
- Give exact click-by-click steps for Vercel, Supabase and Meta, and ask for a
  screenshot when something doesn't match.
- When something can't be tested here, say so; don't claim it works.

## Never

- Never ask for, paste or commit secrets (API keys, tokens, passwords, app secrets).
  They go only in Vercel environment variables, entered by Hanzala. If a session
  needs a key for an outside API, use the secure credential form, not chat.
- The Claude connector (`lib/mcp`) and the WhatsApp assistant must never delete or
  cancel anything, change admin settings, approve people or lock things.
- Don't use the meeting assistant or connector to bypass permissions: everything
  runs as the signed-in person, under Supabase RLS.

## Stack

- Next.js 16 App Router + TypeScript, Tailwind + shadcn/ui, League Spartan font.
  Brand rules and copy voice: `docs/BRAND.md` (sentence case, no exclamation marks,
  no em dashes, British spelling, calm and plain).
- Supabase: Postgres with RLS on every table, Auth (Microsoft, `@highfy.pk` only),
  Storage. Server code uses `lib/supabase/server.ts` (as the user) or
  `lib/supabase/admin.ts` (service role, only for system jobs).
- All dates and "today" are Pakistan time (`lib/time.ts`: `todayPKT`, `formatDate`, …).
- Hosting: two Vercel projects build `main`: **comlead-efsw** serves tasks.highfy.pk
  (the one that matters); **comlead** is a second copy. Environment variables live on
  the team **Shared** tab, linked to comlead-efsw. After changing a variable:
  Deployments → ⋯ → Redeploy.
- `next build` may stop once with a Next.js "security vulnerability" notice; running
  it again continues. An upgrade of Next.js is still to do (ask first).

## Map

| Area | Where |
|---|---|
| Task pages ("What's up": time tabs, counts, grouped list, By person) | `app/(app)/my`, `app/(app)/tasks`, `components/tasks/whats-up.tsx`, `lib/tasks/period.ts` |
| Task data and filters | `lib/tasks/queries.ts`, `lib/tasks/filters.ts`, `app/(app)/tasks/actions.ts` |
| Projects, campaigns, partnerships | `app/(app)/projects` etc., `lib/domains.ts`, `lib/projects.ts` |
| Meetings and the meeting assistant (Claude) | `app/(app)/meetings`, `lib/ai/claude.ts`, Admin → Meeting assistant |
| Placements (homepage banners), Design requests | `app/(app)/placements`, `components/placements`, `lib/placements.ts`, `lib/creative.ts` |
| Daily deals | `app/(app)/daily-deals`, `components/daily-deals` |
| Notifications (page + web push; no emails) | `supabase/migrations/*_notifications.sql` (triggers on the activity log), `lib/notify.ts`, `lib/push.ts`, `public/sw.js`, `app/(app)/notifications` |
| Claude connector (MCP) | `app/api/mcp`, `lib/mcp/tools.ts`, `lib/mcp/keys.ts` |
| WhatsApp (message or voice note → tasks) | `app/api/whatsapp`, `lib/whatsapp.ts`, `lib/whatsapp-agent.ts` (reuses the connector tools), `lib/transcribe.ts` |
| Daily jobs | `app/api/cron/*`, schedules in `vercel.json` |
| Settings (notifications, WhatsApp link, Outlook, Claude link) | `app/(app)/settings` |

## Database changes

- New file in `supabase/migrations/`, named `YYYYMMDD00NNNN_what.sql`, numbered after
  the last one. Never edit a file that has already been run.
- Enable RLS and write policies for every new table; revoke from `anon`.
- End with `notify pgrst, 'reload schema';` so the API sees new tables at once.
- The app should keep working if a release goes out before its SQL is run
  (read new tables defensively).

## Checks before a PR

`npx tsc --noEmit -p .`, `npx eslint app components lib`, and `npx next build`.
For UI work, run the app and look at it (Playwright and Chromium are preinstalled;
screenshot at deviceScaleFactor 2 for anything Hanzala will see). There is no
shared test database: the last local Postgres + PostgREST + GoTrue stack lived in a
scratchpad and is gone, so rebuild one if a change needs a real end-to-end test.

## Outside services (set up by Hanzala; keys in Vercel)

- **Anthropic** `ANTHROPIC_API_KEY` (meeting assistant, WhatsApp). Admin → Meeting
  assistant shows whether the live site sees each key (lengths only).
- **Web push** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
- **WhatsApp** (Meta Cloud API, number +92 320 8796020, phone number ID
  1381585775048064, WhatsApp account "Highfy Tasks" 1014842014319816, Meta app
  "Highfy Tasks"): `WHATSAPP_TOKEN` (system user "Highfy Tasks bot"),
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
  `WHATSAPP_DISPLAY_NUMBER`; voice notes need `OPENAI_API_KEY`. People link their
  number in My settings → WhatsApp.
- **Microsoft Graph** `MS_*` (Outlook calendar invites).
- **Supabase** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`; `CRON_SECRET` for the daily jobs.

## Open items

- `bulk-select` branch: tick boxes, Select all and a bulk bar (done, due date,
  give to, delete) for task lists; not tested yet. Placements still need the same.
- WhatsApp: rules from Hanzala on how messages map to tasks are still to come.
- Next.js security upgrade.
