import dictionary from "./field-dictionary.json";

/**
 * The field registry: one entry per item field, in `docs/reference/item-fields.csv` order.
 * It is generated from the workbook (`tools/field-dictionary/export.py`) and checked against the CSV
 * by `registry.test.ts`, so a change to the dictionary that is not carried through fails the build.
 * The grid Columns picker, the default views and the schema tests all read from here.
 */
export type FieldType =
  | "Select" | "Text" | "Long text" | "Number" | "Currency" | "Date" | "Date range" | "Person" | "People" | "Person or text"
  | "Boolean" | "Tags" | "Links" | "Relation" | "Files" | "Thread" | "Structured" | "Note" | "System" | "Computed";
export type EditMode = "editable" | "computed" | "system" | "locked";
export const CURRENT_PHASE = 1;
export const VIEW_NAMES = ["Prioritisation", "Planning", "Delivery", "Go-to-market", "Outcomes", "Leadership", "Discovery", "History"] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export interface FieldDef {
  id: string;
  key: string;
  name: string;
  group: string;
  type: FieldType;
  storage: string;
  phase: number;
  mode: EditMode;
  /** True only for `editable` fields. */
  editable: boolean;
  customerSafe: boolean;
  allowed: string[];
  views: ViewName[];
  githubSync: string | null;
  description: string | null;
}

const MODE: Record<string, EditMode> = {
  "Editable": "editable", "Computed (read-only)": "computed", "System (read-only)": "system", "Locked (GitHub)": "locked",
};

interface Raw {
  n: string; name: string; key: string; group: string; type: string; storage: string; phase: number; editing: string;
  customerSafe: boolean; views: string[]; allowed: string[]; githubSync: string | null; description: string | null;
}

export const FIELDS: readonly FieldDef[] = (dictionary as Raw[]).map((r) => {
  const mode = MODE[r.editing];
  if (!mode) throw new Error(`Unknown editing mode "${r.editing}" for ${r.key}`);
  return {
    id: r.n, key: r.key, name: r.name, group: r.group, type: r.type as FieldType, storage: r.storage, phase: r.phase,
    mode, editable: mode === "editable", customerSafe: r.customerSafe, allowed: r.allowed,
    views: r.views as ViewName[], githubSync: r.githubSync, description: r.description,
  };
});

export const FIELD_BY_KEY: Readonly<Record<string, FieldDef>> = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

/** Column on the `items` table when it differs from the field key. Labels shown in the app come from the dictionary, never from column names. */
const COLUMN_NAME: Record<string, string> = {
  home_project: "home_project_id", // the relation stores the project id
  product_manager: "owner_user_id", // a user id (tenant member); the grid shows the person
  g2m_date_est: "end_date",
};
/** Field key for a database column of items, when the two differ. */
export const KEY_BY_COLUMN: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(COLUMN_NAME).map(([k, c]) => [c, k]));

/** Fields stored in a related table, and which one. */
const RELATED: Record<string, string> = {
  artifacts: "item_links", depends_on: "item_relations", related_to: "item_relations",
  tags: "item_tags", target_scope: "item_tags", live_scope: "item_tags", target_segments: "item_tags",
  contributing_teams: "item_teams", screenshots: "item_files",
};

const isStoredOnItems = (f: FieldDef) =>
  f.storage.startsWith("Column on items") || f.storage.startsWith("System-set column") || f.storage.startsWith("GitHub-synced column");

/** Name of the `items` column that holds this field, or null for related-table and computed fields. */
export function columnOnItems(f: FieldDef): string | null {
  if (f.key in COLUMN_NAME) return COLUMN_NAME[f.key]!;
  if (f.key in RELATED || f.type === "Note") return null; // a note documents another field; it has no column
  if (f.mode === "computed" && !f.storage.startsWith("GitHub-synced")) return null;
  return isStoredOnItems(f) ? f.key : null;
}
export function relatedTable(f: FieldDef): string | null {
  return RELATED[f.key] ?? null;
}
export const COLUMN_ON_ITEMS: readonly string[] = FIELDS.map(columnOnItems).filter((c): c is string => c !== null);

export const isShipped = (f: FieldDef) => f.phase <= CURRENT_PHASE;
export const arrivesLabel = (f: FieldDef) => (isShipped(f) ? null : `Arrives in phase ${f.phase}`);

/** Default views: the column lists of the "Grid columns and views" sheet, in grid order. */
export const DEFAULT_VIEWS: Readonly<Record<ViewName, string[]>> = Object.fromEntries(
  VIEW_NAMES.map((v) => [v, FIELDS.filter((f) => f.views.includes(v)).map((f) => f.key)]),
) as Record<ViewName, string[]>;
