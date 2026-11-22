import { describe, expect, it, vi } from "vitest";
import type { UsageResult } from "@pv/domain";
import { buildContext } from "./read-model";
import { handleRpc, TOOLS, type McpBackend } from "./rpc";

type Out = { result: { isError?: boolean; content: { text: string }[] } };
function setup(role = "viewer") {
  const report = vi.fn(async (kind: string, weekOf?: string) => ({ report: kind, week: weekOf ?? "this", markdown: "- R-01 moved to Build" }));
  const backend: McpBackend = {
    role,
    workspaceContext: vi.fn(async () => buildContext({ tenant: { id: "t", name: "M" }, userId: "u1", role, projects: [], groups: [], teams: [], members: [], githubConnected: false, repoPrivate: new Map() })),
    read: { report } as never, write: {} as never,
    meter: vi.fn<McpBackend["meter"]>(async (): Promise<UsageResult> => ({ ok: true })),
  };
  const call = async (args: Record<string, unknown>) => {
    const r = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_report", arguments: args } }, backend, TOOLS)) as Out;
    const text = r.result.content[0]!.text;
    return { isError: r.result.isError === true, text, data: r.result.isError ? null : JSON.parse(text).data };
  };
  return { call, report };
}

describe("get_report", () => {
  it("is a read tool every role may use, returns the report inside the data envelope and passes the week through", async () => {
    const s = setup("viewer");
    const r = await s.call({ report: "weekly_digest", week_of: "2026-11-18" });
    expect(r.isError, r.text).toBe(false);
    expect(JSON.parse(r.text).envelope).toBe("pv-data");
    expect(s.report).toHaveBeenCalledWith("weekly_digest", "2026-11-18", undefined);
    expect((await s.call({ report: "health" })).data).toMatchObject({ report: "health" });
    expect(TOOLS.find((t) => t.name === "get_report")).toMatchObject({ mode: "read", annotations: { readOnlyHint: true } });
  });
  it("refuses an unknown report and a badly written date", async () => {
    const s = setup();
    expect((await s.call({ report: "velocity" })).text).toMatch(/report must be one of: weekly_digest, health/);
    expect((await s.call({ report: "weekly_digest", week_of: "last week" })).text).toMatch(/yyyy-mm-dd/);
    expect(s.report).not.toHaveBeenCalled();
  });
});

describe("get_report scope", () => {
  it("passes the named initiatives through and refuses anything that is not a code", async () => {
    const s = setup();
    await s.call({ report: "weekly_digest", items: ["R-1", "r-02"] });
    expect(s.report).toHaveBeenCalledWith("weekly_digest", undefined, ["R-1", "r-02"]);
    expect((await s.call({ report: "health", items: ["R-1; drop table"] })).text).toMatch(/list of up to 60 initiative codes/);
    expect((await s.call({ report: "health", items: "R-1" })).text).toMatch(/list of up to 60 initiative codes/);
    expect((await s.call({ report: "health", items: Array.from({ length: 61 }, (_, i) => `R-${i + 1}`) })).text).toMatch(/up to 60/);
  });
  it("leaves the scope out when none is named", async () => {
    const s = setup();
    await s.call({ report: "health" });
    expect(s.report).toHaveBeenCalledWith("health", undefined, undefined);
  });
});
