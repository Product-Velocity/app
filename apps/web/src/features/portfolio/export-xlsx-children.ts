import { isOpenableUrl, type FieldDef } from "@pv/domain";
import { excelDateFormat, trackerOf, xlsxCell } from "./export-xlsx";
import type { GridItem, IssueTreeRow, JiraTreeRow, Lookups } from "./types";

/** One tracker issue under an initiative's linked issue, in the shape the report prints (Jira and GitHub alike). */
export type ReportChild = { key: string; type: string; title: string; status: string; group: "To Do" | "In Progress" | "Done" | ""; assignee: string; url: string | null; updatedAt: string | null };

export type ReportChildren = { jira: Record<string, JiraTreeRow[]>; github: Record<string, IssueTreeRow[]> };

const GROUP = { new: "To Do", indeterminate: "In Progress", done: "Done" } as const;

/**
 * The first-level children of an initiative's linked issue. Jira first, as in the grid. Today these are the stories and tasks under a linked epic;
 * once an initiative is linked to a tracker issue above the epics (issue #431) they are the epics, with no change here. The row type is the
 * tracker's own issue type ("Epic", "Story"), and GitHub's first level is its epics.
 */
export function childrenOf(row: GridItem, children: ReportChildren): ReportChild[] {
  const j = children.jira[row.id];
  if (j && j.length > 0) {
    return j.map((c) => ({ key: c.key, type: c.type ?? "Issue", title: c.title, status: c.status ?? "", group: c.category ? GROUP[c.category] : "", assignee: c.assignee ?? "", url: c.url, updatedAt: c.updatedAt }));
  }
  const g = children.github[row.id] ?? [];
  return g.map((c) => ({
    key: `${c.repo}#${c.number}`, type: "Epic", title: c.title, status: c.state === "closed" ? "Closed" : "Open", group: c.state === "closed" ? "Done" : "",
    assignee: c.assignees.join(", "), url: `https://github.com/${c.repo}/issues/${c.number}`, updatedAt: c.updatedAt,
  }));
}

/** The tracker status of the initiative's own linked issue, to sit in the same columns as the children's. */
function ownStatus(row: GridItem, lookups: Lookups): { status: string; group: ReportChild["group"] } {
  const gh = lookups.github?.links[row.id];
  if (gh) {
    const closed = gh.ghState === "closed_completed" || gh.ghState === "closed_not_planned";
    return { status: closed ? "Closed" : gh.ghState === "open" ? "Open" : "", group: closed ? "Done" : "" };
  }
  const jira = lookups.jira?.links[row.id];
  if (jira) return { status: jira.status ?? "", group: jira.category ? GROUP[jira.category] : "" };
  return { status: "", group: "" };
}

type Cell = ReturnType<typeof xlsxCell>;
type Col = { header: string; width: number; initiative: (r: GridItem, kids: ReportChild[]) => Cell; child: (c: ReportChild, parent: GridItem) => Cell };

const link = (text: string, url: string | null): Cell => ({ value: url && isOpenableUrl(url) ? { text, hyperlink: url } : text });
const text = (v: string): Cell => ({ value: v === "" ? null : v });
const day = (v: string | null): Cell => (v && !Number.isNaN(Date.parse(v)) ? { value: new Date(v), numFmt: excelDateFormat() } : { value: null });

/**
 * "Roadmap with epics": one row per initiative with its linked tracker issues as collapsible child rows beneath it (Excel outline level 1,
 * the 1/2 buttons at the top left), like the Refinery89 roadmap sheet. Leading columns: ID, Row Level, Parent / Group ID, the name, the tracker
 * issue (a link), its status and status group, assignee, last updated, and how many issues are linked; then the initiative fields of the view
 * (they stay empty on child rows). Header bold, frozen and filterable. ExcelJS is loaded only when the file is asked for.
 * Read only: nothing here writes to a tracker.
 */
