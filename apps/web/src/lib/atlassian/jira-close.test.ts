import { describe, expect, it } from "vitest";
import { ReconnectNeeded } from "./token-provider";
import { addRemovedLabel, chooseTransition, closeWith, doneTransitionsOf, readCloseState, type DoneTransition } from "./jira-close";
import { mergeLabels, REMOVED_LABEL } from "./outbound";
import type { JiraRequest } from "./jira-write";

// Closing the Jira issue of a removed initiative (decision 2026-11-03-jira-close-removed), against a fake Jira.
const noSleep = async () => {};
const T = (id: string, name: string, toId: string, toName: string, cat: string) => ({ id, name, to: { id: toId, name: toName, statusCategory: { key: cat } } });
const WORKFLOW = [T("11", "Start", "3", "In Progress", "indeterminate"), T("31", "Done", "10001", "Done", "done"), T("41", "Won't do", "10002", "Won't do", "done")];

type Hit = { method: string; path: string; body?: unknown };
function fake(o: { status?: { name: string; cat: string }; transitions?: unknown[]; labels?: string[]; put?: number; post?: number; postJson?: unknown; get?: number } = {}) {
  const hits: Hit[] = [];
  const call: JiraRequest = async (method, path, body) => {
    hits.push({ method, path, body });
    if (method === "GET" && path.endsWith("/transitions")) return { status: 200, json: { transitions: o.transitions ?? WORKFLOW } };
    if (method === "GET") return o.get ? { status: o.get, json: {} } : { status: 200, json: { fields: { status: { name: o.status?.name ?? "To Do", statusCategory: { key: o.status?.cat ?? "new" } }, labels: o.labels ?? ["team-a"] } } };
    if (method === "PUT") return { status: o.put ?? 204, json: {} };
    return { status: o.post ?? 204, json: o.postJson ?? {} };
  };
  return { call, hits };
}
const writes = (h: Hit[]) => h.filter((x) => x.method !== "GET");

describe("reading the state to decide (no write)", () => {
  it("keeps only the transitions whose target status is in the category done, whatever the status is called", () => {
    const r = doneTransitionsOf({ transitions: [...WORKFLOW, T("51", "Close", "9", "Closed", "done"), T("61", "Reopen", "1", "Done?", "new")] });
    expect(r.map((t) => t.id)).toEqual(["31", "41", "51"]);
    expect(r[0]).toEqual({ id: "31", name: "Done", toStatusId: "10001", toStatusName: "Done" });
  });
  it("ignores malformed transitions and cleans text from Jira", () => {
    const r = doneTransitionsOf({ transitions: [{ id: "abc", to: { id: "1", statusCategory: { key: "done" } } }, { id: "5", name: "x\u0000y", to: { id: "z", statusCategory: { key: "done" } } }, T("7", "Fine\n", "8", "Done", "done")] });
    expect(r).toEqual([{ id: "7", name: "Fine", toStatusId: "8", toStatusName: "Done" }]);
    expect(doneTransitionsOf(null)).toEqual([]);
  });
  it("reads the status, the labels and the Done transitions with GET only", async () => {
    const j = fake();
    const s = await readCloseState(j.call, "PLAT-12", noSleep);
    expect(s).toMatchObject({ ok: true, statusName: "To Do", statusCategory: "new", labels: ["team-a"] });
    expect(s.ok && s.done.map((t) => t.id)).toEqual(["31", "41"]);
    expect(writes(j.hits)).toEqual([]);
  });
  it("says gone for a 404, sign in again for a 401 or a lost token, and never loops", async () => {
    expect(await readCloseState(fake({ get: 404 }).call, "PLAT-12", noSleep)).toMatchObject({ ok: false, kind: "gone" });
    expect(await readCloseState(fake({ get: 401 }).call, "PLAT-12", noSleep)).toMatchObject({ ok: false, kind: "reconnect" });
    let n = 0;
    const lost: JiraRequest = async () => { n++; throw new ReconnectNeeded(); };
    expect(await readCloseState(lost, "PLAT-12", noSleep)).toMatchObject({ ok: false, kind: "reconnect" });
    expect(n).toBe(1);
    expect(await readCloseState(fake().call, "not a key", noSleep)).toMatchObject({ ok: false, kind: "gone" });
  });
});

