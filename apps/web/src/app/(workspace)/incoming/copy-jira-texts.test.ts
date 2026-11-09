import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Tables = Record<string, unknown[]>;
let tables: Tables;
let role = "creator";
let platform: unknown = null;
let issues: Record<string, { ok: boolean; kind?: string; labels?: string[]; description?: unknown }>;
let rpcCalls: { name: string; args: Record<string, unknown> }[];
let results: Record<string, { data: unknown; error: unknown }>;

const query = (table: string) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in"]) q[m] = () => q;
  q.then = (resolve: (v: unknown) => void) => resolve({ data: tables[table] ?? [], error: null });
  return q;
};
vi.mock("@/lib/session", () => ({ requireWorkspace: async () => ({ supabase: { from: query }, user: { id: "u1" }, active: { tenantId: "t1", role, platform } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return results[name] ?? { data: true, error: null }; } }) }));
vi.mock("@/lib/atlassian/server", () => ({ jiraRequest: () => ({}) }));
vi.mock("@/lib/atlassian/jira-issue", () => ({
  readIssue: async (_call: unknown, key: string) => {
    const i = issues[key];
    if (!i) return { ok: false, kind: "gone", message: "gone" };
    if (!i.ok) return { ok: false, kind: i.kind ?? "unavailable", message: "x" };
    return { ok: true, issue: { key, id: "1", summary: "s", description: i.description ?? null, labels: i.labels ?? [] } };
  },
}));

const { copyJiraIssueTexts, refreshPulledFromJira } = await import("./copy-jira-texts");
const ID = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const KEY = (n: number) => `PAY-${n}`;
const item = (n: number, o: { source?: string; description?: string | null } = {}) => ({ id: ID(n), source: o.source ?? `Jira issue ${KEY(n)}`, description: o.description ?? null });
const link = (n: number) => ({ item_id: ID(n), connection_id: "c1", site_id: "s1", issue_key: KEY(n) });
const adf = (text: string) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

beforeEach(() => {
  role = "creator"; platform = null; rpcCalls = []; issues = {}; results = { jira_copy_issue_labels: { data: { change_type: true, focus_area: true }, error: null } };
  tables = { items: [], item_jira_links: [], jira_issues: [] };
});

describe("copyJiraIssueTexts (pull-in keeps the Jira issue's text and labels, issue #365)", () => {
  it("copies the description as Markdown text for the signed-in person", async () => {
    tables.items = [item(1)]; tables.item_jira_links = [link(1)];
    issues[KEY(1)] = { ok: true, description: { type: "doc", version: 1, content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Goal" }] }, { type: "paragraph", content: [{ type: "text", text: "Ping @x <!-- hidden -->" }] }] } };
    expect(await copyJiraIssueTexts([ID(1)])).toMatchObject({ copied: 1, failed: 0, noText: 0, checked: 1 });
    expect(rpcCalls[0]).toMatchObject({ name: "jira_copy_issue_description", args: { p_actor: "u1", p_item: ID(1) } });
    const text = rpcCalls[0]!.args.p_text as string;
    expect(text).toContain("## Goal");
    expect(text).not.toContain("<!--");
  });
  it("keeps type: as Change Type and area: as Focus Area (live labels first, else the record), and never maps the Jira issue type", async () => {
    tables.items = [item(2), item(3)]; tables.item_jira_links = [link(2), link(3)];
    tables.jira_issues = [{ item_id: ID(2), labels: ["type:feature"] }, { item_id: ID(3), labels: ["area:admin", "type:bug"] }];
    issues[KEY(2)] = { ok: true, labels: ["type:improvement", "area:billing"], description: adf("t") };
    issues[KEY(3)] = { ok: false }; // unreadable: the record's labels still apply
    const r = await copyJiraIssueTexts([ID(2), ID(3)]);
    expect(r).toMatchObject({ labelled: 2, copied: 1, failed: 1 });
    const calls = rpcCalls.filter((c) => c.name === "jira_copy_issue_labels").map((c) => c.args);
    expect(calls).toContainEqual(expect.objectContaining({ p_item: ID(2), p_change_type: "Improvement to existing feature", p_focus_area: "billing" }));
    expect(calls).toContainEqual(expect.objectContaining({ p_item: ID(3), p_change_type: "Bug", p_focus_area: "admin" }));
    expect(JSON.stringify(rpcCalls)).not.toMatch(/issue_type|issuetype/i);
  });
  it("re-pull: fills labels on an initiative that already has a Description, without touching the Description", async () => {
    tables.items = [item(4, { description: "Mine" })]; tables.item_jira_links = [link(4)];
    issues[KEY(4)] = { ok: true, labels: ["area:admin"], description: adf("ignored") };
    expect(await refreshPulledFromJira([ID(4)])).toMatchObject({ checked: 1, copied: 0, labelled: 1 });
    expect(rpcCalls.map((c) => c.name)).toEqual(["jira_copy_issue_labels"]);
  });
  it("uses the Description section of a description Product Velocity wrote, and says so when there is no text", async () => {
    tables.items = [item(5), item(6)]; tables.item_jira_links = [link(5), link(6)];
    const h = (t: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: t }] });
    const p = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    issues[KEY(5)] = { ok: true, description: { type: "doc", version: 1, content: [h("Summary"), p("S"), h("Description"), p("The real text"), h("Hypothesis (IF / THEN / RESULTING IN)"), p("H")] } };
    issues[KEY(6)] = { ok: true, description: null };
    expect(await copyJiraIssueTexts([ID(5), ID(6)])).toMatchObject({ copied: 1, noText: 1 });
    expect(rpcCalls.find((c) => c.name === "jira_copy_issue_description")!.args.p_text).toBe("The real text");
  });
  it("leaves out other initiatives, flags a Jira sign-in problem, and counts a database refusal as failed", async () => {
    tables.items = [item(7, { source: "GitHub issue #7" }), item(8), item(9)]; tables.item_jira_links = [link(7), link(8), link(9)];
    issues[KEY(8)] = { ok: false, kind: "reconnect" }; issues[KEY(9)] = { ok: true, description: adf("t") };
    results.jira_copy_issue_description = { data: null, error: { message: "refused" } };
    const r = await copyJiraIssueTexts([ID(7), ID(8), ID(9)]);
    expect(r).toMatchObject({ checked: 2, copied: 0, failed: 2, reconnect: true });
  });
  it("does nothing for a viewer, platform staff, or a malformed id", async () => {
    tables.items = [item(10)]; tables.item_jira_links = [link(10)]; issues[KEY(10)] = { ok: true, description: adf("x") };
    role = "viewer";
    expect(await copyJiraIssueTexts([ID(10)])).toMatchObject({ copied: 0, failed: 1 });
    role = "creator"; platform = { tenantId: "t1" };
    expect(await copyJiraIssueTexts([ID(10)])).toMatchObject({ copied: 0, failed: 1 });
    platform = null;
    expect(await copyJiraIssueTexts(["not-an-id"])).toMatchObject({ copied: 0, failed: 0 });
    expect(rpcCalls).toHaveLength(0);
  });
});
