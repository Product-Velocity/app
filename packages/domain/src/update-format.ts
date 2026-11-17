/**
 * The weekly update is plain text with a very small Markdown: `[label](https://link)`, `**bold**` and `- ` list items. This turns it into blocks the page
 * draws, and into HTML and plain text for the clipboard, so a person can paste it into an email with every initiative, ticket and document as a working link.
 * Only http and https links are kept as links (anything else, like `javascript:`, stays as the words). Nothing here trusts the text: HTML is escaped.
 */
export type Inline = { text: string; href?: string; bold?: boolean };
export type UpdateBlock =
  | { type: "title"; inline: Inline[] }
  | { type: "heading"; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "list"; items: Inline[][] };

/** The section titles of the weekly update, each on a line of its own. */
export const UPDATE_SECTIONS = ["Highlights", "Risks and asks", "What moved this week", "Next two weeks", "Investment mix"] as const;

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
const safe = (u: string) => /^https?:\/\/[^\s]+$/i.test(u);

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of line.matchAll(LINK)) {
    if (m.index! > last) out.push({ text: line.slice(last, m.index) });
    if (m[3] !== undefined) out.push({ text: m[3], bold: true });
    else if (safe(m[2]!)) out.push({ text: m[1]!, href: m[2]! });
    else out.push({ text: m[0]! });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

export function parseUpdate(text: string): UpdateBlock[] {
  const blocks: UpdateBlock[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let first = true;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    if (first) { blocks.push({ type: "title", inline: parseInline(line) }); first = false; continue; }
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      const last = blocks.at(-1);
      if (last?.type === "list") last.items.push(parseInline(item[1]!)); else blocks.push({ type: "list", items: [parseInline(item[1]!)] });
      continue;
    }
    if ((UPDATE_SECTIONS as readonly string[]).includes(line.trim())) blocks.push({ type: "heading", inline: [{ text: line.trim() }] });
    else if (/^\*\*[^*]+\*\*$/.test(line.trim())) blocks.push({ type: "paragraph", inline: [{ text: line.trim().slice(2, -2), bold: true }] });
    else blocks.push({ type: "paragraph", inline: parseInline(line) });
  }
  return blocks;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inlineHtml = (parts: Inline[]) => parts.map((p) => {
  const t = esc(p.text);
  return p.href ? `<a href="${esc(p.href)}">${t}</a>` : p.bold ? `<strong>${t}</strong>` : t;
}).join("");
const inlinePlain = (parts: Inline[]) => parts.map((p) => (p.href ? `${p.text} (${p.href})` : p.text)).join("");

const FONT = "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2933;";

/** HTML for the clipboard (inline styles only, which is what mail programs keep). */
export function updateToHtml(text: string): string {
  const body = parseUpdate(text).map((b) => {
    if (b.type === "title") return `<p style="${FONT}font-size:16px;margin:0 0 12px;"><strong>${inlineHtml(b.inline)}</strong></p>`;
    if (b.type === "heading") return `<p style="${FONT}font-size:15px;margin:18px 0 4px;"><strong>${inlineHtml(b.inline)}</strong></p>`;
    if (b.type === "paragraph") return `<p style="${FONT}margin:10px 0 2px;">${inlineHtml(b.inline)}</p>`;
    return `<ul style="${FONT}margin:2px 0 6px;padding-left:20px;">${b.items.map((i) => `<li style="margin:2px 0;">${inlineHtml(i)}</li>`).join("")}</ul>`;
  }).join("");
  return `<div style="${FONT}">${body}</div>`;
}

/** Plain text for the clipboard and for mail programs that drop HTML: a link reads "label (address)". */
export function updateToPlain(text: string): string {
  return parseUpdate(text).map((b) => {
    if (b.type === "list") return b.items.map((i) => `- ${inlinePlain(i)}`).join("\n");
    if (b.type === "title") return `${inlinePlain(b.inline)}\n`;
    if (b.type === "heading") return `\n${inlinePlain(b.inline)}`;
    return `\n${inlinePlain(b.inline)}`;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
