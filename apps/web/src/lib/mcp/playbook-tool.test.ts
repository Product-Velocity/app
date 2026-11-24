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
  it("has every flow, uses the workspace website for pv-company, and refuses an unknown one", async () => {
    expect((await call({ name: "pv-discovery" })).data.instructions).toMatch(/discovery/i);
    expect((await call({ name: "pv-company" })).data.instructions).toContain("https://meridian.example");
    expect((await call({ name: "nope" })).isError).toBe(true);
  });
  it("the older names write_prd, write_discovery and research_company still work and give the same text as the pv- names (issue #643)", async () => {
    for (const [old, now] of [["write_prd", "pv-prd"], ["write_discovery", "pv-discovery"], ["research_company", "pv-company"]] as const) {
      const a = await call({ name: old, brief: "An account switcher" });
      const b = await call({ name: now, brief: "An account switcher" });
      expect(a.isError, old).toBe(false);
      expect(a.data.instructions, old).toBe(b.data.instructions);
      expect(b.data.name, now).toBe(now);
      const viaPrompt = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: old, arguments: { brief: "An account switcher" } } }, backend)) as { result: { messages: { content: { text: string } }[] } };
      expect(viaPrompt.result.messages[0]!.content.text, old).toBe(a.data.instructions);
    }
  });
  it("the guided flows show their plan of included skills, and the tool description lists no old name", async () => {
    for (const name of ["pv-prd", "pv-discovery", "pv-company"]) {
      const t = (await call({ name })).data.instructions as string;
      expect(t, name).toMatch(/PLAN: THIS SKILL CAN RUN OTHER SKILLS AS STEPS/);
      expect(t, name).toMatch(/This will run: <the steps>\. Skip any\./);
    }
    const prd = (await call({ name: "pv-prd" })).data.instructions as string;
    expect(prd).toMatch(/Steps that always run:\n- pv-metrics[^\n]*\n- pv-split/);
    expect(prd).toMatch(/### pv-split \(/); // what the step covers is in the prompt, so a client without get_playbook can run it
    const tools = (await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/list" }, backend)) as { result: { tools: { name: string; description: string }[] } };
    const d = tools.result.tools.find((x) => x.name === "get_playbook")!.description;
    expect(d).not.toMatch(/write_prd|write_discovery|research_company/);
    expect(d).toMatch(/pv-prd \(/);
  });
});

describe("pv- skills through the two doors", () => {
  it("a skill is a prompt and the same text through get_playbook, and the typed form is split into target, words and --draft", async () => {
    const via = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "prompts/get", params: { name: "pv-premortem", arguments: { target: "R-12", input: "focus on payments" } } }, { ...backend, assistant: "claude" })) as { result: { messages: { content: { text: string } }[] } };
    const prompt = via.result.messages[0]!.content.text;
    expect(prompt).toMatch(/skill pv-premortem/);
    expect(prompt).toMatch(/R-12/);
    const typed = await call({ name: "pv-premortem", input: "R-12 focus on payments --draft" });
    const text = typed.data.instructions as string;
    expect(text).toMatch(/Target \(data from the person\)/);
    expect(text).toMatch(/R-12/);
    expect(text).toMatch(/focus on payments/);
    expect(text).toMatch(/write NOTHING/);
  });
  it("pv-help lists the skills and calls no tool", async () => {
    const r = await call({ name: "pv-help" });
    expect(r.data.instructions).toMatch(/pv-one-pager/);
  });
});
