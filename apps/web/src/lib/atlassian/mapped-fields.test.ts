import { describe, expect, it } from "vitest";
import { dropMissingFields } from "./mapped-fields";
import { buildJiraPayload } from "./outbound";
import type { JiraRequest } from "./jira-write";

const fake = (ids: string[], status = 200): JiraRequest & { calls: string[] } => {
  const calls: string[] = [];
  const f = (async (_m: string, path: string) => { calls.push(path); return { status, json: ids.map((id) => ({ id, name: id, custom: id.startsWith("customfield") })) }; }) as JiraRequest & { calls: string[] };
  f.calls = calls;
  return f;
};
const ITEM = { initiative_name: "N", description: "D", moscow: "Must", g2m_date_est: "2027-03-31", planned_start: "2027-01-04", theme: "Payments" };

describe("fields the configuration names but the site no longer has", () => {
  it("reads nothing when only system fields are mapped", async () => {
    const f = fake([]);
    expect(await dropMissingFields(f, { priorityByMoscow: { Must: "1" } })).toEqual({ map: { priorityByMoscow: { Must: "1" } }, notes: [] });
    expect(f.calls).toEqual([]);
  });
  it("keeps fields that exist", async () => {
    const m = { startDate: "customfield_10015", theme: "customfield_10030", dueDate: "customfield_10016" };
    expect(await dropMissingFields(fake(["customfield_10015", "customfield_10030", "customfield_10016"]), m)).toEqual({ map: m, notes: [] });
  });
  it("drops a missing field, says which, and the payload then leaves it out", async () => {
    const r = await dropMissingFields(fake(["customfield_10030"]), { startDate: "customfield_10015", theme: "customfield_10030", dueDate: "customfield_10016" });
    expect(r.map).toEqual({ theme: "customfield_10030", off: ["jira.dueDate"] });
    expect(r.notes).toEqual(["Start date not sent: the Jira field customfield_10015 no longer exists on this site. Choose another one in the field configuration.", "Due date not sent: the Jira field customfield_10016 no longer exists on this site. Choose another one in the field configuration."]);
    const f = buildJiraPayload({ item: ITEM, fields: r.map }).fields;
    expect(Object.keys(f).some((k) => k.startsWith("customfield_10015") || k === "customfield_10016" || k === "duedate")).toBe(false);
    expect(f.customfield_10030).toBe("Payments");
  });
  it("leaves the map alone when the site's fields can not be read", async () => {
    const m = { startDate: "customfield_10015" };
    expect(await dropMissingFields(fake([], 500), m)).toEqual({ map: m, notes: [] });
  });
  it("reads a site's fields once for a whole preview when given a cache key", async () => {
    const f = fake(["customfield_10015"]);
    const m = { startDate: "customfield_10015" };
    let t = 1_000_000;
    for (let n = 0; n < 5; n++) await dropMissingFields(f, m, { cacheKey: "c1|s1", now: () => t });
    expect(f.calls).toEqual(["/field"]);
    t += 61_000;
    await dropMissingFields(f, m, { cacheKey: "c1|s1", now: () => t });
    expect(f.calls).toHaveLength(2);
  });
});
