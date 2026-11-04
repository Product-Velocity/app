import { JiraSettings } from "./jira-settings";

export const metadata = { title: "Jira · Product Velocity" };
/** "Read Jira now" and pulling issues in run from this page: allow the longest run the plan offers. */
export const maxDuration = 60;

export default function JiraSettingsPage({ searchParams }: { searchParams: Promise<{ status?: string; ignored?: string; c?: string; ch?: string; m?: string; why?: string }> }) {
  return <JiraSettings section="configure" searchParams={searchParams} />;
}
