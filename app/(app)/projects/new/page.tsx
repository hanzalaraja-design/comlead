import { DomainNewPage } from "@/components/projects/domain-pages";

export const metadata = { title: "New · Projects · Highfy Tasks" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <DomainNewPage kind="project" searchParams={searchParams} />;
}
