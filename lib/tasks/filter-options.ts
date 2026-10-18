import { createClient } from "@/lib/supabase/server";
import { getDepartments, getPeople } from "@/lib/auth";
import { personName } from "@/lib/labels";
import { formatDate } from "@/lib/time";
import type { FilterOptions } from "@/components/tasks/task-filter-bar";

/** Options for the task filter bar, limited to what the viewer can see. */
export async function getFilterOptions(opts: { departmentId?: string } = {}): Promise<FilterOptions> {
  const supabase = await createClient();
  const [departments, people, tagsRes, meetingsRes] = await Promise.all([
    getDepartments(),
    getPeople(),
    supabase.rpc("visible_task_tags"),
    (() => {
      let q = supabase.from("meetings").select("id, title, meeting_date, department_id").order("meeting_date", { ascending: false }).limit(60);
      if (opts.departmentId) q = q.eq("department_id", opts.departmentId);
      return q;
    })(),
  ]);

  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  return {
    departments: departments.filter((d) => !d.archived).map((d) => ({ value: d.slug, label: d.name })),
    people: people.map((p) => ({ value: p.id, label: personName(p), hint: p.email })),
    tags: ((tagsRes.data ?? []) as unknown as (string | { visible_task_tags: string })[]).map((t) =>
      typeof t === "string" ? t : t.visible_task_tags,
    ),
    meetings: (meetingsRes.data ?? []).map((m) => ({
      value: m.id as string,
      label: `${m.title || "Meeting"} · ${formatDate(m.meeting_date as string, "d MMM")}`,
      hint: opts.departmentId ? undefined : deptName.get(m.department_id as string),
    })),
  };
}
