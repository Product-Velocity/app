import { renderJiraHarness } from "./render";

export default function JiraHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return renderJiraHarness(searchParams, "configure");
}
