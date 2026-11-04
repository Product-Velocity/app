import { JiraSettings } from "../jira-settings";

export const metadata = { title: "Jira sync logs · Product Velocity" };
/** "Check Jira now" reads every linked issue and its children: allow the longest run the plan offers. */
export const maxDuration = 60;

export default function JiraLogsPage({ searchParams }: { searchParams: Promise<{ status?: string; ignored?: string; c?: string; ch?: string; m?: string; why?: string }> }) {
  return <JiraSettings section="logs" searchParams={searchParams} />;
}
