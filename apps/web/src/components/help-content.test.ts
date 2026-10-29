import { describe, expect, it } from "vitest";
import { FIELDS, FIELD_BY_KEY } from "@pv/domain";
import { COLUMN_GROUPS, COLUMN_ROWS, OVERRIDE_KEYS, accessLabel } from "./help-content";

describe("Help guide columns table", () => {
  it("has exactly one row for every column in the field dictionary, in its order", () => {
    expect(COLUMN_ROWS.map((r) => r.key)).toEqual(FIELDS.map((f) => f.key));
    expect(COLUMN_ROWS.length).toBe(169);
  });
  it("gives every row text in every cell", () => {
    for (const r of COLUMN_ROWS) for (const [k, v] of Object.entries(r)) expect(v, `${r.key}.${k}`).not.toBe("");
  });
  it("keeps every group of the dictionary", () => {
    expect(COLUMN_GROUPS).toEqual([...new Set(FIELDS.map((f) => f.group))]);
  });
  it("has wording only for columns that exist", () => {
    for (const k of OVERRIDE_KEYS) expect(FIELD_BY_KEY[k], k).toBeDefined();
  });
  it("takes read-only from the dictionary, not from the text", () => {
    expect(accessLabel(["initiative_name"])).toBe("Read/write");
    expect(accessLabel(["status"])).toBe("Read-only (tracker)");
    expect(accessLabel(["item_code"])).toBe("Read-only");
    expect(accessLabel(["value_weighted"])).toBe("Read-only");
    const row = (k: string) => COLUMN_ROWS.find((r) => r.key === k)!;
    expect(row("status").access).toBe("Read-only (tracker)");
    expect(row("sponsor").access).toBe("Read/write");
  });
  it("never shows a commercial column as synced to GitHub or Jira", () => {
    for (const k of ["value_12m", "confidence", "customers_requesting", "decision", "kr_metric", "cost_of_not_doing"]) {
      const r = COLUMN_ROWS.find((x) => x.key === k)!;
      expect(r.github, k).toMatch(/never/i);
      expect(r.jira, k).toMatch(/never/i);
    }
  });
});
