import { describe, expect, it } from "vitest";
import { probeDevInfo, probeIdeaWrite, probeInitiativeWrite, probePaging, probeWebhook, type ProbeCall } from "./atlassian-probes";
import { getJson } from "@/lib/atlassian/read-client";
import { readOpenWork } from "@/lib/atlassian/read-issues";
import type { JiraRequest } from "@/lib/atlassian/jira-write";

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
      if (path.includes("expand=transitions")) return { status: 200, json: { transitions: [{ name: "Discovery" }] } };
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

/** A fake Jira with an Initiative level: INIT-1 (project ROAD, company-managed) over epics in R8P and DATA, with stories under them. */
function fakeInitiativeSite(opts: { initiativeLevel?: boolean; hide?: string; lagSearches?: number } = {}) {
  let lag = opts.lagSearches ?? 0;
  const issues: Record<string, { type: string; level: number; project: string; parent?: string }> = {
    "INIT-1": { type: "Initiative", level: 2, project: "ROAD" },
    "R8P-5": { type: "Epic", level: 1, project: "R8P", parent: "INIT-1" },
    "DATA-9": { type: "Epic", level: 1, project: "DATA", parent: "INIT-1" },
    "R8P-6": { type: "Story", level: 0, project: "R8P", parent: "R8P-5" },
    "DATA-10": { type: "Task", level: 0, project: "DATA", parent: "DATA-9" },
  };
  const calls: string[] = [];
  let seq = 100;
  const shape = (k: string) => ({ id: k, key: k, fields: { issuetype: { name: issues[k]!.type, hierarchyLevel: issues[k]!.level }, project: { key: issues[k]!.project }, parent: issues[k]!.parent ? { key: issues[k]!.parent } : undefined } });
  const call: ProbeCall = async (method, path, body) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    const url = new URL(path, "https://x");
    if (path === "/issuetype") return { status: 200, json: [{ id: "1", name: "Sub-task", hierarchyLevel: -1 }, { id: "2", name: "Story", hierarchyLevel: 0 }, { id: "3", name: "Epic", hierarchyLevel: 1 }, ...(opts.initiativeLevel === false ? [] : [{ id: "4", name: "Initiative", hierarchyLevel: 2 }])] };
    if (url.pathname.startsWith("/project/")) {
      const key = url.pathname.split("/")[2]!;
      const types = key === "ROAD" ? [{ id: "4", name: "Initiative", hierarchyLevel: 2 }, { id: "3", name: "Epic", hierarchyLevel: 1 }] : [{ id: "3", name: "Epic", hierarchyLevel: 1 }, { id: "2", name: "Story", hierarchyLevel: 0 }];
      return { status: 200, json: { key, style: key === "R8P" ? "next-gen" : "classic", simplified: key === "R8P", projectTypeKey: "software", issueTypes: types } };
    }
    if (method === "POST" && url.pathname === "/issue") {
      const f = (body as { fields: { project: { key: string }; issuetype: { id: string } } }).fields;
      const k = `${f.project.key}-${++seq}`;
      issues[k] = { type: f.issuetype.id === "4" ? "Initiative" : "Epic", level: f.issuetype.id === "4" ? 2 : 1, project: f.project.key };
      return { status: 201, json: { key: k } };
    }
    if (method === "PUT" && url.pathname.startsWith("/issue/")) { issues[url.pathname.split("/")[2]!]!.parent = (body as { fields: { parent: { key: string } } }).fields.parent.key; return { status: 204, json: {} }; }
    if (method === "DELETE") { delete issues[url.pathname.split("/")[2]!]; return { status: 204, json: {} }; }
    if (url.pathname.startsWith("/issue/")) return { status: 200, json: shape(url.pathname.split("/")[2]!) };
    if (url.pathname === "/search/jql") {
      const jql = url.searchParams.get("jql") ?? "";
      if (jql.startsWith("issuetype in")) return { status: 200, json: { issues: [shape("INIT-1")], isLast: true } };
      if (jql.startsWith("parent in") && lag > 0) { lag--; return { status: 200, json: { issues: [], isLast: true } }; }
      const parents = [...jql.matchAll(/"([A-Z0-9_]+-\d+)"/g)].map((m) => m[1]!);
      const found = Object.keys(issues).filter((k) => parents.includes(issues[k]!.parent ?? "") && issues[k]!.project !== opts.hide).map(shape);
      return { status: 200, json: { issues: found, isLast: true } };
    }
    return { status: 404, json: {} };
  };
  return { call, calls, issues };
}

