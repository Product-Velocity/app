// Publishing a written document to a Confluence page (issue #693 slice B, docs/decisions/2026-11-26-document-home-in-confluence.md).
// Everything here is pure: Markdown to Confluence's page format ("storage format"), the warning about commercial text, reading a page id from a
// page address, and the decision whether a publish creates, updates, has nothing to send or is a conflict. The calls to Confluence are elsewhere.

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string => esc(s).replace(/"/g, "&quot;");

/** A link target Confluence may open: web addresses and mail links only (never javascript: or data:). */
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s<>"']+$/i;

/** Code inside CDATA: a literal `]]>` would end the section early, so it is split across two sections. */
const cdata = (s: string): string => `<![CDATA[${s.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;

/** Inline Markdown: code, bold, italic, strike-through, links and images (an image becomes its text; images are not published). Raw HTML is shown as text. */
export function inline(src: string): string {
  const codes: string[] = [];
  // 1. code spans are taken out first so their content is not formatted
  let s = src.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _t: string, c: string) => {
    codes.push(`<code>${esc(c.trim())}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // 2. images, then links (text may carry formatting; the address is checked)
  const links: string[] = [];
  s = s.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g, (_m, alt: string, url: string) => `${alt || "image"} (${url})`);
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g, (_m, text: string, url: string) => {
    links.push(SAFE_HREF.test(url) ? `<a href="${escAttr(url)}">` : "");
    return `\u0001${links.length - 1}\u0001${text}\u0002${links.length - 1}\u0002`;
  });
  s = esc(s);
  // 3. emphasis
  s = s.replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g, (_m, a: string, b: string) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)|(^|[^_\w])_([^_\n]+?)_(?![_\w])/g, (_m, p1: string | undefined, a: string | undefined, p2: string | undefined, b: string | undefined) => `${p1 ?? p2 ?? ""}<em>${a ?? b}</em>`);
  s = s.replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");
  // 4. put links and code back
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => links[Number(i)] ?? "").replace(/\u0002(\d+)\u0002/g, (_m, i: string) => (links[Number(i)] ? "</a>" : ""));
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? "");
  // a hard line break: two spaces or a backslash before the end of a line
  return s.replace(/(?: {2,}|\\)\n/g, "<br/>");
}

const isBlank = (l: string): boolean => l.trim() === "";
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const splitRow = (line: string): string[] => {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") { cur += "|"; i++; } else if (t[i] === "|") { cells.push(cur.trim()); cur = ""; } else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
};

function renderList(lines: string[], start: number): [string, number] {
  const first = LIST_ITEM.exec(lines[start]!)!;
  const base = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const tag = ordered ? "ol" : "ul";
  let out = `<${tag}>`;
  let i = start;
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i]!);
    if (!m || m[1]!.length < base) break;
    if (m[1]!.length > base) break; // a deeper item belongs to the item before it (handled below)
    if (/\d/.test(m[2]!) !== ordered) break;
    let text = m[3]!;
    text = text.replace(/^\[ \]\s+/, "☐ ").replace(/^\[[xX]\]\s+/, "☑ ");
    i++;
    // continuation lines of this item (indented, not a new item) and nested lists
    const cont: string[] = [text];
    let nested = "";
    while (i < lines.length) {
      const l = lines[i]!;
      if (isBlank(l)) break;
      const n = LIST_ITEM.exec(l);
      if (n && n[1]!.length > base) { const [html, next] = renderList(lines, i); nested += html; i = next; continue; }
      if (n || HEADING.test(l) || FENCE.test(l)) break;
      if (/^\s+\S/.test(l)) { cont.push(l.trim()); i++; continue; }
      break;
    }
    out += `<li>${inline(cont.join("\n"))}${nested}</li>`;
    // a blank line between items of the same list does not end it
    if (i < lines.length && isBlank(lines[i]!)) {
      let j = i;
      while (j < lines.length && isBlank(lines[j]!)) j++;
      const n = j < lines.length ? LIST_ITEM.exec(lines[j]!) : null;
      if (n && n[1]!.length === base && /\d/.test(n[2]!) === ordered) i = j;
    }
  }
  return [`${out}</${tag}>`, i];
}

function blocks(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let out = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) { i++; continue; }
    let m: RegExpExecArray | null;
    if ((m = FENCE.exec(line))) {
      const fence = m[1]!;
      const lang = /^[A-Za-z0-9+#-]{1,20}$/.test(m[2]!) ? m[2]!.toLowerCase() : "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(lines[i]!)) { body.push(lines[i]!); i++; }
      i++; // the closing fence (or the end of the text)
      out += `<ac:structured-macro ac:name="code" ac:schema-version="1">${lang ? `<ac:parameter ac:name="language">${esc(lang)}</ac:parameter>` : ""}<ac:plain-text-body>${cdata(body.join("\n"))}</ac:plain-text-body></ac:structured-macro>`;
      continue;
    }
    if ((m = HEADING.exec(line))) { const n = m[1]!.length; out += `<h${n}>${inline(m[2]!)}</h${n}>`; i++; continue; }
    if (HR.test(line)) { out += "<hr/>"; i++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i]!)) { q.push(lines[i]!.replace(/^ {0,3}> ?/, "")); i++; }
      out += `<blockquote>${blocks(q.join("\n"))}</blockquote>`;
      continue;
    }
    if (LIST_ITEM.test(line)) { const [html, next] = renderList(lines, i); out += html; i = next; continue; }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes("-")) {
      const head = splitRow(line);
      i += 2;
      let rows = "";
      while (i < lines.length && !isBlank(lines[i]!) && lines[i]!.includes("|")) {
        const cells = splitRow(lines[i]!);
        rows += `<tr>${head.map((_, c) => `<td>${inline(cells[c] ?? "")}</td>`).join("")}</tr>`;
        i++;
      }
      out += `<table><tbody><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr>${rows}</tbody></table>`;
      continue;
    }
    // a paragraph: lines until a blank line or the start of another block
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]!) && !(para.length > 0 && (HEADING.test(lines[i]!) || FENCE.test(lines[i]!) || HR.test(lines[i]!) || /^ {0,3}>/.test(lines[i]!) || LIST_ITEM.test(lines[i]!)))) { para.push(lines[i]!); i++; }
    out += `<p>${inline(para.join("\n"))}</p>`;
  }
  return out;
}

