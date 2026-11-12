import { redirect } from "next/navigation";

/** Comments became Notifications; mentions are one of its tabs. */
export default function CommentsPage() {
  redirect("/notifications?show=mentions");
}
