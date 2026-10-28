import { DomainCalendarPage } from "@/components/projects/domain-pages";

export const metadata = { title: "Projects · Highfy Tasks" };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function Page(props: Props) {
  return <DomainCalendarPage kind="project" {...props} />;
}
