import { describe, expect, it } from "vitest";
import { probeDevInfo, probeIdeaLink, valueCandidates, probeIdeaWrite, probePaging, probeWebhook, type ProbeCall } from "./atlassian-probes";
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

/** A fake Jira Product Discovery project: stores what is written, refuses fields in `refuse`, and reads back with optional distortion. */
function fakeDiscovery(o: { type?: string; refuse?: string[]; failCreate?: boolean; dropDescription?: boolean } = {}) {
  const calls: string[] = [];
  const store: Record<string, unknown> = {};
  const fieldsList = [
    { id: "customfield_10001", name: "Impact", schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" } },
    { id: "customfield_10002", name: "Effort", schema: { type: "number", custom: "x:float" } },
    { id: "customfield_10003", name: "Theme", schema: { type: "array", items: "string", custom: "x:labels" } },
    { id: "customfield_10004", name: "Idea short description", schema: { type: "string", custom: "x:textarea" } },
    { id: "customfield_10005", name: "Roadmap", schema: { type: "string", custom: "x:roadmap" } },
  ];
  const call: ProbeCall = async (m, path, body) => {
    calls.push(`${m} ${path}`);
    if (path.startsWith("/project/")) return { status: 200, json: { projectTypeKey: o.type ?? "product_discovery", issueTypes: [{ id: "9", name: "Idea", hierarchyLevel: 0 }] } };
    if (path === "/field") return { status: 200, json: fieldsList };
    if (path.endsWith("/editmeta")) return { status: 200, json: { fields: { customfield_10001: { schema: { type: "option" }, allowedValues: [{ id: "77", value: "High" }] }, customfield_10002: { schema: { type: "number" } }, customfield_10003: { schema: { type: "array", items: "string" } }, customfield_10004: { schema: { type: "string", custom: "x:textarea" } } } } };
    if (m === "POST") return o.failCreate ? { status: 400, json: { errors: { issuetype: "no" } } } : { status: 201, json: { key: "DISC-7" } };
    if (m === "PUT") {
      const fields = obj2(body).fields;
      for (const k of Object.keys(fields)) {
        if (o.refuse?.includes(k)) return { status: 400, json: { errors: { [k]: "Field cannot be set. It is not on the appropriate screen, or unknown." } } };
        if (k === "customfield_10005" && typeof fields[k] === "string") return { status: 400, json: { errors: { [k]: "bad shape" } } };
        store[k] = fields[k];
      }
      return { status: 204, json: null };
    }
    if (m === "DELETE") return { status: 204, json: null };
    if (path.includes("expand=transitions")) return { status: 200, json: { transitions: [{ name: "Discovery" }] } };
    if (path.startsWith("/issue/DISC-7?fields=")) return { status: 200, json: { fields: { ...store, labels: ["pv-spike"], ...(o.dropDescription ? { description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "pv spike j8" }] }] } } : {}) } } };
    return { status: 200, json: {} };
  };
  return { call, calls, store };
}
const obj2 = (v: unknown): { fields: Record<string, unknown> } => v as { fields: Record<string, unknown> };

describe("J8: idea write probe", () => {
  it("finds fields by name, sets each in its own request, reads back and always deletes", async () => {
    const f = fakeDiscovery();
    const steps = await probeIdeaWrite(f.call, "DISC");
    const text = steps.map((s) => `${s.label}: ${s.note}`).join("\n");
    expect(text).toContain("Impact: customfield_10001 (option");
    expect(text).toContain("writable as option{id}");
    expect(text).toContain("writable as number");
    expect(text).toContain("Roadmap (customfield_10005)");
    const road = steps.find((s) => s.label.startsWith("Set Roadmap"))!; // plain string refused, the ADF retry accepted: both attempts are reported
    expect(road.status).toBe(204);
    expect(road.note).toContain("plain string: 400, ADF: 204");
    expect(f.store.customfield_10001).toEqual({ id: "77" });
    expect(f.store.description).toMatchObject({ type: "doc", version: 1 });
    expect(steps.find((s) => s.label === "Read back and compare")!.note).toContain("description: round-trips (same node types and text)");
    expect(f.calls.at(-1)).toBe("DELETE /issue/DISC-7");
  });
  it("one refused field does not stop the others and is reported with Jira's reason", async () => {
    const f = fakeDiscovery({ refuse: ["customfield_10002"] });
    const steps = await probeIdeaWrite(f.call, "DISC");
    expect(steps.find((s) => s.label.startsWith("Set Effort"))!.note).toContain("refused");
    expect(steps.find((s) => s.label.startsWith("Set Theme"))!.status).toBe(204);
    expect(f.calls.at(-1)).toBe("DELETE /issue/DISC-7");
  });
  it("a description that comes back different is flagged as DIFFERS with node types only", async () => {
    const f = fakeDiscovery({ dropDescription: true });
    const note = (await probeIdeaWrite(f.call, "DISC")).find((s) => s.label === "Read back and compare")!.note;
    expect(note).toContain("description: DIFFERS; node types read back: doc > paragraph > text");
  });
  it("prints no issue text, only structure", async () => {
    const f = fakeDiscovery();
    const all = (await probeIdeaWrite(f.call, "DISC")).map((s) => s.note).join("\n");
    expect(all).not.toContain("pv spike j8");
    expect(all).not.toContain("High");
  });
  it("refuses to write anywhere but a Product Discovery project", async () => {
    const f = fakeDiscovery({ type: "software" });
    const steps = await probeIdeaWrite(f.call, "PLAT");
    expect(steps).toHaveLength(1);
    expect(f.calls.some((c) => c.startsWith("POST") || c.startsWith("PUT"))).toBe(false);
  });
  it("a refused create is reported and nothing is deleted", async () => {
    const f = fakeDiscovery({ failCreate: true });
    const steps = await probeIdeaWrite(f.call, "DISC");
    expect(steps.find((s) => s.label.startsWith("Create"))!.status).toBe(400);
    expect(f.calls.some((c) => c.startsWith("DELETE"))).toBe(false);
  });
  it("chooses value shapes from the schema", () => {
    expect(valueCandidates({ schema: { type: "number" } })[0]).toEqual({ value: 1, kind: "number" });
    expect(valueCandidates({ schema: { type: "array", items: "option" }, allowedValues: [{ id: "5" }] })[0]!.value).toEqual([{ id: "5" }]);
    expect(valueCandidates({ schema: { type: "string", custom: "x:textarea" } })[0]!.kind).toBe("ADF");
    expect(valueCandidates({ schema: { type: "user" } })).toEqual([]);
  });
});

