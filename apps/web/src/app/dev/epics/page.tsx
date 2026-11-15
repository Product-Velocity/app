import { notFound } from "next/navigation";
import { EpicsView } from "@/features/incoming/epics-view";
import { classifyEpics, type SeenEpic } from "@/lib/atlassian/epic-coverage";

/** Test page for the Epics list on Incoming (issue #464) with fictional data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function EpicsTestPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  const e = (key: string, title: string, o: Partial<SeenEpic> = {}): SeenEpic => ({ key, project: key.split("-")[0]!, title, status: "In Progress", category: "indeterminate", parentKey: null, url: `https://meridian.example.test/browse/${key}`, updatedAt: null, ...o });
  const items = [{ id: "i1", code: "R-01", name: "Takeover fix" }, { id: "i2", code: "R-02", name: "Checkout redesign" }, { id: "i3", code: "R-03", name: "Search relevance" }];
  const rows = classifyEpics({
    epics: [e("R8P-12", "Takeover: payment retries"), e("R8P-13", "Checkout: address form"), e("R8P-14", "Tech debt: logging"), e("R8P-15", "Search: synonyms", { parentKey: "RR-9" }), e("PUB-3", "Publisher onboarding"), e("R8P-20", "Takeover: refunds")],
    items, links: [{ itemId: "i1", issueKey: "R8P-12" }], tree: [{ itemId: "i2", issueKey: "R8P-13" }], requests: [{ itemId: "i3", epicKey: "PUB-3", state: "pending", error: null }],
  });
  return <EpicsView rows={rows} initiatives={items} projects={q.empty ? [] : ["R8P", "PUB"]} lastRead="2026-11-15T21:30:00Z" canEdit canAdmin />;
}
