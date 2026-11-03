import { JiraSettings } from "./jira-settings";

export const metadata = { title: "Jira · Product Velocity" };

export default function JiraSettingsPage({ searchParams }: { searchParams: Promise<{ status?: string; ignored?: string; c?: string; ch?: string; m?: string }> }) {
  return <JiraSettings section="configure" searchParams={searchParams} />;
}
