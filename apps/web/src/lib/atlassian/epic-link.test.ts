import { describe, expect, it } from "vitest";
import { epicResultText, EPICS_NEED_ABOVE_EPIC, linkEpics, planEpics, splitEpicPlan, type EpicRequest } from "./epic-link";
import type { JiraIssueRow } from "./read-issues";
import type { JiraRequest } from "./jira-write";
import { ReconnectNeeded } from "./token-provider";

const row = (key: string, o: Partial<JiraIssueRow> = {}): JiraIssueRow => ({ key, id: "1", title: `Title ${key}`, type: "Epic", level: 1, labels: [], status: "To Do", category: "new", parent: null, url: null, updated: null, ...o });
const asked = (...keys: string[]): EpicRequest[] => keys.map((key) => ({ key, state: "pending", lastError: null }));

describe("planEpics: what a confirmed send would do for each requested epic", () => {
  it("an epic with no parent gets the Initiative; one under another parent is moved, and the old parent is kept", () => {
    const lines = planEpics({ requests: asked("R8P-5", "DATA-9"), read: [row("R8P-5"), row("DATA-9", { parent: "QQ-3" })], missing: [], initiativeKey: "ROAD-1", aboveEpic: true });
    expect(lines.map((l) => [l.key, l.will, l.previousParent])).toEqual([["R8P-5", true, null], ["DATA-9", true, "QQ-3"]]);
    expect(lines[0]!.text).toContain("gets it as its parent");
    expect(lines[1]!.text).toContain("moves under it (now under QQ-3)");
  });
  it("an epic that is already under the Initiative is not written, only recorded", () => {
    const [l] = planEpics({ requests: asked("R8P-5"), read: [row("R8P-5", { parent: "ROAD-1" })], missing: [], initiativeKey: "ROAD-1", aboveEpic: true });
    expect(l).toMatchObject({ will: false, already: true });
    expect(l!.text).toContain("already under it");
  });
  it("while the Initiative does not exist yet, nothing is 'already under it'", () => {
    const [l] = planEpics({ requests: asked("R8P-5"), read: [row("R8P-5", { parent: "ROAD-1" })], missing: [], initiativeKey: null, aboveEpic: true });
    expect(l).toMatchObject({ will: true });
  });
  it("only epics: another level, a missing issue, or a project whose initiative type is at Epic level write nothing and say why", () => {
    const lines = planEpics({ requests: asked("R8P-6", "GONE-1"), read: [row("R8P-6", { type: "Story", level: 0 })], missing: ["GONE-1"], initiativeKey: "ROAD-1", aboveEpic: true });
    expect(lines.map((l) => l.will)).toEqual([false, false]);
    expect(lines[0]!.text).toContain("is a Story (level 0), not an epic");
    expect(lines[1]!.text).toContain("does not exist or this sign-in cannot see it");
    const low = planEpics({ requests: asked("R8P-5"), read: [row("R8P-5")], missing: [], initiativeKey: "ROAD-1", aboveEpic: false });
    expect(low[0]).toMatchObject({ will: false, text: EPICS_NEED_ABOVE_EPIC });
  });
  it("when it cannot be told whether the type is above Epic, Jira decides (the epic is offered)", () => {
    expect(planEpics({ requests: asked("R8P-5"), read: [row("R8P-5")], missing: [], initiativeKey: "ROAD-1", aboveEpic: null })[0]!.will).toBe(true);
  });
});

/** A fake Jira that records the writes and answers each issue as told. */
function fakeJira(answers: Record<string, { status: number; json?: unknown }> = {}) {
  const writes: { path: string; body: unknown }[] = [];
  const call: JiraRequest = async (method, path, body) => {
    writes.push({ path: `${method} ${path}`, body });
    const key = path.split("/").pop()!;
    const a = answers[key];
    return { status: a?.status ?? 204, json: a?.json ?? {} };
  };
  return { call, writes };
}
const plan = (...lines: Partial<ReturnType<typeof planEpics>[number]>[]) => lines.map((l, i) => ({ key: `R8P-${i + 1}`, text: "", will: true, previousParent: null, ...l }));
const noSleep = async () => {};

