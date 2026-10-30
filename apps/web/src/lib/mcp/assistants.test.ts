import { describe, expect, it, vi } from "vitest";
import { ASSISTANT_INFO, type Assistant, type UsageResult } from "@pv/domain";
import { simplifySchema } from "./assistant-schema";
import { buildContext } from "./read-model";
import { handleRpc, toolsFor, TOOLS, type McpBackend } from "./rpc";

const backend = (assistant?: Assistant): McpBackend => ({
  role: "creator", assistant,
  workspaceContext: vi.fn(async () => buildContext({ tenant: { id: "t", name: "M" }, userId: "u1", role: "creator", projects: [], groups: [], teams: [], members: [], githubConnected: false, repoPrivate: new Map() })),
  read: {} as never, write: {} as never,
  meter: vi.fn<McpBackend["meter"]>(async (): Promise<UsageResult> => ({ ok: true })),
});
type Listed = { result: { tools: { name: string; inputSchema: unknown; annotations: Record<string, boolean> }[] } };
const list = async (a?: Assistant) => ((await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, backend(a))) as Listed).result.tools;

describe("one server, the same tools for every assistant", () => {
  it("Claude, Gemini and an unknown client see the same tools; ChatGPT sees those plus search and fetch", async () => {
    const claude = (await list("claude")).map((t) => t.name);
    expect((await list("gemini")).map((t) => t.name)).toEqual(claude);
    expect((await list("other")).map((t) => t.name)).toEqual(claude);
    expect((await list("chatgpt")).map((t) => t.name).filter((n) => !["search", "fetch"].includes(n))).toEqual(claude);
    expect((await list("chatgpt")).map((t) => t.name)).toEqual(expect.arrayContaining(["search", "fetch"]));
  });
  it("every tool says whether it only reads, and the write tools are the same for all", async () => {
    for (const a of ["claude", "chatgpt", "gemini"] as const) {
      for (const t of await list(a)) expect(typeof t.annotations.readOnlyHint, `${a} ${t.name}`).toBe("boolean");
    }
    expect(TOOLS.filter((t) => t.mode === "write").every((t) => !t.assistants)).toBe(true);
  });
  it("a role check applies whichever assistant asks: a viewer cannot write through ChatGPT or Gemini either", async () => {
    for (const a of ["chatgpt", "gemini", "claude"] as const) {
      const b = { ...backend(a), role: "viewer" };
      const r = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "remember", arguments: {} } }, b)) as { result: { isError?: boolean; content: { text: string }[] } };
      expect(r.result.isError, a).toBe(true);
      expect(r.result.content[0]!.text, a).toMatch(/read-only/);
    }
  });
  it("no tool for any assistant can approve, rank, decide, value or confirm", async () => {
    for (const a of ["claude", "chatgpt", "gemini"] as const) {
      expect((await list(a)).map((t) => t.name).filter((n) => /approve|rank|decision|value|delete|ready|confirm_note|confirm_memory/i.test(n))).toEqual([]);
    }
  });
});

describe("instructions and prompts per assistant", () => {
  const instructions = async (a?: Assistant) => ((await handleRpc({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-06-18" } }, backend(a))) as { result: { instructions: string } }).result.instructions;
  it("a client that cannot start prompts is told to use get_playbook; one that can is told the prompt names", async () => {
    expect(ASSISTANT_INFO.chatgpt.prompts).toBe(false);
    expect(await instructions("chatgpt")).toMatch(/call get_playbook/);
    expect(await instructions("claude")).toMatch(/prompts write_prd, write_discovery, review_group/);
    expect(await instructions("gemini")).not.toMatch(/call get_playbook/);
  });
  it("everyone gets the same flow rules and the memory description", async () => {
    for (const a of ["claude", "chatgpt", "gemini"] as const) {
      const i = await instructions(a);
      expect(i).toMatch(/Remember what lasts/);
      expect(i).toMatch(/review_group lists the other initiatives of the same Initiative Group/);
      expect(i).toMatch(/Research the context of this brief/);
    }
  });
  it("lists the same prompts to all clients", async () => {
    const names = async (a: Assistant) => ((await handleRpc({ jsonrpc: "2.0", id: 4, method: "prompts/list" }, backend(a))) as { result: { prompts: { name: string }[] } }).result.prompts.map((p) => p.name);
    expect(await names("gemini")).toEqual(await names("claude"));
    expect(await names("chatgpt")).toEqual(["write_prd", "write_discovery", "review_group", "research_company", "setup_memory"]);
  });
});

describe("simple schemas for Gemini", () => {
  const FORBIDDEN = /"(additionalProperties|\$schema|anyOf|oneOf|const|pattern|format|default|uniqueItems)"/;
  it("removes what a small-schema client rejects from every tool, and keeps the tools usable", async () => {
    const gemini = await list("gemini");
    for (const t of gemini) {
      const s = JSON.stringify(t.inputSchema);
      expect(s, t.name).not.toMatch(FORBIDDEN);
      expect((t.inputSchema as { type: string }).type, t.name).toBe("object");
    }
    // the same tools unchanged for Claude
    expect(JSON.stringify((await list("claude")).find((t) => t.name === "search_items")!.inputSchema)).toMatch(/anyOf/);
    const fields = (gemini.find((t) => t.name === "search_items")!.inputSchema as { properties: { fields: { type: string; description: string } } }).properties.fields;
    expect(fields.type).toBe("array");
    expect(fields.description).toMatch(/Also accepted: "all"/);
  });
  it("keeps types, enums, required lists and limits", () => {
    const s = simplifySchema({
      type: "object", additionalProperties: false,
      properties: { kind: { type: "string", enum: ["a", "b"] }, n: { type: "integer", minimum: 1, maximum: 5 }, all: { const: "all" }, either: { anyOf: [{ type: "array", items: { type: "string" } }, { const: "all" }], description: "Fields." } },
      required: ["kind"],
    }) as { properties: Record<string, Record<string, unknown>>; required: string[] };
    expect(s.required).toEqual(["kind"]);
    expect(s.properties.kind).toEqual({ type: "string", enum: ["a", "b"] });
    expect(s.properties.n).toEqual({ type: "integer", minimum: 1, maximum: 5 });
    expect(s.properties.all).toEqual({ enum: ["all"], type: "string" });
    expect(s.properties.either).toMatchObject({ type: "array", items: { type: "string" } });
    expect(String(s.properties.either!.description)).toMatch(/Fields\. Also accepted: "all"/);
  });
});

describe("tools are not shown to clients that cannot use them, but nothing becomes callable by hiding", () => {
  it("search is unknown to a Claude connection", async () => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "search", arguments: { query: "x" } } }, backend("claude"))) as { error?: { message: string } };
    expect(r.error?.message).toBe("Unknown tool");
    expect(toolsFor("claude").length).toBe(TOOLS.length - 2);
  });
});
