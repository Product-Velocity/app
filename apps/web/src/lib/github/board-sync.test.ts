import { describe, expect, it, vi } from "vitest";
import { MemorySourceControl } from "@pv/github";

vi.mock("server-only", () => ({}));
const { syncBoardStatuses, ingestProjectItemEvent } = await import("./board-sync");

const connection = { id: "c1", tenant_id: "t1", expected_account: "Acme", installation_id: 9, account_login: "Acme", state: "connected" as const };
const board = { id: "PVT_1", number: 3, title: "Roadmap", url: "https://github.com/orgs/Acme/projects/3", mapping: { priority: null, group: null, dueDate: null, size: null, status: { id: "F_S", name: "Status" }, priorityMap: {} } };

function fakeAdmin(tables: Record<string, unknown[]>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const chain = (rows: unknown[]) => { const q: Record<string, unknown> = {}; for (const m of ["select", "eq", "not", "is", "order", "range"]) q[m] = () => q; q.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null }); q.then = (r: (v: unknown) => void) => r({ data: rows, error: null }); return q; };
  return { calls, from: (t: string) => chain(tables[t] ?? []), rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: (args.p_rows as unknown[]).length, error: null }; } } as never;
}
const tables = (over: Record<string, unknown[]> = {}) => ({
  projects: [{ id: "p1", github_board: board }],
  items: [{ id: "i1", gh_project_status: null }, { id: "i2", gh_project_status: "Ready" }, { id: "i3", gh_project_status: null }],
  item_github_links: [
    { item_id: "i1", repo_full_name: "Acme/App", issue_number: 175, project_item_id: null },
    { item_id: "i2", repo_full_name: "Acme/App", issue_number: 176, project_item_id: "PVTI_176" },
    { item_id: "i3", repo_full_name: "Acme/App", issue_number: 177, project_item_id: null },
    { item_id: "other", repo_full_name: "Acme/App", issue_number: 178, project_item_id: null }, // an initiative of another project
  ],
  ...over,
});
const scWith = () => {
  const sc = new MemorySourceControl();
  sc.boardStatuses.set("PVT_1", [
    { itemId: "PVTI_175", issueNodeId: "I_1", repo: "Acme/App", number: 175, status: "Ready" },
    { itemId: "PVTI_176", issueNodeId: "I_2", repo: "Acme/App", number: 176, status: "Ready" }, // unchanged
    { itemId: "PVTI_178", issueNodeId: "I_4", repo: "Acme/App", number: 178, status: "Done" },
  ]);
  return sc;
};

describe("syncBoardStatuses", () => {
  it("applies the board's status to the initiatives whose status changed, and nothing else", async () => {
    const admin = fakeAdmin(tables());
    const r = await syncBoardStatuses(admin, scWith(), connection);
    expect(r).toEqual({ boards: 1, updated: 1 });
    const calls = (admin as unknown as { calls: { fn: string; args: Record<string, unknown> }[] }).calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("github_apply_board_status");
    expect(calls[0]!.args.p_rows).toEqual([{ item_id: "i1", status: "Ready", board_item_id: "PVTI_175" }]);
  });
  it("only the boards named are read; a board without a status field or one that cannot be read is skipped", async () => {
    const sc = scWith();
    expect(await syncBoardStatuses(fakeAdmin(tables()), sc, connection, { boardIds: ["PVT_other"] })).toEqual({ boards: 0, updated: 0 });
    expect(await syncBoardStatuses(fakeAdmin(tables({ projects: [{ id: "p1", github_board: { ...board, mapping: { ...board.mapping, status: null } } }] })), sc, connection)).toEqual({ boards: 0, updated: 0 });
    expect(await syncBoardStatuses(fakeAdmin(tables()), new MemorySourceControl(), connection)).toEqual({ boards: 0, updated: 0 });
  });
  it("a connection without an installation does nothing", async () => {
    expect(await syncBoardStatuses(fakeAdmin(tables()), scWith(), { ...connection, installation_id: null })).toEqual({ boards: 0, updated: 0 });
  });
});

describe("ingestProjectItemEvent", () => {
  const conn = { id: "c1", tenant_id: "t1", expected_account: "Acme", installation_id: 9, account_login: "Acme", state: "connected" };
  const withConn = (over: Record<string, unknown[]> = {}) => fakeAdmin({ ...tables(), github_connections: [conn], ...over });
  const ev = (over: Record<string, unknown> = {}) => ({ installationId: 9, action: "edited", boardId: "PVT_1", fieldName: "Status", ...over });

  it("a change of the Status field reads the board and applies it", async () => {
    const admin = withConn();
    expect(await ingestProjectItemEvent(admin, scWith(), ev())).toBe("processed");
    expect((admin as unknown as { calls: unknown[] }).calls).toHaveLength(1);
  });
  it("a change of another field, another action, an unknown board or no connection is ignored without reading anything", async () => {
    const sc = scWith();
    for (const e of [ev({ fieldName: "Priority" }), ev({ action: "reordered" }), ev({ boardId: "PVT_x" })]) expect(await ingestProjectItemEvent(withConn(), sc, e)).toBe("ignored");
    expect(sc.calls).not.toContain("listBoardItems");
    expect(await ingestProjectItemEvent(withConn({ github_connections: [] }), sc, ev())).toBe("ignored");
  });
  it("an item added to the board (no field named) is read too, and the field name is compared without case", async () => {
    expect(await ingestProjectItemEvent(withConn(), scWith(), ev({ action: "created", fieldName: null }))).toBe("processed");
    expect(await ingestProjectItemEvent(withConn(), scWith(), ev({ fieldName: " status " }))).toBe("processed");
  });
});

