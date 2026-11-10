import { requireWorkspace } from "@/lib/session";
import type { SessionState } from "@/lib/alignment";
import { plannedQuarters, type SessionRow, type SessionStats } from "@/lib/alignment-list";
import { AlignmentList } from "@/features/alignment/alignment-list";
import type { Initiative } from "@/lib/alignment-pick";
import { createAlignmentSession } from "./actions";

export const metadata = { title: "Alignment · Product Velocity" };

type SessionDb = {
  id: string; name: string; method: SessionRow["method"]; status: SessionState; created_at: string; opened_at: string | null; closes_at: string | null; closed_at: string | null;
  created_by: string | null; contested: unknown;
};

/**
 * The Alignment tab (issue #392): every alignment session of the workspace. What a person gets is decided by the database: admins read every session,
 * everyone else only closed or archived sessions that allow results. The admin-only values (invited, voted, applied, who created it) come from a
 * function that returns rows to admins only, so for anyone else `stats` stays empty.
 */
export default async function AlignmentPage() {
  const { supabase, active } = await requireWorkspace("/alignment");
  const isAdmin = active.role === "admin" && !active.platform;
  await supabase.rpc("alignment_close_due", { p_tenant: active.tenantId }).then(() => undefined, () => undefined); // sessions past their closing time close now (admins only; others are refused)
  const { data: sessions } = await supabase
    .from("alignment_sessions")
    .select("id, name, method, status, created_at, opened_at, closes_at, closed_at, created_by, contested:results_snapshot->results->contested")
    .eq("tenant_id", active.tenantId)
    .order("created_at", { ascending: false });
  const list = (sessions ?? []) as unknown as SessionDb[];
  const ids = list.map((s) => s.id);

  const { data: links } = ids.length
    ? await supabase.from("alignment_items").select("session_id, item_id, shown_name").eq("tenant_id", active.tenantId).in("session_id", ids)
    : { data: [] };
  const itemLinks = (links ?? []) as { session_id: string; item_id: string | null; shown_name: string | null }[];
  // the current name and Planned Quarter of every initiative in these sessions: a draft has no snapshot of the names yet, and the planned quarter of a session
  // is the one most of its initiatives have (Ashu, 2026-11-10), read as it is now
  const linked = [...new Set(itemLinks.filter((l) => l.item_id).map((l) => l.item_id!))];
  const { data: itemRows } = linked.length ? await supabase.from("items").select("id, initiative_name, g2m_quarter").eq("tenant_id", active.tenantId).in("id", linked) : { data: [] };
  const current = new Map(((itemRows ?? []) as { id: string; initiative_name: string; g2m_quarter: string | null }[]).map((n) => [n.id, n]));
  const bySession = new Map<string, { n: number; names: string[]; quarters: (string | null)[] }>();
  for (const l of itemLinks) {
    const e = bySession.get(l.session_id) ?? { n: 0, names: [], quarters: [] };
    e.n++;
    const it = l.item_id ? current.get(l.item_id) : undefined;
    const nm = l.shown_name ?? it?.initiative_name;
    if (nm) e.names.push(nm);
    e.quarters.push(it?.g2m_quarter ?? null);
    bySession.set(l.session_id, e);
  }

  const stats = new Map<string, SessionStats>();
  const people: Record<string, string> = {};
  let initiatives: Initiative[] = [];
  if (isAdmin) {
    const [st, dir, projects, items, computed] = await Promise.all([
      supabase.rpc("alignment_session_stats", { p_tenant: active.tenantId }),
      supabase.rpc("tenant_directory", { p_tenant: active.tenantId }),
      supabase.from("projects").select("id, name").eq("tenant_id", active.tenantId),
      supabase.from("items").select("id, item_code, initiative_name, home_project_id, initiative_phase, moscow, g2m_quarter").eq("tenant_id", active.tenantId).is("deleted_at", null).is("cycle_id", null).order("stack_rank").limit(2000),
      supabase.from("items_computed").select("id, ready_for_build").eq("tenant_id", active.tenantId).eq("ready_for_build", "Ready").limit(2000),
    ]);
    const ready = new Set(((computed.data ?? []) as { id: string }[]).map((r) => r.id));
    for (const r of (st.data ?? []) as { session_id: string; invited: number; voted: number; mailing_draft: boolean; applied_at: string | null; applied_moved: number | null; undone: boolean }[]) {
      stats.set(r.session_id, { invited: r.invited, voted: r.voted, mailingDraft: r.mailing_draft, applied: r.applied_at ? { at: r.applied_at, moved: r.applied_moved ?? 0 } : null, undone: r.undone });
    }
    for (const m of (dir.data ?? []) as { user_id: string; email: string }[]) people[m.user_id] = m.email;
    const projectName = new Map(((projects.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
    initiatives = ((items.data ?? []) as { id: string; item_code: string; initiative_name: string; home_project_id: string | null; initiative_phase: string | null; moscow: string | null; g2m_quarter: string | null }[])
      .map((i) => ({ id: i.id, code: i.item_code, name: i.initiative_name, project: (i.home_project_id && projectName.get(i.home_project_id)) || "No project", phase: i.initiative_phase, moscow: i.moscow, quarter: i.g2m_quarter, ready: ready.has(i.id) }));
  }

  const rows: SessionRow[] = list.map((s) => ({
    id: s.id, name: s.name, method: s.method, status: s.status, createdAt: s.created_at, openedAt: s.opened_at, closesAt: s.closes_at, closedAt: s.closed_at,
    createdBy: isAdmin ? s.created_by : null,
    initiatives: bySession.get(s.id)?.n ?? 0,
    itemNames: (bySession.get(s.id)?.names ?? []).join(", "),
    ...plannedQuarters(bySession.get(s.id)?.quarters ?? []),
    contested: Array.isArray(s.contested) ? s.contested.length : null,
    stats: isAdmin ? stats.get(s.id) ?? { invited: 0, voted: 0, mailingDraft: false, applied: null, undone: false } : null,
  }));

  return <AlignmentList rows={rows} isAdmin={isAdmin} people={people} initiatives={initiatives} create={createAlignmentSession} />;
}
