import { describe, expect, it } from "vitest";
import { FIELD_BY_KEY } from "@pv/domain";
import { selectionToCsv } from "./export-selection";
import type { GridItem } from "./types";

const lookups = { projects: [{ id: "p1", name: "Platform" }], members: [{ user_id: "u1", email: "ana@example.test" }] };
const row = (o: Record<string, unknown>) => ({ id: "i", item_code: "R-01", initiative_name: "A", stack_rank: 1, project_rank: 1, home_project: "p1", ...o }) as GridItem;
const fields = ["item_code", "initiative_name", "home_project", "product_manager", "value_12m", "archived"].map((k) => FIELD_BY_KEY[k]!);

describe("selectionToCsv", () => {
  it("writes the shown columns with their dictionary names and readable values", () => {
    const csv = selectionToCsv([row({ product_manager: "u1", value_12m: 1200.5, archived: false }), row({ item_code: "R-02", initiative_name: "B, with comma" })], fields, lookups);
    expect(csv).toBe(
      'Initiative ID,Initiative Name,Home Project,Product Manager,"Value (EUR, 12-month run-rate)",Archived\r\n' +
      "R-01,A,Platform,ana@example.test,1200.5,false\r\n" +
      'R-02,"B, with comma",Platform,,,\r\n',
    );
  });
  it("defuses names that look like spreadsheet formulas", () => {
    expect(selectionToCsv([row({ initiative_name: "=HYPERLINK(\"http://x\")" })], [FIELD_BY_KEY.initiative_name!], lookups)).toContain("'=HYPERLINK");
  });
});
