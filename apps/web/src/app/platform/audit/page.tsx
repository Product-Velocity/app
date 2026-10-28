import { requirePlatformAdmin } from "@/lib/session";
import { parseAuditFilters } from "@/lib/audit-log";
import { loadAudit, PAGE_SIZE } from "@/lib/audit-query";
import { AuditView } from "@/components/audit-view";

export const metadata = { title: "Audit log (all accounts) · Product Velocity" };

/** R-111 FR-6.6: platform admins read the audit log of every account, with the same filters and export. */
export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requirePlatformAdmin("/platform/audit");
  const filters = parseAuditFilters(sp);
  const account = typeof sp.account === "string" && /^[0-9a-f-]{36}$/i.test(sp.account) ? sp.account : undefined;
  const [{ rows, lookup, more }, { data: accounts }] = await Promise.all([
    loadAudit(supabase, { platform: true, tenantId: account, filters, limit: PAGE_SIZE }),
    supabase.rpc("platform_accounts", { p_limit: 500 }),
  ]);
  return (
    <div className="page-wide">
      <h1>Audit log, all accounts</h1>
      <p className="muted">Entries made by platform admins carry a Platform admin badge. Entering and leaving an account is logged too.</p>
      <AuditView
        rows={rows} lookup={lookup} filters={filters} basePath="/platform/audit" exportPath="/platform/audit/export"
        projects={[]} showAccount accounts={((accounts ?? []) as { tenant_id: string; name: string }[]).map((a) => ({ id: a.tenant_id, name: a.name }))}
        accountFilter={account} more={more} timeZone="UTC"
      />
    </div>
  );
}
