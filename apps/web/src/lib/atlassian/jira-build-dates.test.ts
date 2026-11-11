import { describe, expect, it } from "vitest";
import { categoryMap, firstWorkStart, readBuildDates, refreshBuildDatesTolerant, type DatedIssue, type DateDeps } from "./jira-build-dates";
import { ReconnectNeeded } from "./token-provider";

const CATS = categoryMap([{ id: "1", statusCategory: { key: "new" } }, { id: "2", statusCategory: { key: "indeterminate" } }, { id: "3", statusCategory: { key: "done" } }, { id: "4", statusCategory: { key: "indeterminate" } }, { id: "x", statusCategory: { key: "weird" } }]);
const hist = (created: string, to: string, field = "status") => ({ created, items: [{ field, to }] });
const issue = (key: string, histories: ReturnType<typeof hist>[], category = "indeterminate", resolutiondate?: string): DatedIssue => ({ key, fields: { status: { statusCategory: { key: category } }, ...(resolutiondate ? { resolutiondate } : {}) }, changelog: { histories } });
const jira = (issues: DatedIssue[]) => { const asked: string[] = []; return { asked, getPage: async (path: string) => { asked.push(path); const keys = [...decodeURIComponent(path).matchAll(/"([A-Z]+-\d+)"/g)].map((m) => m[1]); return { issues: issues.filter((i) => keys.includes(i.key!)), isLast: true }; } }; };

describe("categoryMap", () => {
  it("keeps only known categories", () => expect([...categoryMap([{ id: "2", statusCategory: { key: "indeterminate" } }, { id: "9", statusCategory: { key: "nope" } }, { statusCategory: { key: "new" } }]).entries()]).toEqual([["2", "indeterminate"]]));
});

describe("firstWorkStart", () => {
  it("is the earliest move into the in-progress or done category, whatever the status names or the order of the history", () => {
    expect(firstWorkStart(issue("A-1", [hist("2026-11-05T10:00:00.000+0100", "4"), hist("2026-11-02T08:00:00.000Z", "2"), hist("2026-11-01T08:00:00.000Z", "1")]), CATS)).toBe("2026-11-02T08:00:00.000Z");
  });
  it("ignores other fields, unknown statuses and moves into To Do; null when nothing qualifies", () => {
    expect(firstWorkStart(issue("A-1", [hist("2026-11-01T08:00:00Z", "1"), hist("2026-11-02T08:00:00Z", "2", "assignee"), hist("2026-11-03T08:00:00Z", "zzz")]), CATS)).toBeNull();
    expect(firstWorkStart({ key: "A-1" }, CATS)).toBeNull();
  });
  it("a jump straight to done counts as the start", () => expect(firstWorkStart(issue("A-1", [hist("2026-11-04T08:00:00Z", "3")]), CATS)).toBe("2026-11-04T08:00:00.000Z"));
});

describe("readBuildDates", () => {
  it("takes the earliest start over the issue and its children, and the resolution date only while done", async () => {
    const j = jira([
      issue("RR-1", [hist("2026-11-09T08:00:00Z", "2")], "done", "2026-11-12T09:00:00Z"),
      issue("RR-2", [hist("2026-11-03T08:00:00Z", "2")], "done"),
      issue("RR-3", []),
    ]);
    const rows = await readBuildDates(j.getPage, CATS, [{ item_id: "i1", issue_key: "RR-1", childKeys: ["RR-2", "RR-3"] }]);
    expect(rows).toEqual([{ key: "RR-1", started: "2026-11-03T08:00:00.000Z", resolved: "2026-11-12T09:00:00.000Z" }]);
    expect(decodeURIComponent(j.asked[0]!)).toContain("expand=changelog");
  });
  it("no resolution date while the issue is not done (reopened clears it); an issue with no history has started null", async () => {
    const j = jira([issue("RR-1", [], "indeterminate", "2026-11-12T09:00:00Z")]);
    expect(await readBuildDates(j.getPage, CATS, [{ item_id: "i1", issue_key: "RR-1", childKeys: [] }])).toEqual([{ key: "RR-1", started: null, resolved: null }]);
  });
  it("an issue Jira did not return gives no row (nothing is known, nothing changes)", async () => {
    expect(await readBuildDates(jira([]).getPage, CATS, [{ item_id: "i1", issue_key: "RR-1", childKeys: [] }])).toEqual([]);
  });
  it("reads 100 keys per call and a refused key (400) does not hide the others", async () => {
    const issues = Array.from({ length: 130 }, (_, n) => issue(`RR-${n + 1}`, [hist("2026-11-02T08:00:00Z", "2")]));
    const j = jira(issues);
    const targets = [{ item_id: "i1", issue_key: "RR-1", childKeys: issues.slice(1).map((i) => i.key!) }];
    await readBuildDates(j.getPage, CATS, targets);
    expect(j.asked).toHaveLength(2);
    const bad = async (path: string) => { if (decodeURIComponent(path).includes('"RR-2"')) throw new Error("Jira answered 400"); return jira(issues).getPage(path); };
    const rows = await readBuildDates(bad, CATS, [{ item_id: "i1", issue_key: "RR-1", childKeys: ["RR-2", "RR-3"] }]);
    expect(rows).toEqual([{ key: "RR-1", started: "2026-11-02T08:00:00.000Z", resolved: null }]);
  });
});

describe("refreshBuildDatesTolerant", () => {
  const deps = (over: Partial<DateDeps> = {}): DateDeps & { applied: unknown[][] } => {
    const applied: unknown[][] = [];
    return { applied, getPage: jira([issue("RR-1", [hist("2026-11-02T08:00:00Z", "2")])]).getPage, getStatuses: async () => [{ id: "2", statusCategory: { key: "indeterminate" } }], apply: async (rows) => { applied.push(rows); return rows.map((r) => ({ key: r.key, changes: { start_building: [null, "2026-11-02"] } })); }, ...over };
  };
  const target = [{ item_id: "i1", issue_key: "RR-1", childKeys: [] }];
  it("reads, applies and counts the initiatives that changed", async () => {
    const d = deps();
    expect(await refreshBuildDatesTolerant(d, target)).toEqual({ read: 1, changed: 1, error: null });
    expect(d.applied).toEqual([[{ key: "RR-1", started: "2026-11-02T08:00:00.000Z", resolved: null }]]);
  });
  it("nothing linked means no Jira call", async () => {
    let called = false;
    expect(await refreshBuildDatesTolerant(deps({ getStatuses: async () => { called = true; return []; } }), [])).toEqual({ read: 0, changed: 0, error: null });
    expect(called).toBe(false);
  });
  it("a Jira failure is returned, not thrown; ReconnectNeeded propagates", async () => {
    expect(await refreshBuildDatesTolerant(deps({ getStatuses: async () => { throw new Error("Jira answered 503"); } }), target)).toEqual({ read: 0, changed: 0, error: "Jira answered 503" });
    await expect(refreshBuildDatesTolerant(deps({ getStatuses: async () => { throw new ReconnectNeeded(); } }), target)).rejects.toBeInstanceOf(ReconnectNeeded);
  });
});
