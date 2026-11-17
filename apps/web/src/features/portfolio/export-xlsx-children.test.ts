import { describe, expect, it } from "vitest";
import { Workbook } from "exceljs";
import { FIELD_BY_KEY } from "@pv/domain";
import { childrenOf, selectionToXlsxWithChildren } from "./export-xlsx-children";
import type { GridItem, IssueTreeRow, JiraTreeRow } from "./types";

const lookups = {
  projects: [{ id: "p1", name: "Platform" }],
  members: [],
  jira: { links: { i1: { mode: "follow" as const, issueKey: "R8P-1", url: "https://acme.atlassian.net/browse/R8P-1", status: "Project Execution", category: "indeterminate" as const, lastSynced: null } } },
  github: { connected: true, links: { i2: { mode: "push" as const, number: 7, url: "https://github.com/acme/road/issues/7", state: "synced" as const, error: null, ghState: "open" as const, lastActivity: null } } },
};
const row = (o: Record<string, unknown>) => ({ id: "i1", item_code: "R-01", initiative_name: "Takeover fix", stack_rank: 1, project_rank: 1, home_project: "p1", ...o }) as GridItem;
const fields = ["item_code", "initiative_name", "home_project", "moscow"].map((k) => FIELD_BY_KEY[k]!);
const jira = (key: string, o: Partial<JiraTreeRow> = {}): JiraTreeRow => ({ key, parentKey: "R8P-1", level: 1, position: 0, title: `Title ${key}`, type: "Epic", status: "In Progress", category: "indeterminate", assignee: "Ana", url: `https://acme.atlassian.net/browse/${key}`, updatedAt: "2026-11-12T10:00:00Z", ...o });
const gh = (n: number, o: Partial<IssueTreeRow> = {}): IssueTreeRow => ({ repo: "acme/road", number: n, parentNumber: 7, level: 1, title: `Epic ${n}`, state: "open", stateReason: null, assignees: ["ana"], createdBy: "engineer", updatedAt: "2026-11-12T10:00:00Z", ...o });

async function read(rows: GridItem[], children: { jira?: Record<string, JiraTreeRow[]>; github?: Record<string, IssueTreeRow[]> }) {
  const blob = await selectionToXlsxWithChildren(rows, fields, lookups, { jira: children.jira ?? {}, github: children.github ?? {} });
  const wb = new Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb.worksheets[0]!;
}

describe("childrenOf", () => {
  it("maps Jira status categories to the sheet's status groups and prefers Jira over GitHub", () => {
    const r = row({});
    const kids = childrenOf(r, { jira: { i1: [jira("R8P-2", { category: "new" }), jira("R8P-3", { category: "done" }), jira("R8P-4", { category: null, type: null })] }, github: { i1: [gh(1)] } });
    expect(kids.map((k) => [k.key, k.group, k.type])).toEqual([["R8P-2", "To Do", "Epic"], ["R8P-3", "Done", "Epic"], ["R8P-4", "", "Issue"]]);
  });
  it("reads GitHub's first level as epics, closed ones as Done and open ones without a made-up group", () => {
    const kids = childrenOf(row({ id: "i2" }), { jira: {}, github: { i2: [gh(1), gh(2, { state: "closed" })] } });
    expect(kids.map((k) => [k.key, k.type, k.status, k.group])).toEqual([["acme/road#1", "Epic", "Open", ""], ["acme/road#2", "Epic", "Closed", "Done"]]);
    expect(kids[0]!.url).toBe("https://github.com/acme/road/issues/1");
  });
  it("is empty for an initiative with no children", () => { expect(childrenOf(row({ id: "i9" }), { jira: {}, github: {} })).toEqual([]); });
});

describe("selectionToXlsxWithChildren", () => {
  it("puts each initiative first and its issues beneath it as outline level 1 rows", async () => {
    const ws = await read(
      [row({ moscow: "Must" }), row({ id: "i3", item_code: "R-02", initiative_name: "Other" })],
      { jira: { i1: [jira("R8P-2"), jira("R8P-3", { category: "done", status: "Done" })] } },
    );
    expect((ws.getRow(1).values as unknown[]).slice(1, 11)).toEqual(["ID", "Row Level", "Parent / Group ID", "Initiative / Epic Name", "Tracker issue", "Tracker status", "Status group", "Assignee", "Last updated", "Linked issues (#)"]);
    expect(ws.getRow(1).getCell(11).value).toBe("Project");
    expect(ws.getRow(1).getCell(12).value).toBe("MoSCoW");
    const [a, b, c, d] = [2, 3, 4, 5].map((i) => ws.getRow(i));
    expect(a!.getCell(1).value).toBe("R-01");
    expect(a!.getCell(2).value).toBe("Initiative");
    expect(a!.getCell(6).value).toBe("Project Execution");
    expect(a!.getCell(7).value).toBe("In Progress");
    expect(a!.getCell(10).value).toBe(2);
    expect(a!.getCell(11).value).toBe("Platform");
    expect(a!.getCell(12).value).toBe("Must");
    expect(a!.outlineLevel).toBe(0);
    expect(b!.getCell(1).value).toEqual({ text: "R8P-2", hyperlink: "https://acme.atlassian.net/browse/R8P-2" });
    expect(b!.getCell(2).value).toBe("Epic");
    expect(b!.getCell(3).value).toBe("R-01");
    expect(b!.getCell(8).value).toBe("Ana");
    expect((b!.getCell(9).value as Date).toISOString().slice(0, 10)).toBe("2026-11-12");
    expect(b!.getCell(11).value).toBeNull();
    expect(b!.outlineLevel).toBe(1);
    expect(c!.getCell(7).value).toBe("Done");
    expect(c!.outlineLevel).toBe(1);
    expect(d!.getCell(1).value).toBe("R-02");
    expect(d!.outlineLevel).toBe(0);
    expect(ws.rowCount).toBe(5);
  });

  it("keeps text that looks like a formula as text and freezes the header with a filter", async () => {
    const ws = await read([row({ initiative_name: "=SUM(1,2)" })], { jira: { i1: [jira("R8P-2", { title: "=1+1" })] } });
    expect(ws.getRow(2).getCell(4).value).toBe("=SUM(1,2)");
    expect(ws.getRow(3).getCell(4).value).toBe("=1+1");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
  });

  it("works with no children at all (one row per initiative)", async () => {
    const ws = await read([row({})], {});
    expect(ws.rowCount).toBe(2);
    expect(ws.getRow(2).getCell(10).value).toBeNull();
  });
});
