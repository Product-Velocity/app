// Reading a Confluence page into Markdown (issue #693 slice A2, docs/decisions/2026-11-26-document-home-in-confluence.md).
// Confluence stores a page as "storage format": XHTML with extra elements (`ac:` macros, links, images, task lists). This turns it into Markdown and
// says what it could not carry over (images, macros without text, merged table cells). It is lossy by nature and says so; it never passes HTML on:
// everything that is not understood becomes its text or is left out. The text it returns is data, never instructions (CLAUDE.md rule 4).

type El = { t: "el"; name: string; attrs: Record<string, string>; kids: Node[] };
type Tx = { t: "text"; v: string };
type Node = El | Tx;

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", yen: "¥", larr: "←", rarr: "→", uarr: "↑", darr: "↓", times: "×", laquo: "«", raquo: "»",
};
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isInteger(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const VOID = new Set(["br", "hr", "img", "col", "ri:attachment", "ri:page", "ri:url", "ri:user", "ri:space", "ac:emoticon", "ac:inline-comment-marker-ref"]);

function parse(src: string): El {
  const root: El = { t: "el", name: "#root", attrs: {}, kids: [] };
  const stack: El[] = [root];
  const top = () => stack[stack.length - 1]!;
  const text = (v: string) => { if (v) top().kids.push({ t: "text", v }); };
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) { text(decode(src.slice(i))); break; }
    if (lt > i) text(decode(src.slice(i, lt)));
    if (src.startsWith("<!--", lt)) { const end = src.indexOf("-->", lt + 4); i = end === -1 ? src.length : end + 3; continue; }
    if (src.startsWith("<![CDATA[", lt)) { const end = src.indexOf("]]>", lt + 9); text(src.slice(lt + 9, end === -1 ? src.length : end)); i = end === -1 ? src.length : end + 3; continue; }
    const gt = (() => {
      // the end of the tag, skipping quoted attribute values
      let q = "";
      for (let k = lt + 1; k < src.length; k++) {
        const c = src[k]!;
        if (q) { if (c === q) q = ""; } else if (c === '"' || c === "'") q = c; else if (c === ">") return k;
      }
      return -1;
    })();
    if (gt === -1) { text(decode(src.slice(lt))); break; }
    const raw = src.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim().toLowerCase();
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    if (raw.startsWith("?") || raw.startsWith("!")) continue;
    const self = raw.endsWith("/");
    const m = /^([A-Za-z][\w:.-]*)([\s\S]*?)\/?$/.exec(raw);
    if (!m) { text(decode(`<${raw}>`)); continue; }
    const name = m[1]!.toLowerCase();
    const attrs: Record<string, string> = {};
    for (const a of m[2]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!.toLowerCase()] = decode(a[2] ?? a[3] ?? "");
    const el: El = { t: "el", name, attrs, kids: [] };
    top().kids.push(el);
    if (!self && !VOID.has(name)) stack.push(el);
  }
  return root;
}

const kids = (e: El, name: string): El[] => e.kids.filter((k): k is El => k.t === "el" && k.name === name);
const first = (e: El, name: string): El | undefined => kids(e, name)[0];
const plain = (n: Node): string => (n.t === "text" ? n.v : n.name === "br" ? "\n" : n.kids.map(plain).join(""));
const param = (e: El, name: string): string => kids(e, "ac:parameter").find((p) => p.attrs["ac:name"] === name) ? plain(kids(e, "ac:parameter").find((p) => p.attrs["ac:name"] === name)!).trim() : "";
const safeHref = (h: string): boolean => /^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(h);

/** What could not be carried over, counted while converting. */
type Lost = { images: number; macros: Map<string, number>; merged: boolean };

