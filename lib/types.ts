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
  /** A department, or a project team that people from several departments join. */
  kind: "department" | "project";
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
  owner_id: string | null;
  status: TaskStatus;
  priority: TaskPriority;
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
  /** Same task given to several people: their copies share this. */
  set_id?: string | null;
  project_id?: string | null;
  /** Set on a subtask: the task it's part of. */
  parent_task_id?: string | null;
  /** Who gave it to its owner, and when. Set automatically. */
  assigned_by?: string | null;
  assigned_at?: string | null;
  /** Locked: only its owner can change it. */
  locked?: boolean;
};

/** Task row with the joins used by list views. */
export type TaskRow = Task & {
  owner: PersonRef | null;
  department: Pick<Department, "id" | "name" | "slug"> | null;
  meeting: { id: string; title: string | null; meeting_date: string } | null;
  project?: Pick<Project, "id" | "name" | "slug" | "kind"> | null;
  /** The main task, when this is a subtask. */
  parent?: { id: string; title: string } | null;
  /** Its subtasks, for the "1/3" count. */
  subtasks?: { status: TaskStatus }[];
  /** Who's helping, besides the owner. */
  collaborators?: { user_id: string }[];
};

export type ProjectKind = "project" | "campaign" | "partnership";
export type PartnerCategory = "beauty" | "non_beauty";

/** A folder of tasks people from any team share. */
export type Project = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: ProjectKind;
  /** Partnerships only: beauty or non-beauty brand. */
  category: PartnerCategory | null;
  /** Locked: only its owners can change it. */
  locked: boolean;
  start_date: string | null;
  end_date: string | null;
  /** Teams in the project: everyone in them is in it. */
  team_ids: string[];
  archived: boolean;
  created_by: string | null;
  created_at: string;
};

export type Meeting = {
  id: string;
  department_id: string;
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
