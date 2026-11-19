import { PartnershipIndexPage } from "@/components/partnerships/partnership-index";

export const metadata = { title: "Brand partnerships · Highfy Tasks" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PartnershipIndexPage raw={await searchParams} />;
}
