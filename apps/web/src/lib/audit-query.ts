import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextDay, type AuditFilters, type AuditLookup, type AuditRow } from "@/lib/audit-log";

export const PAGE_SIZE = 50;
export const EXPORT_LIMIT = 5000;

/** PostgREST `or(...)` filters are comma and bracket separated; those characters are not part of a name or an email. */
const safe = (s: string) => s.replace(/[,()*%\\]/g, " ").trim();

/**
 * Account admins read their own account's log through row-level security (policy audit_log_select); a platform admin reads any account's
 * through platform_audit_search(). The caller says which one; the database decides who may.
 */
export async function loadAudit(
  supabase: SupabaseClient,
  opts: { tenantId?: string; platform?: boolean; filters: AuditFilters; limit: number },
): Promise<{ rows: AuditRow[]; lookup: AuditLookup; more: boolean }> {
  const { filters: f } = opts;
  let rows: AuditRow[] = [];
  if (opts.platform) {
    const { data, error } = await supabase.rpc("platform_audit_search", {
      p_tenant: opts.tenantId ?? null, p_actor: f.actor ? safe(f.actor) : null, p_action: f.action ? safe(f.action) : null, p_project: f.project ?? null,
      p_from: f.from ? `${f.from}T00:00:00Z` : null, p_to: f.to ? `${nextDay(f.to)}T00:00:00Z` : null, p_limit: opts.limit + 1, p_before: f.before ? Number(f.before) : null,
    });
    if (error) throw new Error("Could not load the audit log.");
    rows = (data ?? []) as AuditRow[];
  } else {
    let q = supabase.from("audit_log").select("*").eq("tenant_id", opts.tenantId!).order("id", { ascending: false }).limit(opts.limit + 1);
    if (f.actor) q = q.or(`actor_name.ilike.%${safe(f.actor)}%,actor_email.ilike.%${safe(f.actor)}%`);
    if (f.action) q = q.or(`field.ilike.%${safe(f.action)}%,entity.ilike.%${safe(f.action)}%`);
    if (f.project) q = q.eq("project_id", f.project);
    if (f.from) q = q.gte("at", `${f.from}T00:00:00Z`);
    if (f.to) q = q.lt("at", `${nextDay(f.to)}T00:00:00Z`);
    if (f.before) q = q.lt("id", Number(f.before));
    const { data, error } = await q;
    if (error) throw new Error("Could not load the audit log.");
    rows = (data ?? []) as AuditRow[];
  }
  const more = rows.length > opts.limit;
  rows = rows.slice(0, opts.limit);

  // names for the ids on the page: projects, initiatives (only those the caller can open) and, for the platform view, accounts
  const lookup: AuditLookup = { projects: {}, objects: {}, accounts: {} };
  const projectIds = [...new Set(rows.map((r) => r.project_id).filter((x): x is string => !!x))];
  const itemIds = [...new Set(rows.filter((r) => r.entity === "items" && r.entity_id).map((r) => r.entity_id!))];
  if (projectIds.length) {
    const { data } = await supabase.from("projects").select("id, name").in("id", projectIds);
    for (const p of (data ?? []) as { id: string; name: string }[]) lookup.projects![p.id] = p.name;
  }
  if (itemIds.length) {
    const { data } = await supabase.from("items").select("id, item_code, initiative_name").in("id", itemIds);
    for (const i of (data ?? []) as { id: string; item_code: string | null; initiative_name: string }[]) lookup.objects![i.id] = [i.item_code, i.initiative_name].filter(Boolean).join(" ");
  }
  if (opts.platform) {
    const { data } = await supabase.rpc("platform_accounts", { p_limit: 500 });
    for (const a of (data ?? []) as { tenant_id: string; name: string }[]) lookup.accounts![a.tenant_id] = a.name;
  }
  return { rows, lookup, more };
}
