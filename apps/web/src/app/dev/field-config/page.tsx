import { notFound } from "next/navigation";
import { FieldCatalogView, FieldMappingForm } from "@/components/tracker-field-config";
import { buildMappingView } from "@/lib/tracker-fields/view";
import { formNoop } from "../jira/actions";
import { githubCatalogGroups } from "@/lib/tracker-fields/catalog";

/** Test page for the GitHub field catalog (the real page needs GitHub). Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1. */
export default async function FieldConfigHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  const catalog = {
    tracker: "github" as const, scope: "Acme", readAt: "2026-11-03T12:00:00Z",
    groups: githubCatalogGroups({
      issueFields: q.fields === "denied" ? null : [{ id: "IF_1", name: "Priority", dataType: "single_select", options: ["Urgent", "High", "Medium", "Low"] }, { id: "IF_2", name: "Target date", dataType: "date", options: [] }],
      boards: [{ title: "Roadmap", fields: q.board === "unreadable" ? null : [{ id: "F1", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "o1", name: "Todo" }, { id: "o2", name: "Done" }] }, { id: "F2", name: "Due date", dataType: "DATE" }, { id: "F3", name: "Size", dataType: "SINGLE_SELECT", options: [{ id: "s1", name: "M" }] }] }],
      labels: [{ repo: "Acme/app", labels: [{ name: "pv:moscow/must", description: null }, { name: "bug", description: null }] }],
      issueTypes: ["Epic", "Task"],
      milestones: [{ repo: "Acme/app", milestones: [{ title: "2026 Q4", dueOn: "2026-12-31T12:00:00Z", state: "open" }] }],
    }),
  };
  return (
    <div className="page-narrow">
      <h1>GitHub</h1>
      <div className="card stack">
        <h2>Field configuration</h2>
        <FieldMappingForm tracker="GitHub" projectId="p1" projectName="Platform" action={formNoop}
          view={buildMappingView({ tracker: "github",
            rows: q.config === "changed" ? [{ slot: "github.label.rank", enabled: false, field: null }, { slot: "github.milestone", enabled: false, field: null }] : [],
            board: q.board === "none" ? null : { id: "B1", number: 1, title: "Roadmap", url: "https://example.test/board", mapping: { priority: { id: "F9", name: "Priority" }, group: null, dueDate: { id: "F2", name: "Due date" }, size: null, status: { id: "F1", name: "Status" }, priorityMap: {} } } })} />
        <h3>Fields GitHub shows this connection</h3>
        <FieldCatalogView catalogs={[catalog]} tracker="GitHub" id="github-catalog" />
      </div>
    </div>
  );
}
