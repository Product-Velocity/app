import { requireWorkspace } from "@/lib/session";
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
      <div className="page-head">
        <h1>Roadmap</h1>
        <span className="chip">All projects</span>
        <span className="chip">Ranked by global Stack Rank</span>
      </div>
      {lookups.projects.length === 0 && (
        <p className="notice-box">
          There are no projects yet, so items cannot be added. An admin creates projects first (project setup arrives with the next
          slices).
        </p>
      )}
      <PortfolioClient tenantId={active.tenantId} role={active.role} lookups={lookups} />
    </>
  );
}
