import { JiraSettings } from "../jira-settings";

export const metadata = { title: "Projects · Jira · Product Velocity" };
/** Reading Jira and pulling issues in run from this section: allow the longest run the plan offers. */
export const maxDuration = 60;

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string; ignored?: string; why?: string; project?: string; t?: string }> }) {
  return <JiraSettings section="projects" searchParams={searchParams} />;
}
