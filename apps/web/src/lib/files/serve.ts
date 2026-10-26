import { randomBytes } from "node:crypto";

/** 256 random bits, URL-safe: cannot be guessed, only handed out. */
export const newShareToken = () => randomBytes(32).toString("base64url");
export const isShareToken = (s: string) => /^[A-Za-z0-9_-]{32,64}$/.test(s);

/** Public address of a share link. The name is only for people reading the URL; the token is what opens the file. */
export const shareUrl = (appUrl: string, token: string, name: string) => `${appUrl}/f/${token}/${encodeURIComponent(name)}`;

/**
 * Bytes plus headers that keep an uploaded file inert: it is shown as its own type, never sniffed, never allowed to run
 * anything, not indexed, and the address is not passed on in Referer. Shared links are not cached by shared caches.
 */
export function fileResponse(bytes: Uint8Array, mime: string, name: string, opts: { download?: boolean } = {}): Response {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${opts.download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
    },
  });
}

export type FileRow = { id: string; name: string; kind: string; mime_type: string | null; size_bytes: number | null; share_token: string | null };
/** What the browser gets about a file. The token itself is only ever sent inside the share address. */
export const toFile = (r: FileRow, appUrl: string) => ({ id: r.id, name: r.name, mime: r.mime_type, size: r.size_bytes, shareUrl: r.share_token ? shareUrl(appUrl, r.share_token, r.name) : null });