/** The Markdown of a document as Confluence storage format. Raw HTML in the Markdown is shown as text, never passed on. */
export function markdownToStorage(markdown: string): string {
  return blocks(markdown).replace(/\n/g, " ");
}

/** The notice at the top of a published page: it is managed in Product Velocity, so a change made here can be overwritten. */
export function managedBanner(opts: { link?: string; code?: string } = {}): string {
  const where = opts.link && /^https:\/\//i.test(opts.link) ? ` <a href="${escAttr(opts.link)}">${esc(opts.code ? `Open ${opts.code} in Product Velocity` : "Open in Product Velocity")}</a>.` : "";
  return `<ac:structured-macro ac:name="info" ac:schema-version="1"><ac:rich-text-body><p>Managed in Product Velocity. A change made on this page can be overwritten the next time the document is published.${where}</p></ac:rich-text-body></ac:structured-macro>`;
}

/** The whole page body: the banner, then the document. */
export function pageBody(markdown: string, opts: { link?: string; code?: string } = {}): string {
  return managedBanner(opts) + markdownToStorage(markdown);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Commercial text: Confluence is the customer's own private site (decision 2026-10-29), so publishing is allowed, but the person is warned.
// ---------------------------------------------------------------------------------------------------------------------------------
export type CommercialTerm = { kind: "customer" | "key_result" | "value"; label: string; text: string };
export type CommercialWarning = { kind: "customer" | "key_result" | "value" | "money"; what: string };

const MONEY = /(?:[€$£]\s?\d[\d.,]*\s?(?:k|m|bn|million|billion)?\b|\b\d[\d.,]*\s?(?:k|m|bn|million|billion)?\s?(?:EUR|USD|GBP)\b)/gi;
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** What in the text looks commercial: the given terms (customer names, key results, the value) found in it, and any amount of money. Never blocks; at most 20. */
export function commercialWarnings(markdown: string, terms: readonly CommercialTerm[]): CommercialWarning[] {
  const text = norm(markdown);
  const out: CommercialWarning[] = [];
  const seen = new Set<string>();
  const add = (w: CommercialWarning) => { const k = `${w.kind}|${w.what}`; if (!seen.has(k) && out.length < 20) { seen.add(k); out.push(w); } };
  for (const t of terms) {
    const needle = norm(t.text);
    if (needle.length >= 3 && text.includes(needle)) add({ kind: t.kind, what: t.label });
  }
  for (const m of markdown.matchAll(MONEY)) add({ kind: "money", what: m[0].trim() });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Pages and plans
// ---------------------------------------------------------------------------------------------------------------------------------
/** The page id in a Confluence address (`/wiki/spaces/KEY/pages/12345/Title` or `...viewpage.action?pageId=12345`); null for a short link or anything else. */
export function pageIdFromUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const q = u.searchParams.get("pageId");
  if (q && /^\d{1,20}$/.test(q)) return q;
  const m = /\/pages\/(\d{1,20})(?:\/|$)/.exec(u.pathname);
  return m ? m[1]! : null;
}

export type PublishedPage = { pageId: string; publishedVersion: number; remoteVersion: number | null; contentHash: string | null };
export type RemotePage = { id: string; version: number; title: string } | "missing" | null;
export type PublishAction = "create" | "update" | "none" | "conflict" | "gone";

/**
 * What a publish does. `published` is the live publication of the document (null when it was never published or was unlinked), `remote` what Confluence
 * says about that page now (null when it was not asked, "missing" when the page is gone).
 * - none: the page already holds this version of the document, built the same way;
 * - conflict: somebody saved the page in Confluence since our last write (its version moved), so overwriting would lose their change;
 * - gone: the page was deleted in Confluence; the person may publish to a new page.
 */
export function planPublish(input: { published: PublishedPage | null; docVersion: number; bodyHash: string; remote: RemotePage }): { action: PublishAction; why: string } {
  const { published, docVersion, bodyHash, remote } = input;
  if (!published) return { action: "create", why: "A new page will be created." };
  if (remote === "missing") return { action: "gone", why: "The page was deleted in Confluence." };
  if (remote && published.remoteVersion !== null && remote.version !== published.remoteVersion) return { action: "conflict", why: `The page was changed in Confluence (version ${remote.version}) after Product Velocity last wrote it (version ${published.remoteVersion}).` };
  if (published.publishedVersion === docVersion && published.contentHash === bodyHash) return { action: "none", why: "The page already holds this version of the document." };
  return { action: "update", why: published.publishedVersion === docVersion ? "The page will be rewritten from the document." : `The page holds version ${published.publishedVersion}; version ${docVersion} will be written.` };
}
