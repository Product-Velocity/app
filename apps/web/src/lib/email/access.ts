import { buildEmail } from "./registry/registry";
import { DEFAULT_SITE_URL } from "./registry/layout";

export type PlainEmail = { subject: string; text: string; html: string };

/** To the Account Admins when someone at an authorized domain asks to join (FR-2.2). Registry key app.access-request. */
export function buildAccessRequestEmail(input: { workspace: string; requester: string; link: string; siteUrl?: string }): PlainEmail {
  return buildEmail("app.access-request", { values: { workspace: input.workspace, requester: input.requester, link: input.link }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL, buttonUrl: input.link });
}

/** To the person when an admin approves them (FR-4.3): confirmation and the direct link back to the platform. Registry key app.access-approved. */
export function buildAccessApprovedEmail(input: { workspace: string; link: string; siteUrl?: string }): PlainEmail {
  return buildEmail("app.access-approved", { values: { workspace: input.workspace, link: input.link }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL, buttonUrl: input.link });
}

/** To an address someone wants to link to their account (R-111 FR-4.1): the code only; no link to click, so it cannot be phished from a mailbox. Registry key app.link-code. */
export function buildLinkCodeEmail(input: { code: string; siteUrl?: string }): PlainEmail {
  return buildEmail("app.link-code", { values: { code: input.code, expires: "15 minutes" }, siteUrl: input.siteUrl ?? DEFAULT_SITE_URL });
}
