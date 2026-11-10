/** What another app shares to Product Velocity (Web Share Target): a title, some text and a link. All of it is data, never instructions. */
export type SharedContent = { title?: string | null; text?: string | null; url?: string | null };
export type ShareDraft = { name: string; line: string };

const NAME_MAX = 120;
const LINE_MAX = 1000;
const clean = (s: string | null | undefined) => (s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Turns a share into the quick-add form: the title (else the first line of the text, else the link's host) becomes the name; the rest of
 * the text and the link become the "what and why" line. Only http(s) links are kept.
 */
export function shareToDraft(input: SharedContent): ShareDraft {
  const title = clean(input.title);
  const text = clean(input.text);
  let url = clean(input.url);
  // many apps put the link at the end of the text instead of in the url field
  if (!url) { const m = /https?:\/\/\S+/.exec(text); if (m) url = m[0]; }
  if (url && !/^https?:\/\//i.test(url)) url = "";
  const body = clean(url ? text.replace(url, "") : text);
  const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let host = "";
  try { host = url ? new URL(url).hostname : ""; } catch { url = ""; }
  const name = title || lines[0] || host || "";
  const rest = (title ? lines : lines.slice(1)).join(" ");
  const line = [rest, url].filter(Boolean).join(" ");
  return { name: clip(name, NAME_MAX), line: clip(line, LINE_MAX) };
}
