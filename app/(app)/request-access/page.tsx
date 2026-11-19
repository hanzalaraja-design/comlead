import { notFound, redirect } from "next/navigation";
import { RequestAccessCard, type AccessInfo } from "@/components/access/request-access-card";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Request access" };

/**
 * Opened a task, project, campaign or partnership you can't see: who has
 * access now and a button to ask. Something that doesn't exist is still
 * "not found".
 */
export default async function RequestAccessPage({ searchParams }: { searchParams: Promise<{ task?: string; project?: string }> }) {
  const [sp] = await Promise.all([searchParams, requireViewer()]);
  const type = sp.task ? "task" : sp.project ? "project" : null;
  const key = sp.task ?? sp.project ?? "";
  if (!type || !key) notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc("access_info", { p_type: type, p_key: key });
  const info = data as (AccessInfo & { can_read: boolean; id: string; slug?: string }) | null;
  if (!info) notFound();
  if (info.can_read) redirect(type === "task" ? `/tasks/${info.id}` : `/${info.kind}s/${info.slug}`);
  return (
    <div className="mx-auto max-w-3xl pt-4 md:pt-10">
      <RequestAccessCard info={info} accessKey={key} />
    </div>
  );
}
