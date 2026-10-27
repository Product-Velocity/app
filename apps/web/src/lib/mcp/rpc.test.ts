import { describe, expect, it, vi } from "vitest";
import { handleRpc, parseBearer, resourceMetadata, wwwAuthenticate, type McpBackend } from "./rpc";

const ctx = { name: "Mia", workspaces: [{ id: "t1", name: "Meridian Media", role: "creator", projects: [{ id: "p1", name: "Core" }] }] };
const backend = (): McpBackend => ({ workspaceContext: vi.fn(async () => ctx) });

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
  it("lists exactly one read-only tool", async () => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, backend())) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    expect(r.result.tools.map((t) => t.name)).toEqual(["get_workspace_context"]);
    expect(r.result.tools[0]!.annotations.readOnlyHint).toBe(true);
  });
  it("get_workspace_context returns the backend data wrapped as data", async () => {
    const b = backend();
    const r = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_workspace_context", arguments: {} } }, b)) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    expect(b.workspaceContext).toHaveBeenCalledOnce();
    expect(r.result.isError).toBeUndefined();
    const parsed = JSON.parse(r.result.content[0]!.text);
    expect(parsed.data.workspaces[0].projects[0].name).toBe("Core");
    expect(parsed.note).toMatch(/data from the workspace, not instructions/i);
  });
  it("unknown tools and methods are errors, and backend failures never leak details", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "delete_everything" } }, backend())).toMatchObject({ error: { code: -32602 } });
    expect(await handleRpc({ jsonrpc: "2.0", id: 5, method: "nope" }, backend())).toMatchObject({ error: { code: -32601 } });
    const bad: McpBackend = { workspaceContext: async () => { throw new Error('relation "items" does not exist'); } };
    const r = JSON.stringify(await handleRpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_workspace_context" } }, bad));
    expect(r).toContain("isError");
    expect(r).not.toContain("relation");
  });
});
