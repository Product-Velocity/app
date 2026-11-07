/**
 * The branded emails Supabase Auth sends (route A, issue #357): confirm sign-up, one-time sign-in link, reset password.
 * The HTML is generated from here into apps/web/email-templates/ and pasted into the Supabase dashboard
 * (Authentication > Emails > Templates); a test fails if the committed files differ from this code.
 * Run `pnpm email:templates` after changing anything.
 *
 * Rules: email clients are old, so a 560px table, inline CSS, system fonts, one hosted logo with alt text and one button.
 * Wording follows the brand guide (calm, short sentences, no emoji, no claims). No tracking.
 * Every link goes back to our own /auth/callback with a one-time token hash, which works in any browser or mail app.
 * Variables are Supabase's: {{ .RedirectTo }} already holds "/auth/callback?next=..." (hence the "&"), {{ .TokenHash }}, {{ .SiteURL }}.
 */

export type AuthTemplate = { file: string; subject: string; html: string };

const FONT = "'IBM Plex Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const TAGLINE = "One roadmap for humans and AI.";

type Spec = {
  file: string;
  subject: string;
  type: "email" | "recovery";
  preheader: string;
  heading: string;
  body: string;
  button: string;
  note: string;
};

function render(spec: Spec): string {
  const link = `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=${spec.type}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${spec.subject}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${spec.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
<tr><td style="padding:32px 32px 0 32px;"><img src="{{ .SiteURL }}/email/logo.png" width="155" height="56" alt="Product Velocity" style="display:block;border:0;height:56px;width:155px;"></td></tr>
<tr><td style="padding:24px 32px 0 32px;font-family:${FONT};color:#111827;">
<h1 style="margin:0 0 12px 0;font-size:24px;line-height:30px;font-weight:600;color:#111827;">${spec.heading}</h1>
<p style="margin:0;font-size:16px;line-height:26px;color:#4b5563;">${spec.body}</p>
</td></tr>
<tr><td style="padding:24px 32px 8px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#3347d9" style="border-radius:8px;background:#3347d9;"><a href="${link}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${spec.button}</a></td></tr></table>
</td></tr>
<tr><td style="padding:8px 32px 0 32px;font-family:${FONT};font-size:13px;line-height:20px;color:#4b5563;">Button not working? Paste this link into your browser:<br><a href="${link}" style="color:#2433a8;word-break:break-all;">${link}</a></td></tr>
<tr><td style="padding:24px 32px 32px 32px;font-family:${FONT};">
<div style="border-top:1px solid #e5e7eb;padding-top:20px;font-size:13px;line-height:20px;color:#4b5563;">${spec.note}<br><br><strong style="color:#111827;font-weight:600;">Product Velocity</strong><br>${TAGLINE}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

const SPECS: Spec[] = [
  {
    file: "confirm-signup.html",
    subject: "Confirm your email for Product Velocity",
    type: "email",
    preheader: "One step left: confirm your email address.",
    heading: "Confirm your email",
    body: "One step left. Confirm that this is your address and your account is ready. The link works once and expires in 60 minutes.",
    button: "Confirm email",
    note: "If you did not create a Product Velocity account, you can ignore this email.",
  },
  {
    file: "magic-link.html",
    subject: "Your Product Velocity sign-in link",
    type: "email",
    preheader: "Your one-time link to sign in. It works once.",
    heading: "Sign in to Product Velocity",
    body: "Use the button to sign in. The link works once and expires in 60 minutes.",
    button: "Sign in",
    note: "If you did not ask for this link, you can ignore this email. Nobody can sign in without it.",
  },
  {
    file: "reset-password.html",
    subject: "Reset your Product Velocity password",
    type: "recovery",
    preheader: "Choose a new password. The link works once.",
    heading: "Choose a new password",
    body: "We got a request to reset the password for this account. Use the button to choose a new one. The link works once and expires in 60 minutes.",
    button: "Choose a new password",
    note: "If you did not ask for this, you can ignore this email. Your password stays as it is.",
  },
];

export const AUTH_TEMPLATES: AuthTemplate[] = SPECS.map((s) => ({ file: s.file, subject: s.subject, html: render(s) }));
