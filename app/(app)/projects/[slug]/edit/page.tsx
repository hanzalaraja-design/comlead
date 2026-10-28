import { DomainEditPage } from "@/components/projects/domain-pages";

export const metadata = { title: "Edit · Projects · Highfy Tasks" };

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <DomainEditPage kind="project" params={params} />;
}
