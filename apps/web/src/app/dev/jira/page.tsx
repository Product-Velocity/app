import { notFound } from "next/navigation";
import { connectNoop, disconnectNoop } from "./actions";
import { JiraConnectionsView, type JiraConnectionView } from "@/components/jira-connections-view";

/** Test page for the Jira settings with fixed data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function JiraHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  const state = q.state === "needs" ? "reconnect_needed" : "connected";
  const none = q.state === "none";
  const connections: JiraConnectionView[] = none
    ? []
    : [
        {
          id: "c1",
          state,
          sites: [{ id: "s1", name: "Acme Corp", url: "https://acme.example" }],
          created_at: "2026-11-02T10:00:00Z",
          state_changed_at: "2026-11-05T10:00:00Z",
          projects:
            state === "connected"
              ? [{ siteId: "s1", projects: [{ key: "PLAT", name: "Platform", type: "software", style: "next-gen" }, { key: "DISC", name: "Discovery", type: "product_discovery", style: "next-gen" }] }]
              : [],
        },
      ];
  return <JiraConnectionsView connections={connections} canAdmin={q.role !== "viewer"} configured={q.configured !== "0"} status={q.status} connectAction={connectNoop} disconnectAction={disconnectNoop} />;
}
