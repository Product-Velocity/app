import { describe, expect, it } from "vitest";
import { findByMarker, readIssue } from "./jira-issue";
import type { JiraRequest } from "./jira-write";

const fake = (status: number, json: unknown): JiraRequest & { paths: string[] } => { const f = (async (_m: string, p: string) => { f.paths.push(p); return { status, json }; }) as unknown as JiraRequest & { paths: string[] }; f.paths = []; return f; };
const none = async () => {};

describe("readIssue", () => {
  it("reads summary, description and labels", async () => {
    const r = await readIssue(fake(200, { id: "10001", fields: { summary: "S", description: { type: "doc" }, labels: ["a", 3, "b"] } }), "PLAT-1", none);
    expect(r).toEqual({ ok: true, issue: { key: "PLAT-1", id: "10001", summary: "S", description: { type: "doc" }, labels: ["a", "b"] } });
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
    expect(await findByMarker(f, "PLAT", "pv:item/0123456789abcdef", none)).toEqual({ key: "PLAT-9", id: "5" });
    expect(decodeURIComponent(f.paths[0]!)).toContain('labels = "pv:item/0123456789abcdef"');
    expect(await findByMarker(f, "PLAT\" OR 1=1", "pv:item/0123456789abcdef", none)).toBeNull();
    expect(await findByMarker(f, "PLAT", 'x" OR "1"="1', none)).toBeNull();
    expect(await findByMarker(fake(200, { issues: [] }), "PLAT", "pv:item/0123456789abcdef", none)).toBeNull();
  });
});
