import { redirect } from "next/navigation";

/** Departments are managed at the bottom of People now. */
export default function AdminDepartmentsPage() {
  redirect("/admin/users#departments");
}
