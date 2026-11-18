import { describe, expect, it } from "vitest";
import { findByMarker, readIssue } from "./jira-issue";
import type { JiraRequest } from "./jira-write";

const fake = (status: number, json: unknown): JiraRequest & { paths: string[] } => { const f = (async (_m: string, p: string) => { f.paths.push(p); return { status, json }; }) as unknown as JiraRequest & { paths: string[] }; f.paths = []; return f; };
const none = async () => {};

describe("readIssue", () => {
  it("reads summary, description and labels", async () => {
    const r = await readIssue(fake(200, { id: "10001", fields: { summary: "S", description: { type: "doc" }, labels: ["a", 3, "b"] } }), "PLAT-1", none);
    expect(r).toEqual({ ok: true, issue: { key: "PLAT-1", id: "10001", custom: {}, summary: "S", description: { type: "doc" }, labels: ["a", "b"] } });
  });
  it("asks for the extra custom fields (select fields, issue #512) and returns their raw values; an id that is not a custom field is never requested", async () => {
    const f = fake(200, { id: "10001", fields: { summary: "S", labels: [], customfield_10100: { id: "201", value: "On Track" } } });
    const r = await readIssue(f, "PLAT-1", none, ["customfield_10100", "customfield_10101", "summary", "x,y"]);
    expect(r).toMatchObject({ ok: true, issue: { custom: { customfield_10100: { id: "201", value: "On Track" }, customfield_10101: null } } });
    expect(f.paths[0]).toBe("/issue/PLAT-1?fields=summary,description,labels,customfield_10100,customfield_10101");
  });
  it("a missing issue, a refused sign-in and an outage are told apart; a bad key never reaches Jira", async () => {
    expect(await readIssue(fake(404, {}), "PLAT-1", none)).toMatchObject({ ok: false, kind: "gone" });
    expect(await readIssue(fake(401, {}), "PLAT-1", none)).toMatchObject({ ok: false, kind: "reconnect" });
    expect(await readIssue(fake(500, {}), "PLAT-1", none)).toMatchObject({ ok: false, kind: "unavailable" });
    const f = fake(200, {});
    expect(await readIssue(f, "../x", none)).toMatchObject({ ok: false });
    expect(f.paths).toEqual([]);
  });
});
describe("findByMarker", () => {
  it("finds an issue that carries the marker, and only with a well-formed project key and marker", async () => {
    const f = fake(200, { issues: [{ key: "PLAT-9", id: "5" }] });
    expect(await findByMarker(f, "PLAT", "pm:item/0123456789abcdef", none)).toEqual({ key: "PLAT-9", id: "5" });
    expect(decodeURIComponent(f.paths[0]!)).toContain('labels = "pm:item/0123456789abcdef"');
    expect(await findByMarker(f, "PLAT\" OR 1=1", "pm:item/0123456789abcdef", none)).toBeNull();
    expect(await findByMarker(f, "PLAT", 'x" OR "1"="1', none)).toBeNull();
    expect(await findByMarker(fake(200, { issues: [] }), "PLAT", "pm:item/0123456789abcdef", none)).toBeNull();
  });
});
