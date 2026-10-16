import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Create a meeting and invite everyone in the department (attendees can be
 * edited afterwards). Runs as the signed-in user, so RLS decides whether
 * they may.
 */
export async function insertMeeting(
  supabase: SupabaseClient,
  viewerId: string,
  m: { department_id: string; meeting_date: string; meeting_time: string | null; title: string | null; sub_team_id?: string | null },
): Promise<{ id?: string; error?: { message?: string; code?: string } }> {
  const { data, error } = await supabase
    .from("meetings")
    .insert({ ...m, sub_team_id: m.sub_team_id ?? null, created_by: viewerId })
    .select("id")
    .single();
  if (error || !data) return { error: error ?? { message: "Couldn't create the meeting." } };

  const { data: members } = await supabase.from("department_members").select("user_id").eq("department_id", m.department_id);
  if (members?.length) {
    await supabase.from("meeting_attendees").insert(members.map((x) => ({ meeting_id: data.id, user_id: x.user_id })));
  }
  return { id: data.id as string };
}
