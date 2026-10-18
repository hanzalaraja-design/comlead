export type UserStatus = "pending" | "active" | "disabled";
export type DeptRole = "lead" | "member";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type TaskPriority = "urgent" | "high" | "medium" | "low";
export type TaskSource = "manual" | "meeting" | "whatsapp";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  status: UserStatus;
  outlook_tasks_enabled?: boolean;
  created_at: string;
};

export type PersonRef = Pick<Profile, "id" | "email" | "full_name" | "avatar_url">;

export type Department = {
  id: string;
  name: string;
  slug: string;
  archived: boolean;
  sort_order: number;
  meeting_weekday: number | null;
  meeting_time: string | null;
  meeting_duration_minutes: number;
};

export type SubTeam = {
  id: string;
  department_id: string;
  name: string;
  archived: boolean;
};

export type Membership = {
  department_id: string;
  user_id: string;
  role: DeptRole;
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  /** null = personal task, visible only to its owner. */
  department_id: string | null;
  sub_team_id: string | null;
  owner_id: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  source: TaskSource;
  meeting_id: string | null;
  tags: string[];
  blocked_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

/** Task row with the joins used by list views. */
export type TaskRow = Task & {
  owner: PersonRef | null;
  department: Pick<Department, "id" | "name" | "slug"> | null;
  sub_team: Pick<SubTeam, "id" | "name"> | null;
  meeting: { id: string; title: string | null; meeting_date: string } | null;
};

export type Meeting = {
  id: string;
  department_id: string;
  sub_team_id: string | null;
  title: string | null;
  meeting_date: string;
  meeting_time: string | null;
  agenda: string | null;
  minutes: string | null;
  decisions: string[];
  series_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivityEntry = {
  id: number;
  created_at: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  department_id: string | null;
  task_id: string | null;
  meeting_id: string | null;
  subject_user_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
};

export type SavedView = {
  id: string;
  name: string;
  path: string;
  created_at: string;
};
