import { notFound } from "next/navigation";
import { connectNoop, disconnectNoop, formNoop } from "./actions";
import { JiraConnectionsView, type JiraConnectionView, type JiraProjectLinkView } from "@/components/jira-connections-view";

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
  // ?step=choose (one linked, one waiting for a Jira project) | types (the issue types of the chosen Jira project) | change (Change pressed on the linked one)
  const step = q.step ?? "choose";
  const types = [{ id: "10001", name: "Epic" }, { id: "10002", name: "Feature" }, { id: "10003", name: "Task" }, { id: "10004", name: "Subtask" }];
  const projectLinks: JiraProjectLinkView[] = [
    {
      projectId: "p1", projectName: "Platform", choosing: step === "change",
      link: { jiraKey: "PLAT", jiraName: "Platform", siteName: "Acme Corp", initiative: "Epic", epic: "Feature", task: "Subtask" },
      mapping: null,
    },
    {
      projectId: "p2", projectName: "Growth", link: null, choosing: true,
      mapping: step === "types" ? { connection: "c1", site: "s1", key: "GROW", jiraName: "Growth", types, proposal: { initiative: "10001", epic: "10002", task: "10004" } } : null,
    },
  ];
  const jiraOptions = [{ value: "c1|s1|PLAT", label: "PLAT · Platform", group: "Acme Corp" }, { value: "c1|s1|GROW", label: "GROW · Growth", group: "Acme Corp" }];
  return <JiraConnectionsView connections={connections} canAdmin={q.role !== "viewer"} configured={q.configured !== "0"} status={q.status} connectAction={connectNoop} disconnectAction={disconnectNoop}
    projectLinks={q.state === "none" ? [] : projectLinks} jiraOptions={jiraOptions} basePath="/dev/jira" linkAction={formNoop} unlinkAction={formNoop} />;
}