export async function selectionToXlsxWithChildren(rows: GridItem[], fields: FieldDef[], lookups: Lookups, children: ReportChildren, sheetName = "Roadmap with epics"): Promise<Blob> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "Product Velocity";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Roadmap with epics");
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };

  const lead: Col[] = [
    { header: "ID", width: 14, initiative: (r) => text(String(r.item_code ?? "")), child: (c) => link(c.key, c.url) },
    { header: "Row Level", width: 12, initiative: () => text("Initiative"), child: (c) => text(c.type) },
    { header: "Parent / Group ID", width: 16, initiative: () => ({ value: null }), child: (_c, p) => text(String(p.item_code ?? "")) },
    { header: "Initiative / Epic Name", width: 46, initiative: (r) => text(String(r.initiative_name ?? "")), child: (c) => text(c.title) },
    { header: "Tracker issue", width: 14, initiative: (r) => { const t = trackerOf(r, lookups); return t ? link(t.label, t.url) : { value: null }; }, child: (c) => link(c.key, c.url) },
    { header: "Tracker status", width: 22, initiative: (r) => text(ownStatus(r, lookups).status), child: (c) => text(c.status) },
    { header: "Status group", width: 13, initiative: (r) => text(ownStatus(r, lookups).group), child: (c) => text(c.group) },
    { header: "Assignee", width: 22, initiative: () => ({ value: null }), child: (c) => text(c.assignee) },
    { header: "Last updated", width: 13, initiative: () => ({ value: null }), child: (c) => day(c.updatedAt) },
    { header: "Linked issues (#)", width: 10, initiative: (_r, kids) => (kids.length > 0 ? { value: kids.length, numFmt: "0" } : { value: null }), child: () => ({ value: null }) },
  ];
  const rest = fields.filter((f) => f.key !== "item_code" && f.key !== "initiative_name");
  const cols: Col[] = [
    ...lead,
    ...rest.map((f): Col => ({ header: f.name, width: Math.min(60, Math.max(12, f.name.length + 2)), initiative: (r) => xlsxCell(f, r, lookups), child: () => ({ value: null }) })),
  ];

  const header = ws.addRow(cols.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FF1F2937" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F6" } }; c.border = { bottom: { style: "thin", color: { argb: "FFB8C0CF" } } }; });

  const widths = cols.map((c) => c.width);
  const put = (cells: Cell[], opts: { child: boolean }) => {
    const out = ws.addRow(cells.map((c) => c.value));
    cells.forEach((cell, i) => {
      const x = out.getCell(i + 1);
      if (cell.numFmt) x.numFmt = cell.numFmt;
      if (cell.wrap) x.alignment = { wrapText: true, vertical: "top" };
      if (typeof cell.value === "object" && cell.value !== null && "hyperlink" in cell.value) x.font = { color: { argb: "FF1A56C4" }, underline: true };
      const len = cell.value instanceof Date ? 12 : typeof cell.value === "object" && cell.value !== null ? cell.value.text.length : String(cell.value ?? "").length;
      if (i >= lead.length) widths[i] = Math.min(60, Math.max(widths[i]!, len + 2));
    });
    if (opts.child) {
      out.outlineLevel = 1;
      out.eachCell((x) => { if (!(typeof x.value === "object" && x.value !== null && "hyperlink" in x.value)) x.font = { color: { argb: "FF4B5563" } }; });
    } else {
      out.font = { bold: true };
      out.eachCell((x) => { if (typeof x.value === "object" && x.value !== null && "hyperlink" in x.value) x.font = { bold: true, color: { argb: "FF1A56C4" }, underline: true }; });
    }
  };

  let total = 0;
  for (const r of rows) {
    const kids = childrenOf(r, children);
    put(cols.map((c) => c.initiative(r, kids)), { child: false });
    total += 1;
    for (const k of kids) { put(cols.map((c) => c.child(k, r)), { child: true }); total += 1; }
  }
  ws.columns.forEach((col, i) => { col.width = widths[i]!; });
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 4 }];
  if (total > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: total + 1, column: cols.length } };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
