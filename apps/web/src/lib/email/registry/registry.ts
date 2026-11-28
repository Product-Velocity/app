import { renderHtml, renderPersonalHtml, renderPersonalText, renderText, type EmailBrand } from "./layout";
import { renderMacros, sampleValues, type MacroName, type MacroValues } from "./macros";

/**
 * Template registry (issue #370). Every product email has a key, a trigger, a recipient rule, the code path that sends it, the macros
 * its text may use, and default wording. The frame (layout.ts), links, tokens, recipients and the trigger-to-template mapping are
 * code and can never be edited; only the text fields below can (phase 4, through a published override, falling back to these defaults).
 */
export type EmailKey =
  | "auth.confirm-signup" | "auth.sign-in-link" | "auth.reset-password" | "auth.reauthentication" | "auth.invite" | "auth.email-change"
  | "app.invitation" | "app.new-workspace" | "app.welcome-personal" | "app.followup-personal" | "app.access-request" | "app.domain-join" | "app.access-approved" | "app.link-code" | "site.early-access" | "site.contact"
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
  /** Cannot be paused in the platform console: a sign-in, confirmation, reset or code email (pausing it would lock people out) or an alignment mailing a workspace admin confirmed. */
  alwaysOn?: boolean;
  /** Carries the one-pixel open-tracking image (lib/email/open-pixel.ts). A short named list; never the alignment emails to voters, nor an auth email. */
  trackOpens?: boolean;
  /** A personal note from a named person (founder emails): plain text look, no logo, frame or button; `note` is the P.S. */
  personal?: boolean;
  /** Display name on the From line for a personal note; the address stays the verified sender. */
  fromName?: string;
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
    alwaysOn: true,
    macros: ["firstname", "link", "expires", "product"],
    authAction: "signup",
    linkType: "signup",
    subject: "Confirm your email for {{product}}",
    preheader: "One step left: confirm your email address.",
    heading: "Confirm your email",
    body: "Hi {{firstname}},\n\nOne step left. Confirm that this is your address and your account is ready. The link works once and expires in {{expires}}.",
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
    alwaysOn: true,
    macros: ["firstname", "link", "expires", "product"],
    authAction: "magiclink",
    linkType: "email",
    subject: "Your {{product}} sign-in link",
    preheader: "Your one-time link to sign in. It works once.",
    heading: "Sign in to {{product}}",
    body: "Hi {{firstname}},\n\nUse the button to sign in. The link works once and expires in {{expires}}.",
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
    alwaysOn: true,
    macros: ["firstname", "link", "expires", "product"],
    authAction: "recovery",
    linkType: "recovery",
    subject: "Reset your {{product}} password",
    preheader: "Choose a new password. The link works once.",
    heading: "Choose a new password",
    body: "Hi {{firstname}},\n\nWe got a request to reset the password for this account. Use the button to choose a new one. The link works once and expires in {{expires}}.",
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
    alwaysOn: true,
    macros: ["firstname", "code", "expires", "product"],
    authAction: "reauthentication",
    subject: "Your {{product}} confirmation code",
    preheader: "Your confirmation code.",
    heading: "Confirm it is you",
    body: "Hi {{firstname}},\n\nEnter this code to confirm the change. It works once and expires in {{expires}}.",
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
    alwaysOn: true,
    macros: ["firstname", "link", "expires", "product"],
    authAction: "invite",
    linkType: "invite",
    subject: "You have been invited to {{product}}",
    preheader: "Accept your invitation and set up your account.",
    heading: "You are invited",
    body: "Hi {{firstname}},\n\nYou have been invited to {{product}}. Use the button to accept and set up your account. The link works once and expires in {{expires}}.",
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
    alwaysOn: true,
    macros: ["firstname", "link", "expires", "product"],
    authAction: "email_change",
    linkType: "email_change",
    subject: "Confirm your new email for {{product}}",
    preheader: "Confirm the change of email address.",
    heading: "Confirm your new email",
    body: "Hi {{firstname}},\n\nUse the button to confirm the change of email address on your account. The link works once and expires in {{expires}}.",
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
    trackOpens: true,
    macros: ["firstname", "inviter", "workspace", "role", "link", "expires", "product"],
    subject: "{{inviter}} invited you to {{workspace}} on {{product}}",
    preheader: "Accept the invitation to {{workspace}}.",
    heading: "You are invited to {{workspace}}",
    body: "Hi {{firstname}},\n\n{{inviter}} invited you to join {{workspace}} on {{product}} as {{role}}.\n\n{{product}} gives your team one roadmap for humans and their AI.\n\nOpen the link below, sign in or create an account with this email address, and accept. A one-minute welcome follows, then you land on the roadmap.",
    button: "Accept invitation",
    note: "The link works once and expires in {{expires}}. If you did not expect this email, you can ignore it.",
  },
  {
    key: "app.new-workspace",
    name: "New workspace created",
    trigger: "Someone finishes onboarding and creates their workspace",
    recipient: "The Product Velocity contact address (lib/public-contact.ts)",
    path: "Onboarding (app/onboarding/actions.ts, lib/new-workspace-notice.ts)",
    confirmFirst: false,
    limits: "One email per workspace created; a failed send never blocks the person",
    macros: ["firstname", "requester", "workspace", "link", "product"],
    subject: "New workspace on {{product}}: {{workspace}}",
    preheader: "{{requester}} just finished setting up {{workspace}}.",
    heading: "{{workspace}} is set up",
    body: "Hi {{firstname}},\n\n{{requester}} signed up and finished creating the workspace {{workspace}}.\n\nOpen the platform console to see the account.",
    button: "Open the platform console",
    note: "This is an internal notice. It holds the sign-up address, so do not forward it.",
  },
  {
    key: "app.welcome-personal",
    name: "Personal welcome from Ashu",
    trigger: "The person who created a workspace finishes the Team step of setup",
    recipient: "That person (replies go to the contact address)",
    path: "Onboarding finish (lib/founder-emails.ts, called from app/onboarding/invite/actions.ts)",
    confirmFirst: false,
    limits: "Once per workspace; starts Paused: switch it to Active in this console when the wording is confirmed",
    personal: true,
    fromName: "Ashu from Product Velocity",
    editable: ["subject", "preheader", "body", "note"],
    trackOpens: true,
    macros: ["firstname", "name", "workspace", "product"],
    subject: "Welcome to {{product}}, {{name}}",
    preheader: "A quick hello from Ashu.",
    heading: "Welcome",
    body: "Hi {{firstname}},\n\nI am Ashu, part of the PM team that built {{product}} for our own use. We were tired of roadmaps that lived in five places and never matched what engineering was doing.\n\nThanks for setting up {{workspace}}. I would love to know what you were hoping it would fix first. Just reply to this email, even one line helps.\n\nAshu",
    button: null,
    note: "P.S. If you would rather not get emails like this, reply \"stop\" and I will not send another.",
  },
  {
    key: "app.followup-personal",
    name: "Personal follow-up from Ashu",
    trigger: "Two days after a workspace was created, if it still has no initiatives and no GitHub or Jira connection",
    recipient: "The person who created the workspace (replies go to the contact address)",
    path: "Daily check (lib/founder-emails.ts, run by /api/cron/github)",
    confirmFirst: false,
    limits: "Once per workspace; only workspaces created 2 to 14 days ago; at most 20 a day; starts Paused: switch it to Active in this console when the wording is confirmed",
    personal: true,
    fromName: "Ashu from Product Velocity",
    editable: ["subject", "preheader", "body", "note"],
    trackOpens: true,
    macros: ["firstname", "name", "workspace", "product"],
    subject: "Quick question about {{workspace}}",
    preheader: "Did anything get in your way?",
    heading: "Quick question",
    body: "Hi {{firstname}},\n\nAshu again from {{product}}. I noticed {{workspace}} has no initiatives yet, so I wanted to check that nothing got in your way.\n\nThe two quickest steps are adding your first initiative (type a name in the top row and press Enter) and connecting GitHub or Jira. If something was confusing, or {{product}} is not what you expected, just reply and tell me. That helps me more than anything.\n\nAshu",
    button: null,
    note: "P.S. If you would rather not get emails like this, reply \"stop\" and I will not send another.",
  },
  {
    key: "app.domain-join",
    name: "Colleague joined as Viewer",
    trigger: "Someone signs up (or verifies a linked address) with a confirmed email at an authorized domain of a workspace that lets them join automatically",
    recipient: "The workspace's Account Admins (at most 10)",
    path: "Sign-up check and linked-address verification (lib/access-requests.ts)",
    confirmFirst: false,
    limits: "At most 10 admins emailed per person who joins; once per person and workspace",
    macros: ["firstname", "requester", "workspace", "link", "product"],
    subject: "{{requester}} joined {{workspace}} on {{product}} as a Viewer",
    preheader: "A new colleague has Viewer access to {{workspace}}.",
    heading: "{{requester}} joined as a Viewer",
    body: "Hi {{firstname}},\n\n{{requester}} signed up with an email address at your authorized domain, confirmed it, and now has access to {{workspace}} as a Viewer.\n\nOther rights are not set automatically. Open the members grid to give them a different role, or to pause or revoke their access.",
    button: "Open the members grid",
    note: "If you do not know this person, set them to Revoked. You can also switch off automatic joining in Workspace settings.",
  },
  {
    key: "app.access-request",
    name: "Access request to admins",
    trigger: "Someone signs up with an email address at an authorized domain and asks to join",
    recipient: "The workspace's Account Admins (at most 10)",
    path: "Sign-up check and linked-address verification (lib/access-requests.ts)",
    confirmFirst: false,
    limits: "At most 10 admins emailed per request",
    macros: ["firstname", "requester", "workspace", "link", "product"],
    subject: "{{requester}} asked to join {{workspace}} on {{product}}",
    preheader: "Review the request to join {{workspace}}.",
    heading: "{{requester}} asked to join",
    body: "Hi {{firstname}},\n\n{{requester}} signed up with an email address at your authorized domain and asked to join {{workspace}}.\n\nThey have no access until you approve them. Review the request in the members grid (status Requested Access).",
    button: "Review the request",
    note: "If you do not know this person, leave the request or set it to Revoked.",
  },
  {
    key: "site.early-access",
    name: "Join us request",
    trigger: "Someone fills in the Join us form on the public homepage",
    recipient: "The Product Velocity contact address (lib/public-contact.ts)",
    path: "Public homepage form (app/(marketing)/actions.ts)",
    confirmFirst: false,
    limits: "Five requests per address and per visitor an hour; a hidden field turns bots away",
    macros: ["firstname", "name", "requester", "workspace", "role", "teams", "product"],
    subject: "Join us request from {{name}} at {{workspace}}",
    preheader: "{{name}} asked to join us.",
    heading: "{{name}} asked to join us",
    body: "Hi {{firstname}},\n\nEmail: {{requester}}\nCompany: {{workspace}}\nRole: {{role}}\nProduct teams: {{teams}}\n\nThey filled in the Join us form on the homepage. Reply to this address to get in touch.",
    button: null,
    note: "This request is not stored anywhere else. Delete this email when you are done with it.",
  },
  {
    key: "site.contact",
    name: "Contact form message",
    trigger: "Someone sends a message through the contact form (/contact)",
    recipient: "The Product Velocity contact address (lib/public-contact.ts); replies go to the sender",
    path: "Public contact page (app/contact/actions.ts)",
    confirmFirst: false,
    limits: "Five messages per address and per visitor an hour; a hidden field turns bots away",
    macros: ["firstname", "name", "requester", "subject", "message", "product"],
    subject: "{{subject}}: message from {{name}}",
    preheader: "{{name}} wrote to you through the contact form.",
    heading: "{{name}} sent a message",
    body: "Hi {{firstname}},\n\nEmail: {{requester}}\nAbout: {{subject}}\n\n{{message}}\n\nReply to this email to answer them.",
    button: null,
    note: "This message is not stored anywhere else. Delete this email when you are done with it.",
  },
  {
    key: "app.access-approved",
    name: "Access approved",
    trigger: "An admin approves a request to join a workspace",
    recipient: "The person who asked",
    path: "Members page, approval (settings/members/actions.ts)",
    confirmFirst: false,
    limits: "One per approval; the Resend account limits apply",
    macros: ["firstname", "workspace", "link", "product"],
    subject: "You now have access to {{workspace}} on {{product}}",
    preheader: "You now have access to {{workspace}}.",
    heading: "You now have access",
    body: "Hi {{firstname}},\n\nAn admin approved your request. You now have access to {{workspace}} on {{product}}.",
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
    alwaysOn: true,
    macros: ["firstname", "code", "expires", "product"],
    subject: "Your {{product}} code: {{code}}",
    preheader: "Your code to add this address.",
    heading: "Your code",
    body: "Hi {{firstname}},\n\nEnter this code on the Account page of {{product}} to add this address to your account. It works for {{expires}}.",
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
    alwaysOn: true,
    macros: ["firstname", "name", "session", "closes", "link", "product"],
    subject: "Help us decide what comes first: {{session}}",
    preheader: "Your vote counts. It takes a few minutes.",
    heading: "{{session}}",
    // two layers: this frame is the platform's; the body and subject are replaced by the workspace admin's own text on each mailing
    body: "Hi {{firstname}},\n\nWe are choosing what to build first and your view counts. It takes a few minutes, on your phone or your computer.\n\nYour answers are anonymous to the other participants. {{closes}}",
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
    alwaysOn: true,
    macros: ["firstname", "name", "session", "closes", "link", "product"],
    subject: "A reminder to vote: {{session}}",
    preheader: "You have not voted yet.",
    heading: "{{session}}",
    body: "Hi {{firstname}},\n\nYou have not voted yet in {{session}}. {{closes}} It only takes a few minutes.",
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
    alwaysOn: true,
    macros: ["firstname", "name", "session", "closes", "link", "product"],
    subject: "Your new link: {{session}}",
    preheader: "Your new personal link.",
    heading: "Your new link",
    body: "Hi {{firstname}},\n\nHere is your new personal link for {{session}}. {{closes}}",
    button: "Open your personal link",
    note: "The earlier link no longer works. Please do not forward this one.",
  },
];

