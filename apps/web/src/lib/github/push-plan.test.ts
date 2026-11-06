import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { planPush, ITEM_SELECT } = await import("./push");
import { COLUMN_ON_ITEMS } from "@pv/domain";

/** A tiny stand-in for the signed-in client: each table returns what the test set; `eq` filters apply to the columns a row has (so kind and shared split the attachments). */
function fakeSupabase(tables: Record<string, unknown[]>) {
  const chain = (rows: unknown[]) => { const eqs: [string, unknown][] = []; const q: Record<string, unknown> = {}; for (const m of ["is", "in", "select", "not", "order"]) q[m] = () => q; q.eq = (k: string, v: unknown) => { eqs.push([k, v]); return q; }; q.then = (r: (v: unknown) => void) => r({ data: rows.filter((x) => eqs.every(([k, v]) => !(k in (x as object)) || (x as Record<string, unknown>)[k] === v)), error: null }); return q; };
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
    const base = { items: [item], projects: [{ id: "p1", name: "Core", default_repo: "Acme/App", tracker: "github" }], item_attachments: [{ item_id: "i1", kind: "file", name: "Mock.png", share_token: "T".repeat(43) }] };
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
  it("puts the shared documents into the issue as a last section of name + public link for a private repository only; the text never goes in", async () => {
    const T = "D".repeat(43);
    const docs = [{ item_id: "i1", kind: "prd", title: "PRD: Mirror", status: "approved", has_text: true, share_token: T }, { item_id: "i1", kind: "prd", title: "Empty one", status: "approved", has_text: false, share_token: "E".repeat(43) }, { item_id: "i1", kind: "other", title: "No address", status: "draft", has_text: true, share_token: null }];
    const base = { items: [item], projects: [{ id: "p1", name: "Core", default_repo: "Acme/App", tracker: "github" }], item_documents: docs };
    const [priv] = await planPush(fakeSupabase({ ...base, github_repositories: [{ full_name: "Acme/App", access: "read_write", is_private: true }] }), "t1", "https://app.example", connection, ["i1"]);
    expect(priv!.block).toContain(`## Documents\n- [PRD: Mirror (PRD, Approved)](https://app.example/d/${T}/PRD%3A%20Mirror)`);
    expect(priv!.block).not.toContain("Empty one"); // no text: not sent
    expect(priv!.block).not.toContain("No address"); // not shared or an unaccepted draft has no address
    expect(priv!.filesNote).toContain("Document links in the issue: PRD: Mirror. Skipped, no text yet: Empty one.");
    // the issue still reads back: the Documents section is not mistaken for one of our texts
    const { splitManagedBlock } = await import("@pv/github");
    expect(splitManagedBlock(priv!.block.replace(/<!-- pv:begin item=\S+ -->/, "<!-- pv:begin item=00000000-0000-0000-0000-000000000001 -->"))).toMatchObject({ ok: true, summary: "", description: "" }); // the fixture id is not a UUID
    const [pub] = await planPush(fakeSupabase({ ...base, github_repositories: [{ full_name: "Acme/App", access: "read_write", is_private: false }] }), "t1", "https://app.example", connection, ["i1"]);
    expect(pub!.block).not.toContain("## Documents");
    expect(pub!.block).not.toContain(T);
    expect(pub!.filesNote).toContain("2 shared document links were left out");
  });
  it("an issue written before the rename, with ## Artifacts, still reads back", async () => {
    const { splitManagedBlock } = await import("@pv/github");
    const body = ["<!-- pv:begin item=00000000-0000-0000-0000-000000000001 -->", "", "## Summary", "Short", "", "## Description", "Long", "", "## Artifacts", "- [PRD](https://example.test/prd)", "", "---", "Managed by Product Velocity: x", "<!-- pv:end -->"].join("\n");
    expect(splitManagedBlock(body)).toMatchObject({ ok: true, summary: "Short", description: "Long" });
  });
  it("says when an attached file has no share link and so is not in the issue", async () => {
    const base = { items: [item], projects: [{ id: "p1", name: "Core", default_repo: "Acme/App", tracker: "github" }], github_repositories: [{ full_name: "Acme/App", access: "read_write", is_private: true }] };
    const [plan] = await planPush(fakeSupabase({ ...base, item_attachments: [{ item_id: "i1", kind: "file", name: "a.png", share_token: null }, { item_id: "i1", kind: "file", name: "b.png", share_token: "T".repeat(43) }] }), "t1", "https://app.example", connection, ["i1"]);
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
    expect(ITEM_SELECT).toBe("id, item_code, initiative_name, summary, description, hypothesis, moscow, stack_rank, change_type, end_date, theme, focus_area, value_type, g2m_quarter, effort, initiative_phase, home_project_id");
  });
  it("a failed read says so instead of claiming the initiative does not exist", async () => {
    const failing = { from: () => ({ select: () => { const q: Record<string, unknown> = {}; for (const m of ["eq", "is", "in", "select", "not", "order"]) q[m] = () => q; q.then = (r: (v: unknown) => void) => r({ data: null, error: { message: "column x does not exist" } }); return q; } }) } as never;
    const [plan] = await planPush(failing, "t1", "https://app.example", connection, ["i1"]);
    expect(plan).toMatchObject({ action: "blocked" });
    expect(plan!.reason).toContain("could not be read");
    expect(plan!.reason).not.toContain("column x");
  });
});
