import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Tables = Record<string, unknown[]>;
let tables: Tables;
let role = "creator";
let platform: unknown = null;
let bodies: Record<number, string | null | Error>;
let rpcCalls: { name: string; args: Record<string, unknown> }[];
let rpcResult: { data: unknown; error: unknown };

const query = (table: string) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "not", "in", "neq"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
  q.then = (resolve: (v: unknown) => void) => resolve({ data: tables[table] ?? [], error: null });
  return q;
};

vi.mock("@/lib/session", () => ({ requireWorkspace: async () => ({ supabase: { from: query }, user: { id: "u1" }, active: { tenantId: "t1", role, platform } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return rpcResult; } }) }));
vi.mock("@/lib/github/server", () => ({
  githubSourceControl: () => ({ getIssue: async (_i: number, _r: string, n: number) => { const b = bodies[n]; if (b instanceof Error) throw b; return b === null || b === undefined ? null : { number: n, body: b }; } }),
}));

const { copyIssueDescriptions } = await import("./copy-descriptions");
const ID = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const item = (n: number, o: { source?: string; description?: string | null } = {}) => ({ id: ID(n), source: o.source ?? `GitHub issue #${n}`, description: o.description ?? null });
const link = (n: number) => ({ item_id: ID(n), repo_full_name: "dev-nbm/earo_admin", issue_number: n });

beforeEach(() => {
  role = "creator"; platform = null; rpcCalls = []; rpcResult = { data: true, error: null };
  bodies = {};
  tables = { github_connections: [{ id: "c1", installation_id: 9 }], items: [], item_github_links: [] };
});

describe("copyIssueDescriptions (pull-in keeps the issue's text, issue #364)", () => {
  it("copies the body of a pulled-in issue once, as plain text with our markers neutralised, for the signed-in person", async () => {
    tables.items = [item(1)]; tables.item_github_links = [link(1)];
    bodies[1] = "## Goal\r\nThe IO builder <!-- hidden --> ping @someone";
    expect(await copyIssueDescriptions([ID(1)])).toEqual({ copied: 1, failed: 0 });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({ name: "github_copy_issue_description", args: { p_actor: "u1", p_item: ID(1) } });
    const text = rpcCalls[0]!.args.p_text as string;
    expect(text).toContain("## Goal\nThe IO builder");
    expect(text).not.toContain("<!--");
    expect(text).not.toContain("\r");
  });
  it("leaves an initiative alone that already has a description, or that was not pulled in from an issue", async () => {
    tables.items = [item(2, { description: "Mine" }), item(3, { source: "Customer interview" })]; tables.item_github_links = [link(2), link(3)];
    bodies[2] = "x"; bodies[3] = "x";
    expect(await copyIssueDescriptions([ID(2), ID(3)])).toEqual({ copied: 0, failed: 0 });
    expect(rpcCalls).toHaveLength(0);
  });
  it("skips an issue that holds a Product Velocity block, and an issue without a body", async () => {
    tables.items = [item(4), item(5)]; tables.item_github_links = [link(4), link(5)];
    bodies[4] = "intro\n<!-- pv:begin item=x -->\n## Summary\nx\n<!-- pv:end -->"; bodies[5] = "   ";
    expect(await copyIssueDescriptions([ID(4), ID(5)])).toEqual({ copied: 0, failed: 0 });
    expect(rpcCalls).toHaveLength(0);
  });
  it("counts an issue it could not read as failed and still copies the others", async () => {
    tables.items = [item(6), item(7), item(8)]; tables.item_github_links = [link(6), link(7), link(8)];
    bodies[6] = new Error("GitHub down"); bodies[7] = null; bodies[8] = "fine";
    expect(await copyIssueDescriptions([ID(6), ID(7), ID(8)])).toEqual({ copied: 1, failed: 2 });
  });
  it("counts a refusal of the database as failed, not as copied", async () => {
    tables.items = [item(9)]; tables.item_github_links = [link(9)]; bodies[9] = "x";
    rpcResult = { data: null, error: { message: "refused" } };
    expect(await copyIssueDescriptions([ID(9)])).toEqual({ copied: 0, failed: 1 });
  });
  it("does nothing for a viewer, platform staff, or a malformed id", async () => {
    tables.items = [item(10)]; tables.item_github_links = [link(10)]; bodies[10] = "x";
    role = "viewer";
    expect(await copyIssueDescriptions([ID(10)])).toEqual({ copied: 0, failed: 1 });
    role = "creator"; platform = { tenantId: "t1" };
    expect(await copyIssueDescriptions([ID(10)])).toEqual({ copied: 0, failed: 1 });
    platform = null;
    expect(await copyIssueDescriptions(["not-an-id"])).toEqual({ copied: 0, failed: 0 });
    expect(rpcCalls).toHaveLength(0);
  });
});
