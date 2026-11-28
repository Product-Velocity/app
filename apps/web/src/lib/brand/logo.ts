import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * A company logo as the product stores it (issue #750): whatever was uploaded or found is re-drawn as a PNG by the server, so the file that is ever served is
 * ours (no script, no external reference, no odd format) and email clients can show it. At most 1 MB in, 25 million pixels, 640 by 240 out, 600 KB out.
 */
export const MAX_LOGO_INPUT = 1_000_000;
const MAX_LOGO_OUTPUT = 600_000;
const FORMATS = new Set(["png", "jpeg", "svg", "webp"]);

export type LogoResult = { ok: true; png: Buffer; sha: string; width: number; height: number } | { ok: false; error: string };

/** An SVG may not carry a script, an embedded page or a reference to anything outside itself. */
export function svgIsPlain(text: string): boolean {
  if (/<\s*script|<\s*foreignObject|<\s*iframe|<\s*object|<\s*embed|\son[a-z]+\s*=|javascript:|<!ENTITY/i.test(text)) return false;
  for (const m of text.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) {
    const v = (m[1] ?? "").trim();
    if (!(v.startsWith("#") || /^data:image\/(png|jpeg|webp);base64,/i.test(v))) return false;
  }
  if (/url\(\s*["']?(?!#)/i.test(text)) return false;
  return true;
}

export async function makeLogoPng(input: Uint8Array): Promise<LogoResult> {
  if (input.length === 0) return { ok: false, error: "The file is empty." };
  if (input.length > MAX_LOGO_INPUT) return { ok: false, error: "The logo must be 1 MB or smaller." };
  const buf = Buffer.from(input);
  try {
    const looksSvg = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(buf.subarray(0, 2000).toString("utf8"));
    if (looksSvg && !svgIsPlain(buf.toString("utf8"))) return { ok: false, error: "This SVG has a script or points at something outside itself. Export it again as a plain logo, or upload a PNG." };
    const base = sharp(buf, { limitInputPixels: 25_000_000, failOn: "error", ...(looksSvg ? { density: 192 } : {}) });
    const meta = await base.metadata();
    if (!meta.format || !FORMATS.has(meta.format)) return { ok: false, error: "Use a PNG, JPG, WebP or SVG logo." };
    if ((meta.pages ?? 1) > 1) return { ok: false, error: "Use a still image, not an animation." };
    const out = await base.rotate().resize({ width: 640, height: 240, fit: "inside", withoutEnlargement: meta.format !== "svg" }).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    const { width, height } = out.info;
    if (width < 16 || height < 16) return { ok: false, error: "The logo is too small to use (at least 16 by 16 pixels)." };
    if (out.data.length > MAX_LOGO_OUTPUT) return { ok: false, error: "The logo is too detailed to use. Try a simpler version." };
    return { ok: true, png: out.data, sha: createHash("sha256").update(out.data).digest("hex"), width, height };
  } catch {
    return { ok: false, error: "We could not read that image. Use a PNG, JPG, WebP or SVG logo." };
  }
}
