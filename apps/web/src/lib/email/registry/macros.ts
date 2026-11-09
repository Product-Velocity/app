/**
 * Macro engine for product emails (issue #370). `{{macro}}` placeholders; each template declares the macros it allows.
 * Unknown macros are refused on save, a missing value uses a defined fallback so a raw `{{...}}` is never sent, and every value is
 * escaped by type. Link macros are built by the system only, never typed by an editor.
 */

export type MacroKind = "text" | "link";
export type MacroDef = { kind: MacroKind; fallback: string; sample: string; label: string };

/** Starter catalog (issue #370). */
export const MACRO_CATALOG = {
  link: { kind: "link", fallback: "", sample: "https://app.example/a/sample", label: "Link for the button" },
  name: { kind: "text", fallback: "there", sample: "Ana", label: "Recipient name" },
  workspace: { kind: "text", fallback: "your workspace", sample: "Meridian Media", label: "Workspace name" },
  inviter: { kind: "text", fallback: "A colleague", sample: "Sam Rivera", label: "Person who invited" },
  role: { kind: "text", fallback: "member", sample: "Creator", label: "Role offered" },
  requester: { kind: "text", fallback: "Someone", sample: "Jo Park", label: "Person asking for access" },
  code: { kind: "text", fallback: "", sample: "123456", label: "One-time code" },
  session: { kind: "text", fallback: "the session", sample: "Q1 priorities", label: "Alignment session name" },
  closes: { kind: "text", fallback: "", sample: "12 Dec 2026", label: "Closing date" },
  expires: { kind: "text", fallback: "60 minutes", sample: "60 minutes", label: "How long the link or code works" },
  product: { kind: "text", fallback: "Product Velocity", sample: "Product Velocity", label: "Product name" },
} as const satisfies Record<string, MacroDef>;

export type MacroName = keyof typeof MACRO_CATALOG;
const NAMES = Object.keys(MACRO_CATALOG) as MacroName[];
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Macro names used in a text, in order, without repeats. Anything between braces counts, so a typo is found. */
export function macrosIn(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  return seen;
}

/** Problems that stop a save: unknown macros, macros this template does not allow, and stray braces. */
export function validateMacros(text: string, allowed: readonly MacroName[]): string[] {
  const problems: string[] = [];
  for (const name of macrosIn(text)) {
    if (!(NAMES as string[]).includes(name)) problems.push(`Unknown macro {{${name}}}.`);
    else if (!(allowed as readonly string[]).includes(name)) problems.push(`{{${name}}} is not available in this email.`);
  }
  if (text.replace(PLACEHOLDER, "").match(/\{\{|\}\}/)) problems.push("Unbalanced {{ or }}.");
  return problems;
}

/** Text only: no markup, no scripts, no links an editor typed. Returns problems, empty when fine. */
export function validatePlainText(text: string): string[] {
  const problems: string[] = [];
  if (/<[a-z!/?]/i.test(text)) problems.push("HTML is not allowed; write plain text.");
  if (/https?:\/\/|\bwww\.|mailto:|javascript:|data:/i.test(text)) problems.push("Links cannot be typed here; use the button.");
  return problems;
}

export type MacroValues = Partial<Record<MacroName, string | null | undefined>>;

function valueFor(name: MacroName, values: MacroValues): string {
  const v = values[name];
  const s = typeof v === "string" ? v.trim() : "";
  return s !== "" ? s : MACRO_CATALOG[name].fallback;
}

/**
 * Replaces macros. `html: true` escapes the values and the surrounding text; `false` leaves plain text. A placeholder that is not in
 * the catalog is dropped (never sent raw); validation on save should have refused it already.
 */
export function renderMacros(text: string, values: MacroValues, mode: "html" | "text"): string {
  const out: string[] = [];
  let last = 0;
  const esc = mode === "html" ? escapeHtml : (s: string) => s;
  for (const m of text.matchAll(PLACEHOLDER)) {
    out.push(esc(text.slice(last, m.index)));
    const name = m[1] as MacroName;
    if ((NAMES as string[]).includes(name)) out.push(esc(valueFor(name, values)));
    last = m.index! + m[0].length;
  }
  out.push(esc(text.slice(last)));
  return out.join("").replace(/\{\{|\}\}/g, "");
}

export const sampleValues = (allowed: readonly MacroName[]): MacroValues =>
  Object.fromEntries(allowed.map((n) => [n, MACRO_CATALOG[n].sample]));
