// Markdown to Atlassian Document Format (ADF) for the description of a Jira issue (docs/16 point 5, decision 2026-11-03).
// A small, tested subset: paragraphs, headings, bold, italic, inline code, links, bullet and numbered lists, code blocks.
// Anything else stays plain text. No dependency. The output is only ever data sent to Jira; it is never executed.

type Mark = { type: "strong" | "em" | "code" } | { type: "link"; attrs: { href: string } };
type Inline = { type: "text"; text: string; marks?: Mark[] };
export type AdfNode = { type: string; attrs?: Record<string, unknown>; content?: AdfNode[]; text?: string; marks?: Mark[] };
export type AdfDoc = { type: "doc"; version: 1; content: AdfNode[] };

const SAFE_LINK = /^https?:\/\/[^\s<>"]+$/i;

/** Inline Markdown: `code`, **bold**, *italic* / _italic_, [text](https://url). Unmatched markers stay as text. */
export function inlineToAdf(src: string): Inline[] {
  const out: Inline[] = [];
  const push = (text: string, marks: Mark[] = []) => { if (text) out.push(marks.length ? { type: "text", text, marks } : { type: "text", text }); };
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|(?<![\w*])\*([^*\n]+)\*(?![\w*])|(?<![\w_])_([^_\n]+)_(?![\w_])/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    push(src.slice(last, m.index));
    if (m[1] !== undefined) push(m[1], [{ type: "code" }]);
    else if (m[2] !== undefined) push(m[2], [{ type: "strong" }]);
    else if (m[3] !== undefined) push(m[3], SAFE_LINK.test(m[4]!) ? [{ type: "link", attrs: { href: m[4]! } }] : []); // an unsafe address (javascript:) becomes plain text
    else push((m[5] ?? m[6])!, [{ type: "em" }]);
    last = m.index + m[0].length;
  }
  push(src.slice(last));
  return out;
}

const para = (text: string): AdfNode => ({ type: "paragraph", content: inlineToAdf(text) as AdfNode[] });
const listItem = (text: string): AdfNode => ({ type: "listItem", content: [para(text)] });

/** Markdown text to an ADF document. An empty text gives an empty document (a valid ADF doc needs at least one block, so an empty paragraph). */
export function markdownToAdf(md: string): AdfDoc {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: AdfNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]!); i++) body.push(lines[i]!);
      i++;
      const text = body.join("\n");
      blocks.push({ type: "codeBlock", ...(fence[1] ? { attrs: { language: fence[1] } } : {}), content: text ? [{ type: "text", text }] : [] });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ type: "heading", attrs: { level: h[1]!.length }, content: inlineToAdf(h[2]!.trim()) as AdfNode[] }); i++; continue; }
    const bullet = /^\s*[-*+]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    const kind = bullet.test(line) ? "bulletList" : numbered.test(line) ? "orderedList" : null;
    if (kind) {
      const re = kind === "bulletList" ? bullet : numbered;
      const items: AdfNode[] = [];
      for (; i < lines.length && re.test(lines[i]!); i++) items.push(listItem(re.exec(lines[i]!)![1]!.trim()));
      blocks.push({ type: kind, content: items });
      continue;
    }
    const para_: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i]!); i++) para_.push(lines[i]!.trim());
    blocks.push(para(para_.join(" ")));
  }
  return { type: "doc", version: 1, content: blocks.length ? blocks : [{ type: "paragraph", content: [] }] };
}

/** ADF to plain text, for showing a conflict and for hashing. Display only: it is never written back to Jira. */
export function adfToText(node: unknown): string {
  const walk = (n: unknown, ctx: { ordered?: boolean; n: number }): string => {
    if (typeof n !== "object" || n === null) return "";
    const o = n as AdfNode;
    const kids = Array.isArray(o.content) ? o.content : [];
    switch (o.type) {
      case "text": return typeof o.text === "string" ? o.text : "";
      case "hardBreak": return "\n";
      case "mention": return typeof o.attrs?.text === "string" ? o.attrs.text : "@someone";
      case "paragraph": case "heading": return kids.map((k) => walk(k, ctx)).join("") + "\n";
      case "codeBlock": return kids.map((k) => walk(k, ctx)).join("") + "\n";
      case "bulletList": return kids.map((k) => `- ${walk(k, ctx).trim()}\n`).join("");
      case "orderedList": return kids.map((k, j) => `${j + 1}. ${walk(k, ctx).trim()}\n`).join("");
      case "tableRow": return kids.map((k) => walk(k, ctx).trim()).join(" | ") + "\n";
      default: return kids.map((k) => walk(k, ctx)).join("");
    }
  };
  return walk(node, { n: 0 }).replace(/\n{3,}/g, "\n\n").trim();
}

/** True when the ADF holds only the node types this converter writes (so rewriting it loses nothing); a table, macro or mention makes it false. */
export function isSimpleAdf(node: unknown): boolean {
  const ok = new Set(["doc", "paragraph", "heading", "text", "bulletList", "orderedList", "listItem", "codeBlock", "hardBreak"]);
  const marks = new Set(["strong", "em", "code", "link"]);
  const walk = (n: unknown): boolean => {
    if (typeof n !== "object" || n === null) return false;
    const o = n as AdfNode;
    if (!ok.has(o.type)) return false;
    if (Array.isArray(o.marks) && !o.marks.every((m) => marks.has(m.type))) return false;
    return (o.content ?? []).every(walk);
  };
  return walk(node);
}
