import { describe, expect, it } from "vitest";
import type { PlanItem, PushItemResult, ReceiveItem, SyncChoice, SyncConfirmResult, SyncPreviewResult } from "@/lib/github/push-types";
import { routeSync, type SyncApi, type TrackerId } from "./sync-router";

const card = (id: string): ReceiveItem => ({ id, code: id.toUpperCase(), name: id, status: "in_step", received: [], issueNumber: 1, issueUrl: null });
const plan = (id: string): PlanItem => ({ id, action: "unchanged" }) as PlanItem;
const pick = (itemId: string): SyncChoice => ({ itemId, field: "title", choice: "pv", ghHash: "0".repeat(64) });

/** An engine that records what it was called with. */
function engine(account: string, o: { fail?: string; stale?: boolean } = {}) {
  const calls: { op: string; ids: string[]; choices?: SyncChoice[] }[] = [];
  const api: SyncApi = {
    async start(ids) { calls.push({ op: "start", ids }); return o.fail ? { ok: false, error: o.fail } : { ok: true, account, received: ids.map(card), send: ids.map(plan) } satisfies SyncPreviewResult; },
    async board(ids) { calls.push({ op: "board", ids }); return { ok: true, lines: Object.fromEntries(ids.map((i) => [i, { label: "Delivery Status", from: null, to: account }])), failed: account === "jira" }; },
    async confirm(ids, choices) {
      calls.push({ op: "confirm", ids, choices });
      if (o.stale) return { ok: false, error: "changed", stale: { account, received: [], send: [] } } satisfies SyncConfirmResult;
      const results: PushItemResult[] = ids.map((id) => ({ id, code: id.toUpperCase(), outcome: "updated" }));
      return { ok: true, results, taken: [] };
    },
  };
  return { api, calls };
}
const of = (m: Record<string, TrackerId | null>) => async (ids: string[]) => new Map(ids.map((i) => [i, m[i] ?? null]));

describe("routing a sync to the engine of each initiative's tracker", () => {
  it("one tracker: that engine is called once, with the same ids and options, and its answer comes back as it is", async () => {
    const gh = engine("acme");
    const api = routeSync({ github: gh.api }, of({ a: "github", b: "github" }));
    const r = await api.start(["a", "b"], { board: false });
    expect(gh.calls).toEqual([{ op: "start", ids: ["a", "b"] }]);
    expect(r).toMatchObject({ ok: true, account: "acme" });
  });

  it("a project without a tracker yet behaves as GitHub, as before", async () => {
    const gh = engine("acme");
    await routeSync({ github: gh.api }, of({ a: null })).start(["a"]);
    expect(gh.calls[0]!.ids).toEqual(["a"]);
  });

  it("a mixed selection: each engine gets only its own initiatives; the cards come back in the order of the selection", async () => {
    const gh = engine("acme"), jira = engine("jira");
    const api = routeSync({ github: gh.api, jira: jira.api }, of({ a: "github", b: "jira", c: "github" }));
    const r = await api.start(["a", "b", "c"]);
    expect(gh.calls[0]!.ids).toEqual(["a", "c"]);
    expect(jira.calls[0]!.ids).toEqual(["b"]);
    expect(r.ok && r.received.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(r.ok && r.send.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(r.ok && r.account).toBe("acme, jira");
  });

  it("a choice only reaches the engine that owns its initiative", async () => {
    const gh = engine("acme"), jira = engine("jira");
    const api = routeSync({ github: gh.api, jira: jira.api }, of({ a: "github", b: "jira" }));
    await api.confirm(["a", "b"], [pick("a"), pick("b")]);
    expect(gh.calls[0]!.choices!.map((c) => c.itemId)).toEqual(["a"]);
    expect(jira.calls[0]!.choices!.map((c) => c.itemId)).toEqual(["b"]);
  });

  it("confirm results of both engines are put together", async () => {
    const api = routeSync({ github: engine("acme").api, jira: engine("jira").api }, of({ a: "github", b: "jira" }));
    const r = await api.confirm(["a", "b"], []);
    expect(r.ok && r.results.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("a tracker without an engine is said plainly, and no engine is called at all (nothing is written for the others)", async () => {
    const gh = engine("acme");
    const api = routeSync({ github: gh.api }, of({ a: "github", b: "jira" }));
    for (const r of [await api.start(["a", "b"]), await api.board(["a", "b"]), await api.confirm(["a", "b"], [])]) expect(r).toEqual({ ok: false, error: "Syncing with Jira is not available yet." });
    expect(gh.calls).toEqual([]);
  });

  it("an engine's error is returned as it is, and the changed-since-preview answer keeps its new difference", async () => {
    expect(await routeSync({ github: engine("acme", { fail: "GitHub is not connected." }).api }, of({ a: "github" })).start(["a"])).toEqual({ ok: false, error: "GitHub is not connected." });
    const r = await routeSync({ github: engine("acme", { stale: true }).api }, of({ a: "github" })).confirm(["a"], []);
    expect(r).toMatchObject({ ok: false, error: "changed", stale: { account: "acme" } });
  });

  it("board lines of both engines are merged and a failure on either is kept", async () => {
    const api = routeSync({ github: engine("acme").api, jira: engine("jira").api }, of({ a: "github", b: "jira" }));
    const r = await api.board(["a", "b"]);
    expect(r.ok && Object.keys(r.lines)).toEqual(["a", "b"]);
    expect(r.ok && r.failed).toBe(true);
  });
});