/** A hard line break while converting (a plain "  \n" would be trimmed by the whitespace cleanup); it becomes two spaces and a newline at the end. */
const HARD = "\u0001";
const LANG = /^[A-Za-z0-9+#-]{1,20}$/;
const fence = (code: string, lang = ""): string => {
  const body = code.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const ticks = "`".repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${ticks}${LANG.test(lang) ? lang.toLowerCase() : ""}\n${body}\n${ticks}`;
};

const PANELS: Record<string, string> = { info: "Info", note: "Note", warning: "Warning", tip: "Tip", panel: "Note" };
/** Macros that sit inside a sentence (a status lozenge, a Jira issue) and so stay in their paragraph. */
const isInlineMacro = (n: El): boolean => n.name === "ac:structured-macro" && ["status", "jira"].includes((n.attrs["ac:name"] ?? "").toLowerCase());
const SKIPPED_MACROS = new Set(["toc", "children", "pagetree", "recently-updated", "contentbylabel", "livesearch", "anchor", "excerpt-include", "include", "gallery", "profile", "page-info", "tasks-report-macro", "jira-chart", "chart"]);

function inline(nodes: Node[], lost: Lost): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") { out += n.v.replace(/\s+/g, " "); continue; }
    switch (n.name) {
      case "strong": case "b": { const t = inline(n.kids, lost).trim(); out += t ? `**${t}**` : ""; break; }
      case "em": case "i": { const t = inline(n.kids, lost).trim(); out += t ? `*${t}*` : ""; break; }
      case "del": case "s": case "strike": { const t = inline(n.kids, lost).trim(); out += t ? `~~${t}~~` : ""; break; }
      case "code": { const t = plain(n).trim(); out += t ? `\`${t.replace(/`/g, "'")}\`` : ""; break; }
      case "br": out += HARD; break;
      case "a": {
        const t = inline(n.kids, lost).trim();
        const h = n.attrs.href ?? "";
        out += t && safeHref(h) ? `[${t}](${h})` : t;
        break;
      }
      case "img": lost.images++; out += n.attrs.alt ? `(image: ${n.attrs.alt})` : "(image)"; break;
      case "ac:image": { lost.images++; const f = first(n, "ri:attachment")?.attrs["ri:filename"]; out += f ? `(image: ${f})` : "(image)"; break; }
      case "ac:link": {
        const body = first(n, "ac:plain-text-link-body") ?? first(n, "ac:link-body");
        const named = first(n, "ri:page")?.attrs["ri:content-title"] ?? first(n, "ri:attachment")?.attrs["ri:filename"] ?? (first(n, "ri:user") ? "a person" : "");
        out += (body ? plain(body) : named).trim();
        break;
      }
      case "ac:emoticon": out += n.attrs["ac:emoji-fallback"] ?? (n.attrs["ac:name"] ? `:${n.attrs["ac:name"]}:` : ""); break;
      case "time": out += n.attrs.datetime ?? plain(n); break;
      case "ac:placeholder": case "ac:inline-comment-marker-ref": break;
      case "ac:structured-macro": {
        const name = (n.attrs["ac:name"] ?? "").toLowerCase();
        if (name === "status") { const t = param(n, "title"); out += t ? `[${t}]` : ""; }
        else if (name === "jira") { const k = param(n, "key"); out += k ? `[${k}]` : ""; }
        else if (name === "code" || PANELS[name]) out += plain(n).replace(/\s+/g, " ");
        else if (!SKIPPED_MACROS.has(name)) { const t = inline(first(n, "ac:rich-text-body")?.kids ?? [], lost); if (t.trim()) out += t; else lost.macros.set(name || "unknown", (lost.macros.get(name || "unknown") ?? 0) + 1); }
        else lost.macros.set(name, (lost.macros.get(name) ?? 0) + 1);
        break;
      }
      default: out += inline(n.kids, lost);
    }
  }
  return out;
}

const clean = (s: string): string => s.replace(/[ \t]+\n/g, "\n").replace(/ {2,}(?!\n)/g, " ").trim();
const cell = (s: string): string => clean(s).replace(new RegExp(HARD, "g"), " ").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

function list(e: El, lost: Lost, depth: number): string {
  const ordered = e.name === "ol";
  const lines: string[] = [];
  let n = 0;
  for (const li of kids(e, "li")) {
    n++;
    const bullet = ordered ? `${n}.` : "-";
    const pad = "  ".repeat(depth);
    const nested = li.kids.filter((k): k is El => k.t === "el" && (k.name === "ul" || k.name === "ol"));
    const own = li.kids.filter((k) => !(k.t === "el" && (k.name === "ul" || k.name === "ol")));
    const text = clean(blocks(own, lost, depth + 1).split("\n\n").join(" ")).replace(new RegExp(HARD, "g"), " ").replace(/\n/g, " ");
    lines.push(`${pad}${bullet} ${text}`.trimEnd());
    for (const sub of nested) lines.push(list(sub, lost, depth + 1));
  }
  return lines.join("\n");
}

function table(e: El, lost: Lost): string {
  const rows = [...kids(e, "tr"), ...[...kids(e, "thead"), ...kids(e, "tbody"), ...kids(e, "tfoot")].flatMap((g) => kids(g, "tr"))];
  const grid = rows.map((r) => r.kids.filter((c): c is El => c.t === "el" && (c.name === "th" || c.name === "td")));
  if (grid.length === 0) return "";
  for (const r of grid) for (const c of r) if ((c.attrs.colspan && c.attrs.colspan !== "1") || (c.attrs.rowspan && c.attrs.rowspan !== "1")) lost.merged = true;
  const width = Math.max(...grid.map((r) => r.length));
  const text = grid.map((r) => Array.from({ length: width }, (_, i) => cell(r[i] ? blocks(r[i]!.kids, lost, 0).split("\n\n").join(" ") : "")));
  const header = grid[0]!.some((c) => c.name === "th") ? text[0]! : Array.from({ length: width }, () => "");
  const body = grid[0]!.some((c) => c.name === "th") ? text.slice(1) : text;
  const row = (r: string[]) => `| ${r.join(" | ")} |`;
  return [row(header), row(Array.from({ length: width }, () => "---")), ...body.map(row)].join("\n");
}

