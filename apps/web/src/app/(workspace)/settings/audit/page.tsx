import { requireWorkspace } from "@/lib/session";
import { parseAuditFilters } from "@/lib/audit-log";
import { loadAudit, PAGE_SIZE } from "@/lib/audit-query";
import { AuditView } from "@/components/audit-view";

export const metadata = { title: "Audit log · Product Velocity" };

/** R-111 FR-6.6: account admins read their own account's log (and platform admins inside it); nobody can edit or delete an entry. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase, active } = await requireWorkspace("/settings/audit");
  const allowed = active.role === "admin" || !!active.platform;
  if (!allowed) {
    return (
      <div className="page-narrow">
        <h1>Audit log</h1>
        <p className="muted">Only workspace admins can read the audit log.</p>
      </div>
    );
  }
  const filters = parseAuditFilters(sp);
  const [{ rows, lookup, more }, { data: projects }, { data: tenant }] = await Promise.all([
    loadAudit(supabase, { tenantId: active.tenantId, filters, limit: PAGE_SIZE }),
    supabase.from("projects").select("id, name").eq("tenant_id", active.tenantId).order("name"),
    supabase.from("tenants").select("time_zone").eq("id", active.tenantId).single(),
  ]);
  return (
    <div className="page-wide">
      <h1>Audit log</h1>
      <p className="muted">
        Every change in {active.tenantName}: who made it (name and email as they were at the time), their role, when, where, what changed and how.
        Platform admins who work in this account appear here too, marked as such. Entries cannot be edited or deleted.
      </p>
      <AuditView
        rows={rows} lookup={lookup} filters={filters} basePath="/settings/audit" exportPath="/settings/audit/export"
        projects={(projects ?? []) as { id: string; name: string }[]} showAccount={false} more={more}
        timeZone={(tenant as { time_zone: string | null } | null)?.time_zone || "UTC"}
      />
    </div>
  );
}