describe("J2/J4 probe: create an Initiative and an epic in another project, set the parent, delete both", () => {
  it("proves the cross-project parent, and removes everything it made", async () => {
    const j = fakeInitiativeSite();
    const before = Object.keys(j.issues).sort();
    const steps = await probeInitiativeWrite(j.call, "ROAD", "R8P");
    const text = steps.map((s) => `${s.label}: ${s.note}`).join("\n");
    expect(text).toContain("a different project");
    expect(text).toContain("parent key matches: true");
    expect(text).toContain("1 child(ren) found");
    expect(Object.keys(j.issues).sort()).toEqual(before);
    expect(steps.filter((s) => s.label.startsWith("Delete")).every((s) => s.note === "deleted")).toBe(true);
  });
  it("asks the children query again when the search index lags, and says how many tries it took", async () => {
    const sleeps: number[] = [];
    let t = 0;
    const steps = await probeInitiativeWrite(fakeInitiativeSite({ lagSearches: 2 }).call, "ROAD", "R8P", { sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t });
    const note = steps.find((x) => x.label.startsWith("The children query"))!.note;
    expect(note).toContain("1 child(ren) found after 3 tries");
    expect(note).toContain("lagged");
    expect(sleeps).toEqual([2000, 2000]);
  });
  it("says it is a real gap when the search never shows the child within the wait, and still deletes everything", async () => {
    const j = fakeInitiativeSite({ lagSearches: 99 });
    const before = Object.keys(j.issues).sort();
    const steps = await probeInitiativeWrite(j.call, "ROAD", "R8P", { sleep: async () => {} });
    expect(steps.find((x) => x.label.startsWith("The children query"))!.note).toContain("0 child(ren) found after 6 tries");
    expect(steps.find((x) => x.label.startsWith("The children query"))!.note).toContain("a real gap");
    expect(Object.keys(j.issues).sort()).toEqual(before);
  });
  it("writes nothing when the Initiative project has no level above Epic", async () => {
    const j = fakeInitiativeSite();
    const steps = await probeInitiativeWrite(j.call, "R8P", "R8P");
    expect(steps[0]!.note).toContain("no issue type above Epic");
    expect(j.calls.some((c) => c.startsWith("POST") || c.startsWith("PUT") || c.startsWith("DELETE"))).toBe(false);
  });
  it("says the project was not found (not that it has no Initiative type) when Jira answers 404, and writes nothing", async () => {
    const j = fakeInitiativeSite();
    const notFound: ProbeCall = async (m, path, b) => (path.startsWith("/project/NOPE") ? { status: 404, json: { errorMessages: ["No project could be found"] } } : j.call(m, path, b));
    const steps = await probeInitiativeWrite(notFound, "NOPE", "R8P");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: 404 });
    expect(steps[0]!.note).toContain("did not return the project");
    expect(steps[0]!.note).not.toContain("no issue type above Epic");
    expect(j.calls.some((c) => c.startsWith("POST") || c.startsWith("PUT") || c.startsWith("DELETE"))).toBe(false);
    const epicMissing: ProbeCall = async (m, path, b) => (path.startsWith("/project/NOPE") ? { status: 404, json: {} } : j.call(m, path, b));
    expect((await probeInitiativeWrite(epicMissing, "ROAD", "NOPE"))[0]!.note).toContain("did not return the project");
  });
  it("refuses anything that is not two project keys", async () => {
    const j = fakeInitiativeSite();
    expect((await probeInitiativeWrite(j.call, "ROAD", "r8p; drop"))[0]!.note).toContain("nothing was written");
    expect(j.calls).toEqual([]);
  });
});
