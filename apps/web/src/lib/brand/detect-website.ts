import "server-only";
import { luminance, normalizeHex } from "@pv/domain";
import { fetchPublic } from "@/lib/link-title";

/**
 * What a company's own website says about its brand (issue #750): a proposal, never a decision. A person looks at it, picks what is right and an admin confirms.
 * The page and up to two of its stylesheets are read through the same guarded fetch as a link title (public addresses only, size and time limits).
 * Colours: named brand variables first, the page's theme colour next, then the most used saturated colours; greys, white and black are ignored.
 * Fonts: the first family of the most used font-family rules, and Google Fonts links; generic families are ignored. Logo candidates: pictures marked as the
 * logo, the page's icons and its share image. Nothing here is trusted: values are checked and only hex colours and short names come out.
 */
export type BrandProposal = {
  name: string | null;
  colors: string[];
  fonts: string[];
  logoCandidates: string[];
  notes: string[];
};

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "inherit", "initial", "unset", "emoji", "math", "-apple-system", "blinkmacsystemfont", "segoe ui", "helvetica", "helvetica neue", "arial", "times new roman", "times", "georgia", "courier new", "courier", "verdana", "tahoma", "trebuchet ms", "apple color emoji", "segoe ui emoji"]);
const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(Math.min(0x10ffff, e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) || 32) : ENTITY[e.toLowerCase()] ?? m));
const attr = (tag: string, name: string) => { const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag); return m ? decode(m[1] ?? m[2] ?? "") : null; };

function hsl(hex: string): { s: number; l: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  return { s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
}
/** A colour that could be a brand colour: clearly coloured, not almost white or almost black. */
export const isBrandish = (hex: string) => { const { s, l } = hsl(hex); return s >= 0.35 && l >= 0.12 && l <= 0.88; };
const toHex = (raw: string): string | null => {
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(raw);
  if (rgb) return normalizeHex("#" + [rgb[1], rgb[2], rgb[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, "0")).join(""));
  return normalizeHex(raw);
};
const distance = (a: string, b: string) => Math.abs(luminance(a) - luminance(b)) + [1, 3, 5].reduce((n, i) => n + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0) / 765;

/** Pure: the proposal from the page's HTML, its stylesheets' text and its address. */
export function parseWebsite(input: { html: string; css: string; base: string }): BrandProposal {
  const { html, css, base } = input;
  const all = `${html}\n${css}`;
  const notes: string[] = [];
  // name
  const og = /<meta\b[^>]*\bproperty\s*=\s*["']og:site_name["'][^>]*>/i.exec(html)?.[0];
  const titleRaw = (og ? attr(og, "content") : null) ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const name = decode(titleRaw.replace(/<[^>]*>/g, "")).split(/\s[|–—-]\s/)[0]!.replace(/\s+/g, " ").trim().slice(0, 120) || null;

  // colours: named variables, then the theme colour, then frequency
  const ordered: string[] = [];
  const push = (raw: string | null | undefined) => { const h = raw ? toHex(raw.trim()) : null; if (h && isBrandish(h) && !ordered.includes(h)) ordered.push(h); };
  const color = "(#[0-9a-f]{3,8}\\b|rgba?\\([^)]*\\))";
  for (const rank of ["primary|brand", "accent|secondary|highlight|theme|main"]) {
    for (const m of all.matchAll(new RegExp(`--[a-z0-9-]*(?:${rank})[a-z0-9-]*\\s*:\\s*${color}`, "gi"))) push(m[1]);
  }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if (/name\s*=\s*["']theme-color["']/i.test(m[0])) push(attr(m[0], "content"));
  const counts = new Map<string, number>();
  for (const m of all.matchAll(new RegExp(color, "gi"))) { const h = toHex(m[1]!); if (h && isBrandish(h)) counts.set(h, (counts.get(h) ?? 0) + 1); }
  for (const [h] of [...counts.entries()].sort((a, b) => b[1] - a[1])) if (!ordered.includes(h) && ordered.every((o) => distance(o, h) > 0.12)) push(h);
  if (ordered.length === 0) notes.push("No brand colour stood out on the page. Type one in.");

  // fonts
  const fontCount = new Map<string, number>();
  const addFont = (f: string) => { const n = f.replace(/["']/g, "").trim(); if (n && n.length <= 80 && !GENERIC.has(n.toLowerCase()) && !n.startsWith("var(") && /^[\w .+-]+$/.test(n)) fontCount.set(n, (fontCount.get(n) ?? 0) + 1); };
  for (const m of all.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) addFont(m[1]!.split(",")[0]!);
  for (const m of all.matchAll(/fonts\.googleapis\.com\/css2?\?[^"'\s>]*/gi)) for (const f of m[0].matchAll(/family=([^&:;"']+)/g)) addFont(decodeURIComponent(f[1]!).replace(/\+/g, " "));
  const fonts = [...fontCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);

  // logo candidates, best first
  const abs = (href: string | null) => { if (!href) return null; try { const u = new URL(href.trim(), base); return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null; } catch { return null; } };
  const cands: string[] = [];
  const add = (u: string | null) => { if (u && !cands.includes(u) && cands.length < 6) cands.push(u); };
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) if (/logo/i.test(`${attr(m[0], "class") ?? ""} ${attr(m[0], "id") ?? ""} ${attr(m[0], "alt") ?? ""} ${attr(m[0], "src") ?? ""}`)) add(abs(attr(m[0], "src")));
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const sized = (t: string) => Number(/(\d+)x\d+/.exec(attr(t, "sizes") ?? "")?.[1] ?? 0);
  for (const t of links.filter((l) => /apple-touch-icon/i.test(attr(l, "rel") ?? "")).sort((a, b) => sized(b) - sized(a))) add(abs(attr(t, "href")));
  for (const t of links.filter((l) => /\bicon\b/i.test(attr(l, "rel") ?? "") && !/apple-touch/i.test(attr(l, "rel") ?? "")).sort((a, b) => sized(b) - sized(a))) add(abs(attr(t, "href")));
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if (/property\s*=\s*["']og:image["']/i.test(m[0])) add(abs(attr(m[0], "content")));
  if (cands.length === 0) notes.push("No logo was found on the page. Upload one.");
  return { name, colors: ordered.slice(0, 6), fonts, logoCandidates: cands, notes };
}

/** Reads the website (the page and its first two stylesheets) and proposes a brand. Answers null when the page cannot be read. */
export async function detectBrandFromWebsite(rawUrl: string): Promise<BrandProposal | null> {
  const page = await fetchPublic(rawUrl, { accept: "text/html", maxBytes: 400 * 1024, types: /^text\/html|^application\/xhtml/i, timeoutMs: 6000, userAgent: "ProductVelocityBrandReader/1.0" });
  if (!page) return null;
  const html = page.body.toString("utf8");
  const sheets = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((l) => /stylesheet/i.test(attr(l, "rel") ?? "")).slice(0, 2);
  let css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  for (const l of sheets) {
    const href = attr(l, "href");
    let abs: string | null = null;
    try { abs = href ? new URL(href, page.url).toString() : null; } catch { /* a bad address is skipped */ }
    const sheet = abs ? await fetchPublic(abs, { accept: "text/css", maxBytes: 400 * 1024, types: /^text\/css/i, timeoutMs: 6000, userAgent: "ProductVelocityBrandReader/1.0" }) : null;
    if (sheet) css += `\n${sheet.body.toString("utf8")}`;
  }
  return parseWebsite({ html, css, base: page.url.toString() });
}
