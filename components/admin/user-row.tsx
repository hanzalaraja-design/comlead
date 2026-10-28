"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/person-avatar";
import { fullName } from "@/lib/labels";
import type { DeptRole, Profile } from "@/lib/types";
import { setUserAdmin, setUserStatus } from "@/app/(app)/admin/actions";
import { addMember, removeMember, setMemberRole } from "@/app/(app)/departments/actions";

type Dept = { id: string; name: string };

export function UserRow({
  user,
  memberships,
  departments,
  isSelf,
}: {
  user: Profile;
  memberships: { department_id: string; role: DeptRole }[];
  departments: Dept[];
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [deptToAdd, setDeptToAdd] = useState("");
  const [roleToAdd, setRoleToAdd] = useState<DeptRole>("member");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(success);
      else toast.error(res.error ?? "Something went wrong");
    });

  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const available = departments.filter((d) => !memberships.some((m) => m.department_id === d.id));

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <PersonAvatar person={user} className="h-9 w-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {fullName(user)}
            {user.is_admin && <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">ADMIN</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user.status === "pending" && (
            <Button size="sm" disabled={pending} onClick={() => run(() => setUserStatus(user.id, "active"), "Approved")}>
              Approve
            </Button>
          )}
          {user.status === "disabled" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setUserStatus(user.id, "active"), "Access restored")}>
              Restore access
            </Button>
          )}
          {user.status === "active" && !isSelf && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={pending}
              onClick={() => {
                if (confirm(`Turn off access for ${fullName(user)}?`)) run(() => setUserStatus(user.id, "disabled"), "Access turned off");
              }}
            >
              Disable
            </Button>
          )}
          {!isSelf && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={user.is_admin}
                disabled={pending}
                onChange={(e) => run(() => setUserAdmin(user.id, e.target.checked), e.target.checked ? "Now an Admin" : "Admin removed")}
              />
              Admin
            </label>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-12">
        {memberships.length === 0 && <span className="text-xs text-muted-foreground">No department yet</span>}
        {memberships.map((m) => (
          <span key={m.department_id} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-3 pr-1 text-xs">
            {deptName.get(m.department_id) ?? "Archived"}
            <select
              aria-label="Role"
              value={m.role}
              disabled={pending}
              onChange={(e) => run(() => setMemberRole(m.department_id, user.id, e.target.value as DeptRole), "Role updated")}
              className="rounded bg-transparent text-xs font-medium"
            >
              <option value="member">Member</option>
              <option value="lead">Dept admin</option>
            </select>
            <button
              type="button"
              aria-label="Remove from department"
              disabled={pending}
              className="rounded-full p-0.5 text-muted-foreground hover:text-danger"
              onClick={() => run(() => removeMember(m.department_id, user.id), "Removed")}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {available.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <select
              aria-label="Add to department"
              value={deptToAdd}
              onChange={(e) => setDeptToAdd(e.target.value)}
              className="h-7 field px-1 text-xs"
            >
              <option value="">+ Department…</option>
              {available.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {deptToAdd && (
              <>
                <select
                  aria-label="Role"
                  value={roleToAdd}
                  onChange={(e) => setRoleToAdd(e.target.value as DeptRole)}
                  className="h-7 field px-1 text-xs"
                >
                  <option value="member">Member</option>
                  <option value="lead">Dept admin</option>
                </select>
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const res = await addMember(deptToAdd, user.id, roleToAdd);
                      if (res.ok) setDeptToAdd("");
                      return res;
                    }, "Added")
                  }
                >
                  Add
                </Button>
              </>
            )}
          </span>
        )}
      </div>
    </li>
  );
}
