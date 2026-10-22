/**
 * Post-login redirect targets come from the URL, so only same-site paths are
 * allowed. Anything else (absolute URLs, `//host`, backslash tricks, control
 * characters) falls back to `fallback`.
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2000) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = "http://same-site.invalid";
    if (new URL(next, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
