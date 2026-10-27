import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTrackingIssue, hashBoardValue as hashBoard, hashText, MemorySourceControl } from "@pv/github";

vi.mock("server-only", () => ({}));
const order: string[] = [];
const pushCalls: { ids: string[]; force: ReadonlySet<string> | undefined }[] = [];
let plan: unknown[] = [];
let pushResults: Record<string, string> = {};
vi.mock("./push", () => ({
  planPush: async () => plan,
  executePush: async (o: { ids: string[]; force?: ReadonlySet<string> }) => { order.push("send"); pushCalls.push({ ids: o.ids, force: o.force }); return o.ids.map((id) => ({ id, code: "R-1", outcome: pushResults[id] ?? "updated" })); },
}));
vi.mock("./receive", () => ({
  receiveFromGithub: async (_a: unknown, _s: unknown, _c: unknown, ids: string[], texts: Map<string, unknown>) => {
    for (const id of ids) texts.set(id, issueTexts[id]);
    return ids.map((id) => ({ id, code: "R-1", name: "Faster export", status: "in_step", received: [], issueNumber: 31, issueUrl: null }));
  },
}));
const { confirmSync, buildSyncPreview } = await import("./sync-flow");

const ITEM = "11111111-1111-4111-8111-111111111111";
const pv = { id: ITEM, item_code: "R-1", initiative_name: "Faster export", summary: "S", description: "D", hypothesis: "H", moscow: "Must", theme: "Mobile", end_date: "2026-12-31", effort: "M", home_project_id: "p1" };
const bodyFor = (over: Record<string, unknown>) => buildTrackingIssue({ item: { ...pv, ...over }, itemId: ITEM, projectName: "Mobile", appUrl: "https://pv.test", artifacts: [] }).block;
let issueTexts: Record<string, { title: string; body: string }>;
const inStep = { title: hashText("Faster export"), summary: hashText("S"), description: hashText("D"), hypothesis: hashText("H") };

const BOARD = { id: "B", number: 1, title: "Roadmap", url: "https://github.com/orgs/x/projects/1", mapping: { priority: { id: "fp", name: "Priority" }, group: null, dueDate: { id: "fd", name: "Due date" }, size: { id: "fs", name: "Size" }, status: null, priorityMap: { Must: "P0", Should: "P1", Could: "P2" } } };
/** A board whose item shows these values by field id (single-select option names and dates). */
function boardSc(values: Record<string, object> | null | undefined) {
  const sc = new MemorySourceControl();
  sc.boardFields.set("B", [{ id: "fp", name: "Priority", dataType: "SINGLE_SELECT", options: [{ id: "o0", name: "P0" }, { id: "o1", name: "P1" }, { id: "o2", name: "P2" }] }, { id: "fd", name: "Due date", dataType: "DATE" }, { id: "fs", name: "Size", dataType: "SINGLE_SELECT", options: [{ id: "s1", name: "M" }, { id: "s2", name: "XL" }] }]);
  if (values) sc.boardItems.push({ id: "PVTI_1", boardId: "B", issueNodeId: "I_1", values: values as never });
  return sc;
}
const onBoard = { fp: { optionId: "o0" }, fd: { date: "2026-12-31" }, fs: { optionId: "s1" } };
const boardBase = { priority: hashBoard("P0"), due: hashBoard("2026-12-31"), size: hashBoard("M") };

type Rpc = { name: string; args: Record<string, unknown> };
function ctx(opts: { rows?: unknown[]; base?: unknown; pullError?: boolean; readError?: boolean; board?: Record<string, object> | null } = {}) {
  const rpcs: Rpc[] = [];
  const rows = opts.rows ?? [pv];
  const q = (table: string) => {
    const r: Record<string, unknown> = {};
    for (const m of ["eq", "is", "in", "select", "not"]) r[m] = () => r;
    r.then = (resolve: (v: unknown) => void) => resolve(table === "projects" ? { data: opts.board ? [{ id: "p1", github_board: BOARD }] : [], error: null } : table === "item_groups" ? { data: [{ name: "Mobile" }, { name: "Platform" }], error: null } : opts.readError && table === "item_github_links" ? { data: null, error: { message: 'column "sync_base" does not exist' } } : { data: table === "items" ? rows : [{ item_id: ITEM, mode: "push", sync_base: opts.base ?? inStep, project_item_id: opts.board ? "PVTI_1" : null }], error: null });
    return r;
  };
  const adminUi = { rpc: async (name: string, args: Record<string, unknown>) => { rpcs.push({ name, args }); order.push(name); return name === "github_apply_pull" ? (opts.pullError ? { data: null, error: { message: "boom" } } : { data: { initiative_name: "Faster export", description: "D" }, error: null }) : { data: null, error: null }; } };
  return { rpcs, ctx: { supabase: { from: q }, adminGithub: {}, adminUi, sc: boardSc(opts.board), connection: { id: "c1", tenant_id: "t1", expected_account: "Acme", installation_id: 9, account_login: "Acme", state: "connected" }, tenantId: "t1", actor: "u1", appUrl: "https://pv.test" } as never };
}

