import { describe, expect, it, vi } from "vitest";
import { detectMapping, MemorySourceControl, type BoardField } from "@pv/github";

vi.mock("server-only", () => ({}));
vi.mock("./sync", () => ({ refreshTree: async () => undefined }));
const { planPush, executePush } = await import("./push");

// Ready for build at Gate B (issue #358): the board Status is set to the existing option Ready by a confirmed send, only from the start.
function fakeSupabase(tables: Record<string, unknown[]>) {
  const chain = (rows: unknown[]) => { const q: Record<string, unknown> = {}; for (const m of ["eq", "is", "in", "select", "not", "order"]) q[m] = () => q; q.then = (r: (v: unknown) => void) => r({ data: rows, error: null }); return q; };
  return { from: (t: string) => ({ select: () => chain(tables[t] ?? []) }) } as never;
}
const opts = (...names: string[]) => names.map((name) => ({ id: `o-${name}`, name }));
const withReady: BoardField[] = [{ id: "f-status", name: "Status", dataType: "SINGLE_SELECT", options: opts("Backlog", "Ready", "In progress", "Done") }, { id: "f-prio", name: "Priority", dataType: "SINGLE_SELECT", options: opts("P0", "P1", "P2") }];
const noReady: BoardField[] = [{ id: "f-status", name: "Status", dataType: "SINGLE_SELECT", options: opts("Backlog", "Done") }];
const board = (f: BoardField[]) => ({ id: "PVT_1", number: 3, title: "Roadmap", url: "https://github.com/orgs/Acme/projects/3", mapping: detectMapping(f) });
const connection = { id: "c1", tenant_id: "t1", expected_account: "Acme", installation_id: 9, account_login: "Acme", state: "connected" as const };
const row = { id: "i1", item_code: "R-01", initiative_name: "Ship it", summary: null, hypothesis: null, description: null, moscow: "Should", stack_rank: 4, change_type: null, end_date: null, theme: null, effort: null, home_project_id: "p1" };
const ready = { id: "i1", ready_for_build_at: "2026-11-06T10:00:00Z", initiative_phase: "Build", gh_project_status: null as string | null };
const tables = (f: BoardField[], over: Record<string, unknown[]> = {}) => ({
  items: [{ ...row, ...ready }],
  projects: [{ id: "p1", name: "Core", default_repo: "Acme/App", tracker: "github", github_board: board(f) }],
  github_repositories: [{ full_name: "Acme/App", access: "read_write", is_private: true }],
  ...over,
});
const link = (o: Record<string, unknown> = {}) => [{ item_id: "i1", mode: "push", repo_full_name: "Acme/App", issue_number: 7, html_url: "u", sync_state: "synced", last_pushed_hash: "x", ready_handled_at: null, project_item_id: null, issue_node_id: null, ...o }];
const sc = (f: BoardField[]) => { const s = new MemorySourceControl(); s.boardFields.set("PVT_1", f); return s; };
function admin() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const chain = (rows: unknown[]) => { const q: Record<string, unknown> = {}; for (const m of ["eq", "select"]) q[m] = () => q; q.then = (r: (v: unknown) => void) => r({ data: rows, error: null }); return q; };
  return { calls, rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { error: null }; }, from: () => ({ select: () => chain([]), update: () => chain([]) }) };
}
const run = (s: MemorySourceControl, a: ReturnType<typeof admin>, t: Record<string, unknown[]>) => executePush({ supabase: fakeSupabase(t), admin: a as never, sc: s, connection, tenantId: "t1", actor: "u1", appUrl: "https://app.example", ids: ["i1"] });

