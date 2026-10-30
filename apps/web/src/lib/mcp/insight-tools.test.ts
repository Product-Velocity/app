import { describe, expect, it, vi } from "vitest";
import type { MemoryRow, UsageResult } from "@pv/domain";
import { buildContext } from "./read-model";
import { handleRpc, toolsFor, type McpBackend } from "./rpc";

type Out = { result: { isError?: boolean; content: { text: string }[] } };
const rows = [
  { id: "i1", item_code: "R-1", initiative_name: "Timeline view of the roadmap", theme: "Roadmap views", summary: "Show initiatives on a timeline by quarter", g2m_date_est: "2026-12-01" },
  { id: "i2", item_code: "R-2", initiative_name: "Gantt timeline for quarters", theme: "Roadmap views", summary: "A timeline chart of initiatives by quarter", g2m_date_est: "2027-02-01" },
  { id: "i3", item_code: "R-3", initiative_name: "Cards view", theme: "Roadmap views", summary: "Cards grouped by status" },
  { id: "i4", item_code: "R-4", initiative_name: "Billing export", theme: "Payments", summary: "Export invoices" },
];
const note = (o: Partial<MemoryRow>): MemoryRow => ({
  id: "n1", scope: "workspace", group: null, item: null, kind: "partner", title: "Acme Pay", body: "Card payments.", source: "https://acme.example", basis: "source", tags: [], status: "draft", ai_draft: true, version: 1,
  verified_at: new Date().toISOString(), updated_at: new Date().toISOString(), assistant: "chatgpt", ...o,
});

function setup(notes: MemoryRow[] = [], profile: { sections: Record<string, string>; researched_at: string | null } | null = null) {
  const backend: McpBackend = {
    role: "viewer",
    assistant: "chatgpt",
    workspaceContext: vi.fn(async () => buildContext({ tenant: { id: "t", name: "M" }, userId: "u1", role: "viewer", projects: [], groups: [], teams: [], members: [], githubConnected: false, repoPrivate: new Map() })),
    read: {
      searchData: vi.fn(async () => ({ rows, names: { projects: [], members: [] }, me: "u1" })),
      documents: vi.fn(async (code: string) => (code === "R-2" ? [{ id: "d1", item_code: "R-2", kind: "prd", title: "PRD: Gantt", status: "draft", version: 1, ai_draft: true, characters: 900, updated_at: "2026-10-01T00:00:00Z", approved_at: null }] : [])),
      memories: vi.fn(async () => notes),
      companyProfile: vi.fn(async () => ({ url: null, profile: profile ? { status: "draft", version: 1, ai_draft: true, researched_at: profile.researched_at, confirmed_at: null, updated_at: "2026-10-01T00:00:00Z", sections: profile.sections } : null })),
    } as never,
    write: {} as never,
    meter: vi.fn<McpBackend["meter"]>(async (): Promise<UsageResult> => ({ ok: true })),
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, backend, toolsFor("chatgpt"))) as Out;
    const text = r.result.content[0]!.text;
    return { isError: r.result.isError === true, text, data: r.result.isError ? null : JSON.parse(text).data };
  };
  return { call, backend };
}

describe("review_group", () => {
  it("reviews the siblings of an initiative with evidence, the documents to read and the group's notes — for a read-only role", async () => {
    const s = setup([note({ id: "g", scope: "group", group: "Roadmap views", kind: "lesson", title: "Timeline lesson", body: "Quarter columns confused users." })]);
    const r = await s.call("review_group", { item: "R-1" });
    expect(r.data.group).toBe("Roadmap views");
    expect(r.data.siblings.map((x: { code: string }) => x.code)).toEqual(["R-2", "R-3"]);
    expect(r.data.findings.some((f: { kind: string; with: string[] }) => f.kind === "possible_overlap" && f.with[0] === "R-2")).toBe(true);
    expect(r.data.read_first).toContain("R-2");
    expect(r.data.documents).toEqual([{ code: "R-2", documents: [expect.objectContaining({ id: "d1", title: "PRD: Gantt" })] }]);
    expect(r.data.notes.map((n: { title: string }) => n.title)).toContain("Timeline lesson");
    expect(JSON.parse(r.text).envelope).toBe("pv-data");
  });
  it("works from a group and a brief, and asks for one of them", async () => {
    const s = setup();
    expect((await s.call("review_group", { group: "Roadmap views", brief: "A timeline by quarter" })).data.subject).toBeNull();
    expect((await s.call("review_group", {})).isError).toBe(true);
    expect((await s.call("review_group", { item: "R-99" })).isError).toBe(true);
  });
});

describe("check_research", () => {
  it("splits the terms into known, stale and missing, from notes and the profile", async () => {
    const s = setup(
      [note({}), note({ id: "n2", title: "Globex", verified_at: "2025-01-01T00:00:00Z" })],
      { sections: { glossary: "Churn: accounts that left." }, researched_at: new Date().toISOString() },
    );
    const r = await s.call("check_research", { terms: ["Acme Pay", "Globex", "churn", "Initech"] });
    expect(r.data).toMatchObject({ checked: 4, known: ["Acme Pay", "churn"], stale: ["Globex"], missing: ["Initech"] });
    expect(r.data.next).toMatch(/Globex, Initech/);
  });
  it("needs terms and says when everything is known", async () => {
    const s = setup([note({})]);
    expect((await s.call("check_research", { terms: [] })).isError).toBe(true);
    expect((await s.call("check_research", { terms: ["Acme Pay"] })).data.next).toMatch(/already known/);
  });
});

describe("get_playbook", () => {
  it("returns the same text as the MCP prompt, with the person's words quoted as data", async () => {
    const s = setup();
    const p = await s.call("get_playbook", { name: "write_prd", brief: "An account switcher" });
    expect(p.data.instructions).toContain('"""\nAn account switcher\n"""');
    const viaPrompt = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "write_prd", arguments: { brief: "An account switcher" } } }, s.backend)) as { result: { messages: { content: { text: string } }[] } };
    expect(p.data.instructions).toBe(viaPrompt.result.messages[0]!.content.text);
  });
  it("has the review, memory and research playbooks, and refuses an unknown one", async () => {
    const s = setup();
    expect((await s.call("get_playbook", { name: "review_group", item: "R-1" })).data.instructions).toMatch(/review_group/);
    expect((await s.call("get_playbook", { name: "setup_memory" })).data.instructions).toMatch(/remember/);
    expect((await s.call("get_playbook", { name: "research_company" })).data.instructions).toMatch(/profile/i);
    expect((await s.call("get_playbook", { name: "nope" })).isError).toBe(true);
  });
});
