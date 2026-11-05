import { requireWorkspace } from "@/lib/session";
import { DecisionsClient } from "@/features/gates/decisions-client";

export const metadata = { title: "Decisions · Product Velocity" };

/** Every decision-gate request of the workspace (docs/28-DECISION-GATES.md section 6). Staff looking in see it but cannot decide. */
export default async function DecisionsPage() {
  const { active, user } = await requireWorkspace("/decisions");
  return <DecisionsClient tenantId={active.tenantId} me={user.id} mayDecide={active.platform === null} />;
}
