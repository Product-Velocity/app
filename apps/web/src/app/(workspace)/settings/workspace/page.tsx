import { requireWorkspace } from "@/lib/session";
import { countryOptions, currencyOptions, timeZoneOptions } from "@/lib/workspace-profile";
import { WorkspaceForm } from "./form";
import { ProjectsCard, type ProjectRow } from "./projects-card";
import { GateApprovers } from "@/features/gates/gate-approvers";

export const metadata = { title: "Workspace settings · Product Velocity" };

export default async function WorkspaceSettingsPage() {
  const { supabase, active } = await requireWorkspace("/settings/workspace");
  const { data } = await supabase.from("tenants").select("name, country, currency, time_zone, allowed_email_domains, restrict_invites_to_domains, auto_join_authorized_domains, company_url").eq("id", active.tenantId).single();
  const t = data as { name: string; country: string | null; currency: string | null; time_zone: string | null; allowed_email_domains: string[]; restrict_invites_to_domains: boolean; auto_join_authorized_domains: boolean; company_url: string | null } | null;
  // Projects (issue #526): admins rename and delete; the counts name what a delete would remove (the Trash is read through its own function)
  let projectRows: ProjectRow[] = [];
  if (active.role === "admin" && !active.platform) {
    const [{ data: ps }, { data: live }, { data: trashed }] = await Promise.all([
      supabase.from("projects").select("id, name, tracker").eq("tenant_id", active.tenantId).order("name"),
      supabase.from("items").select("home_project_id").eq("tenant_id", active.tenantId).is("deleted_at", null).limit(20000),
      supabase.rpc("trashed_items", { p_tenant: active.tenantId }),
    ]);
    const count = (rows: { home_project_id?: string | null }[] | null | undefined) => { const m = new Map<string, number>(); for (const r of rows ?? []) if (r.home_project_id) m.set(r.home_project_id, (m.get(r.home_project_id) ?? 0) + 1); return m; };
    const liveBy = count(live as { home_project_id: string }[] | null);
    const trashedBy = count(trashed as { home_project_id: string }[] | null);
    projectRows = ((ps ?? []) as { id: string; name: string; tracker: string | null }[]).map((p) => ({ id: p.id, name: p.name, tracker: p.tracker === "jira" || p.tracker === "github" ? p.tracker : null, live: liveBy.get(p.id) ?? 0, trashed: trashedBy.get(p.id) ?? 0 }));
  }
  return (
    <div className="page-narrow">
      <h1>Workspace settings</h1>
      <p className="muted">The organization profile and who can ask to join it.{active.role !== "admin" && " Only admins can change these."}</p>
      <div className="card">
        <WorkspaceForm
          canEdit={active.role === "admin"}
          countries={countryOptions()}
          currencies={currencyOptions()}
          timeZones={timeZoneOptions()}
          values={{ name: t?.name ?? active.tenantName, country: t?.country ?? "", currency: t?.currency ?? "", timeZone: t?.time_zone ?? "", domains: (t?.allowed_email_domains ?? []).join(", "), restrictInvites: t?.restrict_invites_to_domains ?? false, autoJoin: t?.auto_join_authorized_domains ?? true, companyUrl: t?.company_url ?? "" }}
        />
      </div>
      {active.role === "admin" && !active.platform && <ProjectsCard projects={projectRows} canEdit />}
      <GateApprovers tenantId={active.tenantId} canEdit={active.role === "admin" && !active.platform} />
    </div>
  );
}
