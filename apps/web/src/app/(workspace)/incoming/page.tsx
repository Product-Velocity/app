import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { IncomingClient } from "@/features/incoming/incoming-client";

export const metadata = { title: "Incoming · Product Velocity" };

/** Issues in the tracker that are not initiatives: pull in, ignore, and the rules for new arrivals (R-024). */
export default async function IncomingPage() {
  const { supabase, active } = await requireWorkspace("/incoming");
  const { data: conn } = await supabase.from("github_connections").select("id").eq("tenant_id", active.tenantId).eq("state", "connected").maybeSingle();
  if (!conn) {
    return (
      <>
        <div className="page-head"><h1>Incoming</h1></div>
        <p>This workspace is not connected to GitHub yet. {active.role === "admin" ? <Link href="/settings/integrations/github">Connect GitHub</Link> : "An admin can connect it in Settings > GitHub."}</p>
      </>
    );
  }
  const { data: projects } = await supabase.from("projects").select("id, name").eq("tenant_id", active.tenantId).order("name");
  return <IncomingClient tenantId={active.tenantId} projects={(projects ?? []) as { id: string; name: string }[]} canEdit={["creator", "admin"].includes(active.role)} canAdmin={active.role === "admin"} />;
}
