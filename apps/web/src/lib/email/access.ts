import { buildEmail, type TemplateText } from "./registry/registry";
import { DEFAULT_SITE_URL } from "./registry/layout";
import { firstNameOf } from "@/lib/founder-rules";
import { SUPPORT_CONTACT } from "@/lib/public-contact";

/** The internal notices go to the product owner, so they greet the owner by first name. */
const OWNER_FIRST = firstNameOf(SUPPORT_CONTACT.name);

export type PlainEmail = { subject: string; text: string; html: string };

/** To the Account Admins when someone at an authorized domain asks to join (FR-2.2). Registry key app.access-request. */
export function buildAccessRequestEmail(input: { firstname?: string; workspace: string; requester: string; link: string; siteUrl?: string; override?: Partial<TemplateText> | null }): PlainEmail {
  return buildEmail("app.access-request", { values: { firstname: input.firstname, workspace: input.workspace, requester: input.requester, link: input.link }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL, buttonUrl: input.link, override: input.override });
}

/** To the Account Admins when someone at an authorized domain joined automatically as a Viewer (issue #673). Registry key app.domain-join. */
export function buildDomainJoinEmail(input: { firstname?: string; workspace: string; requester: string; link: string; siteUrl?: string; override?: Partial<TemplateText> | null }): PlainEmail {
  return buildEmail("app.domain-join", { values: { firstname: input.firstname, workspace: input.workspace, requester: input.requester, link: input.link }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL, buttonUrl: input.link, override: input.override });
}

/** To the person when an admin approves them (FR-4.3): confirmation and the direct link back to the platform. Registry key app.access-approved. */
export function buildAccessApprovedEmail(input: { firstname?: string; workspace: string; link: string; siteUrl?: string; override?: Partial<TemplateText> | null }): PlainEmail {
  return buildEmail("app.access-approved", { values: { firstname: input.firstname, workspace: input.workspace, link: input.link }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL, buttonUrl: input.link, override: input.override });
}

/** To an address someone wants to link to their account (R-111 FR-4.1): the code only; no link to click, so it cannot be phished from a mailbox. Registry key app.link-code. */
export function buildLinkCodeEmail(input: { firstname?: string; code: string; siteUrl?: string; override?: Partial<TemplateText> | null }): PlainEmail {
  return buildEmail("app.link-code", { values: { firstname: input.firstname, code: input.code, expires: "15 minutes" }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL, override: input.override });
}

/** To the Product Velocity contact address when someone writes through the contact form (issue #530). Registry key site.contact. */
export function buildContactEmail(input: { name: string; email: string; subject: string; message: string; siteUrl?: string; override?: Partial<TemplateText> | null }): PlainEmail {
  return buildEmail("site.contact", { values: { firstname: OWNER_FIRST, name: input.name, requester: input.email, subject: input.subject, message: input.message }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL, override: input.override });
}

/** To the Product Velocity contact address when someone asks for early access on the public homepage (issue #498). Registry key site.early-access. */
export function buildEarlyAccessEmail(input: { name: string; email: string; company: string; role: string; teams: string; siteUrl?: string; override?: Partial<TemplateText> | null }): PlainEmail {
  return buildEmail("site.early-access", { values: { firstname: OWNER_FIRST, name: input.name, requester: input.email, workspace: input.company, role: input.role, teams: input.teams || "not stated" }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL, override: input.override });
}

/** To the Product Velocity contact address when someone finishes creating their workspace. Registry key app.new-workspace. */
export function buildNewWorkspaceEmail(input: { workspace: string; requester: string; link: string; siteUrl?: string; override?: Partial<TemplateText> | null }): PlainEmail {
  return buildEmail("app.new-workspace", { values: { firstname: OWNER_FIRST, workspace: input.workspace, requester: input.requester, link: input.link }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL, buttonUrl: input.link, override: input.override });
}

/** To the person who created a workspace, from Ashu, once setup is finished. Registry key app.welcome-personal. */
export function buildWelcomePersonalEmail(input: { firstname: string; workspace: string; siteUrl?: string; override?: Partial<TemplateText> | null }): PlainEmail {
  return buildEmail("app.welcome-personal", { values: { firstname: input.firstname, workspace: input.workspace }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL, override: input.override });
}

/** To the person who created a workspace that is still empty two days later, from Ashu. Registry key app.followup-personal. */
export function buildFollowupPersonalEmail(input: { firstname: string; workspace: string; siteUrl?: string; override?: Partial<TemplateText> | null }): PlainEmail {
  return buildEmail("app.followup-personal", { values: { firstname: input.firstname, workspace: input.workspace }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL, override: input.override });
}
