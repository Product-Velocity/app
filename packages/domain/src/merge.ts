// Merging the two texts of a document and its Confluence page when both changed since they were last in step (issue #721).
// A block-level three-way merge: the text both sides started from (`base`), the document now (`ours`) and the page now (`theirs`), cut into blocks (paragraphs,
// headings, list items kept together, tables, code). A block only one side changed is taken from that side; a change both sides made the same way is taken once;
// blocks both sides changed differently are CONFLICTS the person settles one by one. Pure and deterministic; the page and the document are read elsewhere.
//
// Blocks are compared by a normalised KEY (the text as it would look after a round trip through Confluence), so a difference only in how Markdown is written
// (`*` or `_`, list markers, trailing spaces) is not a change, but the text taken is always the side's own.

import { markdownToStorage } from "./confluence";
import { storageToMarkdown } from "./confluence-import";

export type Block = { key: string; text: string };
export type MergeChunk =
  | { kind: "same"; text: string }
  | { kind: "ours"; text: string; base: string; theirs: string }
  | { kind: "theirs"; text: string; base: string; ours: string }
  | { kind: "both"; text: string }
  | { kind: "conflict"; base: string; ours: string; theirs: string };
export type Choice = "ours" | "theirs" | "both";

export const MAX_MERGE_BLOCKS = 3000;

/** The blocks of a Markdown text: separated by blank lines; a fenced code block is never cut. */
export function splitBlocks(markdown: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && line.trim() === "" && !/^\s*(```|~~~)/.test(line)) {
      if (cur.length > 0) { out.push(cur.join("\n")); cur = []; }
    } else cur.push(line);
  }
  if (cur.length > 0) out.push(cur.join("\n"));
  return out.map((b) => b.replace(/\s+$/g, "")).filter((b) => b !== "");
}

/** How a block would read after a round trip through Confluence's page format, whitespace folded: the key two blocks are compared by. */
export function blockKey(text: string): string {
  const back = storageToMarkdown(markdownToStorage(text)).markdown;
  return back.replace(/\s+/g, " ").trim().toLowerCase();
}
const toBlocks = (markdown: string): Block[] => splitBlocks(markdown).map((text) => ({ key: blockKey(text), text }));

/** Longest common subsequence of two key lists: for each index of `a`, the matched index in `b` or -1. */
function lcs(a: string[], b: string[]): number[] {
  const n = a.length, m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const match = new Array<number>(n).fill(-1);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { match[i] = j; i++; j++; } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++; else j++;
  }
  return match;
}

const same = (x: Block[], y: Block[]): boolean => x.length === y.length && x.every((b, i) => b.key === y[i]!.key);
const join = (bs: Block[]): string => bs.map((b) => b.text).join("\n\n");

export type MergeResult = { ok: true; chunks: MergeChunk[]; conflicts: number } | { ok: false; error: string };

/** The three-way merge. Fails (in words) when a text is too long to compare. */
export function mergeTexts(baseMd: string, oursMd: string, theirsMd: string): MergeResult {
  const base = toBlocks(baseMd), ours = toBlocks(oursMd), theirs = toBlocks(theirsMd);
  if (Math.max(base.length, ours.length, theirs.length) > MAX_MERGE_BLOCKS) return { ok: false, error: `The text has more than ${MAX_MERGE_BLOCKS} blocks; it is too long to merge. Choose one side instead.` };
  const bk = base.map((b) => b.key);
  const mo = lcs(bk, ours.map((b) => b.key));
  const mt = lcs(bk, theirs.map((b) => b.key));
  // the anchors: base blocks that both sides kept, in order (a match of one side that is out of order with the other's is not an anchor)
  const anchors: { b: number; o: number; t: number }[] = [];
  for (let i = 0; i < base.length; i++) {
    if (mo[i]! < 0 || mt[i]! < 0) continue;
    const last = anchors[anchors.length - 1];
    if (last && (mo[i]! <= last.o || mt[i]! <= last.t)) continue;
    anchors.push({ b: i, o: mo[i]!, t: mt[i]! });
  }
  const chunks: MergeChunk[] = [];
  let conflicts = 0;
  let pb = 0, po = 0, pt = 0;
  const region = (b1: number, o1: number, t1: number) => {
    const B = base.slice(pb, b1), O = ours.slice(po, o1), T = theirs.slice(pt, t1);
    if (B.length === 0 && O.length === 0 && T.length === 0) return;
    if (same(O, T)) { if (O.length > 0) chunks.push(same(B, O) ? { kind: "same", text: join(O) } : { kind: "both", text: join(O) }); }
    else if (same(B, O)) { if (T.length > 0) chunks.push({ kind: "theirs", text: join(T), base: join(B), ours: join(O) }); else chunks.push({ kind: "theirs", text: "", base: join(B), ours: join(O) }); }
    else if (same(B, T)) { chunks.push({ kind: "ours", text: join(O), base: join(B), theirs: join(T) }); }
    else { chunks.push({ kind: "conflict", base: join(B), ours: join(O), theirs: join(T) }); conflicts += 1; }
  };
  for (const a of anchors) {
    region(a.b, a.o, a.t);
    chunks.push({ kind: "same", text: ours[a.o]!.text });
    pb = a.b + 1; po = a.o + 1; pt = a.t + 1;
  }
  region(base.length, ours.length, theirs.length);
  // neighbouring "same" chunks are one block of text
  const merged: MergeChunk[] = [];
  for (const c of chunks) {
    const prev = merged[merged.length - 1];
    if (c.kind === "same" && prev?.kind === "same") prev.text = `${prev.text}\n\n${c.text}`; else merged.push(c);
  }
  return { ok: true, chunks: merged, conflicts };
}

/** The merged text, with the person's choice for each conflict (keyed by the chunk's index). A conflict without a choice is an error, never guessed. */
export function applyMerge(chunks: readonly MergeChunk[], choices: Record<number, Choice>): { ok: true; markdown: string } | { ok: false; error: string } {
  const parts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    if (c.kind === "conflict") {
      const ch = choices[i];
      if (ch === undefined) return { ok: false, error: "Choose a side for every block that both sides changed." };
      const text = ch === "ours" ? c.ours : ch === "theirs" ? c.theirs : [c.ours, c.theirs].filter((x) => x !== "").join("\n\n");
      if (text !== "") parts.push(text);
    } else if (c.text !== "") parts.push(c.text);
  }
  return { ok: true, markdown: parts.join("\n\n") + "\n" };
}
