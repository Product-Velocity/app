import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALL_DEFAULT_VIEWS, COLUMN_ON_ITEMS, DEFAULT_VIEWS, WAITING_IN_VIEW, KEY_BY_COLUMN, FIELDS, FIELD_BY_KEY, VIEW_NAMES, arrivesLabel, columnOnItems, isShipped, relatedTable,
} from "./registry";

/** Minimal CSV reader for docs/reference/item-fields.csv (quoted fields, no embedded newlines). */
function parseCsv(text: string): Record<string, string>[] {
  const rows = text.trim().split(/\r?\n/).map((line) => {
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    return cells;
  });
  const head = rows[0]!;
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const csv = parseCsv(readFileSync(new URL("../../../docs/reference/item-fields.csv", import.meta.url), "utf8"));

describe("field registry matches docs/reference/item-fields.csv", () => {
  it("has the same fields in the same order", () => {
    expect(FIELDS.map((f) => f.key)).toEqual(csv.map((r) => r.key));
    expect(FIELDS).toHaveLength(165);
  });
  it("has the same id, type, storage and phase for every field", () => {
    for (const r of csv) {
      const f = FIELD_BY_KEY[r.key!]!;
      expect({ key: r.key, id: f.id, type: f.type, storage: f.storage, phase: f.phase })
        .toEqual({ key: r.key, id: r.id, type: r.type, storage: r.storage, phase: Number(r.ships_in_phase) });
    }
  });
  it("has the same allowed values for every select", () => {
    for (const r of csv) {
      const f = FIELD_BY_KEY[r.key!]!;
      if (f.type === "Select" && r.allowed_values && r.allowed_values.includes("·")) {
        expect(f.allowed, r.key).toEqual(r.allowed_values.split(" · ").map((v) => v.trim()));
      }
    }
  });
});

describe("registry rules", () => {
  it("gives every field exactly one edit mode and locks the GitHub-driven ones", () => {
    for (const f of FIELDS) expect(["editable", "computed", "system", "locked"]).toContain(f.mode);
    expect(FIELD_BY_KEY.status!.mode).toBe("locked");
    expect(FIELD_BY_KEY.initiative_name!.mode).toBe("editable");
    expect(FIELD_BY_KEY.value_weighted!.mode).toBe("computed");
    expect(FIELD_BY_KEY.item_code!.mode).toBe("system");
  });
  it("never lets a person edit a computed, system or locked field", () => {
    for (const f of FIELDS.filter((x) => x.mode !== "editable")) expect(f.editable).toBe(false);
  });
  it("knows which phase-1 fields are real columns and which live in related tables", () => {
    expect(columnOnItems(FIELD_BY_KEY.value_12m!)).toBe("value_12m");
    expect(columnOnItems(FIELD_BY_KEY.home_project!)).toBe("home_project_id");
    expect(columnOnItems(FIELD_BY_KEY.product_manager!)).toBe("owner_user_id");
    expect(columnOnItems(FIELD_BY_KEY.g2m_date_est!)).toBe("end_date");
    expect(KEY_BY_COLUMN.owner_user_id).toBe("product_manager");
    expect(columnOnItems(FIELD_BY_KEY.tags!)).toBeNull();
    expect(relatedTable(FIELD_BY_KEY.tags!)).toBe("item_tags");
    expect(relatedTable(FIELD_BY_KEY.depends_on!)).toBe("item_relations");
    expect(relatedTable(FIELD_BY_KEY.artifacts!)).toBe("item_links");
    expect(relatedTable(FIELD_BY_KEY.screenshots!)).toBe("item_files");
    expect(COLUMN_ON_ITEMS.length).toBeGreaterThan(70);
  });
  it("marks later phases as arriving", () => {
    expect(isShipped(FIELD_BY_KEY.initiative_name!)).toBe(true);
    expect(isShipped(FIELD_BY_KEY.outcome_verdict!)).toBe(false);
    expect(arrivesLabel(FIELD_BY_KEY.outcome_verdict!)).toBe("Arrives in phase 7");
    expect(arrivesLabel(FIELD_BY_KEY.initiative_name!)).toBeNull();
  });
  it("has the ten default views of R-021, in the agreed order", () => {
    expect(VIEW_NAMES).toEqual(["Prioritisation", "Planning", "Delivery", "Go-to-market", "Outcomes", "Leadership", "Discovery", "Timeline", "History", "Cycle review"]);
  });
});

describe("default views match docs/reference/default-views.csv", () => {
  const rows = parseCsv(readFileSync(new URL("../../../docs/reference/default-views.csv", import.meta.url), "utf8"));
  const inFile = (v: string) => rows.filter((r) => r.view === v);
  it("every key exists in item-fields.csv and positions run 1..n", () => {
    for (const v of VIEW_NAMES) {
      inFile(v).forEach((r, i) => {
        expect(FIELD_BY_KEY[r.key!], `${v}: ${r.key}`).toBeDefined();
        expect(Number(r.position), `${v}: ${r.key}`).toBe(i + 1);
      });
    }
    expect([...new Set(rows.map((r) => r.view))]).toEqual([...VIEW_NAMES]);
  });
  it("the code has exactly the file's keys, order and pinned columns (all phases)", () => {
    for (const v of VIEW_NAMES) {
      expect(ALL_DEFAULT_VIEWS[v].columns, v).toEqual(inFile(v).map((r) => r.key));
      expect(ALL_DEFAULT_VIEWS[v].pinned, v).toEqual(inFile(v).filter((r) => r.pinned === "pinned").map((r) => r.key));
    }
  });
  it("the first three columns of every view are pinned: Stack Rank, Initiative ID, Initiative Name", () => {
    for (const v of VIEW_NAMES) expect(ALL_DEFAULT_VIEWS[v].pinned, v).toEqual(["stack_rank", "item_code", "initiative_name"]);
  });
  it("each view has 15 to 25 columns", () => {
    for (const v of VIEW_NAMES) { expect(ALL_DEFAULT_VIEWS[v].columns.length, v).toBeGreaterThanOrEqual(15); expect(ALL_DEFAULT_VIEWS[v].columns.length, v).toBeLessThanOrEqual(25); }
  });
  it("a view shows only fields that have shipped; the others wait in their listed position", () => {
    for (const v of VIEW_NAMES) {
      expect(DEFAULT_VIEWS[v], v).toEqual(inFile(v).map((r) => r.key!).filter((k) => isShipped(FIELD_BY_KEY[k]!)));
      expect(DEFAULT_VIEWS[v].length + WAITING_IN_VIEW[v].length, v).toBe(inFile(v).length);
    }
    expect(DEFAULT_VIEWS.Delivery).not.toContain("outcome_verdict");
    expect(WAITING_IN_VIEW.Outcomes.length).toBeGreaterThan(0);
  });
  it("the pinned columns are always in the shown list, and Rank in Project keeps its position", () => {
    for (const v of VIEW_NAMES) expect(DEFAULT_VIEWS[v].slice(0, 3), v).toEqual(["stack_rank", "item_code", "initiative_name"]);
    expect(DEFAULT_VIEWS.Prioritisation[3]).toBe("project_rank");
  });
});

describe("group, editing mode and customer-safe flags match the sheet 'Grid columns and views' (docs/reference/grid-views.csv)", () => {
  const sheet = parseCsv(readFileSync(new URL("../../../docs/reference/grid-views.csv", import.meta.url), "utf8"));
  const MODE_OF: Record<string, string> = { "Editable": "editable", "Computed (read-only)": "computed", "System (read-only)": "system", "Locked (GitHub)": "locked" };
  it("lists the same 165 fields in the same order", () => {
    expect(sheet.map((r) => r.key)).toEqual(FIELDS.map((f) => f.key));
  });
  it("carries the group, editing mode and customer-safe flag of the sheet", () => {
    for (const r of sheet) {
      const f = FIELD_BY_KEY[r.key!]!;
      expect(f.group, r.key).toBe(r.group);
      expect(f.mode, r.key).toBe(MODE_OF[r.editing!]);
      expect(f.customerSafe, r.key).toBe(r.customer_safe === "Y");
    }
  });
});
