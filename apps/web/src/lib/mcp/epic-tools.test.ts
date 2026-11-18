import { describe, expect, it, vi } from "vitest";
import type { SearchRow, UsageResult } from "@pv/domain";
import { buildContext, type ItemDetail } from "./read-model";
import { handleRpc, TOOLS, type McpBackend } from "./rpc";
import { ToolInputError } from "./tool-error";
import type { McpEpics } from "./write-model";

type Out = { result: { isError?: boolean; content: { text: string }[] } };
function setup(opts: { refuse?: string } = {}) {
  const asked: { item: string; keys: string[] }[] = [];
  const epics: McpEpics = {
    request: vi.fn(async (item, keys) => {
      if (opts.refuse) throw new ToolInputError(opts.refuse);
      asked.push({ item, keys });
      const added = keys.filter((k: string) => k !== "R8P-1");
      return { added, current: keys.map((k: string) => ({ key: k, state: "pending", last_error: null })) };
    }),
  };
  const detail = (ref: string): ItemDetail | null =>
    ref.toUpperCase() === "R-01" ? ({ row: { id: "i1", item_code: "R-01" } as SearchRow, links: [], tags: {}, relations: { depends_on: [], depended_on_by: [], related_to: [] }, teams: [], files: [], github: null, activity: [] } as unknown as ItemDetail) : null;
  const backend: McpBackend = {
    role: "creator",
    workspaceContext: vi.fn(async () => buildContext({ tenant: { id: "t", name: "M" }, userId: "u1", role: "creator", projects: [], groups: [], teams: [], members: [], githubConnected: false, repoPrivate: new Map() })),
    read: { itemDetail: vi.fn(async (r: string) => detail(r)) } as never,
    write: { epics } as never,
    meter: vi.fn<McpBackend["meter"]>(async (): Promise<UsageResult> => ({ ok: true })),
  };
  const call = async (args: Record<string, unknown>) => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "request_jira_epics", arguments: args } }, backend, TOOLS)) as Out;
    const text = r.result.content[0]!.text;
    return { isError: r.result.isError === true, text, data: r.result.isError ? null : JSON.parse(text).data };
  };
  return { call, asked, epics };
}

describe("request_jira_epics", () => {
  it("records epic keys (upper-cased, links accepted, no repeats) and says nothing was sent to Jira", async () => {
    const s = setup();
    const r = await s.call({ item: "r-01", epics: ["r8p-2", "https://x.atlassian.net/browse/DATA-9", "R8P-2", "R8P-1"] });
    expect(s.asked).toEqual([{ item: "i1", keys: ["R8P-2", "DATA-9", "R8P-1"] }]);
    expect(r.data).toMatchObject({ status: "recorded", item: "R-01", added: ["R8P-2", "DATA-9"], already_listed: ["R8P-1"] });
    expect(JSON.stringify(r.data.notes)).toMatch(/Nothing was sent to Jira/);
  });

  it("refuses something that is not a key, and an unknown initiative, before anything is recorded", async () => {
    const s = setup();
    expect((await s.call({ item: "R-01", epics: ["not a key!"] })).isError).toBe(true);
    const unknown = await s.call({ item: "R-99", epics: ["R8P-2"] });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/No initiative/);
    expect(s.epics.request).not.toHaveBeenCalled();
  });

  it("shows the database's reason (read-only initiative, key taken) as the message", async () => {
    const s = setup({ refuse: "This initiative follows its Jira issue read-only: take ownership first." });
    const r = await s.call({ item: "R-01", epics: ["R8P-2"] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/follows its Jira issue read-only/);
  });

  it("is listed as a tool that changes data", () => {
    const t = TOOLS.find((x) => x.name === "request_jira_epics")!;
    expect(t.mode).toBe("write");
    expect((t.annotations as { readOnlyHint: boolean }).readOnlyHint).toBe(false);
  });
});
