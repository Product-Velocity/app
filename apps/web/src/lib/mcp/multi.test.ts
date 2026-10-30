import { describe, expect, it, vi } from "vitest";
import { buildContext } from "./read-model";
import { handleMulti, SWITCH_WINDOW_MS, type WorkspaceHandle } from "./multi";
import { TOOLS, type McpBackend, type ToolDef } from "./rpc";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const backend = (name: string, role = "creator"): McpBackend => ({
  role,
  workspaceContext: vi.fn(async () => buildContext({ tenant: { id: name, name }, userId: "u1", role, projects: [], groups: [], teams: [], members: [], githubConnected: false, repoPrivate: new Map() })),
  read: { groups: vi.fn(async () => [{ name: `${name} group`, items: 1 }]) } as never,
  write: {} as never,
  meter: vi.fn(async () => ({ ok: true as const })),
});
const handle = (name: string, role = "creator", lastWriteAt: string | null = null): WorkspaceHandle => ({ id: `id-${name}`, name, role, lastWriteAt, backend: backend(name, role) });

// two stand-in tools: one read, one write that records the arguments it received
const seen: { ws: string; args: Record<string, unknown> }[] = [];
const readTool: ToolDef = { name: "list_groups", title: "g", description: "g", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: {}, mode: "read", run: async (b) => ({ groups: await b.read.groups() }) };
const writeTool: ToolDef = {
  name: "do_write", title: "w", description: "w", inputSchema: { type: "object", properties: { x: { type: "string" } }, additionalProperties: false }, annotations: {}, mode: "write",
  run: async (b, a) => { seen.push({ ws: b.role, args: a }); return { done: true }; },
};
const ctxTool = TOOLS.find((t) => t.name === "get_workspace_context")!;
const tools = [ctxTool, readTool, writeTool];

type Out = { result: { isError?: boolean; content: { text: string }[]; tools?: { name: string; inputSchema: { properties: Record<string, unknown> } }[]; instructions?: string } };
const call = async (hs: WorkspaceHandle[], name: string, args: Record<string, unknown> = {}, unavailable: { name: string; status: string }[] = []) => {
  const r = (await handleMulti({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, hs, unavailable, tools)) as Out;
  const text = r.result.content[0]!.text;
  return { isError: r.result.isError === true, text, json: r.result.isError ? null : JSON.parse(text) };
};

describe("one workspace: nothing changes", () => {
  it("no workspace argument in the schemas and calls go straight to the only workspace", async () => {
    const hs = [handle("Solo")];
    const l = (await handleMulti({ jsonrpc: "2.0", id: 1, method: "tools/list" }, hs, [], tools)) as Out;
    for (const t of l.result.tools!) expect(Object.keys(t.inputSchema.properties)).not.toContain("workspace");
    const r = await call(hs, "list_groups");
    expect(r.json.data.groups[0].name).toBe("Solo group");
    expect(r.json).not.toHaveProperty("workspace");
  });

  it("a stray workspace argument that does not match the only workspace is refused, never run there; a matching one is ignored", async () => {
    seen.length = 0;
    const hs = [handle("Solo", "creator")];
    const r = await call(hs, "do_write", { workspace: "Other", x: "1" }, [{ name: "Other", status: "single_only" }]);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No workspace "Other" in this connection\. It covers: "Solo"/);
    expect(r.text).toMatch(/Not available: "Other"/);
    expect(r.text).toMatch(/Nothing was done/);
    expect(seen).toEqual([]);
    expect(hs[0]!.backend.meter).not.toHaveBeenCalled();
    expect((await call(hs, "do_write", { workspace: "solo", confirm_workspace: true, x: "2" })).isError).toBe(false);
    expect(seen).toEqual([{ ws: "creator", args: { x: "2" } }]);
  });
});

