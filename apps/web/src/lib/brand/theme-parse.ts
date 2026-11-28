import "server-only";
import JSZip from "jszip";
import { normalizeHex } from "@pv/domain";

/**
 * Reads the theme out of a PowerPoint or Word file (issue #750): the colour scheme, the heading and body fonts, and for a presentation the first picture on
 * the slide master (usually the logo). The file is data: nothing in it is run or passed on as text. Only these parts are read; macro-enabled files are refused;
 * the size of the file, the number of parts and the size of each part read are limited, so a zip bomb cannot cost more than a few megabytes.
 */
export const MAX_THEME_FILE = 25 * 1024 * 1024;
const MAX_PARTS = 4000;
const MAX_XML = 2 * 1024 * 1024;
const MAX_IMAGE = 1_000_000;
const MACRO = /\.(pptm|potm|ppsm|docm|dotm|xlsm)$/i;

export type ThemeKind = "pptx" | "docx";
export type ThemeInfo = {
  kind: ThemeKind;
  name: string | null;
  /** dk1, lt1, dk2, lt2, accent1 to accent6, hlink, folHlink as #rrggbb (those the file defines). */
  colors: Record<string, string>;
  fonts: { major: string | null; minor: string | null };
  /** The first picture on the slide master (presentations only), if it is small enough. */
  logo: Buffer | null;
};
export type ThemeResult = { ok: true; theme: ThemeInfo } | { ok: false; error: string };

const SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"] as const;
export const ACCENT_SLOTS = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const;

/** The declared uncompressed size of a zip part (JSZip keeps it on the part's data record). */
function declaredSize(entry: JSZip.JSZipObject): number {
  const d = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
  return typeof d?.uncompressedSize === "number" ? d.uncompressedSize : Number.POSITIVE_INFINITY;
}

export function parseThemeXml(xml: string): Pick<ThemeInfo, "name" | "colors" | "fonts"> {
  const scheme = /<a:clrScheme\b([^>]*)>([\s\S]*?)<\/a:clrScheme>/i.exec(xml);
  const name = scheme ? /\bname\s*=\s*"([^"]{1,80})"/i.exec(scheme[1] ?? "")?.[1] ?? null : null;
  const colors: Record<string, string> = {};
  for (const slot of SLOTS) {
    const m = new RegExp(`<a:${slot}>([\\s\\S]*?)</a:${slot}>`, "i").exec(scheme?.[2] ?? "");
    if (!m) continue;
    const v = /<a:srgbClr\b[^>]*\bval\s*=\s*"([0-9a-f]{6})"/i.exec(m[1]!)?.[1] ?? /<a:sysClr\b[^>]*\blastClr\s*=\s*"([0-9a-f]{6})"/i.exec(m[1]!)?.[1];
    const hex = v ? normalizeHex(v) : null;
    if (hex) colors[slot] = hex;
  }
  const font = (tag: "majorFont" | "minorFont") => {
    const f = new RegExp(`<a:${tag}>[\\s\\S]*?<a:latin\\b[^>]*\\btypeface\\s*=\\s*"([^"]{1,80})"`, "i").exec(xml)?.[1];
    return f && !f.startsWith("+") ? f : null;
  };
  return { name, colors, fonts: { major: font("majorFont"), minor: font("minorFont") } };
}

export async function readTheme(bytes: Uint8Array, filename: string): Promise<ThemeResult> {
  if (MACRO.test(filename)) return { ok: false, error: "Macro-enabled files are not accepted. Save the file as a plain .pptx or .docx (or a template, .potx or .dotx)." };
  const kind: ThemeKind | null = /\.(pptx|potx|ppsx)$/i.test(filename) ? "pptx" : /\.(docx|dotx)$/i.test(filename) ? "docx" : null;
  if (!kind) return { ok: false, error: "Use a PowerPoint (.pptx, .potx) or Word (.docx, .dotx) file." };
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_THEME_FILE) return { ok: false, error: "The file must be 25 MB or smaller." };
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: false }); } catch { return { ok: false, error: "We could not open that file. Is it a real Office file?" }; }
  const names = Object.keys(zip.files);
  if (names.length > MAX_PARTS) return { ok: false, error: "That file has too many parts to read safely." };
  if (names.some((n) => /vbaProject\.bin$/i.test(n))) return { ok: false, error: "That file contains macros, which are not accepted. Save it without them." };
  const themePath = kind === "pptx" ? "ppt/theme/theme1.xml" : "word/theme/theme1.xml";
  const entry = zip.file(themePath);
  if (!entry) return { ok: false, error: "No theme was found in that file." };
  if (declaredSize(entry) > MAX_XML) return { ok: false, error: "The theme in that file is too large to read safely." };
  const parsed = parseThemeXml(await entry.async("string"));
  if (Object.keys(parsed.colors).length === 0 && !parsed.fonts.major && !parsed.fonts.minor) return { ok: false, error: "That file's theme has no colours or fonts we can read." };

  let logo: Buffer | null = null;
  if (kind === "pptx") {
    const rels = zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels");
    if (rels && declaredSize(rels) <= MAX_XML) {
      const text = await rels.async("string");
      for (const m of text.matchAll(/Target\s*=\s*"\.\.\/media\/([A-Za-z0-9_.-]+)"/g)) {
        const img = zip.file(`ppt/media/${m[1]}`);
        if (img && /\.(png|jpe?g|svg)$/i.test(m[1]!) && declaredSize(img) <= MAX_IMAGE) { logo = Buffer.from(await img.async("uint8array")); break; }
      }
    }
  }
  return { ok: true, theme: { kind, name: parsed.name, colors: parsed.colors, fonts: parsed.fonts, logo } };
}
