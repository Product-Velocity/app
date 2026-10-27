import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authenticate = vi.fn();
vi.mock("@/lib/mcp/auth", () => ({ authenticate: (t: string) => authenticate(t), mcpEnabled: () => true }));
vi.mock("@/lib/site-url", () => ({ siteUrl: async () => "https://app.test" }));

import { POST } from "./route";

const post = (token: string | null, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }) =>
  POST(new NextRequest("https://app.test/mcp", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));

beforeEach(() => authenticate.mockReset());

describe("POST /mcp refusals", () => {
  it("no token: 401 with the discovery header", async () => {
    const r = await post(null);
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("oauth-protected-resource");
  });

  it("a revoked connection: 401 with a clear message and a header that sends the client back to sign in", async () => {
    authenticate.mockResolvedValue({ ok: false, http: 401, error: "connection_revoked", message: "This connection was revoked in Product Velocity." });
    const r = await post("t");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("resource_metadata");
    expect(await r.json()).toMatchObject({ error: "connection_revoked", error_description: expect.stringMatching(/revoked/) });
  });

  it("workspace switched off: 403 that says why, for every call", async () => {
    authenticate.mockResolvedValue({ ok: false, http: 403, error: "workspace_off", message: "Claude is switched off for this workspace." });
    for (const body of [{ jsonrpc: "2.0", id: 1, method: "tools/list" }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_workspace_context" } }]) {
      const r = await post("t", body);
      expect(r.status).toBe(403);
      expect(r.headers.get("www-authenticate")).toBeNull();
      expect(await r.json()).toMatchObject({ error: "workspace_off" });
    }
  });

  it("an allowed caller reaches the tools", async () => {
    authenticate.mockResolvedValue({
      ok: true,
      caller: { userId: "u", clientId: "c", connectionId: "k", backend: { role: "viewer", meter: async () => ({ ok: true }), workspaceContext: async () => ({ workspace: { id: "t", name: "W", role: "viewer", projects: [] } }) } },
    });
    const r = await post("t");
    expect(r.status).toBe(200);
    expect((await r.json()).result.tools[0].name).toBe("get_workspace_context");
  });
});
