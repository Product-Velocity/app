/** Workspace members: lifecycle statuses, who may move to which, and the authorized email domains (issue #216, docs/15 section 3b). */

export const MEMBER_STATUSES = ["requested", "invited", "active", "paused", "revoked"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  requested: "Requested Access",
  invited: "Invited",
  active: "Active",
  paused: "Paused",
  revoked: "Revoked",
};

/** What an admin can set a status to. "invited" is not a stored status: it is a pending invitation, and it can only be cancelled (Revoked). */
const TARGETS: Record<MemberStatus, MemberStatus[]> = {
  requested: ["active", "revoked"],
  invited: ["revoked"],
  active: ["paused", "revoked"],
  paused: ["active", "revoked"],
  revoked: ["active"],
};

export const allowedStatusTargets = (from: MemberStatus): MemberStatus[] => TARGETS[from];

/** True when every selected row may move to `to` (and something is selected). */
export const canChangeStatus = (from: readonly MemberStatus[], to: MemberStatus): boolean =>
  from.length > 0 && from.every((s) => TARGETS[s].includes(to));

/** Becoming active from Requested Access or Invited sends the approval email with the link back to the platform (FR-4.3). */
export const statusAfterSignup = (from: MemberStatus, to: MemberStatus): boolean =>
  to === "active" && (from === "requested" || from === "invited");

/** Free email providers cannot be authorized domains: anyone can have an address there. Keep in step with migration 0049. */
export const FREE_MAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net",
  "mail.com", "zoho.com", "yandex.com", "qq.com", "163.com", "126.com", "fastmail.com", "hey.com", "tutanota.com", "tuta.io",
] as const;

export const MAX_EMAIL_DOMAINS = 20;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const isFreeMailDomain = (domain: string): boolean => (FREE_MAIL_DOMAINS as readonly string[]).includes(domain.toLowerCase());

export function domainOfEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/** Parses the admin's list (commas, spaces or new lines). Lowercase, no duplicates, no free-mail providers. */
export function parseEmailDomains(input: string): { ok: true; domains: string[] } | { ok: false; error: string } {
  const parts = input.split(/[\s,;]+/).map((p) => p.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
  const domains = [...new Set(parts)];
  if (domains.length > MAX_EMAIL_DOMAINS) return { ok: false, error: `Use at most ${MAX_EMAIL_DOMAINS} domains.` };
  for (const d of domains) {
    if (!DOMAIN.test(d)) return { ok: false, error: `${d} is not a valid domain. Write it like acme.com.` };
    if (isFreeMailDomain(d)) return { ok: false, error: `${d} is a free email provider. Use your company domain.` };
  }
  return { ok: true, domains };
}
