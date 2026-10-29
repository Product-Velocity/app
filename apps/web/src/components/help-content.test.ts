import { describe, expect, it } from "vitest";
import { FIELD_BY_KEY } from "@pv/domain";
import { COLUMN_ROWS, accessLabel } from "./help-content";

describe("Help guide columns table", () => {
  it("names only columns that exist in the field dictionary", () => {
    for (const r of COLUMN_ROWS) for (const k of r.keys) expect(FIELD_BY_KEY[k], k).toBeDefined();
  });
  it("takes read-only from the dictionary, not from the text", () => {
    expect(accessLabel(["initiative_name"])).toBe("Read/write");
    expect(accessLabel(["status"])).toBe("Read-only (tracker)");
    expect(accessLabel(["item_code"])).toBe("Read-only");
    expect(accessLabel(["value_weighted"])).toBe("Read-only");
  });
  it("never claims commercial fields reach GitHub or Jira", () => {
    const row = COLUMN_ROWS.find((r) => r.keys.includes("value_12m"))!;
    expect(row.github).toMatch(/never/i);
    expect(row.jira).toMatch(/never/i);
  });
});
