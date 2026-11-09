import { escapeHtml } from "./macros";

/**
 * The one branded frame every product email uses (issue #370): logo, tagline, one button, footer. It lives in git and is tested.
 * Editors change the words only; links, tokens and this frame can never be edited.
 * Email clients are old: 560px table, inline CSS, system fonts, one hosted logo with alt text, no tracking.
 */
const FONT = "'IBM Plex Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
export const TAGLINE = "One roadmap for humans and AI.";

export type LayoutInput = {
  subject: string;
  preheader: string;
  heading: string;
  /** Already-rendered plain text paragraphs (macros resolved); escaped here. Blank line separates paragraphs. */
  body: string;
  button: { label: string; url: string } | null;
  /** A short code shown large, for code emails. */
  code?: string | null;
  note: string;
  siteUrl: string;
};

const paragraphs = (s: string) => s.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px 0;font-size:16px;line-height:26px;color:#4b5563;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");

export function renderHtml(i: LayoutInput): string {
  const url = i.button ? escapeHtml(i.button.url) : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(i.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(i.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
<tr><td style="padding:32px 32px 0 32px;"><img src="${escapeHtml(i.siteUrl)}/email/logo.png" width="155" height="56" alt="Product Velocity" style="display:block;border:0;height:56px;width:155px;"></td></tr>
<tr><td style="padding:24px 32px 0 32px;font-family:${FONT};color:#111827;">
<h1 style="margin:0 0 12px 0;font-size:24px;line-height:30px;font-weight:600;color:#111827;">${escapeHtml(i.heading)}</h1>
${paragraphs(i.body)}
</td></tr>${i.code ? `
<tr><td style="padding:8px 32px 0 32px;font-family:'IBM Plex Mono',Menlo,Consolas,monospace;font-size:28px;letter-spacing:4px;font-weight:600;color:#111827;">${escapeHtml(i.code)}</td></tr>` : ""}${i.button ? `
<tr><td style="padding:24px 32px 8px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3347d9" style="border-radius:8px;background:#3347d9;"><a href="${url}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(i.button.label)}</a></td></tr></table>
</td></tr>
<tr><td style="padding:8px 32px 0 32px;font-family:${FONT};font-size:13px;line-height:20px;color:#4b5563;">Button not working? Paste this link into your browser:<br><a href="${url}" style="color:#2433a8;word-break:break-all;">${url}</a></td></tr>` : ""}
<tr><td style="padding:24px 32px 32px 32px;font-family:${FONT};">
<div style="border-top:1px solid #e5e7eb;padding-top:20px;font-size:13px;line-height:20px;color:#4b5563;">${escapeHtml(i.note)}<br><br><strong style="color:#111827;font-weight:600;">Product Velocity</strong><br>${TAGLINE}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

export function renderText(i: LayoutInput): string {
  return [i.heading, "", i.body, ...(i.code ? ["", i.code] : []), ...(i.button ? ["", `${i.button.label}: ${i.button.url}`] : []), "", i.note, "", "Product Velocity", TAGLINE, ""].join("\n");
}
