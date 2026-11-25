import { describe, expect, it } from "vitest";
import { buildEpicRows, checkSummary, checkable, distinct, filterEpicRows, initiativeListText, linksText, NO_FILTER, resultText, targetRows } from "./jira-epics-model";
import type { JiraEpicRequestRow, JiraTreeRow } from "./types";

const req = (key: string, o: Partial<JiraEpicRequestRow> = {}): JiraEpicRequestRow => ({ key, state: "pending", lastError: null, previousParent: null, ...o });
const node = (key: string, o: Partial<JiraTreeRow> = {}): JiraTreeRow => ({ key, parentKey: "R8P-1", level: 1, position: 0, title: `Title ${key}`, type: "Epic", status: "Done", category: "done", assignee: "Ana", url: `https://acme.atlassian.net/browse/${key}`, updatedAt: null, ...o });

const requests = [req("R8P-5"), req("R8P-6"), req("DATA-9")];
const tree = [
  node("R8P-5"), node("R8P-50", { level: 2, parentKey: "R8P-5", type: "Story", status: "In Progress", category: "indeterminate" }),
  node("R8P-51", { level: 2, parentKey: "R8P-5", type: "Bug", status: "Done" }),
  node("R8P-6", { status: "In Progress", category: "indeterminate" }), node("OTHER-1"),
];
const rows = buildEpicRows(requests, tree, {});

describe("buildEpicRows", () => {
  it("lists each listed epic followed by its children, and leaves out tree rows nobody listed", () => {
    expect(rows.map((r) => `${r.kind}:${r.key}`)).toEqual(["epic:R8P-5", "child:R8P-50", "child:R8P-51", "epic:R8P-6", "epic:DATA-9"]);
  });
  it("keeps an epic that was not read yet, with nothing invented for it", () => {
    expect(rows[4]).toMatchObject({ title: null, type: null, status: null, url: null });
  });
});

describe("filterEpicRows", () => {
  it("filters by type and by status", () => {
    expect(filterEpicRows(rows, { ...NO_FILTER, type: "Story" }).map((r) => r.key)).toEqual(["R8P-50"]);
    expect(filterEpicRows(rows, { ...NO_FILTER, status: "In Progress" }).map((r) => r.key)).toEqual(["R8P-50", "R8P-6"]);
    expect(filterEpicRows(rows, { type: "Epic", status: "Done", text: "" }).map((r) => r.key)).toEqual(["R8P-5"]);
  });
  it("can pick the rows that were not read yet", () => {
    expect(filterEpicRows(rows, { ...NO_FILTER, type: "Not read yet" }).map((r) => r.key)).toEqual(["DATA-9"]);
  });
  it("searches the key, title and assignee", () => {
    expect(filterEpicRows(rows, { ...NO_FILTER, text: "r8p-51" }).map((r) => r.key)).toEqual(["R8P-51"]);
    expect(filterEpicRows(rows, { ...NO_FILTER, text: "ana" })).toHaveLength(4);
  });
  it("offers each value once", () => {
    expect(distinct(rows, (r) => r.type ?? "Not read yet")).toEqual(["Epic", "Story", "Bug", "Not read yet"]);
  });
});

describe("targetRows and checkable", () => {
  it("uses the selection, else everything shown", () => {
    expect(targetRows(rows, new Set()).length).toBe(5);
    expect(targetRows(rows, new Set(["R8P-6", "nope"])).map((r) => r.key)).toEqual(["R8P-6"]);
  });
  it("lets a check and a removal reach only listed epics that are not linked", () => {
    const withLinked = buildEpicRows([req("R8P-5", { state: "linked" }), req("R8P-6")], tree, {});
    expect(withLinked.filter(checkable).map((r) => r.key)).toEqual(["R8P-6"]);
  });
});

describe("linksText", () => {
  it("gives the links only, one per line, without repeats", () => {
    const r = linksText([rows[0]!, rows[1]!, rows[0]!]);
    expect(r.text).toBe("https://acme.atlassian.net/browse/R8P-5\nhttps://acme.atlassian.net/browse/R8P-50");
    expect(r.withoutLink).toEqual([]);
  });
  it("builds a link for an epic not read yet from the site address of the other rows", () => {
    expect(linksText(rows).text.split("\n").at(-1)).toBe("https://acme.atlassian.net/browse/DATA-9");
  });
  it("falls back to the key, and says so, when no site address is known", () => {
    expect(linksText([rows[4]!])).toEqual({ text: "DATA-9", withoutLink: ["DATA-9"] });
  });
});

describe("resultText and checkSummary", () => {
  it("says linked, refused, checked or not checked, always in words", () => {
    const one = (r: JiraEpicRequestRow, checks = {}) => resultText(buildEpicRows([r], [], checks)[0]!, false);
    expect(one(req("A-1", { state: "linked", previousParent: "X-2" }))).toMatchObject({ label: "Linked", detail: "under the Initiative (was under X-2)" });
    expect(one(req("A-1", { state: "failed", lastError: "no permission" }))).toMatchObject({ label: "Jira refused it", detail: "no permission", tone: "bad" });
    expect(one(req("A-1"), { "A-1": { ok: true, text: "A-1 Epic A: gets it as its parent." } })).toMatchObject({ label: "OK", detail: "Epic A: gets it as its parent." });
    expect(one(req("A-1"), { "A-1": { ok: false, text: "A-1 is a Story" } })).toMatchObject({ label: "Cannot be linked", tone: "bad" });
    expect(one(req("A-1"))).toMatchObject({ label: "Not checked yet", tone: "plain" });
  });
  it("words read only projects as read, not link", () => {
    expect(checkSummary([{ ok: true }], true)).toContain("to read it");
    expect(checkSummary([{ ok: true }, { ok: false }], false)).toBe("Checked with Jira: 1 OK, 1 to fix or take off the list. Press Sync with Jira to link the OK ones.");
    expect(checkSummary([], false)).toBeNull();
  });
});

describe("initiativeListText", () => {
  it("gives a clean list of ids and names", () => {
    expect(initiativeListText([{ code: "R-104", name: "PushAds Format (sticky header/footer)" }, { code: "R-109", name: "SPA-Compatible Tag Integration" }]))
      .toBe("R-104 PushAds Format (sticky header/footer)\nR-109 SPA-Compatible Tag Integration");
  });
});
