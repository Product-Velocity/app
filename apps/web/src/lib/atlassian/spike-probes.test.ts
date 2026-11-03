import { describe, expect, it } from "vitest";
import { probeDevInfo, probeIdeaWrite, probePaging, probeWebhook, type ProbeCall } from "./spike-probes";
import { getJson } from "./read-client";
import { readOpenWork } from "./read-issues";
import type { JiraRequest } from "./jira-write";

const noSleep = async () => {};

/** A fake Jira search with `total` issues: token paging, `size` per page, optional 429 on given call numbers. */
function fakeSearch(total: number, opts: { size?: number; limitOn?: number[]; lastFlag?: boolean } = {}) {
  const size = opts.size ?? 100;
  let calls = 0;
  const log: string[] = [];
  const call: JiraRequest & ProbeCall = async (_m, path) => {
    const n = ++calls;
    log.push(path);
    if (opts.limitOn?.includes(n)) return { status: 429, json: {}, retryAfterSec: 2, headers: { "retry-after": "2" } };
    const q = new URL(path, "https://x").searchParams;
    const from = q.get("nextPageToken") ? Number(q.get("nextPageToken")) : 0;
    const to = Math.min(from + size, total);
    const issues = Array.from({ length: to - from }, (_, i) => ({ id: String(10000 + from + i), key: `PLAT-${from + i + 1}`, fields: { summary: `s${from + i}`, issuetype: { name: "Story", hierarchyLevel: 0 }, status: { name: "To Do", statusCategory: { key: "new" } }, updated: "2026-11-01T10:00:00.000Z" } }));
    return { status: 200, json: to >= total ? { issues, isLast: true } : { issues, nextPageToken: String(to), isLast: false } };
  };
  return { call, log, calls: () => calls };
}

describe("J6: paging over more than 100 issues against a fake Jira", () => {
  it("reads 950 issues in 10 pages and is not cut", async () => {
    const j = fakeSearch(950);
    const r = await readOpenWork((p) => getJson(j.call, p, noSleep), "PLAT", "https://acme.atlassian.net");
    expect(r).toMatchObject({ truncated: false, pages: 10 });
    expect(r.rows).toHaveLength(950);
  });
  it("2,500 issues are cut at the page limit and say so (1,000 rows), instead of looping or timing out", async () => {
    const j = fakeSearch(2500);
    const r = await readOpenWork((p) => getJson(j.call, p, noSleep), "PLAT", "https://acme.atlassian.net");
    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(1000);
  });
  it("a site that returns fewer than 100 per page still pages to the end", async () => {
    const j = fakeSearch(230, { size: 50 });
    const r = await readOpenWork((p) => getJson(j.call, p, noSleep), "PLAT", "https://acme.atlassian.net");
    expect(r.rows).toHaveLength(230);
    expect(r.pages).toBe(5);
  });
  it("a 429 in the middle is waited out with Retry-After and the same page is asked again", async () => {
    const j = fakeSearch(300, { limitOn: [2] });
    const waits: number[] = [];
    const r = await readOpenWork((p) => getJson(j.call, p, async (ms) => { waits.push(ms); }), "PLAT", "https://acme.atlassian.net");
    expect(r.rows).toHaveLength(300);
    expect(waits).toEqual([2000]);
    expect(j.log[1]).toBe(j.log[2]); // the retried page is the same request, not a skipped one
  });
  it("gives up after repeated 429s with a readable error, and never retries a 400/401", async () => {
    const j = fakeSearch(300, { limitOn: [1, 2, 3, 4, 5, 6] });
    await expect(getJson(j.call, "/search/jql?x", noSleep)).rejects.toThrow("Jira answered 429");
    const bad: JiraRequest = async () => ({ status: 400, json: {} });
    await expect(getJson(bad, "/x", noSleep)).rejects.toThrow("Jira answered 400");
  });
  it("the paging probe reports pages, sizes, 429s and rate headers", async () => {
    const j = fakeSearch(250, { limitOn: [2] });
    let t = 0;
    const [s] = await probePaging(j.call, "created >= -3650d", { sleep: noSleep, now: () => (t += 1000) });
    expect(s!.status).toBe(200);
    expect(s!.note).toContain("3 pages, 250 issues (0 duplicates");
    expect(s!.note).toContain("429 answers: 1");
    expect(s!.note).toContain("page sizes returned: 100, 100, 50");
  });
});

