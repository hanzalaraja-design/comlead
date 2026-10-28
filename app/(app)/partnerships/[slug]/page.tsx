import { DomainListPage } from "@/components/projects/domain-pages";

export const metadata = { title: "Partnerships · Highfy Tasks" };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function Page(props: Props) {
  return <DomainListPage kind="partnership" {...props} />;
}
