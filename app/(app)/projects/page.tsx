import { DomainIndexPage } from "@/components/projects/domain-pages";

export const metadata = { title: "Projects · Highfy Tasks" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <DomainIndexPage kind="project" raw={await searchParams} />;
}