describe("J8: idea write probe", () => {
  const make = (type: string, failCreate = false) => {
    const calls: string[] = [];
    const call: ProbeCall = async (m, path) => {
      calls.push(`${m} ${path}`);
      if (path.startsWith("/project/")) return { status: 200, json: { projectTypeKey: type, issueTypes: [{ id: "9", name: "Idea", hierarchyLevel: 0 }] } };
      if (m === "POST") return failCreate ? { status: 400, json: { errors: { issuetype: "no" } } } : { status: 201, json: { key: "DISC-7" } };
      if (m === "PUT") return { status: 204, json: null };
      if (m === "DELETE") return { status: 204, json: null };
      return { status: 200, json: { transitions: [{ name: "Discovery" }] } };
    };
    return { call, calls };
  };
  it("creates, edits and deletes one idea", async () => {
    const f = make("product_discovery");
    const steps = await probeIdeaWrite(f.call, "DISC");
    expect(steps.map((s) => s.status)).toEqual([201, 204, 200, 204]);
    expect(f.calls.at(-1)).toBe("DELETE /issue/DISC-7");
  });
  it("refuses to write anywhere but a Product Discovery project", async () => {
    const f = make("software");
    const steps = await probeIdeaWrite(f.call, "PLAT");
    expect(steps).toHaveLength(1);
    expect(f.calls.some((c) => c.startsWith("POST"))).toBe(false);
  });
  it("a refused create is reported and nothing is deleted", async () => {
    const f = make("product_discovery", true);
    const steps = await probeIdeaWrite(f.call, "DISC");
    expect(steps[0]!.status).toBe(400);
    expect(f.calls.some((c) => c.startsWith("DELETE"))).toBe(false);
  });
});

describe("J3: webhook probe", () => {
  it("registers, lists, refreshes, checks failures and always deletes", async () => {
    const calls: string[] = [];
    const call: ProbeCall = async (m, path) => {
      calls.push(`${m} ${path}`);
      if (m === "POST") return { status: 200, json: { webhookRegistrationResult: [{ createdWebhookId: 42 }] } };
      if (m === "GET" && path === "/webhook") return { status: 200, json: { values: [{ id: 42, expirationDate: "2026-12-03" }] } };
      if (m === "PUT") return { status: 200, json: { expirationDate: "2027-01-02" } };
      if (m === "GET") return { status: 200, json: { values: [] } };
      return { status: 202, json: null };
    };
    const steps = await probeWebhook(call, "PLAT", "https://pv.example/api/spikes/jira-webhook");
    expect(steps.map((s) => s.status)).toEqual([200, 200, 200, 200, 202]);
    expect(calls.at(-1)).toBe("DELETE /webhook");
  });
  it("needs an https callback", async () => {
    const calls: string[] = [];
    const steps = await probeWebhook(async (m, p) => { calls.push(m + p); return { status: 200, json: {} }; }, "PLAT", "http://insecure");
    expect(steps[0]!.status).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("J5: development information probe", () => {
  it("reports only the shape of the Development field", async () => {
    const call: ProbeCall = async (_m, path) => path === "/field"
      ? { status: 200, json: [{ id: "customfield_10000", name: "Development", schema: { custom: "com.atlassian.jira.plugins.jira-development-integration-plugin:devsummarycf" } }] }
      : { status: 200, json: { fields: { customfield_10000: "{pullrequest={overall={count=0}}}" } } };
    const steps = await probeDevInfo(call, "PLAT-1");
    expect(steps[1]!.note).toContain("string of");
    expect(steps[1]!.note).not.toContain("pullrequest");
  });
  it("rejects a non-key", async () => {
    expect((await probeDevInfo(async () => ({ status: 200, json: {} }), "x"))[0]!.status).toBe(0);
  });
});
