import { ROLE_LABEL, type Role } from "@/lib/roles";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type InvitationEmail = { subject: string; text: string; html: string };

/** Plain wording, one link, no images and no tracking. Names are escaped; the link is ours. */
export function buildInvitationEmail(input: { workspace: string; inviter: string; role: Role; isApprover: boolean; link: string; days?: number }): InvitationEmail {
  const days = input.days ?? 7;
  const role = `${ROLE_LABEL[input.role]}${input.isApprover ? " and Approver" : ""}`;
  const subject = `${input.inviter} invited you to ${input.workspace} on Product Velocity`;
  const text = [
    `${input.inviter} invited you to join ${input.workspace} on Product Velocity as ${role}.`,
    "",
    "Open this link, sign in or create an account with this email address, and accept:",
    input.link,
    "",
    `The link works once and expires in ${days} days. If you did not expect this email, you can ignore it.`,
    "",
    "Product Velocity",
  ].join("\n");
  const html = [
    `<p>${escapeHtml(input.inviter)} invited you to join <strong>${escapeHtml(input.workspace)}</strong> on Product Velocity as ${escapeHtml(role)}.</p>`,
    `<p>Open this link, sign in or create an account with this email address, and accept:<br><a href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>`,
    `<p>The link works once and expires in ${days} days. If you did not expect this email, you can ignore it.</p>`,
    "<p>Product Velocity</p>",
  ].join("\n");
  return { subject, text, html };
}

/** Limits: a short pause between sends to one person, a cap per invitation, and a cap per workspace per day. */
export const SEND_PAUSE_SECONDS = 60;
export const MAX_SENDS_PER_INVITATION = 5;
export const MAX_INVITATION_EMAILS_PER_DAY = 100;

export function sendLimit(input: { sendCount: number; lastSentAt: string | null; workspaceLastDay: number; now?: number }): string | null {
  const now = input.now ?? Date.now();
  if (input.sendCount >= MAX_SENDS_PER_INVITATION) return `This invitation has been emailed ${MAX_SENDS_PER_INVITATION} times. Copy the link and send it yourself.`;
  if (input.lastSentAt) {
    const wait = SEND_PAUSE_SECONDS - Math.floor((now - Date.parse(input.lastSentAt)) / 1000);
    if (wait > 0) return `Wait ${wait} seconds before sending to the same person again.`;
  }
  if (input.workspaceLastDay >= MAX_INVITATION_EMAILS_PER_DAY) return "This workspace reached today's limit for invitation emails. Copy the link instead, or try tomorrow.";
  return null;
}

/** What an admin sees on the invitation row. */
export function emailStatusText(status: string, error: string | null, sentAt: string | null): string {
  const when = sentAt ? ` ${new Date(sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "";
  switch (status) {
    case "sent": return `Emailed${when}`;
    case "delivered": return `Delivered${when}`;
    case "bounced": return "Bounced: the address did not accept the email";
    case "complained": return "Marked as spam by the recipient";
    case "failed": return `Not sent: ${error ?? "unknown reason"}`;
    default: return "Link only: not emailed";
  }
}
