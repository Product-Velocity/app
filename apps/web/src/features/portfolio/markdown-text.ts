/**
 * The Markdown of a Description as one line of plain text, for the grid cell (the full rendering is in the tooltip and the panel).
 * Drops the syntax, keeps the words: "## Story As a user I want **fast** [docs](https://x)" -> "Story As a user I want fast docs".
 *
 * A cell is one short line; a very long string makes the browser draw nothing at all, so the text is cut here (the hover has all of it).
 */
const CELL_MAX = 240;

export function markdownToPlainText(md: string, max = CELL_MAX): string {
  const text = md.slice(0, 4000)
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>\n]+>/g, "")
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|~~|[*_`])/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
