import { DomainNewPage } from "@/components/projects/domain-pages";

export const metadata = { title: "New · Campaigns · Highfy Tasks" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <DomainNewPage kind="campaign" searchParams={searchParams} />;
}
