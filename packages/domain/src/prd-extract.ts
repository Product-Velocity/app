// From the full PRD (a document that never reaches GitHub) to the three fields the PRD feeds (docs/22-CLAUDE-PRD-FLOW.md sections 3 and 4):
// the Description extract (only the sections flagged github_safe), the Hypothesis block and the customer-safe value proposition.
// Pure and conservative: anything not recognised as a safe section is left out, so a PRD-only part can never reach GitHub by a
// formatting accident. The flags come from prd-template.ts, never from Claude.

import { MAX_DOC_CHARS } from "./documents";
import { PRD_CORE, PRD_MODULES, type PrdFlag } from "./prd-template";

export const DESCRIPTION_LIMIT = 20_000;

type Section = { id: string; title: string; flag: PrdFlag | null; lines: string[] };
export type LeftOut = { id: string; title: string; reason: string };
export type PrdExtract = {
  /** Markdown for the Description field, or null when no safe section was found. */
  description: string | null;
  /** Ids of the sections that went into the Description, in document order. */
  included: string[];
  left_out: LeftOut[];
  /** The IF / THEN / RESULTING IN lines as written, or null. */
  hypothesis: string | null;
  /** The customer-safe value proposition as written, or null. */
  value_proposition: string | null;
  warnings: string[];
};

const FLAG_BY_ID = new Map<string, PrdFlag>([...PRD_CORE, ...PRD_MODULES].map((s) => [s.id, s.flag]));
const H2 = /^##\s+(?:Appendix\s+)?([A-D][1-9]|\d{1,2})\s*[.:)]?\s+(.*?)\s*#*\s*$/i;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Splits the PRD at its level-2 headings (outside code fences). Text before the first one (title, "Depends on" line) belongs to no section. */
function sections(md: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  let fence = false;
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = fence ? null : H2.exec(line);
    if (h) {
      const id = h[1]!.toUpperCase();
      cur = { id, title: h[2]!, flag: FLAG_BY_ID.get(id) ?? null, lines: [line] };
      out.push(cur);
    } else if (!fence && /^##\s+\S/.test(line)) {
      const title = line.replace(/^##\s+/, "").trim();
      cur = { id: title.split(/\s+/)[0]!.replace(/[.:)]+$/, "").toUpperCase(), title, flag: null, lines: [line] }; // a level-2 heading we do not know
      out.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return out;
}

/** The section's text for the Description: its own heading one level down (### N. Title) and deeper headings one level down too. */
function demote(lines: readonly string[]): string {
  let fence = false;
  return lines
    .map((l) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      if (fence) return l;
      const m = HEADING.exec(l);
      return m ? `${"#".repeat(Math.min(6, m[1]!.length + 1))} ${m[2]}` : l;
    })
    .join("\n")
    .trim();
}

const MONEY = /[€$£]\s?\d|\d\s?[km]?\s?(?:€|\$|£|(?:EUR|USD|GBP)(?![A-Za-z]))/i;

/** The IF / THEN / RESULTING IN lines, in that order, as the PRD wrote them. */
function hypothesisBlock(md: string): string | null {
  const lines = md.split("\n");
  const label = (l: string, w: string) => new RegExp(`^\\s*(?:[-*>]\\s+)?(?:\\*\\*|__)?${w}\\s*[:\\-]?(?:\\*\\*|__)?\\s*[:\\-]?\\s+\\S`, "i").test(l);
  for (let i = 0; i < lines.length; i++) {
    if (!label(lines[i]!, "IF")) continue;
    const t = lines.findIndex((l, j) => j > i && j <= i + 6 && label(l, "THEN"));
    if (t < 0) continue;
    const r = lines.findIndex((l, j) => j > t && j <= t + 6 && label(l, "RESULTING IN"));
    if (r < 0) continue;
    return [lines[i], lines[t], lines[r]].map((l) => l!.trim().replace(/^[-*>]\s+/, "")).join("\n");
  }
  return null;
}

/** The text under a heading (or bold line) that names the customer value proposition, up to the next heading of the same or a higher level. */
function valueProposition(md: string): string | null {
  const lines = md.split("\n");
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) fence = !fence;
    if (fence) continue;
    const h = HEADING.exec(lines[i]!);
    const bold = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/.exec(lines[i]!);
    const name = h?.[2] ?? bold?.[1];
    if (!name || !/customer[- ]?(?:facing )?value proposition/i.test(name)) continue;
    const level = h ? h[1]!.length : 7;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const n = HEADING.exec(lines[j]!);
      if (n && n[1]!.length <= Math.min(level, 6)) break;
      if (!h && /^\s*(?:\*\*|__).+(?:\*\*|__)\s*:?\s*$/.test(lines[j]!)) break;
      body.push(lines[j]!);
    }
    const text = body.join("\n").trim();
    if (text) return text;
  }
  return null;
}

export function buildExtract(md: string, version: number): PrdExtract {
  const warnings: string[] = [];
  const left_out: LeftOut[] = [];
  const safe: Section[] = [];
  for (const s of sections(md)) {
    if (s.flag === "github_safe") safe.push(s);
    else if (s.flag === "links") left_out.push({ id: s.id, title: s.title, reason: "links only: add them with add_link, not as text" });
    else if (s.flag === "prd_only") left_out.push({ id: s.id, title: s.title, reason: "stays in the PRD document, never goes to GitHub" });
    else left_out.push({ id: s.id, title: s.title, reason: "not a section of the template, so it was left out to be safe" });
  }

  let description: string | null = null;
  if (safe.length > 0) {
    description = [`_From PRD v${version}. The full PRD stays in Product Velocity._`, ...safe.map((s) => demote(s.lines))].join("\n\n");
    if (description.length > DESCRIPTION_LIMIT) {
      warnings.push(`The GitHub-safe sections together are ${description.length.toLocaleString("en")} characters; the Description holds at most ${DESCRIPTION_LIMIT.toLocaleString("en")}. Shorten them (sizes: ${safe.map((s) => `${s.id} ${s.lines.join("\n").length}`).join(", ")}). Nothing was copied to the Description.`);
      description = null;
    }
  } else {
    warnings.push("No GitHub-safe section found. Section headings must look like \"## 3. Problem Statement\" for the Description extract to work.");
  }

  const hypothesis = hypothesisBlock(md);
  if (!hypothesis) warnings.push("No Hypothesis block found (three lines starting IF, THEN and RESULTING IN), so the Hypothesis field was not filled.");

  let value_proposition = valueProposition(md);
  if (!value_proposition) {
    warnings.push("No customer value proposition found (a heading such as \"Customer value proposition (customer-safe)\"), so the Value Proposition field was not filled.");
  } else if (MONEY.test(value_proposition)) {
    warnings.push("The customer value proposition contains a money amount, which must not appear in customer-safe text. It was not copied; remove the figure from the PRD and run this again.");
    value_proposition = null;
  }

  return { description, included: safe.map((s) => s.id), left_out, hypothesis, value_proposition, warnings };
}

export const PRD_MAX_CHARS = MAX_DOC_CHARS;
