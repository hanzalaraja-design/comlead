import { DomainIndexPage } from "@/components/projects/domain-pages";

export const metadata = { title: "Partnerships · Highfy Tasks" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <DomainIndexPage kind="partnership" raw={await searchParams} />;
}
