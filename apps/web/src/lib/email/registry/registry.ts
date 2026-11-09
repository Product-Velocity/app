import { renderHtml, renderText } from "./layout";
import { renderMacros, sampleValues, type MacroName, type MacroValues } from "./macros";

/**
 * Template registry (issue #370). Every product email has a key, a trigger, a recipient rule, the code path that sends it, the macros
 * its text may use, and default wording. The frame (layout.ts), links, tokens, recipients and the trigger-to-template mapping are
 * code and can never be edited; only the text fields below can (phase 4, through a published override, falling back to these defaults).
 */
export type EmailKey =
  | "auth.confirm-signup" | "auth.sign-in-link" | "auth.reset-password" | "auth.reauthentication" | "auth.invite" | "auth.email-change"
  | "app.invitation" | "app.access-request" | "app.access-approved" | "app.link-code"
  | "alignment.invitation" | "alignment.reminder" | "alignment.new-link";

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
  /** The limits that apply to this email, in words for the platform console. */
  limits: string;
  /** Fields the platform may edit. Absent means all six. The alignment emails take their subject and text from the workspace admin's own mailing text (the second layer), so only the frame is editable. */
  editable?: readonly (keyof TemplateText)[];
  /** Sample values for previews where the catalog's sample would mislead (for example how long a link works). */
  sample?: MacroValues;
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
    limits: "Supabase's own pause per address and hourly cap on auth emails (Authentication > Rate Limits)",
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
    limits: "Supabase's own pause per address and hourly cap on auth emails (Authentication > Rate Limits)",
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
    limits: "Supabase's own pause per address and hourly cap on auth emails (Authentication > Rate Limits)",
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
    limits: "Supabase's own pause per address and hourly cap on auth emails (Authentication > Rate Limits)",
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
    limits: "Supabase's own pause per address and hourly cap on auth emails (Authentication > Rate Limits)",
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
    limits: "Supabase's own pause per address and hourly cap on auth emails (Authentication > Rate Limits)",
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
  {
    key: "app.invitation",
    name: "Workspace invitation",
    trigger: "A workspace admin confirms the email preview of an invitation (or resends it)",
    recipient: "The invited address",
    path: "Members page, createInvitation and resend (lib/email/invitation.ts)",
    confirmFirst: true,
    limits: "60 seconds between sends to one person, 5 per invitation, 100 per workspace per day",
    sample: { expires: "7 days" },
    macros: ["inviter", "workspace", "role", "link", "expires", "product"],
    subject: "{{inviter}} invited you to {{workspace}} on {{product}}",
    preheader: "Accept the invitation to {{workspace}}.",
    heading: "You are invited to {{workspace}}",
    body: "{{inviter}} invited you to join {{workspace}} on {{product}} as {{role}}.\n\nOpen the link below, sign in or create an account with this email address, and accept.",
    button: "Accept invitation",
    note: "The link works once and expires in {{expires}}. If you did not expect this email, you can ignore it.",
  },
  {
    key: "app.access-request",
    name: "Access request to admins",
    trigger: "Someone signs up with an email address at an authorized domain and asks to join",
    recipient: "The workspace's Account Admins (at most 10)",
    path: "Sign-up check and linked-address verification (lib/access-requests.ts)",
    confirmFirst: false,
    limits: "At most 10 admins emailed per request",
    macros: ["requester", "workspace", "link", "product"],
    subject: "{{requester}} asked to join {{workspace}} on {{product}}",
    preheader: "Review the request to join {{workspace}}.",
    heading: "{{requester}} asked to join",
    body: "{{requester}} signed up with an email address at your authorized domain and asked to join {{workspace}}.\n\nThey have no access until you approve them. Review the request in the members grid (status Requested Access).",
    button: "Review the request",
    note: "If you do not know this person, leave the request or set it to Revoked.",
  },
  {
    key: "app.access-approved",
    name: "Access approved",
    trigger: "An admin approves a request to join a workspace",
    recipient: "The person who asked",
    path: "Members page, approval (settings/members/actions.ts)",
    confirmFirst: false,
    limits: "One per approval; the Resend account limits apply",
    macros: ["workspace", "link", "product"],
    subject: "You now have access to {{workspace}} on {{product}}",
    preheader: "You now have access to {{workspace}}.",
    heading: "You now have access",
    body: "An admin approved your request. You now have access to {{workspace}} on {{product}}.",
    button: "Open {{product}}",
    note: "If you did not ask for access, you can ignore this email.",
  },
  {
    key: "app.link-code",
    name: "Linked-address code",
    trigger: "A person adds another email address to their account on the Account page",
    recipient: "The address being linked",
    path: "Account page, linkEmail (account/actions.ts)",
    confirmFirst: false,
    limits: "One code per request; the code works for 15 minutes",
    sample: { expires: "15 minutes" },
    macros: ["code", "expires", "product"],
    subject: "Your {{product}} code: {{code}}",
    preheader: "Your code to add this address.",
    heading: "Your code",
    body: "Enter this code on the Account page of {{product}} to add this address to your account. It works for {{expires}}.",
    button: null,
    note: "If you did not ask for this, ignore this email: nothing is added without the code.",
  },
  {
    key: "alignment.invitation",
    name: "Alignment invitation",
    trigger: "A workspace admin confirms an alignment invitation mailing",
    recipient: "Each participant on the confirmed mailing",
    path: "Alignment mailing send (lib/alignment-send.ts)",
    confirmFirst: true,
    limits: "500 people per mailing; sent 3 at a time, 40 seconds per run, then Continue sending",
    editable: ["preheader", "heading", "button", "note"],
    macros: ["name", "session", "closes", "link", "product"],
    subject: "Help us decide what comes first: {{session}}",
    preheader: "Your vote counts. It takes a few minutes.",
    heading: "{{session}}",
    // two layers: this frame is the platform's; the body and subject are replaced by the workspace admin's own text on each mailing
    body: "Hello {{name}},\n\nWe are choosing what to build first and your view counts. It takes a few minutes, on your phone or your computer.\n\nYour answers are anonymous to the other participants. {{closes}}",
    button: "Open your personal link",
    note: "The link is only for you. Please do not forward it.",
  },
  {
    key: "alignment.reminder",
    name: "Alignment reminder",
    trigger: "A workspace admin confirms a reminder mailing",
    recipient: "Participants who have not voted and did not stop reminders",
    path: "Alignment mailing send (lib/alignment-send.ts)",
    confirmFirst: true,
    limits: "500 people per mailing; sent 3 at a time, 40 seconds per run, then Continue sending",
    editable: ["preheader", "heading", "button", "note"],
    macros: ["name", "session", "closes", "link", "product"],
    subject: "A reminder to vote: {{session}}",
    preheader: "You have not voted yet.",
    heading: "{{session}}",
    body: "Hello {{name}},\n\nYou have not voted yet in {{session}}. {{closes}} It only takes a few minutes.",
    button: "Open your personal link",
    note: "The link is only for you. Please do not forward it.",
  },
  {
    key: "alignment.new-link",
    name: "Alignment new link",
    trigger: "A participant asks for a new personal link on an old or replaced link",
    recipient: "The participant's address on file (the reply on screen is always the same)",
    path: "Alignment link page, requestNewLink (a/[token]/actions.ts)",
    confirmFirst: false,
    limits: "One a minute and six in all per participant (database rule)",
    macros: ["name", "session", "closes", "link", "product"],
    subject: "Your new link: {{session}}",
    preheader: "Your new personal link.",
    heading: "Your new link",
    body: "Hello {{name}},\n\nHere is your new personal link for {{session}}. {{closes}}",
    button: "Open your personal link",
    note: "The earlier link no longer works. Please do not forward this one.",
  },
];

