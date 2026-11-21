// From a skill's document to initiative fields (issue #565, slice 2). A skill that fills fields ends its document with a section
// "## n. Values for Product Velocity": one line per field, `key: value`. The extract copies those lines as written, for the keys the
// skill is allowed to fill, and nothing else; nothing is rewritten and nothing is read from the rest of the document.
// The write itself is update_items, so empty fields are filled at once and filled ones wait for a confirmed diff.

import { claudeMaySet, CLAUDE_LIST_FIELDS } from "./mcp-read";
import { FIELD_BY_KEY } from "./registry";
import type { SkillSpec } from "./skills";

export const VALUES_HEADING = "Values for Product Velocity";

export type SkillExtract = {
  /** What would be written, by field key, in the shape update_items takes. */
  set: Record<string, string | number | string[]>;
  /** Lines in the block that were left out, each with the reason. */
  left_out: { line: string; reason: string }[];
  warnings: string[];
};

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const clean = (s: string) => s.replace(/^[`*_\s]+|[`*_\s]+$/g, "");

/** The lines of the "Values for Product Velocity" section (outside code fences), or null when the document has none. */
function valuesLines(md: string): string[] | null {
  const lines = md.split("\n");
  let fence = false;
  let level = 0;
  let out: string[] | null = null;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const h = HEADING.exec(l);
    if (out === null) {
      if (h && new RegExp(VALUES_HEADING, "i").test(h[2] ?? "")) { out = []; level = (h[1] ?? "#").length; }
      continue;
    }
    if (h && (h[1] ?? "#").length <= level) break;
    out.push(l);
  }
  return out;
}

/** Reads the block and keeps the lines the skill may fill. Values are taken as written; a number is a number only when the field is a number. */
export function skillExtract(spec: SkillSpec, body: string): SkillExtract {
  const r: SkillExtract = { set: {}, left_out: [], warnings: [] };
  if (spec.fields.length === 0) { r.warnings.push(`${spec.command} fills no initiative fields.`); return r; }
  const lines = valuesLines(body);
  if (lines === null) { r.warnings.push(`The document has no "## n. ${VALUES_HEADING}" section, so there is nothing to copy.`); return r; }
  for (const raw of lines) {
    const line = raw.trim().replace(/^[-*+]\s+/, "");
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 1) { r.left_out.push({ line: raw.trim(), reason: "not a `key: value` line" }); continue; }
    const key = clean(line.slice(0, i)).toLowerCase().replace(/\s+/g, "_");
    const value = line.slice(i + 1).trim().replace(/^[`"]|[`"]$/g, "").trim();
    if (!FIELD_BY_KEY[key]) { r.left_out.push({ line: raw.trim(), reason: `"${key}" is not a field` }); continue; }
    if (!spec.fields.includes(key)) { r.left_out.push({ line: raw.trim(), reason: `${spec.command} does not fill ${key}` }); continue; }
    if (!claudeMaySet(key, "creator")) { r.left_out.push({ line: raw.trim(), reason: `${key} is for people only` }); continue; }
    if (value === "" || /^(to define|tbd|unknown|n\/a|-)$/i.test(value)) { r.left_out.push({ line: raw.trim(), reason: "no value (\"to define\")" }); continue; }
    if (key in r.set) { r.left_out.push({ line: raw.trim(), reason: `${key} appears twice; the first is used` }); continue; }
    const type = FIELD_BY_KEY[key]!.type;
    if (CLAUDE_LIST_FIELDS.includes(key)) r.set[key] = value.split(",").map((x) => x.trim()).filter(Boolean);
    else if (type === "Number") {
      const n = Number(value.replace(/,/g, ""));
      if (!Number.isFinite(n)) { r.left_out.push({ line: raw.trim(), reason: `${key} must be a number` }); continue; }
      r.set[key] = n;
    } else r.set[key] = value;
  }
  if (Object.keys(r.set).length === 0) r.warnings.push("No line in the block could be copied.");
  return r;
}
