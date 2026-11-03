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
});
