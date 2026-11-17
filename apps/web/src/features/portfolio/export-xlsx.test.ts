import { describe, expect, it } from "vitest";
import { Workbook } from "exceljs";
import { FIELD_BY_KEY } from "@pv/domain";
import { excelDateFormat, selectionToXlsx } from "./export-xlsx";
import type { GridItem } from "./types";

const lookups = {
  projects: [{ id: "p1", name: "Platform" }],
  members: [{ user_id: "u1", email: "ana@example.test" }],
  jira: { links: { i1: { mode: "push" as const, issueKey: "PV-34", url: "https://acme.atlassian.net/browse/PV-34", status: null, category: null, lastSynced: null } } },
  github: { connected: true, links: { i2: { mode: "push" as const, number: 7, url: "https://github.com/acme/road/issues/7", state: "synced" as const, error: null, ghState: "open" as const, lastActivity: null } } },
};
const row = (o: Record<string, unknown>) => ({ id: "i1", item_code: "R-01", initiative_name: "A", stack_rank: 1, project_rank: 1, home_project: "p1", ...o }) as GridItem;
const fields = ["item_code", "initiative_name", "home_project", "product_manager", "value_12m", "planned_start", "archived"].map((k) => FIELD_BY_KEY[k]!);

async function read(rows: GridItem[]) {
  const blob = await selectionToXlsx(rows, fields, lookups);
  const wb = new Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb.worksheets[0]!;
}

describe("selectionToXlsx", () => {
  it("keeps numbers, dates and ticket links as real typed cells", async () => {
    const ws = await read([
      row({ product_manager: "u1", value_12m: 1200.5, planned_start: "2027-03-31", archived: false }),
      row({ id: "i2", item_code: "R-02", initiative_name: "=SUM(1,2)", value_12m: 3000 }),
    ]);
    expect(ws.getRow(1).values).toEqual([undefined, "Initiative ID", "Tracker issue", "Initiative Name", "Project", "Product Manager", "Business Value (12m run-rate)", "Planned Start", "Archived"]);
    const r2 = ws.getRow(2);
    expect(r2.getCell(1).value).toBe("R-01");
    expect(r2.getCell(2).value).toEqual({ text: "PV-34", hyperlink: "https://acme.atlassian.net/browse/PV-34" });
    expect(r2.getCell(4).value).toBe("Platform");
    expect(r2.getCell(5).value).toBe("ana@example.test");
    expect(r2.getCell(6).value).toBe(1200.5);
    expect(r2.getCell(6).numFmt).toBe("#,##0.00");
    const date = r2.getCell(7).value as Date;
    expect(date).toBeInstanceOf(Date);
    expect(date.toISOString().slice(0, 10)).toBe("2027-03-31");
    expect(r2.getCell(7).numFmt).toBe(excelDateFormat());
    expect(r2.getCell(8).value).toBe("No");
    const r3 = ws.getRow(3);
    expect(r3.getCell(2).value).toEqual({ text: "#7", hyperlink: "https://github.com/acme/road/issues/7" });
    expect(r3.getCell(3).value).toBe("=SUM(1,2)"); // stays text, never a formula
    expect(r3.getCell(6).numFmt).toBe("#,##0");
  });
  it("freezes and filters the header row", async () => {
    const ws = await read([row({})]);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
  });
});