export const templateForAction = (action: string) => EMAIL_TEMPLATES.find((t) => t.authAction === action);

/** Editable wording; a published override replaces these fields only (phase 4). Anything missing falls back to the code default. */
export type TemplateText = Pick<EmailTemplate, "subject" | "preheader" | "heading" | "body" | "button" | "note">;

export type Rendered = { subject: string; html: string; text: string };

/** Renders one template. `button.url` is built by the system, never by a template. The override is optional: no override, code default. */
export function renderTemplate(t: EmailTemplate, input: { values: MacroValues; siteUrl: string; buttonUrl?: string | null; override?: Partial<TemplateText> | null; extraLink?: { label: string; url: string } | null }): Rendered {
  const w: TemplateText = { ...t, ...(input.override ?? {}) };
  const plain = (s: string) => renderMacros(s, input.values, "text");
  const subject = plain(w.subject).replace(/\s+/g, " ").trim();
  const layout = (m: (s: string) => string) => ({
    subject, siteUrl: input.siteUrl,
    preheader: m(w.preheader), heading: m(w.heading), body: m(w.body), note: m(w.note),
    code: t.macros.includes("code") ? input.values.code ?? null : null,
    button: w.button && input.buttonUrl ? { label: m(w.button), url: input.buttonUrl } : null,
    extraLink: input.extraLink ?? null,
  });
  // the layout escapes its inputs, so give it plain text (macros resolved, not yet escaped)
  const l = layout(plain);
  return { subject, html: renderHtml(l), text: renderText(l) };
}

export const previewTemplate = (t: EmailTemplate, siteUrl = "https://app.example") =>
  renderTemplate(t, { values: { ...sampleValues(t.macros), ...(t.sample ?? {}) }, siteUrl, buttonUrl: t.button ? `${siteUrl}/auth/callback?sample=1` : null });

export const templateByKey = (key: EmailKey) => EMAIL_TEMPLATES.find((t) => t.key === key)!;

/**
 * Renders any registry email from its key. `workspaceText` is the second layer of the alignment emails: the workspace admin's own
 * subject and body replace the defaults (macros still resolved and escaped). `extraLink` is a system-built footer link.
 */
export function buildEmail(key: EmailKey, input: { values: MacroValues; siteUrl: string; buttonUrl?: string | null; extraLink?: { label: string; url: string } | null; workspaceText?: { subject?: string; body?: string } | null; override?: Partial<TemplateText> | null }): Rendered {
  const t = templateByKey(key);
  const w = { ...(input.override ?? {}), ...(input.workspaceText ?? {}) };
  const r = renderTemplate(t, { values: input.values, siteUrl: input.siteUrl, buttonUrl: input.buttonUrl, override: w, extraLink: input.extraLink });
  return r;
}