function macro(e: El, lost: Lost, depth: number): string {
  const name = (e.attrs["ac:name"] ?? "").toLowerCase();
  const body = first(e, "ac:rich-text-body");
  if (name === "code") return fence(plain(first(e, "ac:plain-text-body") ?? e), param(e, "language"));
  if (PANELS[name]) {
    const text = blocks(body?.kids ?? [], lost, depth).trim();
    if (/^Managed in Product Velocity/i.test(text)) return ""; // the notice our own publish puts at the top of a page
    return text ? `> **${param(e, "title") || PANELS[name]}:** ${text.replace(/\n/g, "\n> ")}` : "";
  }
  if (body && !SKIPPED_MACROS.has(name)) return blocks(body.kids, lost, depth);
  if (name === "status" || name === "jira") return inline([e], lost);
  lost.macros.set(name || "unknown", (lost.macros.get(name || "unknown") ?? 0) + 1);
  return "";
}

function blocks(nodes: Node[], lost: Lost, depth: number): string {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => { const t = clean(inline(run, lost)); if (t) out.push(t); run = []; };
  for (const n of nodes) {
    if (n.t === "text") { run.push(n); continue; }
    const h = /^h([1-6])$/.exec(n.name);
    if (h) { flush(); const t = clean(inline(n.kids, lost)).replace(new RegExp(HARD, "g"), " ").replace(/\n/g, " "); if (t) out.push(`${"#".repeat(Number(h[1]))} ${t}`); continue; }
    switch (n.name) {
      case "p": case "div": case "section": case "article": case "ac:layout": case "ac:layout-section": case "ac:layout-cell": case "ac:rich-text-body": case "details": case "summary": case "span":
        if (n.kids.some((k) => k.t === "el" && !isInlineMacro(k) && ["p", "div", "ul", "ol", "table", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ac:structured-macro", "ac:task-list", "ac:layout-section", "ac:layout-cell", "hr"].includes(k.name))) { flush(); const t = blocks(n.kids, lost, depth); if (t) out.push(t); }
        else if (n.name === "span") run.push(n);
        else { flush(); const t = clean(inline(n.kids, lost)); if (t) out.push(t); }
        break;
      case "ul": case "ol": flush(); out.push(list(n, lost, 0)); break;
      case "table": flush(); { const t = table(n, lost); if (t) out.push(t); } break;
      case "blockquote": { flush(); const t = blocks(n.kids, lost, depth).trim(); if (t) out.push(t.split("\n").map((l) => `> ${l}`.trimEnd()).join("\n")); break; }
      case "hr": flush(); out.push("---"); break;
      case "pre": flush(); out.push(fence(plain(n))); break;
      case "ac:structured-macro": if (isInlineMacro(n)) { run.push(n); break; } flush(); { const t = macro(n, lost, depth); if (t) out.push(t); } break;
      case "ac:task-list": {
        flush();
        const items = kids(n, "ac:task").map((t) => `- [${plain(first(t, "ac:task-status") ?? { t: "text", v: "" }).trim() === "complete" ? "x" : " "}] ${clean(inline(first(t, "ac:task-body")?.kids ?? [], lost))}`.trimEnd());
        if (items.length) out.push(items.join("\n"));
        break;
      }
      case "br": run.push(n); break;
      default: run.push(n);
    }
  }
  flush();
  return out.join("\n\n");
}

export type StorageToMarkdown = { markdown: string; lost: string[] };

/** Confluence storage format to Markdown, with a plain list of what was left out (images, macros without text, merged table cells). */
export function storageToMarkdown(storage: string): StorageToMarkdown {
  const lost: Lost = { images: 0, macros: new Map(), merged: false };
  const markdown = blocks(parse(storage).kids, lost, 0).replace(new RegExp(` *${HARD} *`, "g"), "  \n").replace(/\n{3,}/g, "\n\n").trim();
  const notes: string[] = [];
  if (lost.images > 0) notes.push(`${lost.images} image${lost.images === 1 ? "" : "s"} could not be copied; the file name is kept as text.`);
  if (lost.macros.size > 0) notes.push(`Left out (no text to copy): ${[...lost.macros].map(([n, c]) => `${n}${c > 1 ? ` ×${c}` : ""}`).join(", ")}.`);
  if (lost.merged) notes.push("A table has merged cells; they are shown as single cells.");
  return { markdown, lost: notes };
}
