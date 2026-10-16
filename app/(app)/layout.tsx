import { AppNav } from "@/components/app-nav";
import { requireViewer } from "@/lib/auth";
import { personName } from "@/lib/labels";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <AppNav isAdmin={viewer.isAdmin} name={personName(viewer.profile)} email={viewer.email} />
      <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-10 md:pt-8">{children}</main>
    </div>
  );
}
