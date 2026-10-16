# Highfy Tasks: Product Spec (v1)

## 1. What we are building

An internal web app for Highfy where every department tracks its to-dos, stores its weekly meeting minutes, and turns meeting action items into tasks. The CEO (Hanzala) can see everything across departments, including a daily activity log of who did what.

Later phases connect Microsoft Calendar (Outlook) and WhatsApp for quick status updates.

## 2. Tech stack

- Next.js (App Router) with TypeScript
- Supabase: Postgres database, Auth, Row Level Security (RLS)
- Vercel for hosting
- Tailwind CSS with shadcn/ui components
- Code lives in a GitHub repo, auto-deployed to Vercel
- Timezone for all dates and "today" logic: Asia/Karachi (PKT)
- Must work well on mobile phones (most of the team will check it on phone)

## 3. Access and login

- Login with Microsoft work account only (Supabase Auth, Azure/Microsoft provider). The company is on Microsoft 365.
- Only emails ending in `@highfy.pk` may access. Enforce this in three places:
  1. Microsoft app registration set to single tenant (Highfy only)
  2. Server-side check on sign-in: reject and sign out any other domain
  3. Database RLS policies so no data is readable without a valid Highfy user
- First login creates a profile automatically. New users land in a "pending" state until an Admin assigns them a department and role.

### Roles
| Role | Can do |
|---|---|
| Admin | Everything. Sees all departments, all tasks, all meetings, all activity. Manages users and departments. |
| Department Lead | Full control of their department: tasks, meetings, minutes, members. Can view other departments read-only. |
| Member | Sees their own department's tasks and meetings. Can create tasks, update tasks assigned to them, comment. |

A person can belong to more than one department.

## 4. Departments

Seed these departments:

1. Commercial
2. Ops
3. Finance
4. Marketing, with sub-teams: SEO, Affiliate, CRM, Performance
5. Content
6. Brand
7. HR
8. Customer Experience

Sub-teams are optional labels inside a department. Tasks and meetings can be tagged with a sub-team. Admin can add, rename or archive departments and sub-teams later.

## 5. Tasks (to-dos)

### Fields
- Title (required)
- Description (rich text)
- Department (required)
- Sub-team (optional)
- Owner (one person responsible)
- Collaborators (optional, other people involved)
- Status: To do, In progress, Blocked, Done, Cancelled
- Priority: Urgent, High, Medium, Low
- Due date (optional time)
- Source: Manual, Meeting, WhatsApp (later)
- Linked meeting (if it came from meeting minutes)
- Tags (free labels, e.g. "Q4", "Birthday Bash")
- Blocked reason (shown when status is Blocked)
- Created by, created at, updated at, completed at
- Comments thread on each task
- Attachments (stored in Supabase Storage)

### Sorting and filtering
Sort and filter by any of:
- Status
- Owner
- Due date
- Department
- Sub-team
- Priority
- Source meeting
- Created date
- Completed date
- Tags
- Overdue (due date passed and not Done/Cancelled)

Filters must combine (e.g. Marketing + Overdue + Owner = X) and be shareable via URL.

### Built-in views
- **My Tasks**: everything I own, grouped by Overdue, Today, This week, Later, No date
- **Department board**: Kanban by status for one department
- **List view**: table with all sort/filter options
- **Calendar view**: tasks by due date
- **Overdue**: across all departments I can see

Users can save their own custom views.

## 6. Weekly meetings and minutes

Each department has one recurring weekly meeting (day and time set per department).

### Meeting record
- Department (and optional sub-team)
- Date and time
- Attendees
- Agenda
- Minutes (rich text editor)
- Decisions (short list)
- Action items

### Action items become tasks
- Inside the minutes, each action item has: text, owner, due date, priority.
- Saving the meeting creates a real task for each action item, linked back to the meeting (Source = Meeting).
- Editing the task later updates the action item status shown in the meeting, and vice versa.

### Carry forward
When a new weekly meeting is created, it auto-shows a "Last week's action items" section with their current status, so each meeting starts by reviewing what was promised last time.

### Meeting archive
- Every department has a Meetings page listing all past meetings, newest first.
- Full-text search across all minutes.
- Filter by department, date range, attendee.

## 7. Activity log

Every meaningful action is recorded automatically, using database triggers so nothing is missed:

- Task created, edited, status changed, reassigned, due date changed, completed, deleted
- Comment added
- Meeting created, minutes edited, action items added
- User added to or removed from a department

Each log entry stores: who, what action, which item, old value, new value, timestamp (PKT).

### Activity views
- **Daily view per person**: pick a person and a date, see everything they did that day in time order, plus a summary (e.g. "Completed 6 tasks, created 3, updated 2 meetings").
- **Team view for a day**: everyone's activity for a date, filterable by department.
- Admin sees all. Leads see their department. Members see their own.
- Log entries cannot be edited or deleted by anyone through the app.

## 8. CEO dashboard (Admin only)

- Per department: open tasks, overdue tasks, completed this week, blocked tasks
- Per person: completed this week, overdue count
- Meetings this week: held or missing minutes per department
- Click any number to open the filtered list behind it

## 9. Phases

Build in this order. Do not start a phase until the previous one is working and approved.

### Phase 1: Core (build now)
Login and domain lock, roles, departments, tasks with all views, meetings with minutes and action items, activity log, CEO dashboard.

### Phase 2: Microsoft Calendar
Using Microsoft Graph:
- Each department's weekly meeting appears in attendees' Outlook calendars, with a link to its minutes page
- Optional per user: tasks with due dates appear as Outlook events or reminders
- Changes in the app update the Outlook event

### Phase 3: WhatsApp
Using the WhatsApp Business Cloud API (Meta):
- Morning message to each person: their tasks due today and overdue
- Each task has quick reply buttons: Done, In progress, Blocked
- Tapping a button updates the task and writes to the activity log (Source = WhatsApp)
- Users link their WhatsApp number in their profile; only linked numbers can update tasks

### Phase 4: Notifications
- In-app notifications for new assignments, comments, mentions
- Daily or weekly email digest per person and per department lead

## 10. Not in v1
- Time tracking
- Recurring tasks (consider in Phase 4)
- External users or brand partners
- Native mobile app (the web app should just work well on phones)

## 11. Rules for building (for Claude Code)
- Write all database changes as Supabase migrations in the repo
- Include a seed file with the departments and sub-teams above
- Enable RLS on every table; test that a Member cannot read another department's data
- Never commit secrets; use environment variables in Vercel
- Keep the UI clean and simple; mobile-first
- After each phase, give a short summary of what was built and how to test it

## 12. Decisions

### Confirmed
1. Members can see only their own department's tasks and meetings. They cannot see other departments at all, not even read-only. Enforce this with RLS, not just by hiding it in the UI.

### To be decided later (do not block Phase 1 on these)
2. Department leads for each department. Build the Admin screen so leads can be assigned any time after launch.
3. Weekly meeting day and time per department. Make this editable per department by Admin and the department lead.
4. Whether task due dates go to Outlook for everyone by default or opt-in. Decide before Phase 2.
