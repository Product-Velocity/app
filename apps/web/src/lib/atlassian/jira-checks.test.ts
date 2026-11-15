import { describe, expect, it } from "vitest";
import type { ProbeCall } from "@/lib/spikes/atlassian-probes";
import { cleanReason, runReadChecks, runWriteCheck, reportText, type CheckResult } from "./jira-checks";

type Issue = { type: string; level: number; project: string; parent?: string };
/** A fake Jira: INIT-1 (project ROAD) over epics in R8P and DATA; two issue types are named "Initiative" (levels 2 and 0) when `twin`. */
function fake(opts: { initiativeLevel?: boolean; hide?: string; twin?: boolean; noInitiative?: boolean; lagSearches?: number; failParent?: boolean; leaky?: boolean } = {}) {
  let lag = opts.lagSearches ?? 0;
  const issues: Record<string, Issue> = opts.noInitiative ? {} : {
    "INIT-1": { type: "Initiative", level: 2, project: "ROAD" },
    "R8P-5": { type: "Epic", level: 1, project: "R8P", parent: "INIT-1" },
    "DATA-9": { type: "Epic", level: 1, project: "DATA", parent: "INIT-1" },
  };
  const calls: string[] = [];
  let seq = 100;
  const shape = (k: string) => ({ id: k, key: k, fields: { issuetype: { name: issues[k]!.type, hierarchyLevel: issues[k]!.level }, project: { key: issues[k]!.project }, parent: issues[k]!.parent ? { key: issues[k]!.parent } : undefined } });
  const call: ProbeCall = async (method, path, body) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    const url = new URL(path, "https://x");
    if (path === "/issuetype") return { status: 200, json: [{ id: "1", name: "Sub-task", hierarchyLevel: -1 }, { id: "2", name: "Story", hierarchyLevel: 0 }, { id: "3", name: "Epic", hierarchyLevel: 1 }, ...(opts.initiativeLevel === false ? [] : [{ id: "4", name: "Initiative", hierarchyLevel: 2 }]), ...(opts.twin ? [{ id: "5", name: "Initiative", hierarchyLevel: 0 }] : [])] };
    if (url.pathname.startsWith("/project/")) {
      const key = url.pathname.split("/")[2]!;
      const types = key === "ROAD" ? [{ id: "4", name: "Initiative", hierarchyLevel: 2 }] : [{ id: "3", name: "Epic", hierarchyLevel: 1 }];
      return { status: 200, json: { key, style: "classic", projectTypeKey: "software", issueTypes: types } };
    }
    if (method === "POST" && url.pathname === "/issue") {
      const f = (body as { fields: { project: { key: string }; issuetype: { id: string } } }).fields;
      const k = `${f.project.key}-${++seq}`;
      issues[k] = { type: f.issuetype.id === "4" ? "Initiative" : "Epic", level: f.issuetype.id === "4" ? 2 : 1, project: f.project.key };
      return { status: 201, json: { key: k } };
    }
    if (method === "PUT" && url.pathname.startsWith("/issue/")) {
      if (opts.failParent) return { status: 400, json: { errorMessages: [opts.leaky ? "Contact jo@example.com at https://acme.atlassian.net/browse/X-1" : "Parent not allowed"] } };
      issues[url.pathname.split("/")[2]!]!.parent = (body as { fields: { parent: { key: string } } }).fields.parent.key; return { status: 204, json: {} };
    }
    if (method === "DELETE") { delete issues[url.pathname.split("/")[2]!]; return { status: 204, json: {} }; }
    if (url.pathname.startsWith("/issue/")) { const k = url.pathname.split("/")[2]!; return issues[k] ? { status: 200, json: shape(k) } : { status: 404, json: {} }; }
    if (url.pathname === "/search/jql") {
      const jql = url.searchParams.get("jql") ?? "";
      if (jql.startsWith("issuetype in")) { const first = Object.keys(issues).find((k) => issues[k]!.level >= 2); return { status: 200, json: { issues: first ? [shape(first)] : [], isLast: true } }; }
      if (jql.startsWith("parent in") && lag > 0) { lag--; return { status: 200, json: { issues: [], isLast: true } }; }
      const parents = [...jql.matchAll(/"([A-Z0-9_]+-\d+)"/g)].map((m) => m[1]!);
      return { status: 200, json: { issues: Object.keys(issues).filter((k) => parents.includes(issues[k]!.parent ?? "") && issues[k]!.project !== opts.hide).map(shape), isLast: true } };
    }
    return { status: 404, json: {} };
  };
  return { call, calls, issues };
}
const by = (r: CheckResult[], key: string) => r.find((c) => c.key === key)!;

