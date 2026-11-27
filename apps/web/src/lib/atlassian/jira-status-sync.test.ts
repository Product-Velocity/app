import { describe, expect, it, vi } from "vitest";
import { decideStatusSync, planStatusSync, transitionsOf, writeStatusSync } from "./jira-status-sync";
import { parseStatusMap, statusesOfType, suggestStatuses } from "./jira-status-map";
import type { JiraRequest } from "./jira-write";

const noSleep = vi.fn(async () => {});
const types = [{ id: "10001", statuses: [{ id: "1", name: "Backlog", statusCategory: { key: "new" } }, { id: "2", name: "WIP Research", statusCategory: { key: "indeterminate" } }, { id: "3", name: "Done", statusCategory: { key: "done" } }] }, { id: "10002", statuses: [{ id: "9", name: "Other", statusCategory: { key: "new" } }] }];
const tr = (id: string, toId: string, toName: string) => ({ id, name: `to ${toName}`, to: { id: toId, name: toName } });

function jira(current: { id: string; name: string }, transitions: unknown[], post = 204) {
  const hits: { m: string; p: string; body?: unknown }[] = [];
  const call: JiraRequest = async (m, p, body) => {
    hits.push({ m, p, body });
    if (m === "GET" && p.startsWith("/issue/PLAT-1?fields=status")) return { status: 200, json: { fields: { status: current } } };
    if (m === "GET" && p === "/issue/PLAT-1/transitions") return { status: 200, json: { transitions } };
    if (m === "POST" && p === "/issue/PLAT-1/transitions") return { status: post, json: post === 400 ? { errorMessages: ["Resolution is required."] } : {} };
    return { status: 404, json: {} };
  };
  return { call, hits };
}

describe("the mapping", () => {
  it("keeps only Initiative Status values with numeric Jira status ids", () => {
    expect(parseStatusMap({ Active: "2", "Not started": "5", Completed: "x", Cancelled: 3, Backlog: "1" })).toEqual({ Active: "2", Backlog: "1" });
    expect(parseStatusMap(null)).toEqual({});
  });
  it("reads the statuses of the initiative issue type only, with their category", () => {
    expect(statusesOfType(types, "10001")).toEqual([{ id: "1", name: "Backlog", category: "new" }, { id: "2", name: "WIP Research", category: "indeterminate" }, { id: "3", name: "Done", category: "done" }]);
    expect(statusesOfType(types, "99")).toEqual([]);
    expect(statusesOfType("x", "10001")).toEqual([]);
  });
  it("suggests a same-name status (Completed also Done), keeps what is saved and never offers a status twice", () => {
    const opts = statusesOfType(types, "10001");
    expect(suggestStatuses(opts)).toEqual({ Backlog: "1", Completed: "3" });
    expect(suggestStatuses(opts, { Active: "2" })).toEqual({ Active: "2", Backlog: "1", Completed: "3" });
    expect(suggestStatuses(opts, { Completed: "1" })).toEqual({ Completed: "1" }); // status 1 (Backlog) is taken, so Backlog gets none
  });
});

describe("decideStatusSync", () => {
  const target = { id: "2", name: "WIP Research" };
  it("is already done when Jira has the mapped status", () => {
    expect(decideStatusSync(target, { id: "2", name: "WIP Research" }, []).state).toBe("already");
  });
  it("moves with the transition that leads to exactly the mapped status", () => {
    const p = decideStatusSync(target, { id: "1", name: "Backlog" }, transitionsOf({ transitions: [tr("11", "3", "Done"), tr("21", "2", "WIP Research")] }));
    expect(p).toMatchObject({ state: "set", transition: { id: "21" }, from: "Backlog", to: "WIP Research" });
  });
  it("writes nothing and says so when the workflow has no such transition", () => {
    const p = decideStatusSync(target, { id: "3", name: "Done" }, transitionsOf({ transitions: [tr("11", "1", "Backlog")] }));
    expect(p).toMatchObject({ state: "blocked", text: expect.stringMatching(/allows no move from Done to WIP Research: nothing was written/) });
  });
});

describe("planStatusSync and writeStatusSync", () => {
  const target = { id: "2", name: "WIP Research" };
  it("the preview reads only (status and transitions), never writes", async () => {
    const j = jira({ id: "1", name: "Backlog" }, [tr("21", "2", "WIP Research")]);
    expect(await planStatusSync(j.call, "PLAT-1", target, noSleep)).toMatchObject({ ok: true, plan: { state: "set" } });
    expect(j.hits.every((h) => h.m === "GET")).toBe(true);
  });
  it("the confirmed write reads again and posts exactly the transition that leads to the mapped status", async () => {
    const j = jira({ id: "1", name: "Backlog" }, [tr("11", "3", "Done"), tr("21", "2", "WIP Research")]);
    expect(await writeStatusSync(j.call, "PLAT-1", target, noSleep)).toEqual({ ok: true, result: "set", status: "WIP Research" });
    const post = j.hits.filter((h) => h.m === "POST");
    expect(post).toEqual([{ m: "POST", p: "/issue/PLAT-1/transitions", body: { transition: { id: "21" } } }]);
  });
  it("writes nothing when the status already is the mapped one (also after it moved since the preview)", async () => {
    const j = jira({ id: "2", name: "WIP Research" }, []);
    expect(await writeStatusSync(j.call, "PLAT-1", target, noSleep)).toEqual({ ok: true, result: "already", status: "WIP Research" });
    expect(j.hits.some((h) => h.m === "POST")).toBe(false);
  });
  it("a blocked workflow is a per-initiative note and nothing is posted; Jira's refusal is shown as Jira said it", async () => {
    const blocked = jira({ id: "3", name: "Done" }, []);
    expect(await writeStatusSync(blocked.call, "PLAT-1", target, noSleep)).toMatchObject({ ok: false, message: expect.stringMatching(/allows no move/) });
    expect(blocked.hits.some((h) => h.m === "POST")).toBe(false);
    const refused = jira({ id: "1", name: "Backlog" }, [tr("21", "2", "WIP Research")], 400);
    expect(await writeStatusSync(refused.call, "PLAT-1", target, noSleep)).toEqual({ ok: false, message: "Jira refused it: Resolution is required." });
  });
  it("refuses a key or a status id that is not valid before any request", async () => {
    const j = jira({ id: "1", name: "x" }, []);
    expect((await planStatusSync(j.call, "plat-1", target, noSleep)).ok).toBe(false);
    expect((await planStatusSync(j.call, "PLAT-1", { id: "2; drop", name: "x" }, noSleep)).ok).toBe(false);
    expect(j.hits).toEqual([]);
  });
});