export const templateForAction = (action: string) => EMAIL_TEMPLATES.find((t) => t.authAction === action);

/** Editable wording; a published override replaces these fields only (phase 4). Anything missing falls back to the code default. */
export type TemplateText = Pick<EmailTemplate, "subject" | "preheader" | "heading" | "body" | "button" | "note">;

export type Rendered = { subject: string; html: string; text: string };

/** Renders one template. `button.url` is built by the system, never by a template. The override is optional: no override, code default. */
export function renderTemplate(t: EmailTemplate, input: { values: MacroValues; siteUrl: string; buttonUrl?: string | null; override?: Partial<TemplateText> | null; extraLink?: { label: string; url: string } | null; brand?: EmailBrand | null }): Rendered {
  const w: TemplateText = { ...t, ...(input.override ?? {}) };
  const plain = (s: string) => renderMacros(s, input.values, "text");
  const subject = plain(w.subject).replace(/\s+/g, " ").trim();
  const layout = (m: (s: string) => string) => ({
    subject, siteUrl: input.siteUrl,
    preheader: m(w.preheader), heading: m(w.heading), body: m(w.body), note: m(w.note),
    code: t.macros.includes("code") ? input.values.code ?? null : null,
    button: w.button && input.buttonUrl ? { label: m(w.button), url: input.buttonUrl } : null,
    extraLink: input.extraLink ?? null,
    brand: input.brand ?? null,
  });
  // the layout escapes its inputs, so give it plain text (macros resolved, not yet escaped)
  const l = layout(plain);
  if (t.personal) return { subject, html: renderPersonalHtml(l), text: renderPersonalText(l) };
  return { subject, html: renderHtml(l), text: renderText(l) };
}

