import { describe, expect, it } from "vitest";
import { mapIssue, type JiraIssueRow, type SearchPage } from "./read-issues";
import { receivedLines, refreshLinkedStatuses, type ApplyResult, type ApplyRow, type RefreshDeps } from "./refresh-linked";

const SITE = "https://acme.atlassian.net";
const raw = (n: number, category: string, name: string, updated = "2026-11-02T10:00:00.000Z") => ({ id: String(100 + n), key: `PLAT-${n}`, fields: { summary: `Issue ${n}`, issuetype: { name: "Epic", hierarchyLevel: 1 }, status: { name, statusCategory: { key: category } }, updated } });

/** A fake Jira and a fake database: the database mimics jira_apply_statuses (compare before write, category to Build Status). */
function fake(jira: Record<number, ReturnType<typeof raw>>, db: Record<string, { item: string; category: string | null; status: string | null; build: string; updated: string }>) {
  const asked: string[][] = [];
  const applied: ApplyRow[][] = [];
  const upserted: JiraIssueRow[][] = [];
  const BUILD: Record<string, string> = { new: "Not started", indeterminate: "In progress", done: "Done" };
  const deps: RefreshDeps = {
    async getPage(path): Promise<SearchPage> {
      const keys = [...decodeURIComponent(path).matchAll(/"(PLAT-[0-9]+)"/g)].map((m) => m[1]!);
      asked.push(keys);
      return { issues: keys.map((k) => jira[Number(k.slice(5))]).filter((x): x is ReturnType<typeof raw> => Boolean(x)), isLast: true };
    },
    async upsert(rows) { upserted.push(rows); },
    async apply(rows): Promise<ApplyResult[]> {
      applied.push(rows);
      const out: ApplyResult[] = [];
      for (const r of rows) {
        const l = db[r.key];
        if (!l) continue;
        if (r.updated && r.updated < l.updated) { out.push({ key: r.key, item_id: l.item, stale: true, changes: {} }); continue; }
        const changes: ApplyResult["changes"] = {};
        if (r.status && r.status !== l.status) changes.jira_status = [l.status, r.status];
        const nb = r.category ? BUILD[r.category]! : l.build;
        if (nb !== l.build) changes.status = [l.build, nb];
        Object.assign(l, { category: r.category, status: r.status, build: nb, updated: r.updated ?? l.updated });
        out.push({ key: r.key, item_id: l.item, stale: false, changes });
      }
      return out;
    },
  };
  return { deps, asked, applied, upserted };
}
const link = (n: number) => ({ item_id: `item-${n}`, issue_key: `PLAT-${n}` });
const linkRow = (n: number, category: string, status: string, build: string, updated = "2026-11-01T10:00:00.000Z") => [`PLAT-${n}`, { item: `item-${n}`, category, status, build, updated }] as const;

describe("refreshing linked initiatives from Jira", () => {
  it("a status that moved in Jira moves Build Status and is reported as Received", async () => {
    const f = fake({ 1: raw(1, "indeterminate", "In Review"), 2: raw(2, "new", "To Do") }, Object.fromEntries([linkRow(1, "new", "To Do", "Not started"), linkRow(2, "new", "To Do", "Not started")]));
    const s = await refreshLinkedStatuses(f.deps, [link(1), link(2)], SITE);
    expect(s).toMatchObject({ checked: 2, changed: 1, stale: 0, missing: [] });
    expect(s.received).toEqual({ "item-1": [{ label: "Build Status", from: "Not started", to: "In progress" }, { label: "Jira status", from: "To Do", to: "In Review" }] });
  });
  it("an issue that became Done is read even though it is not open work any more", async () => {
    const f = fake({ 3: raw(3, "done", "Done") }, Object.fromEntries([linkRow(3, "indeterminate", "In Progress", "In progress")]));
    const s = await refreshLinkedStatuses(f.deps, [link(3)], SITE);
    expect(s.received["item-3"]).toEqual([{ label: "Build Status", from: "In progress", to: "Done" }, { label: "Jira status", from: "In Progress", to: "Done" }]);
    expect(f.upserted[0]![0]).toMatchObject({ key: "PLAT-3", category: "done" }); // the light record is refreshed too
  });
  it("reads 250 linked issues in 3 calls of at most 100", async () => {
    const jira = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [i + 1, raw(i + 1, "new", "To Do")]));
    const db = Object.fromEntries(Array.from({ length: 250 }, (_, i) => linkRow(i + 1, "new", "To Do", "Not started")));
    const f = fake(jira, db);
    const s = await refreshLinkedStatuses(f.deps, Array.from({ length: 250 }, (_, i) => link(i + 1)), SITE);
    expect(f.asked.map((a) => a.length)).toEqual([100, 100, 50]);
    expect(s).toMatchObject({ checked: 250, changed: 0 });
  });
  it("an unchanged answer is reported as nothing: no Received line", async () => {
    const f = fake({ 4: raw(4, "new", "To Do") }, Object.fromEntries([linkRow(4, "new", "To Do", "Not started")]));
    const s = await refreshLinkedStatuses(f.deps, [link(4)], SITE);
    expect(s).toMatchObject({ checked: 1, changed: 0, received: {} });
  });
  it("ignores an answer older than what is known", async () => {
    const f = fake({ 5: raw(5, "new", "To Do", "2026-10-01T00:00:00.000Z") }, Object.fromEntries([linkRow(5, "done", "Done", "Done", "2026-11-02T00:00:00.000Z")]));
    const s = await refreshLinkedStatuses(f.deps, [link(5)], SITE);
    expect(s).toMatchObject({ checked: 1, changed: 0, stale: 1 });
  });
  it("an issue Jira does not return is missing, never a change", async () => {
    const f = fake({}, Object.fromEntries([linkRow(6, "new", "To Do", "Not started")]));
    const s = await refreshLinkedStatuses(f.deps, [link(6)], SITE);
    expect(s).toMatchObject({ checked: 0, changed: 0, missing: ["PLAT-6"] });
    expect(f.applied).toEqual([]);
  });
  it("does not read again what was just read (the open work)", async () => {
    const f = fake({ 8: raw(8, "new", "To Do") }, Object.fromEntries([linkRow(8, "new", "To Do", "Not started"), linkRow(7, "new", "To Do", "Not started")]));
    const known = new Map([["PLAT-7", mapIssue(raw(7, "indeterminate", "Doing"), SITE)!]]);
    const s = await refreshLinkedStatuses(f.deps, [link(7), link(8)], SITE, known);
    expect(f.asked).toEqual([["PLAT-8"]]);
    expect(s.changed).toBe(1);
  });
  it("a Jira failure (sign in again) is thrown before anything is applied", async () => {
    const f = fake({}, {});
    f.deps.getPage = async () => { throw new Error("Sign in to Jira again."); };
    await expect(refreshLinkedStatuses(f.deps, [link(9)], SITE)).rejects.toThrow("Sign in");
    expect(f.applied).toEqual([]);
  });
  it("with nothing linked it does nothing", async () => {
    const f = fake({}, {});
    expect(await refreshLinkedStatuses(f.deps, [], SITE)).toMatchObject({ checked: 0 });
    expect(f.asked).toEqual([]);
  });
  it("the card lines name Build Status first", () => {
    expect(receivedLines({ jira_status: ["A", "B"], status: ["Not started", "Done"] }).map((l) => l.label)).toEqual(["Build Status", "Jira status"]);
  });
});
