import { JiraSettings } from "./jira-settings";

export const metadata = { title: "Connection · Jira · Product Velocity" };

export default function JiraConnectionPage({ searchParams }: { searchParams: Promise<{ status?: string; why?: string }> }) {
  return <JiraSettings section="connection" searchParams={searchParams} />;
}