describe("linkEpics: the only write is the parent of the epic", () => {
  it("sets the parent of each epic, with nothing else in the body", async () => {
    const j = fakeJira();
    const r = await linkEpics(j.call, plan({ previousParent: "QQ-3" }, {}), "ROAD-1", noSleep);
    expect(j.writes).toEqual([{ path: "PUT /issue/R8P-1", body: { fields: { parent: { key: "ROAD-1" } } } }, { path: "PUT /issue/R8P-2", body: { fields: { parent: { key: "ROAD-1" } } } }]);
    expect(r).toEqual([{ key: "R8P-1", ok: true, previousParent: "QQ-3", error: null }, { key: "R8P-2", ok: true, previousParent: null, error: null }]);
  });
  it("writes nothing for an epic that is already there or that the plan did not offer", async () => {
    const j = fakeJira();
    const r = await linkEpics(j.call, plan({ will: false, already: true }, { will: false }), "ROAD-1", noSleep);
    expect(j.writes).toEqual([]);
    expect(r).toEqual([{ key: "R8P-1", ok: true, previousParent: null, error: null }]);
  });
  it("one epic Jira refuses is reported with Jira's reason and does not stop the others", async () => {
    const j = fakeJira({ "R8P-1": { status: 400, json: { errorMessages: ["Issue type Epic cannot have this parent."] } } });
    const r = await linkEpics(j.call, plan({}, {}), "ROAD-1", noSleep);
    expect(r[0]).toMatchObject({ key: "R8P-1", ok: false });
    expect(r[0]!.error).toContain("Issue type Epic cannot have this parent.");
    expect(r[1]).toMatchObject({ key: "R8P-2", ok: true });
    expect(epicResultText(r, "ROAD-1")).toMatch(/1 epic is now under ROAD-1 \(R8P-2\)\. R8P-1 was not moved: .*cannot have this parent/);
  });
  it("a lost sign-in is thrown, not retried", async () => {
    const j = fakeJira({ "R8P-1": { status: 401 } });
    await expect(linkEpics(j.call, plan({}, {}), "ROAD-1", noSleep)).rejects.toBeInstanceOf(ReconnectNeeded);
    expect(j.writes).toHaveLength(1);
  });
  it("refuses a bad Initiative key or epic key without a call", async () => {
    const j = fakeJira();
    const r = await linkEpics(j.call, plan({ key: "nope" }), "ROAD-1", noSleep);
    expect(j.writes).toEqual([]);
    expect(r[0]).toMatchObject({ ok: false, error: "Not a Jira issue key." });
  });
  it("says nothing when there is nothing to say", () => {
    expect(epicResultText([], "ROAD-1")).toBeNull();
    expect(epicResultText([{ key: "A-1", ok: true, previousParent: null, error: null }, { key: "A-2", ok: true, previousParent: null, error: null }], "ROAD-1")).toBe("2 epics are now under ROAD-1 (A-1, A-2).");
  });
});

describe("splitEpicPlan: what Sync links at once and what it asks about (issue #528)", () => {
  it("links an epic with no parent and one already under the Initiative at once; a move asks; what cannot be written is neither", () => {
    const lines = planEpics({
      requests: asked("R8P-5", "DATA-9", "R8P-6", "R8P-7", "GONE-1"),
      read: [row("R8P-5"), row("DATA-9", { parent: "QQ-3" }), row("R8P-6", { parent: "ROAD-1" }), row("R8P-7", { type: "Story", level: 0 })],
      missing: ["GONE-1"], initiativeKey: "ROAD-1", aboveEpic: true,
    });
    const { auto, ask } = splitEpicPlan(lines);
    expect(auto.map((l) => l.key)).toEqual(["R8P-5", "R8P-6"]); // no parent, and already there (only recorded)
    expect(ask.map((l) => l.key)).toEqual(["DATA-9"]); // under QQ-3: a move, a person confirms
  });
  it("asks about nothing and links nothing when the project's initiative type is at Epic level or below", () => {
    const lines = planEpics({ requests: asked("R8P-5"), read: [row("R8P-5")], missing: [], initiativeKey: "ROAD-1", aboveEpic: false });
    expect(splitEpicPlan(lines)).toEqual({ auto: [], ask: [] });
  });
});
