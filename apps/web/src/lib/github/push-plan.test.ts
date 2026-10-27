import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { planPush, ITEM_SELECT } = await import("./push");
import { COLUMN_ON_ITEMS } from "@pv/domain";

/** A tiny stand-in for the signed-in client: each table returns what the test set; filters are ignored. */
function fakeSupabase(tables: Record<string, unknown[]>) {
  const chain = (rows: unknown[]) => { const q: Record<string, unknown> = {}; for (const m of ["eq", "is", "in", "select", "not", "order"]) q[m] = () => q; q.then = (r: (v: unknown) => void) => r({ data: rows, error: null }); return q; };
  return { from: (t: string) => ({ select: () => chain(tables[t] ?? []) }) } as never;
}
const connection = { id: "c1", tenant_id: "t1", expected_account: "Acme", installation_id: 9, account_login: "Acme", state: "connected" as const };
const item = { id: "i1", item_code: "R-01", initiative_name: "Mirror me", summary: null, hypothesis: null, home_project_id: "p1" };

describe("planPush and the one tracker of a project", () => {
  it("blocks an initiative of a Jira project: it is never sent to GitHub", async () => {
    const supabase = fakeSupabase({ items: [item], projects: [{ id: "p1", name: "Mirror", default_repo: null, tracker: "jira" }], github_repositories: [{ full_name: "Acme/App", access: "read_write" }] });
    const [plan] = await planPush(supabase, "t1", "https://app.example", connection, ["i1"]);
    expect(plan).toMatchObject({ action: "blocked", code: "R-01", project: "Mirror" });
    expect(plan!.reason).toContain("linked to Jira");
  });
  it("a GitHub project, and a project without a tracker yet, plan as before", async () => {
    for (const tracker of ["github", null]) {
      const supabase = fakeSupabase({ items: [item], projects: [{ id: "p1", name: "Core", default_repo: "Acme/App", tracker }], github_repositories: [{ full_name: "Acme/App", access: "read_write" }] });
      const [plan] = await planPush(supabase, "t1", "https://app.example", connection, ["i1"]);
      expect(plan).toMatchObject({ action: "create", repo: "Acme/App" });
    }
  });
  it("puts share links of files into the issue for a private repository only, and says so when it leaves them out", async () => {
    const base = { items: [item], projects: [{ id: "p1", name: "Core", default_repo: "Acme/App", tracker: "github" }], item_files: [{ item_id: "i1", name: "Mock.png", share_token: "T".repeat(43) }] };
    const priv = await planPush(fakeSupabase({ ...base, github_repositories: [{ full_name: "Acme/App", access: "read_write", is_private: true }] }), "t1", "https://app.example", connection, ["i1"]);
    expect(priv[0]!.block).toContain(`## Files\n- [Mock.png](https://app.example/f/${"T".repeat(43)}/Mock.png)`);
    expect(priv[0]!.filesNote).toBeUndefined();
    for (const is_private of [false, null]) {
      const pub = await planPush(fakeSupabase({ ...base, github_repositories: [{ full_name: "Acme/App", access: "read_write", is_private }] }), "t1", "https://app.example", connection, ["i1"]);
      expect(pub[0]!.block).not.toContain("## Files");
      expect(pub[0]!.block).not.toContain("T".repeat(43));
      expect(pub[0]!.filesNote).toContain("public");
    }
  });
  it("says when an attached file has no share link and so is not in the issue", async () => {
    const base = { items: [item], projects: [{ id: "p1", name: "Core", default_repo: "Acme/App", tracker: "github" }], github_repositories: [{ full_name: "Acme/App", access: "read_write", is_private: true }] };
    const [plan] = await planPush(fakeSupabase({ ...base, item_files: [{ item_id: "i1", name: "a.png", share_token: null }, { item_id: "i1", name: "b.png", share_token: "T".repeat(43) }] }), "t1", "https://app.example", connection, ["i1"]);
    expect(plan!.filesNote).toContain("1 attached file has no share link");
    expect(plan!.block).toContain("b.png");
    expect(plan!.block).not.toContain("a.png");
  });
  it("puts the quarter of the G2M date in the preview as the milestone, and Change Type and Initiative Group as labels", async () => {
    const tables = { items: [{ ...item, change_type: "New feature", end_date: "2026-11-14", theme: "Checkout" }], projects: [{ id: "p1", name: "Core", default_repo: "Acme/App", tracker: "github" }], github_repositories: [{ full_name: "Acme/App", access: "read_write", is_private: true }] };
    const [plan] = await planPush(fakeSupabase(tables), "t1", "https://app.example", connection, ["i1"]);
    expect(plan).toMatchObject({ milestone: "2026 Q4" });
    expect(plan!.labels).toEqual(expect.arrayContaining(["pv:type/new-feature", "pv:group/checkout"]));
  });
  it("asks the database only for columns that exist: G2M Date (est) is read from end_date", () => {
    const cols = ITEM_SELECT.split(", ");
    for (const c of cols) expect(["id", "home_project_id", ...COLUMN_ON_ITEMS], `${c} is not a column of items`).toContain(c);
    expect(cols).toContain("end_date");
    expect(cols).not.toContain("g2m_date_est");
    // the same list is run against a real database in packages/db/tests/push-columns.test.ts: change both together
    expect(ITEM_SELECT).toBe("id, item_code, initiative_name, summary, description, hypothesis, moscow, stack_rank, change_type, end_date, theme, home_project_id");
  });
  it("a failed read says so instead of claiming the initiative does not exist", async () => {
    const failing = { from: () => ({ select: () => { const q: Record<string, unknown> = {}; for (const m of ["eq", "is", "in", "select", "not", "order"]) q[m] = () => q; q.then = (r: (v: unknown) => void) => r({ data: null, error: { message: "column x does not exist" } }); return q; } }) } as never;
    const [plan] = await planPush(failing, "t1", "https://app.example", connection, ["i1"]);
    expect(plan).toMatchObject({ action: "blocked" });
    expect(plan!.reason).toContain("could not be read");
    expect(plan!.reason).not.toContain("column x");
  });
});