describe("J8: idea to epic link probe", () => {
  const make = (o: { refuseType?: string; parentOk?: boolean; softwareType?: string } = {}) => {
    const calls: string[] = [];
    const links: { id: string; type: string }[] = [];
    const call: ProbeCall = async (m, path, body) => {
      calls.push(`${m} ${path}`);
      if (path === "/project/DISC") return { status: 200, json: { projectTypeKey: "product_discovery", issueTypes: [{ id: "9", name: "Idea", hierarchyLevel: 0 }] } };
      if (path === "/project/PLAT") return { status: 200, json: { projectTypeKey: o.softwareType ?? "software", issueTypes: [{ id: "1", name: "Epic", hierarchyLevel: 1 }, { id: "2", name: "Story", hierarchyLevel: 0 }] } };
      if (path === "/issueLinkType") return { status: 200, json: { issueLinkTypes: [{ name: "Delivers", outward: "delivers", inward: "is delivered by" }, { name: "Relates", outward: "relates to", inward: "relates to" }] } };
      if (m === "POST" && path === "/issue") return { status: 201, json: { key: (body as { fields: { project: { key: string } } }).fields.project.key === "DISC" ? "DISC-1" : "PLAT-9" } };
      if (m === "POST" && path === "/issueLink") { const t = (body as { type: { name: string } }).type.name; if (t === o.refuseType) return { status: 404, json: { errorMessages: ["No issue link type with name found."] } }; links.push({ id: String(links.length + 100), type: t }); return { status: 201, json: null }; }
      if (m === "GET" && path.includes("fields=issuelinks")) return { status: 200, json: { fields: { issuelinks: links.map((l) => ({ id: l.id, type: { name: l.type } })) } } };
      if (m === "DELETE" && path.startsWith("/issueLink/")) { const i = links.findIndex((l) => l.id === path.split("/").pop()); if (i >= 0) links.splice(i, 1); return { status: 204, json: null }; }
      if (m === "PUT") return o.parentOk ? { status: 204, json: null } : { status: 400, json: { errors: { parent: "Given parent work item does not belong to appropriate hierarchy." } } };
      if (m === "DELETE") return { status: 204, json: null };
      return { status: 200, json: {} };
    };
    return { call, calls, links };
  };
  it("tries every link type, removes each link, records the parent refusal and deletes both issues", async () => {
    const f = make();
    const steps = await probeIdeaLink(f.call, "DISC,PLAT");
    const per = steps.find((s) => s.label.startsWith("Link idea"))!.note;
    expect(per).toContain("Delivers: 201 (visible on idea: yes, on epic: yes), removed");
    expect(per).toContain("Relates: 201");
    expect(steps.find((s) => s.label.startsWith("Epic parent"))!.status).toBe(400);
    expect(f.links).toEqual([]);
    expect(f.calls.filter((c) => c.startsWith("DELETE /issue/"))).toEqual(["DELETE /issue/PLAT-9", "DELETE /issue/DISC-1"]);
  });
  it("a refused link type is reported and the others still run", async () => {
    const f = make({ refuseType: "Delivers" });
    const per = (await probeIdeaLink(f.call, "DISC,PLAT")).find((s) => s.label.startsWith("Link idea"))!.note;
    expect(per).toContain("Delivers: 404");
    expect(per).toContain("Relates: 201");
  });
  it("needs two different project keys and the right project types, otherwise writes nothing", async () => {
    for (const [arg, o] of [["DISC", {}], ["DISC,DISC", {}], ["DISC,PLAT", { softwareType: "business" }]] as const) {
      const f = make(o);
      const steps = await probeIdeaLink(f.call, arg);
      expect(steps).toHaveLength(1);
      expect(f.calls.some((c) => c.startsWith("POST") || c.startsWith("PUT"))).toBe(false);
    }
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