beforeEach(() => { order.length = 0; pushCalls.length = 0; plan = [{ id: ITEM, action: "unchanged" }]; pushResults = {}; issueTexts = { [ITEM]: { title: "R-1: Faster export", body: bodyFor({}) } }; });

describe("buildSyncPreview: the comparison", () => {
  it("an issue edited only in GitHub is a conflict whose default is Keep Product Velocity", async () => {
    issueTexts[ITEM] = { title: "R-1: Renamed in GitHub", body: bodyFor({}) };
    const { ctx: c } = ctx();
    const p = await buildSyncPreview(c, [ITEM]);
    expect(p.received[0]).toMatchObject({ status: "conflict", conflicts: [{ field: "title", kind: "github", defaultChoice: "pv", pv: "Faster export", github: "Renamed in GitHub" }] });
  });
  it("edited on both sides: no default", async () => {
    issueTexts[ITEM] = { title: "R-1: Faster export", body: bodyFor({ description: "GitHub description" }) };
    const { ctx: c } = ctx({ rows: [{ ...pv, description: "PV description" }] });
    const p = await buildSyncPreview(c, [ITEM]);
    expect(p.received[0]!.conflicts).toMatchObject([{ field: "description", kind: "both", defaultChoice: null }]);
  });
  it("in step: no conflict, and the agreement is recorded as hashes when no base was known yet", async () => {
    const { ctx: c, rpcs } = ctx({ base: {} });
    const p = await buildSyncPreview(c, [ITEM]);
    expect(p.received[0]!.status).toBe("in_step");
    expect(rpcs.find((r) => r.name === "github_record_base")?.args).toMatchObject({ p_actor: "u1", p_item: ITEM, p_base: inStep });
  });
  it("without a base and with Product Velocity changed since the last send, a difference is a conflict and nothing is guessed", async () => {
    plan = [{ id: ITEM, action: "update" }];
    issueTexts[ITEM] = { title: "R-1: Faster export", body: bodyFor({ summary: "other" }) };
    const { ctx: c } = ctx({ base: {} });
    expect((await buildSyncPreview(c, [ITEM])).received[0]!.conflicts).toMatchObject([{ field: "summary", kind: "both" }]);
  });
  it("an unreadable block is a whole-block conflict without a default", async () => {
    issueTexts[ITEM] = { title: "R-1: Faster export", body: "somebody removed the markers" };
    const { ctx: c } = ctx();
    expect((await buildSyncPreview(c, [ITEM])).received[0]!.conflicts).toMatchObject([{ field: "block", kind: "block", defaultChoice: null }]);
  });
});

describe("a failing read is never shown as in step", () => {
  it("the preview says the texts could not be compared, with no 'In step' and no conflict", async () => {
    issueTexts[ITEM] = { title: "R-1: Renamed in GitHub", body: bodyFor({}) };
    const { ctx: c } = ctx({ readError: true });
    const p = await buildSyncPreview(c, [ITEM]);
    expect(p.received[0]).toMatchObject({ status: "error", message: expect.stringMatching(/could not be compared.*migration/) });
  });
  it("the confirm sends and applies nothing", async () => {
    const { ctx: c, rpcs } = ctx({ readError: true });
    const r = await confirmSync(c, [ITEM], []);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/could not be compared/) });
    expect(pushCalls).toEqual([]);
    expect(rpcs).toEqual([]);
  });
});

