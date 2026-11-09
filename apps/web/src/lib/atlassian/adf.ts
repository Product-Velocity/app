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

/** The cells of one table row: the outer pipes go, \\| is a pipe inside a cell. */
const tableCells = (line: string): string[] => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());

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
    // a GFM table: a header row, a separator row (---), then body rows while the lines start with a pipe
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1]!)) {
      const head = tableCells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) rows.push(tableCells(lines[i]!));
      const cell = (type: "tableHeader" | "tableCell", text: string): AdfNode => ({ type, attrs: {}, content: [para(text)] });
      const width = head.length;
      blocks.push({ type: "table", attrs: { isNumberColumnEnabled: false, layout: "default" }, content: [
        { type: "tableRow", content: head.map((c) => cell("tableHeader", c)) },
        ...rows.map((r): AdfNode => ({ type: "tableRow", content: Array.from({ length: width }, (_, k) => cell("tableCell", r[k] ?? "")) })),
      ] });
      continue;
    }
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
    para_.push(line.trim()); // the first line always belongs to the paragraph (a pipe line that is not a table must not stall the loop)
    for (i++; i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i]!); i++) para_.push(lines[i]!.trim());
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

/**
 * True when the ADF holds only what this converter writes, so rewriting it loses nothing. A plain table (every cell one paragraph, no merged
 * cells) counts; a macro, a mention, a panel or a table with merged or complex cells makes it false.
 */
export function isSimpleAdf(node: unknown): boolean {
  const ok = new Set(["doc", "paragraph", "heading", "text", "bulletList", "orderedList", "listItem", "codeBlock", "hardBreak", "table", "tableRow", "tableHeader", "tableCell"]);
  const marks = new Set(["strong", "em", "code", "link"]);
  const walk = (n: unknown): boolean => {
    if (typeof n !== "object" || n === null) return false;
    const o = n as AdfNode;
    if (!ok.has(o.type)) return false;
    if (Array.isArray(o.marks) && !o.marks.every((m) => marks.has(m.type))) return false;
    if (o.type === "table" && !(o.content ?? []).length) return false;
    if (o.type === "tableCell" || o.type === "tableHeader") {
      const a = (o.attrs ?? {}) as Record<string, unknown>;
      if ((a.colspan ?? 1) !== 1 || (a.rowspan ?? 1) !== 1) return false;
      if (!(o.content ?? []).every((c) => c.type === "paragraph")) return false;
    }
    return (o.content ?? []).every(walk);
  };
  return walk(node);
}

/**
 * ADF to Markdown, for keeping a Jira issue's description once when it is pulled in (issue #365). Reading only: it covers the nodes people
 * actually type (paragraphs, headings, bold, italic, code, links, bullet and numbered lists, code blocks, quotes, rules, plain tables) and
 * reads the content of anything else (panels, expands, layouts) as ordinary blocks, so no text is lost. Attachments and media are left out.
 * Links are kept only when they are http(s). The caller cuts the result and neutralises our markers and @mentions; nothing here is interpreted.
 */
export function adfToMarkdown(node: unknown): string {
  const kids = (n: AdfNode) => (Array.isArray(n.content) ? n.content : []);
  const inline = (n: AdfNode): string => {
    switch (n.type) {
      case "text": {
        let t = typeof n.text === "string" ? n.text : "";
        if (t === "") return "";
        for (const m of n.marks ?? []) {
          if (m.type === "code") t = `\`${t}\``;
          else if (m.type === "strong") t = `**${t}**`;
          else if (m.type === "em") t = `*${t}*`;
          else if ((m.type as string) === "strike") t = `~~${t}~~`;
          else if (m.type === "link") { const href = (m.attrs as { href?: unknown } | undefined)?.href; if (typeof href === "string" && /^https?:\/\//i.test(href)) t = `[${t}](${href})`; }
        }
        return t;
      }
      case "hardBreak": return "  \n";
      case "mention": return typeof n.attrs?.text === "string" ? n.attrs.text : "@someone";
      case "emoji": return typeof n.attrs?.text === "string" ? n.attrs.text : typeof n.attrs?.shortName === "string" ? n.attrs.shortName : "";
      case "inlineCard": return typeof n.attrs?.url === "string" && /^https?:\/\//i.test(n.attrs.url) ? n.attrs.url : "";
      case "status": return typeof n.attrs?.text === "string" ? `[${n.attrs.text}]` : "";
      default: return kids(n).map(inline).join("");
    }
  };
  const indent = (s: string, pad: string) => s.split("\n").map((l, i) => (i === 0 ? l : l === "" ? l : pad + l)).join("\n");
  const block = (n: AdfNode): string => {
    switch (n.type) {
      case "paragraph": return kids(n).map(inline).join("");
      case "heading": { const level = Math.min(6, Math.max(1, Number((n.attrs as { level?: unknown } | undefined)?.level) || 1)); return `${"#".repeat(level)} ${kids(n).map(inline).join("")}`; }
      case "bulletList": return kids(n).map((li) => `- ${indent(kids(li).map(block).filter((x) => x !== "").join("\n"), "  ")}`).join("\n");
      case "orderedList": return kids(n).map((li, i) => { const mark = `${i + 1}. `; return `${mark}${indent(kids(li).map(block).filter((x) => x !== "").join("\n"), " ".repeat(mark.length))}`; }).join("\n");
      case "codeBlock": { const lang = typeof n.attrs?.language === "string" && /^[\w+#-]{1,20}$/.test(n.attrs.language) ? n.attrs.language : ""; return `\`\`\`${lang}\n${kids(n).map((k) => (typeof k.text === "string" ? k.text : "")).join("")}\n\`\`\``; }
      case "blockquote": return kids(n).map(block).filter((x) => x !== "").join("\n\n").split("\n").map((l) => `> ${l}`).join("\n");
      case "rule": return "---";
      case "table": {
        const rows = kids(n).map((r) => kids(r).map((c) => kids(c).map(block).filter((x) => x !== "").join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ")));
        if (rows.length === 0) return "";
        const width = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
        return [line(rows[0]!), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
      }
      case "media": case "mediaSingle": case "mediaGroup": case "mediaInline": return "";
      case "text": case "hardBreak": case "mention": case "emoji": case "inlineCard": case "status": return inline(n);
      default: return kids(n).map(block).filter((x) => x !== "").join("\n\n");
    }
  };
  if (typeof node !== "object" || node === null) return "";
  return block(node as AdfNode).replace(/\n{3,}/g, "\n\n").trim();
}
