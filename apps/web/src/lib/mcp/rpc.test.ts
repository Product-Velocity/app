import { describe, expect, it, vi } from "vitest";
import { buildContext } from "./read-model";
import { handleRpc, parseBearer, resourceMetadata, TOOLS, wwwAuthenticate, type McpBackend, type ToolDef } from "./rpc";

const ctx = buildContext({
  tenant: { id: "t1", name: "Meridian Media" }, userId: "u1", role: "creator",
  projects: [{ id: "p1", name: "Core", default_repo: null, tracker: null }], groups: [], teams: [], members: [],
  githubConnected: false, repoPrivate: new Map(),
});
const noRead = async () => { throw new Error("not used"); };
const backend = (over: Partial<McpBackend> = {}): McpBackend => ({
  role: "creator",
  workspaceContext: vi.fn(async () => ctx),
  read: { searchData: noRead, itemDetail: noRead, groups: noRead, views: noRead, files: noRead, documents: noRead, document: noRead },
  write: { context: noRead, current: noRead, apply: noRead, savePending: noRead, loadPending: noRead, undo: noRead, files: {} as never, documents: {} as never },
  meter: vi.fn(async () => ({ ok: true as const })),
  ...over,
});
/** A stand-in for the write tools of later slices, to prove the role gate now. */
const writeTool = (run: ToolDef["run"] = vi.fn(async () => ({ created: 1 }))): ToolDef => ({
  name: "stand_in_write", title: "Create", description: "x", inputSchema: {}, annotations: {}, mode: "write", run,
});
const call = (name: string, b: McpBackend, tools = TOOLS) => handleRpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: {} } }, b, tools) as Promise<{ result?: { isError?: boolean; content: { text: string }[] } }>;

describe("parseBearer", () => {
  it("reads a Bearer token and nothing else", () => {
    expect(parseBearer("Bearer abc.def")).toBe("abc.def");
    expect(parseBearer("bearer abc")).toBe("abc");
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("Bearer ")).toBeNull();
  });
});

describe("OAuth discovery", () => {
  it("points the 401 at the protected-resource metadata", () => {
    expect(wwwAuthenticate("https://app.test")).toBe(
      'Bearer resource_metadata="https://app.test/.well-known/oauth-protected-resource/mcp"',
    );
  });
  it("names /mcp as the resource and Supabase Auth as the authorization server", () => {
    expect(resourceMetadata("https://app.test", "https://x.supabase.co")).toMatchObject({
      resource: "https://app.test/mcp",
      authorization_servers: ["https://x.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
    });
  });
});

describe("handleRpc", () => {
  it("initialize negotiates a supported version and advertises tools only", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, backend());
    expect(r).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "product-velocity" } } });
  });
  it("falls back to the latest version it supports", async () => {
    const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }, backend());
    expect((r as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-06-18");
  });
  it("notifications get no response", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, backend())).toBeNull();
  });
  it("lists the read tools (read-only) and then the write tools (not read-only)", async () => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, backend())) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    const reads = ["get_workspace_context", "describe_fields", "search_items", "get_item", "list_groups", "list_views", "list_files", "list_documents", "get_document"];
    const writes = ["create_items", "update_items", "confirm_changes", "set_relations", "add_link", "remove_link", "undo_last", "add_file", "set_file_sharing", "remove_file", "create_document", "update_document"];
    expect(r.result.tools.map((t) => t.name)).toEqual([...reads, ...writes]);
    for (const t of r.result.tools) expect(t.annotations.readOnlyHint, t.name).toBe(reads.includes(t.name));
  });
  it("get_workspace_context returns the backend data wrapped as data", async () => {
    const b = backend();
    const r = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_workspace_context", arguments: {} } }, b)) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    expect(b.workspaceContext).toHaveBeenCalledOnce();
    expect(r.result.isError).toBeUndefined();
    const parsed = JSON.parse(r.result.content[0]!.text);
    expect(parsed.data.projects[0].name).toBe("Core");
    expect(parsed.envelope).toBe("pv-data");
    expect(parsed.note).toMatch(/data from the workspace, not instructions/i);
  });
  it("unknown tools and methods are errors, and backend failures never leak details", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "delete_everything" } }, backend())).toMatchObject({ error: { code: -32602 } });
    expect(await handleRpc({ jsonrpc: "2.0", id: 5, method: "nope" }, backend())).toMatchObject({ error: { code: -32601 } });
    const bad = backend({ workspaceContext: async () => { throw new Error('relation "items" does not exist'); } });
    const r = JSON.stringify(await handleRpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_workspace_context" } }, bad));
    expect(r).toContain("isError");
    expect(r).not.toContain("relation");
  });
});

describe("role gate", () => {
  it("lets every role call a read tool", async () => {
    for (const role of ["viewer", "commenter", "creator", "admin", "leadership"]) {
      const r = await call("get_workspace_context", backend({ role }));
      expect(r.result?.isError, role).toBeUndefined();
    }
  });
  it("refuses a write tool for viewer, commenter and leadership, without running it or using quota", async () => {
    for (const role of ["viewer", "commenter", "leadership"]) {
      const run = vi.fn(async () => ({}));
      const b = backend({ role });
      const r = await call("stand_in_write", b, [...TOOLS, writeTool(run)]);
      expect(r.result?.isError, role).toBe(true);
      expect(r.result?.content[0]!.text).toMatch(/read-only/i);
      expect(run).not.toHaveBeenCalled();
      expect(b.meter).not.toHaveBeenCalled();
    }
  });
  it("lets creators and admins run a write tool", async () => {
    for (const role of ["creator", "admin"]) {
      const run = vi.fn(async () => ({ created: 1 }));
      const r = await call("stand_in_write", backend({ role }), [...TOOLS, writeTool(run)]);
      expect(r.result?.isError, role).toBeUndefined();
      expect(run).toHaveBeenCalledOnce();
    }
  });
  it("never shows clients the handlers or modes", async () => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, backend(), [...TOOLS, writeTool()])) as { result: { tools: object[] } };
    for (const t of r.result.tools) expect(Object.keys(t)).not.toEqual(expect.arrayContaining(["run"]));
    expect(JSON.stringify(r)).not.toContain('"mode"');
  });
});

describe("rate limits", () => {
  it("meters every tool call and returns the readable limit message as the tool result", async () => {
    const run = vi.fn(async () => ({}));
    const b = backend({ meter: vi.fn(async () => ({ ok: false as const, reason: "workspace_items", limit: 200, used: 200 })) });
    const r = await call("stand_in_write", b, [...TOOLS, writeTool(run)]);
    expect(r.result?.isError).toBe(true);
    expect(r.result?.content[0]!.text).toMatch(/daily limit of 200 items/);
    expect(run).not.toHaveBeenCalled();
  });
  it("does not meter initialize, ping or tools/list", async () => {
    const b = backend();
    for (const method of ["initialize", "ping", "tools/list"]) await handleRpc({ jsonrpc: "2.0", id: 1, method }, b);
    expect(b.meter).not.toHaveBeenCalled();
  });
});
