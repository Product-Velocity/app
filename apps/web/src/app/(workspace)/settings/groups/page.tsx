import { requireWorkspace } from "@/lib/session";
import { GroupsPanel } from "./panel";

export const metadata = { title: "Initiative Groups · Product Velocity" };

export default async function GroupsPage() {
  const { active } = await requireWorkspace("/settings/groups");
  return (
    <div className="page-narrow">
      <h1>Initiative Groups</h1>
      <p className="muted">
        Anyone who can edit adds a group by typing it in the roadmap, quick-add or an import. Admins keep the list tidy here:
        rename a group, merge two groups, or retire one nobody uses. The list is shared by every project.
        {active.role !== "admin" && " Only admins can change it."}
      </p>
      <GroupsPanel tenantId={active.tenantId} canAdmin={active.role === "admin"} />
    </div>
  );
}