describe("choosing the transition", () => {
  const one: DoneTransition[] = [{ id: "31", name: "Done", toStatusId: "10001", toStatusName: "Done" }];
  const two: DoneTransition[] = [...one, { id: "41", name: "Won't do", toStatusId: "10002", toStatusName: "Won't do" }];
  it("no Done transition: none (label only)", () => expect(chooseTransition([], null, null)).toEqual({ transition: null, needsChoice: false, chosenNotAllowed: false }));
  it("exactly one: it", () => expect(chooseTransition(one, null, null).transition?.id).toBe("31"));
  it("several: the person chooses; the project's remembered status preselects; otherwise it asks", () => {
    expect(chooseTransition(two, null, null)).toEqual({ transition: null, needsChoice: true, chosenNotAllowed: false });
    expect(chooseTransition(two, "41", null).transition?.id).toBe("41");
    expect(chooseTransition(two, null, "10002").transition?.id).toBe("41");
    expect(chooseTransition(two, null, "99999").needsChoice).toBe(true);
  });
  it("a chosen id that is not a Done transition of this issue is refused, even when it is the only one", () => {
    expect(chooseTransition(one, "11", null)).toEqual({ transition: null, needsChoice: false, chosenNotAllowed: true });
    expect(chooseTransition(two, "999", null).chosenNotAllowed).toBe(true);
  });
});

describe("the two writes", () => {
  it("adds the label with Jira's add operation: every other label is kept, nothing else is sent", async () => {
    const j = fake();
    expect(await addRemovedLabel(j.call, "PLAT-12", noSleep)).toEqual({ ok: true });
    expect(j.hits).toEqual([{ method: "PUT", path: "/issue/PLAT-12", body: { update: { labels: [{ add: "pv:removed" }] } } }]);
    expect(REMOVED_LABEL).toBe("pv:removed");
  });
  it("transitions with the id, only a Done one of this issue; the body is just the transition", async () => {
    const j = fake();
    const done = doneTransitionsOf({ transitions: WORKFLOW });
    expect(await closeWith(j.call, "PLAT-12", "41", done, noSleep)).toEqual({ ok: true });
    expect(j.hits).toEqual([{ method: "POST", path: "/issue/PLAT-12/transitions", body: { transition: { id: "41" } } }]);
    const k = fake();
    expect(await closeWith(k.call, "PLAT-12", "11", done, noSleep)).toMatchObject({ ok: false, kind: "rejected" }); // In Progress is not Done
    expect(k.hits).toEqual([]); // refused before anything was sent
  });
  it("a refusal (Jira says a field is required) is returned with Jira's words and sent once, never retried", async () => {
    const j = fake({ post: 400, postJson: { errorMessages: [], errors: { resolution: "Resolution is required" } } });
    const r = await closeWith(j.call, "PLAT-12", "31", doneTransitionsOf({ transitions: WORKFLOW }), noSleep);
    expect(r).toMatchObject({ ok: false, kind: "rejected" });
    expect(!r.ok && r.message).toContain("resolution: Resolution is required");
    expect(writes(j.hits)).toHaveLength(1);
  });
  it("a 429 is retried with back-off up to four times, then reported; a 503 too", async () => {
    let n = 0;
    const call: JiraRequest = async () => { n++; return { status: 429, json: {}, retryAfterSec: 0 }; };
    expect(await closeWith(call, "PLAT-12", "31", doneTransitionsOf({ transitions: WORKFLOW }), noSleep)).toMatchObject({ ok: false, kind: "rate_limited" });
    expect(n).toBe(4);
  });
  it("sign-in lost or refused: sign in again, one request, no loop", async () => {
    let n = 0;
    const lost: JiraRequest = async () => { n++; throw new ReconnectNeeded(); };
    expect(await addRemovedLabel(lost, "PLAT-12", noSleep)).toMatchObject({ ok: false, kind: "reconnect" });
    expect(await closeWith(fake({ post: 401 }).call, "PLAT-12", "31", doneTransitionsOf({ transitions: WORKFLOW }), noSleep)).toMatchObject({ ok: false, kind: "reconnect" });
    expect(n).toBe(1);
  });
  it("a 404 means the issue is gone: nothing is recreated", async () => {
    expect(await addRemovedLabel(fake({ put: 404 }).call, "PLAT-12", noSleep)).toMatchObject({ ok: false, kind: "gone" });
  });
  it("refuses a key that is not a Jira issue key before any request", async () => {
    const j = fake();
    expect(await addRemovedLabel(j.call, "../../x", noSleep)).toMatchObject({ ok: false });
    expect(await closeWith(j.call, "PLAT-1/../x", "31", doneTransitionsOf({ transitions: WORKFLOW }), noSleep)).toMatchObject({ ok: false });
    expect(j.hits).toEqual([]);
  });
});

describe("the label survives a later send", () => {
  it("mergeLabels keeps pv:removed while stale pv: labels are still removed", () => {
    expect(mergeLabels(["team-a", "pv:removed", "pv:moscow/could", "product-velocity"], ["product-velocity", "pv:moscow/must"])).toEqual(["team-a", "pv:removed", "product-velocity", "pv:moscow/must"]);
  });
});