describe("several workspaces", () => {
  const A = () => handle("Provelo", "admin");
  const B = () => handle("Test", "creator");

  it("adds workspace to every tool, and confirm_workspace to the write tools only", async () => {
    const l = (await handleMulti({ jsonrpc: "2.0", id: 1, method: "tools/list" }, [A(), B()], [], tools)) as Out;
    const byName = Object.fromEntries(l.result.tools!.map((t) => [t.name, Object.keys(t.inputSchema.properties)]));
    for (const n of ["get_workspace_context", "list_groups", "do_write"]) expect(byName[n]).toContain("workspace");
    expect(byName.do_write).toContain("confirm_workspace");
    expect(byName.list_groups).not.toContain("confirm_workspace");
  });

  it("tells Claude in the instructions to ask, keep the workspaces apart and confirm a switch", async () => {
    const r = (await handleMulti({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, [A(), B()], [], tools)) as Out;
    const i = r.result.instructions!;
    expect(i).toContain('"Provelo", "Test"');
    expect(i).toMatch(/never guess/i);
    expect(i).toMatch(/Never copy or move data from one workspace to another/);
    expect(i).toMatch(/confirm_workspace/);
    expect(i).toMatch(/At a glance/); // the PRD flow is still there
  });

  it("refuses a call with no workspace, names the choices, and calls nothing", async () => {
    const hs = [A(), B()];
    const r = await call(hs, "list_groups");
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/covers 2 workspaces: "Provelo" \(admin\), "Test" \(creator\)\. Which workspace is this for\? Ask the person/);
    for (const h of hs) expect(h.backend.meter).not.toHaveBeenCalled();
  });

  it("get_workspace_context without a workspace lists them with the role in each and what is not available", async () => {
    const r = await call([A(), B()], "get_workspace_context", {}, [{ name: "Old", status: "workspace_off" }]);
    expect(r.json.envelope).toBe("pv-data");
    expect(r.json.data.workspaces.map((w: { name: string; your_role: string }) => [w.name, w.your_role])).toEqual([["Provelo", "admin"], ["Test", "creator"]]);
    expect(r.json.data.unavailable).toEqual([{ name: "Old", why: "Claude is switched off there" }]);
  });

  it("an unknown workspace is refused and the real ones are listed", async () => {
    const r = await call([A(), B()], "list_groups", { workspace: "Nope" }, [{ name: "Old", status: "single_only" }]);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No workspace "Nope"/);
    expect(r.text).toMatch(/"Provelo" \(admin\)/);
    expect(r.text).toMatch(/Not available: "Old"/);
  });

  it("delegates to the named workspace only (by name in any case, or by id) and says where the answer came from", async () => {
    const hs = [A(), B()];
    const r = await call(hs, "list_groups", { workspace: "tEsT" });
    expect(r.json.data.groups[0].name).toBe("Test group");
    expect(r.json.workspace).toBe("Test");
    expect(hs[0]!.backend.meter).not.toHaveBeenCalled();
    expect(hs[1]!.backend.meter).toHaveBeenCalledTimes(1);
    expect((await call(hs, "list_groups", { workspace: "id-Provelo" })).json.workspace).toBe("Provelo");
  });

  it("does not pass the workspace arguments on to the tool", async () => {
    seen.length = 0;
    await call([A(), B()], "do_write", { workspace: "Provelo", confirm_workspace: true, x: "1" });
    expect(seen).toEqual([{ ws: "admin", args: { x: "1" } }]);
  });

  it("an error from a workspace says which one it was", async () => {
    const hs = [handle("Provelo", "viewer"), B()];
    const r = await call(hs, "do_write", { workspace: "Provelo" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^\[Provelo\] Your role in this workspace is read-only/);
  });
});