describe("read checks", () => {
  it("passes when the Initiative level, an Initiative and its children across projects are found; every call is a GET", async () => {
    const j = fake();
    const r = await runReadChecks(j.call, { linkedProjects: ["ROAD", "R8P", "DATA"] });
    expect(by(r, "level")).toMatchObject({ status: "pass" });
    expect(by(r, "initiative").status).toBe("pass");
    expect(by(r, "children")).toMatchObject({ status: "pass" });
    expect(by(r, "children").reason).toContain("2 children from 2 projects");
    expect(by(r, "live_updates").status).toBe("pass");
    expect(j.calls.every((c) => c.startsWith("GET"))).toBe(true);
  });
  it("fails, with what to do, when the site has no level above Epic, and stops there", async () => {
    const r = await runReadChecks(fake({ initiativeLevel: false }).call, { linkedProjects: [] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "level", status: "fail" });
    expect(r[0]!.fix).toBeTruthy();
  });
  it("warns when two issue types share a name at different levels and says to pick by level", async () => {
    const r = await runReadChecks(fake({ twin: true }).call, { linkedProjects: ["ROAD", "R8P", "DATA"] });
    expect(by(r, "same_name")).toMatchObject({ status: "warn" });
    expect(by(r, "same_name").reason).toContain("Initiative");
    expect(by(r, "same_name").reason).toMatch(/level 2/);
    expect(by(r, "same_name").reason).toMatch(/level 0/);
    expect(by(runReadChecksSync(await runReadChecks(fake().call, { linkedProjects: [] })), "same_name").status).toBe("pass");
  });
  it("warns, naming the project keys, when epics sit in projects without live updates", async () => {
    const r = await runReadChecks(fake().call, { linkedProjects: ["ROAD"] });
    expect(by(r, "live_updates")).toMatchObject({ status: "warn" });
    expect(by(r, "live_updates").reason).toContain("R8P");
    expect(by(r, "live_updates").reason).toContain("DATA");
    expect(by(r, "live_updates").reason).not.toContain("ROAD");
  });
  it("warns, not fails, when no Initiative exists yet", async () => {
    const r = await runReadChecks(fake({ noInitiative: true }).call, { linkedProjects: [] });
    expect(by(r, "initiative")).toMatchObject({ status: "warn" });
    expect(r.some((c) => c.key === "children")).toBe(false);
  });
  it("always says the visibility check is by hand and shows the count read", async () => {
    const r = await runReadChecks(fake({ hide: "DATA" }).call, { linkedProjects: ["ROAD", "R8P"] });
    expect(by(r, "visibility")).toMatchObject({ status: "warn" });
    expect(by(r, "visibility").reason).toContain("1 child");
    expect(by(r, "visibility").reason).toMatch(/compare/i);
  });
  it("fails the children check with Jira's reason when the search is refused", async () => {
    const j = fake();
    const refuse: ProbeCall = async (m, p, b) => (p.includes("parent%20in") || p.includes("parent+in") ? { status: 403, json: { errorMessages: ["No permission"] } } : j.call(m, p, b));
    expect(by(await runReadChecks(refuse, { linkedProjects: [] }), "children")).toMatchObject({ status: "fail" });
  });
  it("saves only keys, counts and type names", async () => {
    expect(JSON.stringify(await runReadChecks(fake().call, { linkedProjects: [] }))).not.toMatch(/summary|@|atlassian\.net/i);
  });
});
const runReadChecksSync = (r: CheckResult[]) => r;

describe("write check", () => {
  it("passes every step, uses the epic in another project, and removes both test issues", async () => {
    const j = fake();
    const before = Object.keys(j.issues).sort();
    const r = await runWriteCheck(j.call, "ROAD", "R8P", { sleep: async () => {} });
    expect(r.every((c) => c.status === "pass")).toBe(true);
    expect(r.some((c) => /Delete/.test(c.label))).toBe(true);
    expect(Object.keys(j.issues).sort()).toEqual(before);
  });
  it("waits for Jira's search (two asks) and still passes, saying it lagged", async () => {
    const sleeps: number[] = [];
    const r = await runWriteCheck(fake({ lagSearches: 2 }).call, "ROAD", "R8P", { sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps).toEqual([2000, 2000]);
    const c = r.find((x) => x.key === "write_children")!;
    expect(c.status).toBe("pass");
    expect(c.reason).toContain("lagged");
  });
  it("fails when the search never shows the child, and still deletes both", async () => {
    const j = fake({ lagSearches: 99 });
    const before = Object.keys(j.issues).sort();
    const r = await runWriteCheck(j.call, "ROAD", "R8P", { sleep: async () => {} });
    expect(r.find((x) => x.key === "write_children")!.status).toBe("fail");
    expect(Object.keys(j.issues).sort()).toEqual(before);
  });
  it("fails the parent step, cleans up both issues, and keeps no email or address in the reason", async () => {
    const j = fake({ failParent: true, leaky: true });
    const before = Object.keys(j.issues).sort();
    const r = await runWriteCheck(j.call, "ROAD", "R8P", { sleep: async () => {} });
    expect(r.find((x) => x.key === "write_parent")!.status).toBe("fail");
    expect(Object.keys(j.issues).sort()).toEqual(before);
    expect(JSON.stringify(r)).not.toMatch(/@|atlassian\.net|https?:/);
  });
  it("fails and writes nothing when the Initiative project has no level above Epic or the keys are not keys", async () => {
    const j = fake();
    const r = await runWriteCheck(j.call, "R8P", "R8P", { sleep: async () => {} });
    expect(r[0]!.status).toBe("fail");
    const bad = await runWriteCheck(j.call, "ROAD", "r8p; drop", { sleep: async () => {} });
    expect(bad[0]).toMatchObject({ status: "fail" });
    expect(j.calls.some((c) => /^(POST|PUT|DELETE)/.test(c))).toBe(false);
  });
});

describe("cleanReason and the report", () => {
  it("removes emails and addresses and caps the length", () => {
    expect(cleanReason("mail jo@example.com see https://x.atlassian.net/browse/A-1 now")).not.toMatch(/@|https?:|atlassian/);
    expect(cleanReason("x".repeat(900)).length).toBeLessThanOrEqual(400);
  });
  it("the report lists a verdict word, the reason and the fix per check", () => {
    const t = reportText("read", [{ key: "a", label: "A", status: "warn", reason: "Because", fix: "Do this" }]);
    expect(t).toContain("WARN");
    expect(t).toContain("Because");
    expect(t).toContain("Do this");
  });
});
