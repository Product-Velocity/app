import { describe, expect, it, vi } from "vitest";
import type { UsageResult } from "@pv/domain";
import { buildContext } from "./read-model";
import { handleRpc, toolsFor, type McpBackend } from "./rpc";

type Out = { result: { isError?: boolean; content: { text: string }[] } };
const backend: McpBackend = {
  role: "viewer", assistant: "chatgpt",
  workspaceContext: vi.fn(async () => buildContext({ tenant: { id: "t", name: "M" }, userId: "u1", role: "viewer", projects: [], groups: [], teams: [], members: [], githubConnected: false, repoPrivate: new Map() })),
  read: { companyProfile: vi.fn(async () => ({ url: "https://meridian.example", profile: null })) } as never, write: {} as never,
  meter: vi.fn<McpBackend["meter"]>(async (): Promise<UsageResult> => ({ ok: true })),
};
const call = async (args: Record<string, unknown>) => {
  const r = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_playbook", arguments: args } }, backend, toolsFor("chatgpt"))) as Out;
  const text = r.result.content[0]!.text;
  return { isError: r.result.isError === true, data: r.result.isError ? null : JSON.parse(text).data, text };
};

describe("get_playbook", () => {
  it("returns the same text as the MCP prompt, with the person's words quoted as data", async () => {
    const p = await call({ name: "write_prd", brief: "An account switcher" });
    expect(p.data.instructions).toContain('"""\nAn account switcher\n"""');
    const viaPrompt = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "write_prd", arguments: { brief: "An account switcher" } } }, backend)) as { result: { messages: { content: { text: string } }[] } };
    expect(p.data.instructions).toBe(viaPrompt.result.messages[0]!.content.text);
  });
  it("has every flow, uses the workspace website for research_company, and refuses an unknown one", async () => {
    expect((await call({ name: "write_discovery" })).data.instructions).toMatch(/discovery/i);
    expect((await call({ name: "research_company" })).data.instructions).toContain("https://meridian.example");
    expect((await call({ name: "nope" })).isError).toBe(true);
  });
});
