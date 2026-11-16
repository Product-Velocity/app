import { describe, expect, it } from "vitest";
import { classifyEpics, needsDecision, openEpicsJql, type SeenEpic } from "./epic-coverage";

const epic = (key: string, o: Partial<SeenEpic> = {}): SeenEpic => ({ key, project: key.split("-")[0]!, title: `Epic ${key}`, status: "In Progress", category: "indeterminate", parentKey: null, url: null, updatedAt: null, ...o });
const items = [{ id: "i1", code: "R-01", name: "Takeover" }, { id: "i2", code: "R-02", name: "Other" }];
const base = { items, links: [], tree: [], requests: [] };

describe("classifyEpics", () => {
  it("an epic that is an initiative's own issue is linked", () => {
    const r = classifyEpics({ ...base, epics: [epic("R8P-1")], links: [{ itemId: "i1", issueKey: "R8P-1" }] });
    expect(r[0]).toMatchObject({ state: "linked", initiative: { code: "R-01" } });
  });
  it("an epic in the tree of an initiative, or whose parent is an initiative's issue, is under it", () => {
    const r = classifyEpics({ ...base, epics: [epic("R8P-2"), epic("R8P-3", { parentKey: "RR-1" })], tree: [{ itemId: "i2", issueKey: "R8P-2" }], links: [{ itemId: "i1", issueKey: "RR-1" }] });
    expect(r.map((x) => [x.key, x.state, x.initiative?.code])).toEqual([["R8P-2", "under", "R-02"], ["R8P-3", "under", "R-01"]]);
  });
  it("an epic listed on an initiative waits for Sync; a failed request leaves it not linked, with the reason", () => {
    const r = classifyEpics({ ...base, epics: [epic("R8P-4"), epic("R8P-5")], requests: [{ itemId: "i1", epicKey: "R8P-4", state: "pending", error: null }, { itemId: "i1", epicKey: "R8P-5", state: "failed", error: "Jira said no" }] });
    expect(r.find((x) => x.key === "R8P-4")).toMatchObject({ state: "requested", initiative: { code: "R-01" } });
    expect(r.find((x) => x.key === "R8P-5")).toMatchObject({ state: "not_linked", note: "A request to link it failed: Jira said no" });
  });
  it("an epic under a Jira Initiative we do not have, and a loose epic, need a decision and come first", () => {
    const r = classifyEpics({ ...base, epics: [epic("R8P-9"), epic("R8P-7", { parentKey: "RR-9" }), epic("R8P-8")], links: [{ itemId: "i1", issueKey: "R8P-9" }] });
    expect(r.map((x) => [x.key, x.state])).toEqual([["R8P-8", "not_linked"], ["R8P-7", "initiative_not_in_pv"], ["R8P-9", "linked"]]);
    expect(r[1]!.note).toBe("RR-9");
    expect(needsDecision(r)).toBe(2);
  });
  it("sorts keys by number, not by text", () => {
    expect(classifyEpics({ ...base, epics: [epic("R8P-10"), epic("R8P-9")] }).map((x) => x.key)).toEqual(["R8P-9", "R8P-10"]);
  });
});

describe("openEpicsJql", () => {
  it("names the project and the epic type ids", () => { expect(openEpicsJql("R8P", ["10000", "10050"])).toBe('project = "R8P" AND issuetype in (10000, 10050) AND statusCategory != Done ORDER BY updated DESC'); });
  it("refuses anything that is not a key or an id", () => {
    expect(() => openEpicsJql('R8P" OR 1=1', ["1"])).toThrow();
    expect(() => openEpicsJql("R8P", ["1) OR (1"])).toThrow();
    expect(() => openEpicsJql("R8P", [])).toThrow();
  });
});
