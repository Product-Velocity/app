import { renderHtml, renderText } from "./layout";
import { renderMacros, sampleValues, type MacroName, type MacroValues } from "./macros";

/**
 * Template registry (issue #370). Every product email has a key, a trigger, a recipient rule, the code path that sends it, the macros
 * its text may use, and default wording. The frame (layout.ts), links, tokens, recipients and the trigger-to-template mapping are
 * code and can never be edited; only the text fields below can (phase 4, through a published override, falling back to these defaults).
 */
export type EmailKey = "auth.confirm-signup" | "auth.sign-in-link" | "auth.reset-password" | "auth.reauthentication" | "auth.invite" | "auth.email-change";

export type EmailTemplate = {
  key: EmailKey;
  name: string;
  /** What causes the send, in words for the platform console. */
  trigger: string;
  recipient: string;
  /** The code path that sends it. */
  path: string;
  /** True when a person must confirm before it goes out (none of the auth emails). */
  confirmFirst: boolean;
  macros: readonly MacroName[];
  /** Supabase action type that selects this template in the Send Email hook. */
  authAction?: "signup" | "magiclink" | "recovery" | "reauthentication" | "invite" | "email_change";
  /** Link type the /auth/callback route accepts for the button. Absent for code emails. */
  linkType?: "email" | "signup" | "recovery" | "invite" | "email_change";
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  button: string | null;
  note: string;
};

export const EMAIL_TEMPLATES: readonly EmailTemplate[] = [
  {
    key: "auth.confirm-signup",
    name: "Confirm sign-up",
    trigger: "Someone creates an account with email and password",
    recipient: "The address being registered",
    path: "Supabase Send Email hook, action signup",
    confirmFirst: false,
    macros: ["link", "expires", "product"],
    authAction: "signup",
    linkType: "signup",
    subject: "Confirm your email for {{product}}",
    preheader: "One step left: confirm your email address.",
    heading: "Confirm your email",
    body: "One step left. Confirm that this is your address and your account is ready. The link works once and expires in {{expires}}.",
    button: "Confirm email",
    note: "If you did not create a {{product}} account, you can ignore this email.",
  },
  {
    key: "auth.sign-in-link",
    name: "Sign-in link",
    trigger: "An existing user asks for an emailed sign-in link",
    recipient: "The address on the account",
    path: "Supabase Send Email hook, action magiclink",
    confirmFirst: false,
    macros: ["link", "expires", "product"],
    authAction: "magiclink",
    linkType: "email",
    subject: "Your {{product}} sign-in link",
    preheader: "Your one-time link to sign in. It works once.",
    heading: "Sign in to {{product}}",
    body: "Use the button to sign in. The link works once and expires in {{expires}}.",
    button: "Sign in",
    note: "If you did not ask for this link, you can ignore this email. Nobody can sign in without it.",
  },
  {
    key: "auth.reset-password",
    name: "Reset password",
    trigger: "Someone uses Forgot password",
    recipient: "The address on the account",
    path: "Supabase Send Email hook, action recovery",
    confirmFirst: false,
    macros: ["link", "expires", "product"],
    authAction: "recovery",
    linkType: "recovery",
    subject: "Reset your {{product}} password",
    preheader: "Choose a new password. The link works once.",
    heading: "Choose a new password",
    body: "We got a request to reset the password for this account. Use the button to choose a new one. The link works once and expires in {{expires}}.",
    button: "Choose a new password",
    note: "If you did not ask for this, you can ignore this email. Your password stays as it is.",
  },
  {
    key: "auth.reauthentication",
    name: "Re-authentication code",
    trigger: "A signed-in user confirms a sensitive change (for example a new password)",
    recipient: "The address on the account",
    path: "Supabase Send Email hook, action reauthentication",
    confirmFirst: false,
    macros: ["code", "expires", "product"],
    authAction: "reauthentication",
    subject: "Your {{product}} confirmation code",
    preheader: "Your confirmation code.",
    heading: "Confirm it is you",
    body: "Enter this code to confirm the change. It works once and expires in {{expires}}.",
    button: null,
    note: "If you did not ask for this, you can ignore this email and consider changing your password.",
  },
  {
    key: "auth.invite",
    name: "Account invitation (Supabase)",
    trigger: "A platform admin invites a user through Supabase Auth",
    recipient: "The invited address",
    path: "Supabase Send Email hook, action invite",
    confirmFirst: false,
    macros: ["link", "expires", "product"],
    authAction: "invite",
    linkType: "invite",
    subject: "You have been invited to {{product}}",
    preheader: "Accept your invitation and set up your account.",
    heading: "You are invited",
    body: "You have been invited to {{product}}. Use the button to accept and set up your account. The link works once and expires in {{expires}}.",
    button: "Accept invitation",
    note: "If you did not expect this, you can ignore this email.",
  },
  {
    key: "auth.email-change",
    name: "Confirm email change",
    trigger: "A signed-in user changes the email address on their account",
    recipient: "The new address, and the current address when Supabase asks for both to confirm",
    path: "Supabase Send Email hook, action email_change",
    confirmFirst: false,
    macros: ["link", "expires", "product"],
    authAction: "email_change",
    linkType: "email_change",
    subject: "Confirm your new email for {{product}}",
    preheader: "Confirm the change of email address.",
    heading: "Confirm your new email",
    body: "Use the button to confirm the change of email address on your account. The link works once and expires in {{expires}}.",
    button: "Confirm change",
    note: "If you did not ask for this, you can ignore this email and your address stays as it is.",
  },
];

export const templateForAction = (action: string) => EMAIL_TEMPLATES.find((t) => t.authAction === action);

/** Editable wording; a published override replaces these fields only (phase 4). Anything missing falls back to the code default. */
export type TemplateText = Pick<EmailTemplate, "subject" | "preheader" | "heading" | "body" | "button" | "note">;

export type Rendered = { subject: string; html: string; text: string };

/** Renders one template. `button.url` is built by the system, never by a template. The override is optional: no override, code default. */
export function renderTemplate(t: EmailTemplate, input: { values: MacroValues; siteUrl: string; buttonUrl?: string | null; override?: Partial<TemplateText> | null }): Rendered {
  const w: TemplateText = { ...t, ...(input.override ?? {}) };
  const plain = (s: string) => renderMacros(s, input.values, "text");
  const subject = plain(w.subject).replace(/\s+/g, " ").trim();
  const layout = (m: (s: string) => string) => ({
    subject, siteUrl: input.siteUrl,
    preheader: m(w.preheader), heading: m(w.heading), body: m(w.body), note: m(w.note),
    code: t.macros.includes("code") ? input.values.code ?? null : null,
    button: w.button && input.buttonUrl ? { label: m(w.button), url: input.buttonUrl } : null,
  });
  // the layout escapes its inputs, so give it plain text (macros resolved, not yet escaped)
  const l = layout(plain);
  return { subject, html: renderHtml(l), text: renderText(l) };
}

export const previewTemplate = (t: EmailTemplate, siteUrl = "https://app.example") =>
  renderTemplate(t, { values: sampleValues(t.macros), siteUrl, buttonUrl: t.button ? `${siteUrl}/auth/callback?sample=1` : null });
