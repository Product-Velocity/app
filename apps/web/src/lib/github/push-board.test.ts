import { describe, expect, it, vi } from "vitest";
import { detectMapping, MemorySourceControl, type BoardField } from "@pv/github";

vi.mock("server-only", () => ({}));
vi.mock("./sync", () => ({ refreshTree: async () => undefined }));
const { planPush, executePush } = await import("./push");

function fakeSupabase(tables: Record<string, unknown[]>) {
  const chain = (rows: unknown[]) => { const q: Record<string, unknown> = {}; for (const m of ["eq", "is", "in", "select", "not", "order"]) q[m] = () => q; q.then = (r: (v: unknown) => void) => r({ data: rows, error: null }); return q; };
  return { from: (t: string) => ({ select: () => chain(tables[t] ?? []) }) } as never;
}
const opts = (...names: string[]) => names.map((name) => ({ id: `o-${name}`, name }));
const fields: BoardField[] = [
  { id: "f-prio", name: "Priority", dataType: "SINGLE_SELECT", options: opts("P0", "P1", "P2", "P3") },
  { id: "f-status", name: "Status", dataType: "SINGLE_SELECT", options: opts("New", "Done") },
  { id: "f-init", name: "Initiative", dataType: "SINGLE_SELECT", options: opts("Growth") },
  { id: "f-due", name: "Due date", dataType: "DATE" },
  { id: "f-size", name: "Size", dataType: "SINGLE_SELECT", options: opts("S", "M", "L") },
];
const board = { id: "PVT_1", number: 3, title: "Product Velocity roadmap", url: "https://github.com/orgs/Acme/projects/3", mapping: detectMapping(fields) };
const connection = { id: "c1", tenant_id: "t1", expected_account: "Acme", installation_id: 9, account_login: "Acme", state: "connected" as const };
const row = { id: "i1", item_code: "R-01", initiative_name: "Mirror me", summary: null, hypothesis: null, description: null, moscow: "Should", stack_rank: 4, change_type: null, end_date: "2026-12-15", theme: "Growth", effort: "M", home_project_id: "p1" };
const tables = (over: Record<string, unknown[]> = {}) => ({
  items: [row],
  projects: [{ id: "p1", name: "Core", default_repo: "Acme/App", tracker: "github", github_board: board }],
  github_repositories: [{ full_name: "Acme/App", access: "read_write", is_private: true }],
  ...over,
});
const scWithBoard = () => { const sc = new MemorySourceControl(); sc.boardFields.set("PVT_1", fields); return sc; };

describe("the preview shows what would go on the board", () => {
  it("lists the fields written from MoSCoW, the group, the G2M date and the effort estimate", async () => {
    const [plan] = await planPush(fakeSupabase(tables()), "t1", "https://app.example", connection, ["i1"], scWithBoard());
    expect(plan!.board).toEqual({ title: "Product Velocity roadmap", included: true, writes: [{ field: "Priority", value: "P1" }, { field: "Initiative", value: "Growth" }, { field: "Due date", value: "2026-12-15" }, { field: "Size", value: "M" }], notes: [], children: 0 });
  });
  it("a Won't initiative is shown as not added", async () => {
    const [plan] = await planPush(fakeSupabase(tables({ items: [{ ...row, moscow: "Won't" }] })), "t1", "https://app.example", connection, ["i1"], scWithBoard());
    expect(plan!.board).toMatchObject({ included: false, writes: [] });
  });
  it("without a linked board, or when GitHub cannot be asked, nothing about a board is claimed", async () => {
    const noBoard = tables({ projects: [{ id: "p1", name: "Core", default_repo: "Acme/App", tracker: "github", github_board: null }] });
    expect((await planPush(fakeSupabase(noBoard), "t1", "https://app.example", connection, ["i1"], scWithBoard()))[0]!.board).toBeUndefined();
    const unreadable = (await planPush(fakeSupabase(tables()), "t1", "https://app.example", connection, ["i1"], new MemorySourceControl()))[0]!;
    expect(unreadable.board).toMatchObject({ included: false, notes: [expect.stringContaining("could not be read")] });
    expect((await planPush(fakeSupabase(tables()), "t1", "https://app.example", connection, ["i1"]))[0]!.board).toBeUndefined();
  });
  it("changing a board value makes an otherwise unchanged initiative a push again", async () => {
    const sc = scWithBoard();
    const first = (await planPush(fakeSupabase(tables()), "t1", "https://app.example", connection, ["i1"], sc))[0]!;
    // pretend the first push stored its hash: re-plan with that hash recorded on the link
    const hashOf = async (moscow: string) => {
      const link = [{ item_id: "i1", mode: "push", repo_full_name: "Acme/App", issue_number: 7, html_url: "u", sync_state: "synced", last_pushed_hash: "x" }];
      return (await planPush(fakeSupabase(tables({ items: [{ ...row, moscow }], item_github_links: link })), "t1", "https://app.example", connection, ["i1"], sc))[0]!;
    };
    expect(first.action).toBe("create");
    expect((await hashOf("Must")).action).toBe("update");
  });
});

