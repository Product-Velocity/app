import { renderJiraHarness } from "../render";

export default function Harness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return renderJiraHarness(searchParams, "mapping");
}
