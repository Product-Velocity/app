// Stealth mode (issue #411, decision 2026-11-11-stealth-names): what the labels, markers and footer that Product Velocity writes to a tracker are CALLED.
// Everything has a default (today's `pv:` names) and a project may change them. Pure, shared by the GitHub and the Jira builders. With no `Names`
// every builder behaves exactly as before.

/** The label families that carry a value: `<prefix><slug>`. The prefix includes its trailing "/" (default `pv:moscow/`). */
export const LABEL_KINDS = ["project", "moscow", "rank", "type", "group", "focus", "value", "quarter", "tag"] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

/** The namespace of the default names. It is ALWAYS treated as ours when cleaning up, so a project that switches to other names has the old labels removed. */
export const LEGACY_NAMESPACE = "pv:";

export const DEFAULT_NAMES = {
  prefix: { project: "pv:project/", moscow: "pv:moscow/", rank: "pv:rank/", type: "pv:type/", group: "pv:group/", focus: "pv:focus/", value: "pv:value/", quarter: "pv:quarter/", tag: "pv:tag/" } as Record<LabelKind, string>,
  base: "product-velocity",
  removed: "pv:removed",
  define: "pv:define",
  /** Jira: the opaque label that finds an issue again after a create whose answer was lost, `<prefix><16 hex>`. */
  jiraMarker: "pv:item/",
  /** GitHub: the word in the hidden markers of the managed block, `<!-- <word>:begin item=… -->`. */
  block: "pv",
} as const;

/** Saved names. Absent = default. `base: ""` = no base label at all. */
export type Names = {
  prefix?: Partial<Record<LabelKind, string>>;
  base?: string;
  removed?: string;
  define?: string;
  jiraMarker?: string;
  block?: string;
  /** No "Product Velocity" in the footer, label and milestone descriptions, and no link back to the app. */
  hideBrand?: boolean;
};

export type ResolvedNames = { prefix: Record<LabelKind, string>; base: string; removed: string; define: string; jiraMarker: string; block: string; hideBrand: boolean };

export function resolveNames(n?: Names | null): ResolvedNames {
  const prefix = { ...DEFAULT_NAMES.prefix };
  for (const k of LABEL_KINDS) { const v = n?.prefix?.[k]; if (typeof v === "string" && v !== "") prefix[k] = v; }
  return {
    prefix,
    base: typeof n?.base === "string" ? n.base : DEFAULT_NAMES.base,
    removed: n?.removed || DEFAULT_NAMES.removed,
    define: n?.define || DEFAULT_NAMES.define,
    jiraMarker: n?.jiraMarker || DEFAULT_NAMES.jiraMarker,
    block: n?.block || DEFAULT_NAMES.block,
    hideBrand: n?.hideBrand === true,
  };
}

// ---- rules for a name (the database checks the same shapes) ----
const CHARS = /^[A-Za-z0-9:_./-]+$/;
/** A label prefix: 1 to 30 characters of letters, digits and : _ . / -, ending in "/" (a trailing slash is added when it is missing). */
export function normalisePrefix(raw: string): string {
  const t = raw.trim();
  return t === "" || /[/:]$/.test(t) ? t : `${t}/`;
}
export function checkPrefix(p: string): string | null {
  if (p.length < 2 || p.length > 30 || !CHARS.test(p) || !p.endsWith("/")) return "must be 2 to 30 characters (letters, digits and : _ . / -) and end in a slash";
  return null;
}
/** A whole label (base, removed, define): 1 to 50 characters, no spaces, no slash needed. */
export function checkLabel(l: string, allowEmpty = false): string | null {
  if (l === "") return allowEmpty ? null : "can not be empty";
  return l.length > 50 || !CHARS.test(l) ? "must be at most 50 characters of letters, digits and : _ . / -" : null;
}
export const checkBlockWord = (w: string): string | null => (/^[a-z0-9_-]{1,20}$/.test(w) ? null : "must be 1 to 20 characters: lower case letters, digits, - and _");

/** Errors of a set of names (empty = fine): each part valid, label prefixes distinct, the removed/define/base labels distinct. */
export function validateNames(n: Names): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const k of LABEL_KINDS) {
    const p = n.prefix?.[k];
    if (p === undefined || p === "") continue;
    const e = checkPrefix(p);
    if (e) errors.push(`The ${k} label ${e}.`);
    const clash = seen.get(p.toLowerCase());
    if (clash) errors.push(`The ${k} and ${clash} labels can not share the text ${p}.`);
    seen.set(p.toLowerCase(), k);
  }
  const whole: [string, string | undefined, boolean][] = [["base", n.base, true], ["removed", n.removed, false], ["define", n.define, false]];
  for (const [what, v, empty] of whole) { if (v === undefined) continue; const e = checkLabel(v, empty); if (e) errors.push(`The ${what} label ${e}.`); }
  const eff = resolveNames(n);
  const labels = [eff.base, eff.removed, eff.define].filter((x) => x !== "");
  if (new Set(labels.map((x) => x.toLowerCase())).size !== labels.length) errors.push("The base, removed and define labels must be different.");
  if (n.jiraMarker !== undefined && n.jiraMarker !== "" && !/^[A-Za-z0-9:_.-]{1,24}\/$/.test(n.jiraMarker)) errors.push("The Jira marker must be 2 to 25 characters and end in a slash.");
  if (n.block !== undefined && n.block !== "") { const e = checkBlockWord(n.block); if (e) errors.push(`The marker word ${e}.`); }
  return errors;
}

/**
 * Whether a label on an issue is one Product Velocity wrote (so a push may remove it when it no longer applies): the current names, and always the
 * default `pv:` namespace and base label, so changing names cleans up what was sent before. The removed label is never "owned": it records a close.
 */
export function isOwnedLabel(label: string, n?: Names | null): boolean {
  const r = resolveNames(n);
  if (label === r.removed || label === DEFAULT_NAMES.removed) return false;
  if (label === r.base || label === DEFAULT_NAMES.base || label.startsWith(LEGACY_NAMESPACE)) return true;
  if (label === r.define) return true;
  return LABEL_KINDS.some((k) => label.startsWith(r.prefix[k])) || label.startsWith(r.jiraMarker);
}

/** The text that replaces "Managed by Product Velocity" in stealth mode (the footer of a managed block). */
export const NEUTRAL_FOOTER = "Managed block: edits between the markers are overwritten, text outside them is kept.";
export const BRANDED_FOOTER_START = "Managed by Product Velocity";
/** Description of labels and milestones we create (none in stealth mode). */
export const labelDescription = (n?: Names | null) => (n?.hideBrand ? "" : "Managed by Product Velocity");

// ---- the managed block markers: any word is read, so an issue written under other names is still found ----
const BLOCK_OPEN = /<!-- ([a-z0-9_-]{1,20}):begin/;
export type FoundBlock = { start: number; /** index just after the closing marker */ after: number; /** index of the closing marker */ end: number; word: string };
/** The managed block of an issue body, whatever word its markers use, or null when it is missing or unclosed. */
export function findBlock(body: string): FoundBlock | null {
  const m = BLOCK_OPEN.exec(body);
  if (!m) return null;
  const close = `<!-- ${m[1]}:end -->`;
  const end = body.indexOf(close, m.index);
  return end === -1 ? null : { start: m.index, end, after: end + close.length, word: m[1]! };
}
/** Start of the opening marker, even when the block is not closed (-1 = none). */
export const blockStartIndex = (body: string): number => BLOCK_OPEN.exec(body)?.index ?? -1;