describe("executePush and the board", () => {
  function admin(treeOnBoard: { repo_full_name: string; issue_number: number }[] = []) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const chain = (rows: unknown[]) => { const q: Record<string, unknown> = {}; for (const m of ["eq", "select"]) q[m] = () => q; q.then = (r: (v: unknown) => void) => r({ data: rows, error: null }); return q; };
    return { calls, rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { error: null }; }, from: () => ({ select: () => chain(treeOnBoard) }) };
  }
  const run = (sc: MemorySourceControl, a: ReturnType<typeof admin>, t = tables()) =>
    executePush({ supabase: fakeSupabase(t), admin: a as never, sc, connection, tenantId: "t1", actor: "u1", appUrl: "https://app.example", ids: ["i1"] });

  it("writes the issue, adds it to the board with its values, then records the link and the board item", async () => {
    const sc = scWithBoard(), a = admin();
    const [r] = await run(sc, a);
    expect(r).toMatchObject({ outcome: "created", issueNumber: 101 });
    expect(sc.boardItems).toHaveLength(1);
    expect(sc.boardItems[0]!.values).toEqual({ "f-prio": { optionId: "o-P1" }, "f-init": { optionId: "o-Growth" }, "f-due": { date: "2026-12-15" }, "f-size": { optionId: "o-M" } });
    expect(a.calls.map((c) => c.fn)).toEqual(["github_record_push", "github_record_project_item"]);
    expect(a.calls[0]!.args.p_state).toBe("synced");
    expect(a.calls[1]!.args).toMatchObject({ p_actor: "u1", p_item: "i1", p_project_item_id: "PVTI_1" });
  });
  it("a Won't initiative is pushed as an issue but never put on the board", async () => {
    const sc = scWithBoard(), a = admin();
    const [r] = await run(sc, a, tables({ items: [{ ...row, moscow: "Won't" }] }));
    expect(r!.outcome).toBe("created");
    expect(sc.boardItems).toHaveLength(0);
    expect(a.calls.map((c) => c.fn)).toEqual(["github_record_push"]);
  });
  it("if the board write fails, the issue stays written but is not recorded as synced, so the next push does the board again", async () => {
    const sc = scWithBoard(), a = admin();
    sc.failOn = "setBoardValue";
    const [r] = await run(sc, a);
    expect(r).toMatchObject({ outcome: "error", issueNumber: 101 });
    expect(r!.message).toContain("could not be updated");
    expect(a.calls).toHaveLength(1);
    expect(a.calls[0]!.args).toMatchObject({ p_state: "error", p_number: 101 });
  });
  it("nothing commercial is ever sent to the board", async () => {
    const sc = scWithBoard(), a = admin();
    await run(sc, a, tables({ items: [{ ...row, value_12m: "LEAK_VALUE", confidence: "LEAK_CONF", customers_requesting: "LEAK_CUSTOMER", decision: "LEAK_DECISION" }] }));
    expect(JSON.stringify([sc.sent, sc.boardItems])).not.toContain("LEAK_");
  });

  const sub = (number: number, state: "open" | "closed" = "open") => ({ number, id: number, nodeId: `I_${number}`, repo: "Acme/App", title: `t${number}`, state, stateReason: null, closedAt: null, assignees: [], createdBy: "engineer" as const });
  const withChildren = () => { const sc = scWithBoard(); sc.subs.set("Acme/App#101", [sub(201), sub(202)]); sc.subs.set("Acme/App#201", [sub(301)]); return sc; };

  it("also puts the children of every level on the board, without field values, and records them", async () => {
    const sc = withChildren(), a = admin();
    const [r] = await run(sc, a);
    expect(r).toMatchObject({ outcome: "created", message: "3 child issues added to the board." });
    expect(sc.boardItems.map((i) => i.issueNodeId)).toEqual(expect.arrayContaining(["I_201", "I_202", "I_301"]));
    const kids = sc.boardItems.filter((i) => i.issueNodeId.startsWith("I_") && i.issueNodeId !== "I_node");
    expect(kids.map((i) => i.values)).toEqual([{}, {}, {}]);
    const rec = a.calls.find((c) => c.fn === "github_record_board_items")!;
    expect(rec.args).toMatchObject({ p_item: "i1", p_board_id: "PVT_1" });
    expect((rec.args.p_nodes as unknown[]).length).toBe(3);
  });
  it("children already on the board are not added again", async () => {
    const sc = withChildren(), a = admin([{ repo_full_name: "Acme/App", issue_number: 201 }, { repo_full_name: "acme/app", issue_number: 301 }]);
    const [r] = await run(sc, a);
    expect(r!.message).toBe("1 child issue added to the board.");
  });
  it("a Won't initiative's children stay off the board too", async () => {
    const sc = withChildren(), a = admin();
    await run(sc, a, tables({ items: [{ ...row, moscow: "Won't" }] }));
    expect(sc.boardItems).toHaveLength(0);
  });
  it("an initiative whose issue did not change still gets its new children when the cache knows of some", async () => {
    const sc = withChildren(), a = admin();
    sc.issues.set("Acme/App#7", { number: 7, id: 70, nodeId: "I_parent", htmlUrl: "u", body: "", state: "open", title: "R-01", labels: [] });
    // the plan hash of the first run is what the link stores, so the issue itself is unchanged on the second run
    const first = (await planPush(fakeSupabase(tables()), "t1", "https://app.example", connection, ["i1"], sc))[0]!;
    expect(first.board!.children).toBe(0);
    const link = (hash: string) => [{ item_id: "i1", mode: "push", repo_full_name: "Acme/App", issue_number: 7, html_url: "u", sync_state: "synced", last_pushed_hash: hash }];
    const pending = tables({ item_github_links: link("x"), item_issue_tree: [{ item_id: "i1", repo_full_name: "Acme/App", issue_number: 201, board_id: null }, { item_id: "i1", repo_full_name: "Acme/App", issue_number: 202, board_id: "OLD_BOARD" }] });
    const plan = (await planPush(fakeSupabase(pending), "t1", "https://app.example", connection, ["i1"], sc))[0]!;
    expect(plan.board!.children).toBe(2); // one never on a board, one only on a board that is no longer linked
  });
  it("if adding children fails, the issue is not recorded as synced so the next send tries again", async () => {
    const sc = withChildren(), a = admin();
    sc.failOn = "addBoardItem";
    const [r] = await run(sc, a);
    expect(r!.outcome).toBe("error");
    expect(a.calls.map((c) => c.fn)).toEqual(["github_record_push"]);
    expect(a.calls[0]!.args.p_state).toBe("error");
  });
});
