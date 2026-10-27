import { createHash } from "node:crypto";
import { BLOCK_END, BLOCK_START } from "./outbound";

// What may come back from a tracking issue (docs/21, section 8): the title and three texts of the managed block, nothing else.
// Everything here is pure so it can be tested without GitHub. Text read from an issue is data: it is cut to the field's limit
// and our own markers are neutralised; it is never interpreted.

export const SYNC_TEXT_FIELDS = ["title", "summary", "description", "hypothesis"] as const;
export type SyncTextField = (typeof SYNC_TEXT_FIELDS)[number];
/** The item column each compared text lives in. This is also the allowlist of what a received text may change. */
export const SYNC_FIELD_COLUMN: Record<SyncTextField, string> = { title: "initiative_name", summary: "summary", description: "description", hypothesis: "hypothesis" };
export const SYNC_FIELD_LABEL: Record<SyncTextField, string> = { title: "Name", summary: "Summary", description: "Description", hypothesis: "Hypothesis" };
export const SYNC_FIELD_LIMIT: Record<SyncTextField, number> = { title: 200, summary: 4000, description: 20000, hypothesis: 4000 };

const HEADINGS = [["summary", "## Summary"], ["description", "## Description"], ["hypothesis", "## Hypothesis (IF / THEN / RESULTING IN)"], ["artifacts", "## Artifacts"], ["files", "## Files"]] as const;
const FOOTER = "\n---\nManaged by Product Velocity";

/** The text as the outbound builder writes it and as it is compared: no carriage returns, trimmed, markers escaped, @mentions defused. */
export function normalise(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/@​/g, "@") // undo our own defusing first, so it is applied exactly once below
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@​")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
}
export const hashText = (s: string | null | undefined) => createHash("sha256").update(normalise(s)).digest("hex");

/** A text read from GitHub, ready to be stored in the item: normalised for storage (no defusing zero-width characters), cut to the limit. */
export function receivedValue(field: SyncTextField, s: string): string {
  return normalise(s).replace(/@​/g, "@").slice(0, SYNC_FIELD_LIMIT[field]).trim();
}

export type SplitBlock = { ok: true; summary: string; description: string; hypothesis: string } | { ok: false; reason: string };

/**
 * The inverse of buildTrackingIssue for the three texts: cuts the managed block at its known headings, in order. A heading that
 * is not where it should be, or markers someone edited, make the block unreadable; the caller then offers a whole-block choice and
 * never guesses a merge. Text outside the markers is not looked at.
 */
export function splitManagedBlock(body: string | null | undefined): SplitBlock {
  const b = (body ?? "").replace(/\r\n?/g, "\n");
  const start = b.indexOf(BLOCK_START);
  const end = start === -1 ? -1 : b.indexOf(BLOCK_END, start);
  if (start === -1 || end === -1) return { ok: false, reason: "The markers of the managed block are missing in GitHub." };
  const block = b.slice(start, end);
  const firstLineEnd = block.indexOf("\n");
  if (firstLineEnd === -1 || !/^<!-- pv:begin item=[0-9a-f-]{36} -->$/.test(block.slice(0, firstLineEnd))) return { ok: false, reason: "The first marker of the managed block was edited in GitHub." };
  const footer = block.lastIndexOf(FOOTER);
  const content = footer === -1 ? block.slice(firstLineEnd) : block.slice(firstLineEnd, footer);

  const found: { key: string; at: number; len: number }[] = [];
  let from = 0;
  for (const [key, heading] of HEADINGS) {
    const m = new RegExp(`(^|\\n)${heading.replace(/[()/]/g, "\\$&")}(?=\\n|$)`).exec(content.slice(from));
    if (!m) continue;
    const at = from + m.index + m[1]!.length;
    found.push({ key, at, len: heading.length });
    from = at + heading.length;
  }
  const out: Record<string, string> = { summary: "", description: "", hypothesis: "" };
  found.forEach((f, i) => {
    if (f.key in out) out[f.key] = content.slice(f.at + f.len, i + 1 < found.length ? found[i + 1]!.at : content.length).trim();
  });
  // anything before the first heading would be text somebody typed inside the markers
  const head = (found[0] ? content.slice(0, found[0].at) : content).trim();
  if (head) return { ok: false, reason: "Text was added inside the managed block in GitHub." };
  return { ok: true, summary: out.summary!, description: out.description!, hypothesis: out.hypothesis! };
}

/** The initiative name from an issue title written as "R-12: Name". A title without the code prefix is taken whole (so a changed prefix shows as a change). */
export function splitTitle(title: string | null | undefined, code: string): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  const prefix = code ? `${code}: ` : "";
  return prefix && t.startsWith(prefix) ? t.slice(prefix.length).trim() : t;
}

/**
 * Three-way comparison of one text. `base` is the hash both sides agreed on at the last sync (undefined when never recorded);
 *  - none: nothing to do (equal now, whatever happened before)
 *  - send: only Product Velocity changed; it goes out with the confirmed send
 *  - github: only GitHub changed; a conflict whose default is to keep Product Velocity, always visible
 *  - both: both changed and differ; a conflict with no default
 * Without a base a difference is "both": never a silent overwrite.
 */
export type TextVerdict = "none" | "send" | "github" | "both";
export function compareTexts(base: string | undefined, pvHash: string, ghHash: string): TextVerdict {
  if (pvHash === ghHash) return "none";
  if (base === undefined) return "both";
  if (ghHash === base) return "send";
  if (pvHash === base) return "github";
  return "both";
}

export type FieldCompare = { field: SyncTextField; verdict: TextVerdict; pvText: string; githubText: string; pvHash: string; ghHash: string };
export type IssueCompare = { fields: FieldCompare[]; /** Set when the managed block cannot be read field by field: only a whole-block choice is offered. */ blockProblem?: string };

/**
 * Compares the name and the three texts of one initiative with what its tracking issue says now. `base` holds the hashes both sides
 * agreed on at the last sync. Pure: the caller reads the item, the issue and the base. Text outside the managed block is never read.
 */
export function compareIssue(i: { code: string; pv: { initiative_name?: string | null; summary?: string | null; description?: string | null; hypothesis?: string | null }; issue: { title?: string | null; body?: string | null }; base?: Partial<Record<SyncTextField, string>> }): IssueCompare {
  const split = splitManagedBlock(i.issue.body);
  const pvRaw: Record<SyncTextField, string> = { title: i.pv.initiative_name ?? "", summary: i.pv.summary ?? "", description: i.pv.description ?? "", hypothesis: i.pv.hypothesis ?? "" };
  // the PV side is cut exactly where the outbound builder cuts, so a long text does not look changed
  const pvText = (f: SyncTextField) => pvRaw[f].trim().slice(0, SYNC_FIELD_LIMIT[f]);
  const ghRaw = (f: SyncTextField) => (f === "title" ? splitTitle(i.issue.title, i.code) : split.ok ? split[f] : "");
  const fields = SYNC_TEXT_FIELDS.filter((f) => f === "title" || split.ok).map((f): FieldCompare => {
    const pvHash = hashText(pvText(f));
    const ghHash = hashText(ghRaw(f));
    return { field: f, verdict: compareTexts(i.base?.[f], pvHash, ghHash), pvText: pvRaw[f], githubText: receivedValue(f, ghRaw(f)), pvHash, ghHash };
  });
  return split.ok ? { fields } : { fields, blockProblem: split.reason };
}
