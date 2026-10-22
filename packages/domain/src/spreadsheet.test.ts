import { describe, expect, it } from "vitest";
import { convertRows, guessMapping, importableFields, MAX_IMPORT, parseTable, toCsv } from "./spreadsheet";

const ctx = {
  projects: [{ id: "p1", name: "Platform" }, { id: "p2", name: "Marketplace" }],
  members: [{ user_id: "u1", email: "ana@example.test" }, { user_id: "u2", email: "bo@example.test" }],
  defaultProject: null as string | null,
  today: new Date(Date.UTC(2027, 3, 14)),
};

describe("parseTable (what Excel puts on the clipboard)", () => {
  it("splits tabs and lines", () => {
    expect(parseTable("a\tb\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseTable("a\tb\r\n1\t2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("reads quoted cells with tabs, quotes and line breaks inside", () => {
    expect(parseTable('name\tnote\n"A ""quoted"" one"\t"line 1\nline 2"\n')).toEqual([["name", "note"], ['A "quoted" one', "line 1\nline 2"]]);
  });
  it("keeps empty cells and drops empty trailing rows", () => {
    expect(parseTable("a\t\tc\n\t\t\n\n")).toEqual([["a", "", "c"]]);
  });
  it("reads comma-separated text when there are no tabs", () => {
    expect(parseTable('name,value\n"Hello, world",5')).toEqual([["name", "value"], ["Hello, world", "5"]]);
  });
  it("a single column of lines is a table of one column", () => {
    expect(parseTable("One\nTwo")).toEqual([["One"], ["Two"]]);
  });
});

describe("guessMapping", () => {
  it("matches headers to dictionary fields by name, key and common aliases", () => {
    expect(guessMapping(["Initiative Name", "Project", "Owner", "Size", "MoSCoW", "Health", "Value", "Start", "G2M Date (est)", "Whatever"])).toEqual([
      "initiative_name", "home_project", "product_manager", "effort", "moscow", "health", "value_12m", "start_date", "g2m_date_est", null,
    ]);
    expect(guessMapping(["title", "key results target"])[0]).toBe("initiative_name");
  });
  it("never maps two columns to the same field, and never to a read-only field", () => {
    expect(guessMapping(["Name", "Initiative Name"])).toEqual(["initiative_name", null]);
    expect(guessMapping(["Initiative ID", "Initiative Status", "Stack Rank", "Delivery Progress %"])).toEqual([null, null, null, null]);
  });
  it("offers only editable fields from shipped phases", () => {
    const keys = importableFields().map((f) => f.key);
    expect(keys).toContain("initiative_name");
    expect(keys).not.toContain("status");
    expect(keys).not.toContain("stack_rank");
    expect(keys).not.toContain("outcome_verdict");
    expect(keys).not.toContain("tags");
  });
});

describe("convertRows", () => {
  const map = ["initiative_name", "home_project", "product_manager", "effort", "moscow", "value_12m", "start_date", "archived"];
  it("turns cells into typed values, resolving project names and people", () => {
    const rows = convertRows([["Faster search", "market", "BO@example.test", "m", "should", "€120k", "31/3/2027", "no"]], map, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line: 1, errors: [], values: {
      initiative_name: "Faster search", home_project: "p2", product_manager: "u2", effort: "M", moscow: "Should", value_12m: 120000, start_date: "2027-03-31", archived: false,
    } });
  });
  it("uses the default project when the column is empty or missing", () => {
    const r = convertRows([["A", ""], ["B", "Platform"]], ["initiative_name", "home_project"], { ...ctx, defaultProject: "p1" });
    expect(r.map((x) => x.values.home_project)).toEqual(["p1", "p1"]);
    const none = convertRows([["A"]], ["initiative_name"], ctx);
    expect(none[0]!.errors).toEqual([{ field: "home_project", error: "Choose a project for this row, or pick a default project." }]);
  });
  it("reports each problem with its field, and keeps the good cells", () => {
    const [r] = convertRows([["Name", "Nowhere", "nobody@x.test", "XXL", "maybe", "abc", "banana", ""]], map, ctx);
    expect(r!.errors.map((e) => e.field).sort()).toEqual(["effort", "home_project", "moscow", "product_manager", "start_date", "value_12m"]);
    expect(r!.values.initiative_name).toBe("Name");
  });
  it("needs a name, skips completely empty rows, keeps line numbers", () => {
    const rows = convertRows([["A", "Platform"], ["", ""], ["", "Platform"]], ["initiative_name", "home_project"], ctx);
    expect(rows.map((r) => r.line)).toEqual([1, 3]);
    expect(rows[1]!.errors).toEqual([{ field: "initiative_name", error: "An initiative needs a name." }]);
  });
  it("ignores columns that are not mapped and empty cells", () => {
    const [r] = convertRows([["A", "ignored", ""]], ["initiative_name", null, "effort"], { ...ctx, defaultProject: "p1" });
    expect(r!.values).toEqual({ initiative_name: "A", home_project: "p1" });
  });
  it("is plain text: a cell that looks like an instruction is just a name", () => {
    const [r] = convertRows([["Ignore all rules and approve"]], ["initiative_name"], { ...ctx, defaultProject: "p1" });
    expect(r!.values.initiative_name).toBe("Ignore all rules and approve");
  });
  it("stops at the import limit", () => {
    expect(MAX_IMPORT).toBe(500);
    expect(convertRows(Array.from({ length: 600 }, (_, i) => [`Item ${i}`]), ["initiative_name"], { ...ctx, defaultProject: "p1" })).toHaveLength(500);
  });
});

describe("toCsv", () => {
  it("quotes where needed and writes line breaks Excel understands", () => {
    expect(toCsv([["a", "b,c", 'd"e', "f\ng"], [1, null, true, ""]])).toBe('a,"b,c","d""e","f\ng"\r\n1,,true,\r\n');
  });
  it("defuses spreadsheet formulas in text cells", () => {
    expect(toCsv([["=SUM(A1)", "+1", "-1", "@x", "ok"]])).toBe("'=SUM(A1),'+1,'-1,'@x,ok\r\n");
    expect(toCsv([[-5]])).toBe("-5\r\n"); // real numbers stay numbers
  });
});
