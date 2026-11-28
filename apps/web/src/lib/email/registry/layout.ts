import { escapeHtml } from "./macros";

/**
 * The one branded frame every product email uses (issue #370): logo, tagline, one button, footer. It lives in git and is tested.
 * Editors change the words only; links, tokens and this frame can never be edited.
 * Email clients are old: 560px table, inline CSS, system fonts, one hosted logo with alt text, no tracking code of our own.
 */
const FONT = "'IBM Plex Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
/** Used only where a caller does not know the deployment address (tests, previews); real sends pass the deployment address. */
export const DEFAULT_SITE_URL = "https://productvelocity.app";
export const TAGLINE = "One roadmap for humans and AI.";

/** A company's own brand for the voter emails (issue #750): its logo and name replace Product Velocity's, its colours dress the button and the links. */
export type EmailBrand = { name: string; logoUrl: string | null; color: string; onColor: string; linkColor: string };

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
  /** A second link built by the system (for example "stop reminders"), shown in the footer. */
  extraLink?: { label: string; url: string } | null;
  siteUrl: string;
  /** Set only for a voting session that uses the company brand. The Product Velocity name, logo and tagline are then not shown. */
  brand?: EmailBrand | null;
};

const paragraphs = (s: string) => s.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px 0;font-size:16px;line-height:26px;color:#4b5563;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");

export function renderHtml(i: LayoutInput): string {
  const url = i.button ? escapeHtml(i.button.url) : "";
  const b = i.brand ?? null;
  const btn = b ? escapeHtml(b.color) : "#2270ed", btnText = b ? escapeHtml(b.onColor) : "#ffffff", link = b ? escapeHtml(b.linkColor) : "#1a56c4";
  const header = b
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${b.logoUrl ? `<td style="padding-right:12px;"><img src="${escapeHtml(b.logoUrl)}" height="48" alt="" style="display:block;border:0;height:48px;width:auto;max-width:200px;"></td>` : ""}<td style="font-family:${FONT};font-size:20px;line-height:24px;font-weight:600;letter-spacing:-0.01em;color:#111827;">${escapeHtml(b.name)}</td></tr></table>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:12px;"><img src="${escapeHtml(i.siteUrl)}/email/logo.png" width="48" height="48" alt="" style="display:block;border:0;height:48px;width:48px;"></td><td style="font-family:${FONT};font-size:20px;line-height:24px;font-weight:600;letter-spacing:-0.01em;color:#111827;">Product Velocity</td></tr></table>`;
  const signoff = b ? `<strong style="color:#111827;font-weight:600;">${escapeHtml(b.name)}</strong>` : `<strong style="color:#111827;font-weight:600;">Product Velocity</strong><br>${TAGLINE}`;
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
<tr><td style="padding:32px 32px 0 32px;">${header}</td></tr>
<tr><td style="padding:24px 32px 0 32px;font-family:${FONT};color:#111827;">
<h1 style="margin:0 0 12px 0;font-size:24px;line-height:30px;font-weight:600;color:#111827;">${escapeHtml(i.heading)}</h1>
${paragraphs(i.body)}
</td></tr>${i.code ? `
<tr><td style="padding:8px 32px 0 32px;font-family:'IBM Plex Mono',Menlo,Consolas,monospace;font-size:28px;letter-spacing:4px;font-weight:600;color:#111827;">${escapeHtml(i.code)}</td></tr>` : ""}${i.button ? `
<tr><td style="padding:24px 32px 8px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${btn}" style="border-radius:8px;background:${btn};"><a href="${url}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:${btnText};text-decoration:none;border-radius:8px;">${escapeHtml(i.button.label)}</a></td></tr></table>
</td></tr>
<tr><td style="padding:8px 32px 0 32px;font-family:${FONT};font-size:13px;line-height:20px;color:#4b5563;">Button not working? Paste this link into your browser:<br><a href="${url}" style="color:${link};word-break:break-all;">${url}</a></td></tr>` : ""}
<tr><td style="padding:24px 32px 32px 32px;font-family:${FONT};">
<div style="border-top:1px solid #e5e7eb;padding-top:20px;font-size:13px;line-height:20px;color:#4b5563;">${escapeHtml(i.note)}${i.extraLink ? `<br><br>${escapeHtml(i.extraLink.label)} <a href="${escapeHtml(i.extraLink.url)}" style="color:${link};word-break:break-all;">${escapeHtml(i.extraLink.url)}</a>` : ""}<br><br>${signoff}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

export function renderText(i: LayoutInput): string {
  return [i.heading, "", i.body, ...(i.code ? ["", i.code] : []), ...(i.button ? ["", `${i.button.label}: ${i.button.url}`] : []), "", i.note, ...(i.extraLink ? ["", `${i.extraLink.label} ${i.extraLink.url}`] : []), "", ...(i.brand ? [i.brand.name] : ["Product Velocity", TAGLINE]), ""].join("\n");
}

/**
 * The personal note (founder emails): no frame, no logo, no button, no heading; a few paragraphs in the reader's own font and a
 * signature line, like a message typed by a person. `note` is the P.S. and holds the stop line.
 */
export function renderPersonalHtml(i: LayoutInput): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(i.subject)}</title>
</head>
<body style="margin:0;padding:16px;background:#ffffff;font-family:${FONT};font-size:15px;line-height:24px;color:#111827;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(i.preheader)}</div>
${i.body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px 0;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("")}
<p style="margin:18px 0 0 0;font-size:13px;line-height:20px;color:#4b5563;">${escapeHtml(i.note)}</p>
</body>
</html>
`;
}

export function renderPersonalText(i: LayoutInput): string {
  return [i.body, "", i.note, ""].join("\n");
}