describe("the preview", () => {
  it("says Set Status to Ready for a ready initiative on a board with a Ready option", async () => {
    const [p] = await planPush(fakeSupabase(tables(withReady)), "t1", "https://app.example", connection, ["i1"], sc(withReady));
    expect(p!.ready).toEqual({ text: "Set Status to Ready", will: true });
  });
  it("an initiative that is not Ready for build (Define, Hold, Stop) shows and writes nothing", async () => {
    const t = tables(withReady, { items: [{ ...row, ...ready, ready_for_build_at: null }] });
    expect((await planPush(fakeSupabase(t), "t1", "https://app.example", connection, ["i1"], sc(withReady)))[0]!.ready).toBeUndefined();
    const define = tables(withReady, { items: [{ ...row, ...ready, initiative_phase: "Define" }] });
    expect((await planPush(fakeSupabase(define), "t1", "https://app.example", connection, ["i1"], sc(withReady)))[0]!.ready).toBeUndefined();
  });
  it("a board without a Ready option says add Ready in GitHub", async () => {
    const [p] = await planPush(fakeSupabase(tables(noReady)), "t1", "https://app.example", connection, ["i1"], sc(noReady));
    expect(p!.ready).toMatchObject({ will: false, text: expect.stringContaining("add Ready in GitHub") });
  });
  it("is skipped for a followed link, a handled one, and an item already In progress or Done", async () => {
    for (const t of [
      tables(withReady, { item_github_links: link({ mode: "follow" }) }),
      tables(withReady, { item_github_links: link({ ready_handled_at: "2026-11-06T11:00:00Z" }) }),
      tables(withReady, { items: [{ ...row, ...ready, gh_project_status: "In progress" }], item_github_links: link() }),
      tables(withReady, { items: [{ ...row, ...ready, gh_project_status: "Done" }], item_github_links: link() }),
    ]) expect((await planPush(fakeSupabase(t), "t1", "https://app.example", connection, ["i1"], sc(withReady)))[0]!.ready).toBeUndefined();
  });
  it("a Backlog item with an otherwise unchanged issue becomes a send", async () => {
    const t = tables(withReady, { items: [{ ...row, ...ready, gh_project_status: "Backlog" }], item_github_links: link() });
    const [p] = await planPush(fakeSupabase(t), "t1", "https://app.example", connection, ["i1"], sc(withReady));
    expect(p!.ready?.will).toBe(true);
    expect(p!.action).toBe("update");
  });
});

describe("the confirmed send", () => {
  it("creates the issue, adds it to the board, sets Status Ready and records it once", async () => {
    const s = sc(withReady), a = admin();
    const [r] = await run(s, a, tables(withReady));
    expect(r).toMatchObject({ outcome: "created" });
    expect(r!.wrote).toContain("Board Status: Ready");
    // the only values on the board: the usual Priority and the Ready option, nothing of the initiative's commercial fields
    expect(s.boardItems[0]!.values).toEqual({ "f-prio": { optionId: "o-P1" }, "f-status": { optionId: "o-Ready" } });
    expect(a.calls.filter((c) => c.fn === "github_record_ready")).toEqual([{ fn: "github_record_ready", args: { p_actor: "u1", p_item: "i1", p_result: "set", p_status: "Ready" } }]);
  });
  it("writes nothing to the board Status when it moved on since the preview", async () => {
    const s = sc(withReady), a = admin();
    s.boardItems.push({ id: "PVTI_X", boardId: "PVT_1", issueNodeId: "N", values: { "f-status": { optionId: "o-In progress" } } });
    const t = tables(withReady, { items: [{ ...row, ...ready, gh_project_status: "Backlog" }], item_github_links: link({ project_item_id: "PVTI_X", issue_node_id: "N" }) });
    await run(s, a, t);
    expect(s.boardItems.find((x) => x.id === "PVTI_X")!.values["f-status"]).toEqual({ optionId: "o-In progress" });
  });
  it("a board without Ready: the issue is sent, nothing is written to Status", async () => {
    const s = sc(noReady), a = admin();
    await run(s, a, tables(noReady));
    expect(Object.values(s.boardItems[0]?.values ?? {})).not.toContainEqual({ optionId: "o-Ready" });
    expect(a.calls.some((c) => c.fn === "github_record_ready")).toBe(false);
  });
});
