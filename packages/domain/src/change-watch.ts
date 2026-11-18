import { CHANGE_TYPES, type ChangeType } from "./change-report";

/**
 * The change bell (top bar): changes per account, project and type since the person last cleared them. Rows come from the database function
 * change_counts(); this file only groups and words them. Counts are per project and per type, never per person (CLAUDE.md rule 8).
 */
export type ChangeCountRow = { tenant_id: string; tenant_name: string; project_id: string; project_name: string; change_type: string; n: number; latest_at: string };

export type WatchedProject = {
  tenantId: string; tenantName: string; projectId: string; projectName: string;
  total: number; latestAt: string;
  /** In the order of CHANGE_TYPES, only the types with a change. */
  byType: { type: ChangeType; label: string; n: number }[];
};

const KNOWN = new Set<string>(CHANGE_TYPES.map((t) => t.id));

/** One entry per project, the project with the newest change first. Types this version does not know are counted in the total only. */
export function watchedProjects(rows: readonly ChangeCountRow[]): WatchedProject[] {
  const by = new Map<string, WatchedProject>();
  for (const r of rows) {
    if (!(r.n > 0)) continue;
    const key = `${r.tenant_id}:${r.project_id}`;
    let p = by.get(key);
    if (!p) { p = { tenantId: r.tenant_id, tenantName: r.tenant_name, projectId: r.project_id, projectName: r.project_name, total: 0, latestAt: r.latest_at, byType: [] }; by.set(key, p); }
    p.total += r.n;
    if (r.latest_at > p.latestAt) p.latestAt = r.latest_at;
    if (KNOWN.has(r.change_type)) {
      const t = CHANGE_TYPES.find((x) => x.id === r.change_type)!;
      const ex = p.byType.find((x) => x.type === t.id);
      if (ex) ex.n += r.n; else p.byType.push({ type: t.id, label: t.label, n: r.n });
    }
  }
  const order = (t: ChangeType) => CHANGE_TYPES.findIndex((x) => x.id === t);
  return [...by.values()].map((p) => ({ ...p, byType: p.byType.sort((a, b) => order(a.type) - order(b.type)) })).sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}

export const totalChanges = (projects: readonly WatchedProject[]) => projects.reduce((s, p) => s + p.total, 0);

/** The pill on the bell: the exact sum up to 99, then "99+". */
export const changeBadge = (n: number) => (n > 99 ? "99+" : String(n));

/** The Changes report of one project in one account (the report reads ?scope=p:{project}). */
export const changeLogHref = (tenantId: string, projectId: string) => `/w/${tenantId}/reports?report=changes&scope=p:${projectId}`;

/** "Platform: 3 Health, 1 Phase", for a tooltip or a screen reader. */
export const changeBreakdownText = (p: Pick<WatchedProject, "byType">) => p.byType.map((t) => `${t.n} ${t.label}`).join(", ");
