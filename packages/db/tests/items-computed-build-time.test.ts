import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, twoTenantFixture, type TestDb } from "./helpers";

// Issue #480: Building Time (days), Actual Build (weeks) and Build vs Estimate High (%) come from Start Building to the tracker's Build Completed first (a GitHub ticket
// closed as completed, else a Jira issue resolved while done), and from the start of the next phase when the tracker has no completion, as before.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let connGh: string;
let connJira: string;
let n = 0;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  connGh = (await db.admin.query("select id from public.github_connections where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id as string;
  connJira = (await db.admin.query("select id from public.jira_connections where tenant_id = $1 and state = 'connected'", [f.tenantA])).rows[0].id as string;
});
afterAll(async () => {
  await db.close();
});

const item = async (cols: Record<string, string | number | null> = {}) => {
  const keys = Object.keys(cols), vals = Object.values(cols);
  return (await db.admin.query(`insert into public.items (tenant_id, home_project_id, initiative_name${keys.map((k) => `, ${k}`).join("")}) values ($1, $2, 'Build time'${keys.map((_, i) => `, $${i + 3}`).join("")}) returning id`, [f.tenantA, f.seedA.project, ...vals])).rows[0].id as string;
};
const github = (id: string, state: string, closedAt: string | null) => db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state, mode, gh_state, gh_closed_at) values ($1, $2, $3, 'Acme/App', $4, $5, 'https://github.com/Acme/App/issues/1', 'synced', 'follow', $6, $7)", [f.tenantA, id, connGh, 700 + ++n, 97000 + n, state, closedAt]);
const jira = (id: string, category: string, resolvedAt: string | null) => db.admin.query("insert into public.item_jira_links (tenant_id, item_id, connection_id, site_id, issue_key, mode, jira_status, jira_status_category, jira_resolved_at) values ($1, $2, $3, 'site-1', $4, 'follow', 'Project Closed', $5, $6)", [f.tenantA, id, connJira, `BT${++n}-1`, category, resolvedAt]);
const computed = async (id: string) => (await db.admin.query("select time_building_days, actual_build_weeks, build_vs_estimate_high_pct from public.items_computed where id = $1", [id])).rows[0] as { time_building_days: number | null; actual_build_weeks: string | null; build_vs_estimate_high_pct: string | null };

describe("items_computed: build time from the tracker's dates", () => {
  it("GitHub: Start Building to the day the ticket was closed as completed, in days, weeks and against the high estimate", async () => {
    const id = await item({ start_building: "2026-11-02", estimate_high_weeks: 2 });
    await github(id, "closed_completed", "2026-11-23T16:00:00Z");
    expect(await computed(id)).toMatchObject({ time_building_days: 21, actual_build_weeks: "3.0", build_vs_estimate_high_pct: "150" });
  });

  it("Jira: Start Building to the resolution date while the issue is done", async () => {
    const id = await item({ start_building: "2026-11-02" });
    await jira(id, "done", "2026-11-12T09:00:00Z");
    expect(await computed(id)).toMatchObject({ time_building_days: 10, actual_build_weeks: "1.4" });
  });

  it("the tracker wins over the start of the next phase, which is only the fallback", async () => {
    const id = await item({ start_building: "2026-11-02", start_beta: "2026-12-14" });
    await jira(id, "done", "2026-11-12T09:00:00Z");
    expect((await computed(id)).time_building_days).toBe(10);
    const none = await item({ start_building: "2026-11-02", start_beta: "2026-11-16" });
    expect((await computed(none)).time_building_days).toBe(14); // no tracker: the old way
  });

  it("a ticket closed as not planned, a reopened issue and a missing Start Building give no tracker build time", async () => {
    const notPlanned = await item({ start_building: "2026-11-02", start_beta: "2026-11-09" });
    await github(notPlanned, "closed_not_planned", "2026-11-20T10:00:00Z");
    expect((await computed(notPlanned)).time_building_days).toBe(7); // falls back to the next phase
    const reopened = await item({ start_building: "2026-11-02" });
    await jira(reopened, "indeterminate", "2026-11-12T09:00:00Z");
    expect((await computed(reopened)).time_building_days).toBeNull();
    const noStart = await item();
    await jira(noStart, "done", "2026-11-12T09:00:00Z");
    expect((await computed(noStart)).time_building_days).toBeNull();
  });

  it("is never negative: a completion before the start is ignored", async () => {
    const id = await item({ start_building: "2026-11-10" });
    await jira(id, "done", "2026-11-01T09:00:00Z");
    expect((await computed(id)).time_building_days).toBeNull();
  });

  it("a same-day finish is zero days", async () => {
    const id = await item({ start_building: "2026-11-10" });
    await github(id, "closed_completed", "2026-11-10T18:00:00Z");
    expect((await computed(id)).time_building_days).toBe(0);
  });

  it("keeps every column of the view in the same order, so nothing that reads it changes", async () => {
    const cols = (await db.admin.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'items_computed' order by ordinal_position")).rows.map((r) => r.column_name as string);
    expect(cols.slice(0, 6)).toEqual(["id", "tenant_id", "value_weighted", "value_weighted_per_build_week", "adoption_pct", "kr_realized_pct"]);
    expect(cols).toContain("time_building_days");
    expect(cols).toContain("build_vs_estimate_high_pct");
    expect(cols).toContain("locked_by_source");
  });
});