describe("confirmSync", () => {
  const titleConflictHash = () => hashText("Renamed in GitHub");
  const edited = () => { issueTexts[ITEM] = { title: "R-1: Renamed in GitHub", body: bodyFor({}) }; };

  it("refuses to proceed while a conflict has no choice, and sends and applies nothing", async () => {
    edited();
    const { ctx: c, rpcs } = ctx();
    const r = await confirmSync(c, [ITEM], []);
    expect(r).toMatchObject({ ok: false, stale: { received: [{ status: "conflict" }] } });
    expect(rpcs.filter((x) => x.name === "github_apply_pull")).toEqual([]);
    expect(pushCalls).toEqual([]);
  });
  it("an edit made after the preview is caught: the new difference comes back and nothing is overwritten", async () => {
    edited();
    const { ctx: c } = ctx();
    const staleHash = hashText("An older GitHub title");
    const r = await confirmSync(c, [ITEM], [{ itemId: ITEM, field: "title", choice: "pv", ghHash: staleHash }]);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/changed after you looked/), stale: { received: [{ conflicts: [{ ghHash: titleConflictHash() }] }] } });
    expect(pushCalls).toEqual([]);
  });
  it("Keep GitHub applies the text first (only the allowlisted column), then sends, then records the base", async () => {
    edited();
    const { ctx: c, rpcs } = ctx();
    const r = await confirmSync(c, [ITEM], [{ itemId: ITEM, field: "title", choice: "github", ghHash: titleConflictHash() }]);
    expect(r).toMatchObject({ ok: true, taken: [{ itemId: ITEM, field: "initiative_name", before: "Faster export", after: "Renamed in GitHub" }] });
    expect(rpcs.find((x) => x.name === "github_apply_pull")?.args).toMatchObject({ p_actor: "u1", p_item: ITEM, p_fields: { initiative_name: "Renamed in GitHub" } });
    expect(order.indexOf("github_apply_pull")).toBeLessThan(order.indexOf("send"));
    expect(order.indexOf("send")).toBeLessThan(order.lastIndexOf("github_record_base"));
    expect(pushCalls[0]!.force?.size ?? 0).toBe(0); // Keep GitHub never forces a write of Product Velocity's text
  });
  it("Keep Product Velocity forces the write even though nothing changed since the last send", async () => {
    edited();
    const { ctx: c, rpcs } = ctx();
    const r = await confirmSync(c, [ITEM], [{ itemId: ITEM, field: "title", choice: "pv", ghHash: titleConflictHash() }]);
    expect(r).toMatchObject({ ok: true, taken: [] });
    expect([...pushCalls[0]!.force!]).toEqual([ITEM]);
    expect(rpcs.some((x) => x.name === "github_apply_pull")).toBe(false);
  });
  it("Keep GitHub for an unreadable block sends nothing for that initiative", async () => {
    issueTexts[ITEM] = { title: "R-1: Faster export", body: "markers gone" };
    const { ctx: c } = ctx();
    const hash = (await buildSyncPreview(c, [ITEM])).received[0]!.conflicts![0]!.ghHash;
    const r = await confirmSync(c, [ITEM], [{ itemId: ITEM, field: "block", choice: "github", ghHash: hash }]);
    expect(r.ok && r.results[0]).toMatchObject({ outcome: "unchanged", message: expect.stringMatching(/left as it is/) });
    expect(pushCalls).toEqual([]);
  });
  it("a failing pull leaves that initiative unsent and its base unchanged", async () => {
    edited();
    const { ctx: c, rpcs } = ctx({ pullError: true });
    const r = await confirmSync(c, [ITEM], [{ itemId: ITEM, field: "title", choice: "github", ghHash: titleConflictHash() }]);
    expect(r).toMatchObject({ ok: true, results: [{ id: ITEM, outcome: "error" }] });
    expect(pushCalls).toEqual([]);
    expect(rpcs.some((x) => x.name === "github_record_base")).toBe(false);
  });
  it("a send that fails does not record a base, so the next sync retries", async () => {
    edited();
    pushResults = { [ITEM]: "error" };
    const { ctx: c, rpcs } = ctx();
    await confirmSync(c, [ITEM], [{ itemId: ITEM, field: "title", choice: "pv", ghHash: titleConflictHash() }]);
    expect(rpcs.some((x) => x.name === "github_record_base")).toBe(false);
  });
});


