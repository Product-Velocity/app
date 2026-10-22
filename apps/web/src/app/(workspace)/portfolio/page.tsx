import { requireWorkspace } from "@/lib/session";
import { AddProject } from "@/features/portfolio/add-project";
import { PortfolioClient } from "@/features/portfolio/portfolio-client";

export const metadata = { title: "Roadmap · Product Velocity" };

export default async function PortfolioPage() {
  const { supabase, active } = await requireWorkspace("/portfolio");
  const { data: projects } = await supabase.from("projects").select("id, name").eq("tenant_id", active.tenantId).order("name");
  const { data: people } = await supabase.rpc("tenant_directory", { p_tenant: active.tenantId });
  const lookups = {
    projects: (projects ?? []) as { id: string; name: string }[],
    members: ((people ?? []) as { user_id: string; email: string }[]).map((p) => ({ user_id: p.user_id, email: p.email })),
  };

  return (
    <>
      {lookups.projects.length === 0 && (
        <div className="notice-box">
          <p>There are no projects yet, and every item belongs to a project.</p>
          {active.role === "admin" ? <AddProject tenantId={active.tenantId} open /> : <p>Ask an admin to add the first project.</p>}
        </div>
      )}
      <PortfolioClient
        tenantId={active.tenantId}
        role={active.role}
        lookups={lookups}
        headLeft={<h1>Roadmap</h1>}
        headRight={active.role === "admin" && lookups.projects.length > 0 ? <AddProject tenantId={active.tenantId} /> : null}
      />
    </>
  );
}
