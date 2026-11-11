import { describe, expect, it } from "vitest";
import { buildJiraPayload, mergeLabels } from "@/lib/atlassian/outbound";
import { markerFor, planJiraSend } from "@/lib/atlassian/jira-sync-core";
import { findByMarker } from "@/lib/atlassian/jira-issue";
import { addRemovedLabel } from "@/lib/atlassian/jira-close";
import { effectiveJiraMap, githubOptions, namesFromRows, parseConfigRows, type ConfigRow } from "./mapping";
import { buildMappingView } from "./view";

// Stealth mode (issue #411) on the Jira side, and how saved rows turn into names for both trackers.
const ROWS: ConfigRow[] = [
  { slot: "jira.label.moscow", enabled: true, field: null, text: "moscow/" }, { slot: "jira.label.rank", enabled: true, field: null, text: "rank/" },
  { slot: "jira.label.base", enabled: false, field: null }, { slot: "jira.name.removed", enabled: true, field: null, text: "removed" }, { slot: "jira.name.marker", enabled: true, field: null, text: "ref/" },
];
const item = { initiative_name: "Checkout", moscow: "Must", stack_rank: 3, initiative_phase: "Define" };

describe("rows to names", () => {
  it("no rows is no names, so the builders send what they always sent", () => {
    expect(namesFromRows([], "jira")).toEqual({});
    expect(effectiveJiraMap({}, [])).toEqual({});
    expect(githubOptions([])).toEqual({});
  });
  it("Jira rows", () => {
    expect(namesFromRows(ROWS, "jira")).toEqual({ prefix: { moscow: "moscow/", rank: "rank/" }, base: "", removed: "removed", jiraMarker: "ref/" });
    expect(effectiveJiraMap({}, ROWS).names).toBeDefined();
  });
  it("GitHub rows: the marker word and hiding the brand; a Jira row is ignored", () => {
    const gh = parseConfigRows([{ slot: "github.name.block", enabled: true, field: null, text: "sync" }, { slot: "github.hideBrand", enabled: true, field: null }, { slot: "jira.label.moscow", enabled: true, field: null, text: "m/" }], "github");
    expect(githubOptions(gh).names).toEqual({ block: "sync", hideBrand: true });
  });
  it("stored rows are never trusted: a bad text or a text on a slot without one is dropped", () => {
    expect(parseConfigRows([{ slot: "jira.label.moscow", enabled: true, field: null, text: "bad text" }, { slot: "jira.dueDate", enabled: true, field: null, text: "x" }], "jira")).toEqual([]);
  });
});

describe("Jira under other names", () => {
  const map = effectiveJiraMap({}, ROWS);
  it("labels, no base label, and a changed marker", () => {
    const p = buildJiraPayload({ item, fields: map, projectName: "Platform" });
    expect(p.fields.labels).toEqual(["pv:project/platform", "moscow/must", "rank/top-10", "pv:define"]);
  });
  it("labels written under the old names are removed on update; people's labels and the removed label stay", () => {
    const merged = mergeLabels(["team-a", "product-velocity", "pv:moscow/should", "removed", "pv:removed"], ["moscow/must"], map.names);
    expect(merged).toEqual(["team-a", "removed", "pv:removed", "moscow/must"]);
  });
  it("a create carries the marker under the chosen prefix, and it is found again by it", async () => {
    const plan = planJiraSend({ pv: { id: "i1", name: "Checkout", description: null, moscow: "Must" }, jira: null, base: null, map, create: { projectKey: "PLAT", issueTypeId: "10001" } } as never);
    expect(plan.marker).toMatch(/^ref\/[0-9a-f]{16}$/);
    expect(plan.marker).toBe(markerFor("i1", "ref/"));
    expect(plan.fields.labels as string[]).toContain(plan.marker);
    const jqls: string[] = [];
    const call = async (_m: string, path: string) => { jqls.push(decodeURIComponent(path)); return { status: 200, json: { issues: [{ key: "PLAT-9", id: "5" }] } }; };
    expect(await findByMarker(call as never, "PLAT", plan.marker!)).toEqual({ key: "PLAT-9", id: "5" });
    expect(jqls[0]).toContain(`labels = "${plan.marker}"`);
    expect(markerFor("i1")).toMatch(/^pv:item\//); // default unchanged
  });
  it("the removed label added after a confirmed close uses the chosen name", async () => {
    const sent: unknown[] = [];
    const call = async (_m: string, _p: string, body?: unknown) => { sent.push(body); return { status: 204, json: {} }; };
    expect(await addRemovedLabel(call as never, "PLAT-1", undefined, { removed: "removed" })).toEqual({ ok: true });
    expect(sent).toEqual([{ update: { labels: [{ add: "removed" }] } }]);
  });
});

describe("the view", () => {
  it("label rows carry their text and the names card lists the rest", () => {
    const v = buildMappingView({ tracker: "jira", rows: parseConfigRows(ROWS, "jira"), choices: null });
    const moscow = v.changeable.find((r) => r.id === "jira.label.moscow")!;
    expect(moscow.control).toMatchObject({ type: "toggle", text: { value: "moscow/", default: "pv:moscow/" } });
    expect(moscow.isDefault).toBe(false);
    expect(v.names.map((n) => n.id)).toEqual(["jira.label.base", "jira.name.removed", "jira.name.define", "jira.name.marker"]);
    expect(v.names.find((n) => n.id === "jira.label.base")).toMatchObject({ on: false });
    const gh = buildMappingView({ tracker: "github", rows: [], choices: null });
    expect(gh.names.map((n) => n.id)).toEqual(["github.label.base", "github.name.removed", "github.name.define", "github.name.block", "github.hideBrand"]);
  });
});
