import { EDITABLE_FIELDS, validateEdit } from "./fields";
import { pick } from "./quickadd";
import { FIELD_BY_KEY, type FieldDef } from "./registry";

/** Most rows one paste may import. */
export const MAX_IMPORT = 500;

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let atStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && atStart) { quoted = true; atStart = false; }
    else if (c === delimiter) { row.push(cell); cell = ""; atStart = true; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = ""; atStart = true;
    } else { cell += c; atStart = false; }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  while (rows.length > 0 && rows[rows.length - 1]!.every((x) => x.trim() === "")) rows.pop();
  return rows;
}

/** What Excel or Google Sheets put on the clipboard (tab-separated), or comma-separated text. */
export function parseTable(text: string): string[][] {
  if (text.includes("\t")) return parseDelimited(text, "\t");
  const comma = parseDelimited(text, ",");
  const width = comma[0]?.length ?? 0;
  if (width > 1 && comma.every((r) => r.length === width)) return comma;
  return parseDelimited(text, "\u0000"); // one column: every line is a cell
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, string> = {
  title: "initiative_name", name: "initiative_name", initiative: "initiative_name", project: "home_project", owner: "product_manager",
  pm: "product_manager", manager: "product_manager", size: "effort", tshirt: "effort", value: "value_12m", valueeur: "value_12m",
  start: "start_date", end: "g2m_date_est", enddate: "g2m_date_est", g2m: "g2m_date_est", g2mdate: "g2m_date_est", group: "theme",
  g2mquarter: "g2m_quarter", quarter: "g2m_quarter", category: "roadmap_category", phase: "initiative_phase", sponsor: "sponsor", description: "summary",
};

/** Fields a paste can fill: the ones a person can edit in a cell today. */
export function importableFields(): FieldDef[] {
  return EDITABLE_FIELDS.map((k) => FIELD_BY_KEY[k]!).filter(Boolean);
}

/** Suggest a field for each header (null = do not import this column). A field is used at most once. */
export function guessMapping(headers: string[]): (string | null)[] {
  const fields = importableFields();
  const byName = new Map<string, string>();
  for (const f of fields) { byName.set(norm(f.name), f.key); byName.set(norm(f.key), f.key); }
  const allowed = new Set(fields.map((f) => f.key));
  const used = new Set<string>();
  return headers.map((h) => {
    const n = norm(h);
    const key = byName.get(n) ?? (ALIASES[n] && allowed.has(ALIASES[n]!) ? ALIASES[n]! : undefined);
    if (!key || used.has(key)) return null;
    used.add(key);
    return key;
  });
}

export type ImportCtx = {
  projects: { id: string; name: string }[];
  members: { user_id: string; email: string }[];
  defaultProject: string | null;
  today: Date;
};
export type ImportRow = {
  /** Row number in the pasted data (the header row is not counted). */
  line: number;
  values: Record<string, unknown>;
  errors: { field: string; error: string }[];
};

/** Turn pasted cells into typed values for each row, with the problems found. Rows that are completely empty are skipped. */
export function convertRows(rows: string[][], map: (string | null)[], ctx: ImportCtx): ImportRow[] {
  const out: ImportRow[] = [];
  rows.forEach((cells, i) => {
    if (out.length >= MAX_IMPORT || cells.every((c) => c.trim() === "")) return;
    const values: Record<string, unknown> = {};
    const errors: ImportRow["errors"] = [];
    let projectFailed = false;
    map.forEach((field, col) => {
      const raw = (cells[col] ?? "").trim();
      if (!field || raw === "") return;
      const def = FIELD_BY_KEY[field];
      if (!def) return;
      if (field === "home_project") {
        const r = pick(ctx.projects, (p) => p.name, raw);
        if ("hit" in r) values[field] = r.hit.id;
        else { projectFailed = true; errors.push({ field, error: r.error === "many" ? `More than one project starts with "${raw}".` : `No project named "${raw}".` }); }
        return;
      }
      if (def.type === "Person") {
        const exact = ctx.members.find((m) => m.email.toLowerCase() === raw.toLowerCase());
        const r = exact ? { hit: exact } : pick(ctx.members, (m) => m.email.split("@")[0]!, raw);
        if ("hit" in r) values[field] = r.hit.user_id;
        else errors.push({ field, error: r.error === "many" ? `More than one person starts with "${raw}".` : `No person "${raw}" in this workspace.` });
        return;
      }
      let text = raw;
      if (def.type === "Currency") text = raw.replace(/^[€$£]\s*/, "");
      if (def.type === "Boolean") text = raw === "1" ? "yes" : raw === "0" ? "no" : raw;
      const v = validateEdit(field, text, { today: ctx.today });
      if (v.ok) { if (v.value !== null) values[field] = v.value; }
      else errors.push({ field, error: v.error });
    });
    if (!("initiative_name" in values)) errors.push({ field: "initiative_name", error: "An initiative needs a name." });
    if (!("home_project" in values) && !projectFailed) {
      if (ctx.defaultProject) values.home_project = ctx.defaultProject;
      else errors.push({ field: "home_project", error: "Choose a project for this row, or pick a default project." });
    }
    out.push({ line: i + 1, values, errors });
  });
  return out;
}

/** CSV that Excel opens: quoted where needed, CRLF line ends, text that looks like a formula is defused. */
export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",") + "\r\n").join("");
}