export const previewTemplate = (t: EmailTemplate, siteUrl = "https://app.example") =>
  renderTemplate(t, { values: { ...sampleValues(t.macros), ...(t.sample ?? {}) }, siteUrl, buttonUrl: t.button ? `${siteUrl}/auth/callback?sample=1` : null });

export type EmailStatus = "active" | "paused";
/** What an email does until someone switches it in the platform console: the personal notes start Paused (nothing is sent before the wording is confirmed), every other email Active. */
export const defaultEmailStatus = (t: Pick<EmailTemplate, "personal">): EmailStatus => (t.personal ? "paused" : "active");

export const templateByKey = (key: EmailKey) => EMAIL_TEMPLATES.find((t) => t.key === key)!;

/**
 * Renders any registry email from its key. `workspaceText` is the second layer of the alignment emails: the workspace admin's own
 * subject and body replace the defaults (macros still resolved and escaped). `extraLink` is a system-built footer link.
 */
export function buildEmail(key: EmailKey, input: { values: MacroValues; siteUrl: string; buttonUrl?: string | null; extraLink?: { label: string; url: string } | null; workspaceText?: { subject?: string; body?: string } | null; override?: Partial<TemplateText> | null; brand?: EmailBrand | null }): Rendered {
  const t = templateByKey(key);
  const w = { ...(input.override ?? {}), ...(input.workspaceText ?? {}) };
  const r = renderTemplate(t, { values: input.values, siteUrl: input.siteUrl, buttonUrl: input.buttonUrl, override: w, extraLink: input.extraLink, brand: input.brand ?? null });
  return r;
}
