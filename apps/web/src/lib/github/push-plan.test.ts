import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { planPush } = await import("./push");

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
});
