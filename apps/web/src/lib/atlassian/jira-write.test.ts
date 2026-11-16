import { describe, expect, it, vi } from "vitest";
import { createIssue, updateIssue, withBackoff, type JiraRequest } from "./jira-write";
import { ReconnectNeeded } from "./token-provider";

const noSleep = vi.fn(async () => {});
const seq = (...answers: { status: number; json?: unknown; retryAfterSec?: number }[]): JiraRequest & { calls: number } => {
  let i = 0;
  const f = (async () => { f.calls++; return { json: {}, ...answers[Math.min(i++, answers.length - 1)]! }; }) as unknown as JiraRequest & { calls: number };
  f.calls = 0;
  return f;
};

describe("Jira write client", () => {
  it("creates an issue and returns its key", async () => {
    const call = seq({ status: 201, json: { key: "PLAT-9", id: "10009" } });
    expect(await createIssue(call, { summary: "x" }, noSleep)).toEqual({ ok: true, key: "PLAT-9", id: "10009", created: true });
  });
  it("retries a 429 with back-off (honouring Retry-After) and then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const call = seq({ status: 429, retryAfterSec: 5 }, { status: 429 }, { status: 204 });
    expect(await updateIssue(call, "PLAT-1", { summary: "x" }, sleep)).toMatchObject({ ok: true, created: false });
    expect(call.calls).toBe(3);
    expect(sleep.mock.calls.map((c) => (c as unknown as number[])[0])).toEqual([5000, 2000]);
  });
  it("gives up after four tries on a steady 429 and says so", async () => {
    const call = seq({ status: 429 });
    const r = await updateIssue(call, "PLAT-1", {}, noSleep);
    expect(call.calls).toBe(4);
    expect(r).toMatchObject({ ok: false, kind: "rate_limited" });
  });
  it("does not retry a refusal and shows Jira's reason as text", async () => {
    const call = seq({ status: 400, json: { errors: { duedate: "bad date" } } });
    const r = await updateIssue(call, "PLAT-1", {}, noSleep);
    expect(call.calls).toBe(1);
    expect(r).toEqual({ ok: false, kind: "rejected", message: "Jira refused it: duedate: bad date" });
  });
  it("a missing issue is 'gone' and is never recreated", async () => {
    const call = seq({ status: 404 });
    expect(await updateIssue(call, "PLAT-1", {}, noSleep)).toMatchObject({ ok: false, kind: "gone" });
    expect(call.calls).toBe(1);
  });
  it("ReconnectNeeded and a 401 both mean sign in again, with no retry loop", async () => {
    let n = 0;
    const throwing: JiraRequest = async () => { n++; throw new ReconnectNeeded(); };
    expect(await createIssue(throwing, {}, noSleep)).toMatchObject({ ok: false, kind: "reconnect" });
    expect(n).toBe(1);
    expect(await updateIssue(seq({ status: 401 }), "PLAT-1", {}, noSleep)).toMatchObject({ kind: "reconnect" });
  });
  it("refuses a key that is not a Jira key before any request (no path injection)", async () => {
    const call = seq({ status: 204 });
    expect(await updateIssue(call, "../../x", {}, noSleep)).toMatchObject({ ok: false, kind: "rejected" });
    expect(call.calls).toBe(0);
  });
  it("withBackoff returns non-retryable answers at once", async () => {
    const call = seq({ status: 200 });
    expect((await withBackoff(() => call("GET", "/x"), noSleep)).status).toBe(200);
  });
  it("a Priority that is not on the issue type's screen is left out and the rest is sent, with a note (issue #469)", async () => {
    const bodies: unknown[] = [];
    const call = (async (_m: string, _p: string, body?: unknown) => { bodies.push(body); return bodies.length === 1 ? { status: 400, json: { errors: { priority: "Field 'priority' cannot be set. It is not on the appropriate screen, or unknown." } } } : { status: 201, json: { key: "PLAT-9", id: "1" } }; }) as unknown as JiraRequest;
    const r = await createIssue(call, { summary: "x", priority: { id: "2" }, labels: ["pm:moscow/must"] }, noSleep);
    expect(r).toMatchObject({ ok: true, key: "PLAT-9", created: true });
    expect((r as { dropped?: string[] }).dropped?.[0]).toMatch(/^Not sent: Priority \(Field 'priority' cannot be set/);
    expect(bodies[1]).toEqual({ fields: { summary: "x", labels: ["pm:moscow/must"] } });
  });
  it("the same for an update, and a refusal of anything else (the summary) still fails", async () => {
    const put = seq({ status: 400, json: { errors: { customfield_10015: "not on screen" } } }, { status: 204 });
    expect(await updateIssue(put, "PLAT-1", { summary: "x", customfield_10015: "2026-12-01" }, noSleep)).toMatchObject({ ok: true, dropped: [expect.stringContaining("customfield_10015")] });
    const bad = seq({ status: 400, json: { errors: { summary: "too long" } } });
    expect(await updateIssue(bad, "PLAT-1", { summary: "x" }, noSleep)).toMatchObject({ ok: false, kind: "rejected" });
    expect(bad.calls).toBe(1);
  });
});
