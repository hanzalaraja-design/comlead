/**
 * The kinds of notification, as the settings page lists them. Shared by the
 * server (lib/notify) and the settings form.
 */

export type NotifyKindInfo = { key: string; label: string; hint?: string };

export const NOTIFY_GROUPS: { title: string; kinds: NotifyKindInfo[] }[] = [
  {
    title: "Your tasks",
    kinds: [
      { key: "assigned", label: "Assigned to me", hint: "Someone gives you a task or moves one to you" },
      { key: "collaborator", label: "Added as a collaborator" },
      { key: "mention", label: "Mentioned", hint: "Someone types @ and your name in a comment" },
      { key: "comment", label: "Comments", hint: "On tasks you own, made, work on or commented on" },
      { key: "finished", label: "Finished", hint: "A task you gave someone, or work on, is done" },
      { key: "status", label: "Status changes", hint: "Started, blocked, reopened" },
      { key: "due", label: "Due date changed" },
      { key: "edits", label: "Other changes", hint: "Title, description, team, files, subtasks" },
    ],
  },
  {
    title: "Reminders",
    kinds: [
      { key: "roundup", label: "Morning roundup", hint: "What's due today and overdue, at 9:30 am" },
      { key: "due_tomorrow", label: "Due tomorrow", hint: "A heads-up at 6 pm" },
    ],
  },
  {
    title: "Projects, campaigns and meetings",
    kinds: [
      { key: "project_added", label: "Added to a project, campaign or partnership" },
      { key: "project_task", label: "New tasks in ones I own" },
      { key: "meeting", label: "Added to a meeting" },
    ],
  },
  {
    title: "Placements and design",
    kinds: [
      { key: "design_new", label: "New work for my team", hint: "Bookings and requests for Design; banners for Tech to put live" },
      { key: "my_requests", label: "My requests", hint: "Sent for review, completed, comments" },
      { key: "revision", label: "Revisions and comments on what I'm designing" },
      { key: "ending", label: "Banners ending soon", hint: "For Commercial and whoever booked them" },
      { key: "homepage_today", label: "What goes live or comes down today", hint: "For Tech" },
    ],
  },
];

/** Off by default for push (they still show on the Notifications page). Matches the database default. */
export const PUSH_OFF_DEFAULT = ["status", "due", "edits", "project_task", "meeting", "ending"];

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