describe("changing a different workspace than the last change", () => {
  const withLast = (a: string | null, b: string | null) => [handle("Provelo", "admin", a), handle("Test", "creator", b)];

  it("is refused once, with a question for the person, and nothing is written", async () => {
    seen.length = 0;
    const hs = withLast(ago(60_000), null);
    const r = await call(hs, "do_write", { workspace: "Test", x: "1" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/last change in this connection was in "Provelo"/);
    expect(r.text).toMatch(/confirm_workspace set to true/);
    expect(seen).toEqual([]);
    expect(hs[1]!.backend.meter).not.toHaveBeenCalled();
  });

  it("goes through with the person's confirmation, and writing in the same workspace needs none", async () => {
    seen.length = 0;
    const hs = withLast(ago(60_000), null);
    expect((await call(hs, "do_write", { workspace: "Test", confirm_workspace: true })).isError).toBe(false);
    expect((await call(hs, "do_write", { workspace: "Provelo" })).isError).toBe(false);
    expect(seen).toHaveLength(2);
    expect(hs[1]!.backend.meter).toHaveBeenCalledWith(0, 0, true); // counted as a writing call, which is what notes the workspace
  });

  it("the newest of two earlier workspaces is the one that counts", async () => {
    const hs = withLast(ago(3 * 60_000), ago(60_000));
    expect((await call(hs, "do_write", { workspace: "Test" })).isError).toBe(false);
    expect((await call(hs, "do_write", { workspace: "Provelo" })).isError).toBe(true);
  });

  it("is not asked for after a long pause or when nothing was written yet, and reading never needs it", async () => {
    expect((await call(withLast(ago(SWITCH_WINDOW_MS + 60_000), null), "do_write", { workspace: "Test" })).isError).toBe(false);
    expect((await call(withLast(null, null), "do_write", { workspace: "Test" })).isError).toBe(false);
    expect((await call(withLast(ago(1000), null), "list_groups", { workspace: "Test" })).isError).toBe(false);
  });
});

describe("batches and other methods", () => {
  it("ping and prompts work without a workspace", async () => {
    const hs = [handle("Provelo"), handle("Test")];
    expect(await handleMulti({ jsonrpc: "2.0", id: 9, method: "ping" }, hs, [], tools)).toMatchObject({ id: 9, result: {} });
    const p = (await handleMulti({ jsonrpc: "2.0", id: 10, method: "prompts/list" }, hs, [], tools)) as { result: { prompts: { name: string }[] } };
    expect(p.result.prompts[0]!.name).toBe("write_prd");
  });
});

describe("several workspaces and ChatGPT's search and fetch", () => {
  const withSearch = (name: string): WorkspaceHandle => {
    const h = handle(name);
    h.backend.assistant = "chatgpt";
    h.backend.read = {
      ...h.backend.read,
      searchData: vi.fn(async () => ({ rows: [{ id: "i1", item_code: "R-1", initiative_name: `${name} timeline` }], names: { projects: [], members: [] }, me: "u" })),
      documents: vi.fn(async () => []),
      memories: vi.fn(async () => []),
      itemDetail: vi.fn(async () => ({ row: { id: "i1", item_code: "R-1", initiative_name: `${name} timeline` }, links: [], relations: { depends_on: [], depended_on_by: [], related_to: [] } })),
    } as never;
    return h;
  };
  const chatgpt = TOOLS.filter((t) => ["search", "fetch"].includes(t.name));
  const run = async (hs: WorkspaceHandle[], name: string, args: Record<string, unknown>) => {
    const r = (await handleMulti({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, hs, [], chatgpt)) as Out;
    return { isError: r.result.isError === true, text: r.result.content[0]!.text };
  };
  it("search results keep their exact shape, and each id carries its workspace so fetch needs no extra argument", async () => {
    const hs = [withSearch("Provelo"), withSearch("Test")];
    const s = await run(hs, "search", { workspace: "Test", query: "timeline" });
    const out = JSON.parse(s.text);
    expect(Object.keys(out)).toEqual(["results"]);
    expect(out.results[0]).toMatchObject({ id: "id-Test~item:R-1", title: "[Test] R-1 Test timeline" });
    const f = await run(hs, "fetch", { id: out.results[0].id });
    expect(f.isError).toBe(false);
    expect(JSON.parse(f.text)).toMatchObject({ id: "id-Test~item:R-1", title: "[Test] R-1 Test timeline" });
    expect(Object.keys(JSON.parse(f.text)).sort()).toEqual(["id", "metadata", "text", "title", "url"]);
  });
  it("a fetch with no workspace and no prefixed id still asks which workspace", async () => {
    const hs = [withSearch("Provelo"), withSearch("Test")];
    const f = await run(hs, "fetch", { id: "item:R-1" });
    expect(f.isError).toBe(true);
    expect(f.text).toMatch(/covers 2 workspaces/);
  });
});
