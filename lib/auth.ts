import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Department, DeptRole, Profile, SubTeam } from "@/lib/types";

export const ALLOWED_DOMAIN = "highfy.pk";

export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

export type Viewer = {
  id: string;
  email: string;
  profile: Profile;
  isAdmin: boolean;
  /** Departments this person belongs to, with their role in each. */
  memberships: { department_id: string; role: DeptRole }[];
  leadDeptIds: string[];
  memberDeptIds: string[];
  isAnyLead: boolean;
};

/** The signed-in user and their profile, or null. Cached per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  // getClaims() checks the session token's signature locally (no round trip
  // to Supabase Auth) when the project uses asymmetric JWT signing keys.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const user = claims ? { id: claims.sub, email: claims.email as string | undefined } : null;
  if (!user || !isAllowedEmail(user.email)) return null;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>(),
    supabase.from("department_members").select("department_id, role").eq("user_id", user.id),
  ]);
  if (!profile) return null;

  const ms = (memberships ?? []) as { department_id: string; role: DeptRole }[];
  return {
    id: user.id,
    email: user.email!,
    profile,
    isAdmin: profile.status === "active" && profile.is_admin,
    memberships: ms,
    leadDeptIds: ms.filter((m) => m.role === "lead").map((m) => m.department_id),
    memberDeptIds: ms.map((m) => m.department_id),
    isAnyLead: ms.some((m) => m.role === "lead"),
  };
});

/** For pages inside the app: must be signed in, Highfy, and approved. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.profile.status !== "active") redirect("/pending");
  return viewer;
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) redirect("/");
  return viewer;
}

export function canLead(viewer: Viewer, departmentId: string): boolean {
  return viewer.isAdmin || viewer.leadDeptIds.includes(departmentId);
}

export function isMemberOf(viewer: Viewer, departmentId: string): boolean {
  return viewer.isAdmin || viewer.memberDeptIds.includes(departmentId);
}

/** Departments the viewer can see (RLS decides). Cached per request. */
export const getDepartments = cache(async (): Promise<Department[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("departments")
    .select("id, name, slug, archived, sort_order, meeting_weekday, meeting_time")
    .order("sort_order")
    .order("name");
  return (data ?? []) as Department[];
});

export const getSubTeams = cache(async (): Promise<SubTeam[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("sub_teams").select("id, department_id, name, archived").order("name");
  return (data ?? []) as SubTeam[];
});

/** Active people, for owner / attendee pickers. */
export const getPeople = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url")
    .eq("status", "active")
    .order("full_name", { nullsFirst: false });
  return (data ?? []) as Pick<Profile, "id" | "email" | "full_name" | "avatar_url">[];
});

/** department_id → user ids, for departments the viewer can see. */
export const getDepartmentMembers = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("department_members").select("department_id, user_id, role");
  return (data ?? []) as { department_id: string; user_id: string; role: DeptRole }[];
});
