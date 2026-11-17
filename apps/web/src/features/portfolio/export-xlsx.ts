import { dateFormatHint, isOpenableUrl, trackerIssueLabel, type FieldDef } from "@pv/domain";
import type { GridItem, Lookups } from "./types";

type Cell = { value: string | number | Date | { text: string; hyperlink: string } | null; numFmt?: string; wrap?: boolean };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIME = /^\d{4}-\d\d-\d\dT/;

/** The person's date format as an Excel number format (the grid's "31 Mar" style needs the year in a file, so it gets "d mmm yyyy"). */
export function excelDateFormat(hint: string = dateFormatHint()): string {
  switch (hint) {
    case "dd/mm/yyyy": return "dd/mm/yyyy";
    case "mm/dd/yyyy": return "mm/dd/yyyy";
    case "yyyy-mm-dd": return "yyyy-mm-dd";
    default: return "d mmm yyyy";
  }
}

/** The tracker issue an item follows or owns: its label (`#12`, `PV-34`) and web address, GitHub first as in the grid. */
export function trackerOf(row: GridItem, lookups: Lookups): { label: string; url: string | null } | null {
  const gh = lookups.github?.links[row.id];
  const ghLabel = gh ? trackerIssueLabel(gh.url, gh.number) : null;
  if (gh && ghLabel) return { label: ghLabel, url: isOpenableUrl(gh.url) ? gh.url : null };
  const jira = lookups.jira?.links[row.id];
  if (jira) return { label: jira.issueKey, url: isOpenableUrl(jira.url) ? jira.url : null };
  return null;
}

/** One field value as a typed cell: real dates, real numbers (with a number format), names for people and projects. Text stays text, so nothing is read as a formula. */
export function xlsxCell(f: FieldDef, row: GridItem, lookups: Lookups): Cell {
  const v = row[f.key];
  if (v === null || v === undefined || v === "") return { value: null };
  if (f.key === "home_project") return { value: lookups.projects.find((p) => p.id === v)?.name ?? String(v) };
  if (f.type === "Person") return { value: lookups.members.find((m) => m.user_id === v)?.email ?? String(v) };
  if (typeof v === "boolean") return { value: v ? "Yes" : "No" };
  if (typeof v === "number") {
    if (f.key === "stack_rank" || f.key === "project_rank") return { value: v, numFmt: "0" };
    if (f.key.endsWith("_pct")) return { value: v, numFmt: Number.isInteger(v) ? '0"%"' : '0.00"%"' };
    if (f.key.endsWith("_pp")) return { value: v, numFmt: Number.isInteger(v) ? '0" pp"' : '0.00" pp"' };
    return { value: v, numFmt: Number.isInteger(v) ? "#,##0" : "#,##0.00" };
  }
  if (typeof v === "object") return { value: JSON.stringify(v) };
  const s = String(v);
  const day = s.match(ISO_DAY);
  if (day && (f.type === "Date" || f.type === "Computed" || f.type === "System")) return { value: new Date(Date.UTC(+day[1]!, +day[2]! - 1, +day[3]!)), numFmt: excelDateFormat() };
  if (ISO_TIME.test(s) && !Number.isNaN(Date.parse(s))) return { value: new Date(s), numFmt: `${excelDateFormat()} hh:mm` };
  return { value: s, wrap: f.type === "Long text" };
}

/**
 * The shown rows as an .xlsx file: the same columns as the CSV, but dates are dates, numbers are numbers (so they sort, sum and chart),
 * and the linked GitHub or Jira issue is a clickable link in a "Tracker issue" column beside Initiative ID. The header is bold, frozen and filterable.
 * ExcelJS is loaded only when someone asks for the file.
 */
export async function selectionToXlsx(rows: GridItem[], fields: FieldDef[], lookups: Lookups, sheetName = "Roadmap"): Promise<Blob> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "Product Velocity";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Roadmap");

  const withTracker = rows.some((r) => trackerOf(r, lookups) !== null);
  type Col = { header: string; cell: (r: GridItem) => Cell };
  const cols: Col[] = [];
  for (const f of fields) {
    cols.push({ header: f.name, cell: (r) => xlsxCell(f, r, lookups) });
    if (f.key === "item_code" && withTracker) cols.push(TRACKER_COL(lookups));
  }
  if (withTracker && !fields.some((f) => f.key === "item_code")) cols.push(TRACKER_COL(lookups));

  const header = ws.addRow(cols.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FF1F2937" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F6" } }; c.border = { bottom: { style: "thin", color: { argb: "FFB8C0CF" } } }; });

  const widths = cols.map((c) => Math.min(60, Math.max(10, c.header.length + 2)));
  for (const r of rows) {
    const out = ws.addRow(cols.map((c) => c.cell(r).value));
    cols.forEach((c, i) => {
      const cell = c.cell(r);
      const x = out.getCell(i + 1);
      if (cell.numFmt) x.numFmt = cell.numFmt;
      if (cell.wrap) x.alignment = { wrapText: true, vertical: "top" };
      if (typeof cell.value === "object" && cell.value !== null && "hyperlink" in cell.value) x.font = { color: { argb: "FF1A56C4" }, underline: true };
      const len = cell.value instanceof Date ? 12 : typeof cell.value === "object" && cell.value !== null ? cell.value.text.length : String(cell.value ?? "").length;
      widths[i] = Math.min(60, Math.max(widths[i]!, len + 2));
    });
  }
  ws.columns.forEach((col, i) => { col.width = widths[i]!; });
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: Math.min(2, cols.length) }];
  if (rows.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const TRACKER_COL = (lookups: Lookups) => ({
  header: "Tracker issue",
  cell: (r: GridItem): Cell => {
    const t = trackerOf(r, lookups);
    if (!t) return { value: null };
    return { value: t.url ? { text: t.label, hyperlink: t.url } : t.label };
  },
});

/** Save a file the browser has made. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
