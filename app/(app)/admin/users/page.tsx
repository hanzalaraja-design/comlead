import { PageHeader } from "@/components/page-header";
import { UserRow } from "@/components/admin/user-row";
import { getDepartmentMembers, getDepartments, requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { DeptRole, Profile } from "@/lib/types";

export const metadata = { title: "People · Highfy Tasks" };

const ORDER = { pending: 0, active: 1, disabled: 2 } as const;

export default async function AdminUsersPage() {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const [{ data }, departments, members] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name", { nullsFirst: false }),
    getDepartments(),
    getDepartmentMembers(),
  ]);
  const users = ((data ?? []) as Profile[]).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const byUser = new Map<string, { department_id: string; role: DeptRole }[]>();
  for (const m of members) {
    if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
    byUser.get(m.user_id)!.push({ department_id: m.department_id, role: m.role });
  }
  const depts = departments.filter((d) => !d.archived).map((d) => ({ id: d.id, name: d.name }));

  const groups = [
    { key: "pending", title: "Waiting for approval", hint: "Approve and add them to a department." },
    { key: "active", title: "Active" },
    { key: "disabled", title: "Disabled" },
  ] as const;

  return (
    <>
      <PageHeader
        breadcrumb={["Admin", "People"]}
        title="People"
        description="New people appear here after their first Microsoft sign-in. Roles are set per department."
      />
      <div className="space-y-8">
        {groups.map((g) => {
          const list = users.filter((u) => u.status === g.key);
          if (!list.length) return null;
          return (
            <section key={g.key}>
              <h2 className="kicker mb-1 text-brand-primary">
                {g.title} <span className="font-normal text-muted-foreground">· {list.length}</span>
              </h2>
              {"hint" in g && <p className="mb-2 text-xs text-muted-foreground">{g.hint}</p>}
              <ul className="divide-y divide-brand-panel surface">
                {list.map((u) => (
                  <UserRow key={u.id} user={u} memberships={byUser.get(u.id) ?? []} departments={depts} isSelf={u.id === admin.id} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
