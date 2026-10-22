import { requireWorkspace } from "@/lib/session";
import { PortfolioClient } from "@/features/portfolio/portfolio-client";
import { loadLookups } from "@/features/portfolio/lookups";

export const metadata = { title: "Roadmap · Product Velocity" };

export default async function PortfolioPage() {
  const { supabase, active, user } = await requireWorkspace("/portfolio");
  const lookups = await loadLookups(supabase, active.tenantId);

  return (
    <>
      {lookups.projects.length === 0 && (
        <div className="notice-box">
          <p>There are no projects yet, and every item belongs to a project.</p>
          {active.role === "admin" ? <p>Open “All projects” at the top and choose <strong>+ New project</strong>.</p> : <p>Ask an admin to add the first project.</p>}
        </div>
      )}
      <PortfolioClient
        tenantId={active.tenantId}
        role={active.role}
        userId={user.id}
        lookups={lookups}
        headLeft={<h1>Roadmap</h1>}
      />
    </>
  );
}
