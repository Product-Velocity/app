import { requireWorkspace } from "@/lib/session";
import { PortfolioClient } from "@/features/portfolio/portfolio-client";
import { OpenOnComputer } from "@/components/open-on-computer";
import { loadLookups } from "@/features/portfolio/lookups";
import { showChecklist, type ChecklistCounts } from "@/lib/onboarding";
import { GetStarted } from "./get-started";

export const metadata = { title: "Roadmap · Product Velocity" };
// Sync with GitHub runs its checks as server actions from this page; each request is a few initiatives, but a slow GitHub needs room
export const maxDuration = 60;

export default async function PortfolioPage() {
  const { supabase, active, user } = await requireWorkspace("/portfolio");
  const lookups = await loadLookups(supabase, active.tenantId);
  const counts = active.role === "admin" && !active.isDemoAccount ? await checklistCounts(supabase, active.tenantId) : null;

  return (
    <>
      {lookups.projects.length === 0 && (
        <div className="notice-box">
          <p>There are no projects yet, and every item belongs to a project.</p>
          {active.role === "admin" ? <p>Open “All projects” at the top and choose <strong>+ New project</strong>.</p> : <p>Ask an admin to add the first project.</p>}
        </div>
      )}
      {counts && showChecklist(user.user_metadata, active.tenantId, counts) && <GetStarted counts={counts} />}
      <OpenOnComputer what="The roadmap grid" />
      <div className="desktop-only">
        <PortfolioClient
          tenantId={active.tenantId}
          role={active.role}
          userId={user.id}
          lookups={lookups}
          headLeft={<h1>Roadmap</h1>}
        />
      </div>
    </>
  );
}

/** Head-only counts for the "Get started" card; RLS keeps each one inside the account, and the tenant filter says so too. */
async function checklistCounts(supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"], tenantId: string): Promise<ChecklistCounts> {
  const count = async (table: string, extra?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    if (extra) q = extra(q);
    const { count: n } = await q;
    return n ?? 0;
  };
  const [members, pendingInvites, items, github, jira] = await Promise.all([
    count("tenant_members", (q) => q.eq("is_service_account", false)),
    count("invitations", (q) => q.is("accepted_at", null).is("revoked_at", null)),
    count("items"),
    count("github_connections", (q) => q.neq("state", "disconnected")),
    count("jira_connections", (q) => q.neq("state", "disconnected")),
  ]);
  return { members, pendingInvites, items, trackers: github + jira };
}
