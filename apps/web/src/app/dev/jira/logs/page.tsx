import { renderJiraHarness } from "../render";

export default function JiraLogsHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return renderJiraHarness(searchParams, "logs");
}