describe("board values: Priority, Due date and Size changed on the GitHub Project board", () => {
  const withBase = () => ({ ...inStep, ...boardBase });
  it("a board value equal to Product Velocity's is quiet, and the agreement is recorded when no board base was known", async () => {
    const { ctx: c, rpcs } = ctx({ board: onBoard, base: inStep });
    const p = await buildSyncPreview(c, [ITEM]);
    expect(p.received[0]).toMatchObject({ status: "in_step" });
    expect(rpcs.find((r) => r.name === "github_record_base")?.args).toMatchObject({ p_base: { ...inStep, ...boardBase } });
  });
  it("a Priority changed only on the board is a conflict on the board, defaulting to Keep Product Velocity", async () => {
    const { ctx: c } = ctx({ board: { ...onBoard, fp: { optionId: "o1" } }, base: withBase() });
    const p = await buildSyncPreview(c, [ITEM]);
    expect(p.received[0]).toMatchObject({ status: "conflict", conflicts: [{ field: "priority", label: "Priority", kind: "github", where: "board", pv: "P0", github: "P1", defaultChoice: "pv" }] });
  });
  it("changed on both sides: no default; a size the board shows that Product Velocity does not know cannot be taken over", async () => {
    const { ctx: c } = ctx({ board: { ...onBoard, fs: { optionId: "s2" } }, base: withBase(), rows: [{ ...pv, effort: "S" }] });
    const p = await buildSyncPreview(c, [ITEM]);
    expect(p.received[0]!.conflicts).toMatchObject([{ field: "size", kind: "both", defaultChoice: null }]);
  });
  it("Keep GitHub takes the board's value into the allowlisted column only, then sends, then records the agreed hashes", async () => {
    const { ctx: c, rpcs } = ctx({ board: { ...onBoard, fp: { optionId: "o1" }, fd: { date: "2027-02-01" } }, base: withBase() });
    const p = await buildSyncPreview(c, [ITEM]);
    const picks = p.received[0]!.conflicts!.map((x) => ({ itemId: ITEM, field: x.field, choice: "github" as const, ghHash: x.ghHash }));
    expect(picks.map((x) => x.field).sort()).toEqual(["due", "priority"]);
    order.length = 0;
    const r = await confirmSync(c, [ITEM], picks);
    expect(r).toMatchObject({ ok: true, taken: expect.arrayContaining([{ itemId: ITEM, code: "R-1", field: "moscow", before: null, after: "Should" }, { itemId: ITEM, code: "R-1", field: "end_date", before: null, after: "2027-02-01" }]) });
    expect(rpcs.find((x) => x.name === "github_apply_pull")?.args).toMatchObject({ p_fields: { moscow: "Should", end_date: "2027-02-01" } });
    expect(Object.keys((rpcs.find((x) => x.name === "github_apply_pull")!.args.p_fields as object)).sort()).toEqual(["end_date", "moscow"]);
    expect(order.indexOf("github_apply_pull")).toBeLessThan(order.indexOf("send"));
    expect(rpcs.filter((x) => x.name === "github_record_base").at(-1)?.args).toMatchObject({ p_base: { priority: hashBoard("P1"), due: hashBoard("2027-02-01"), size: hashBoard("M") } });
  });
  it("Keep Product Velocity forces the write of the board value, and an empty Product Velocity value is never forced", async () => {
    const { ctx: c } = ctx({ board: { ...onBoard, fp: { optionId: "o1" } }, base: withBase() });
    const p = await buildSyncPreview(c, [ITEM]);
    const hash = p.received[0]!.conflicts![0]!.ghHash;
    await confirmSync(c, [ITEM], [{ itemId: ITEM, field: "priority", choice: "pv", ghHash: hash }]);
    expect([...pushCalls.at(-1)!.force!]).toEqual([ITEM]);
    pushCalls.length = 0;
    const empty = ctx({ board: { ...onBoard, fs: { optionId: "s2" } }, base: withBase(), rows: [{ ...pv, effort: null }] });
    const q = await buildSyncPreview(empty.ctx, [ITEM]);
    expect(q.received[0]!.conflicts).toMatchObject([{ field: "size", pv: "(empty)", defaultChoice: "github" }]);
    await confirmSync(empty.ctx, [ITEM], [{ itemId: ITEM, field: "size", choice: "pv", ghHash: q.received[0]!.conflicts![0]!.ghHash }]);
    expect(pushCalls.at(-1)!.force?.size ?? 0).toBe(0);
  });
  it("a value that cannot be taken over refuses Keep GitHub on the server too, and nothing is applied or sent", async () => {
    const sc = boardSc({ ...onBoard, fp: { optionId: "o2" } });
    sc.boardFields.set("B", [{ id: "fp", name: "Priority", dataType: "SINGLE_SELECT", options: [{ id: "o2", name: "P3" }] }]);
    const { ctx: c, rpcs } = ctx({ board: onBoard, base: withBase() });
    (c as { sc: unknown }).sc = sc;
    const p = await buildSyncPreview(c, [ITEM]);
    expect(p.received[0]!.conflicts).toMatchObject([{ field: "priority", githubPullable: false, defaultChoice: "pv" }]);
    const r = await confirmSync(c, [ITEM], [{ itemId: ITEM, field: "priority", choice: "github", ghHash: p.received[0]!.conflicts![0]!.ghHash }]);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/cannot be taken over/) });
    expect(rpcs.some((x) => x.name === "github_apply_pull")).toBe(false);
    expect(pushCalls).toEqual([]);
  });
  it("a board that cannot be read is a note on the card, never 'compared and fine'", async () => {
    const { ctx: c } = ctx({ board: onBoard, base: withBase() });
    (c as { sc: { failOn: string | null } }).sc.failOn = "getBoardItemValues";
    const p = await buildSyncPreview(c, [ITEM]);
    expect(p.received[0]!.message).toMatch(/board values .* could not be read/);
  });
  it("an initiative that is not on a board has no board comparison", async () => {
    const { ctx: c } = ctx({ board: null });
    const p = await buildSyncPreview(c, [ITEM]);
    expect(p.received[0]!.status).toBe("in_step");
  });
});
