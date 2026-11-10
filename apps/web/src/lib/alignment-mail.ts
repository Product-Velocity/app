/** Pure rules of alignment participants and invitation emails (issue #124): reading a pasted list, the email text, the states admins see. */
import type { Group } from "./alignment";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type ParticipantRow = { email: string; name: string; group: string };
export type ParsedParticipants = { rows: ParticipantRow[]; problems: string[] };

/**
 * Reads a pasted list or a CSV: one person per line, columns email, name, group separated by comma, semicolon or tab (what Excel pastes).
 * A first line that has no @ is taken as a header. A missing group uses `defaultGroup`; a group is matched by name or id, any capitals.
 * Problems name the line, never the address.
 */
export function parseParticipants(text: string, groups: Group[], defaultGroup: string): ParsedParticipants {
  const rows: ParticipantRow[] = [];
  const problems: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const cells = line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
    if (i === 0 && !cells.some((c) => c.includes("@"))) return; // header line
    const email = cells.find((c) => c.includes("@")) ?? "";
    const rest = cells.filter((c) => c !== email);
    if (!EMAIL.test(email.toLowerCase()) || email.length > 254) { problems.push(`Line ${i + 1}: that is not an email address.`); return; }
    const [name = "", groupText = ""] = rest;
    let group = defaultGroup;
    if (groupText) {
      const g = groups.find((x) => x.id === groupText.toLowerCase() || x.name.toLowerCase() === groupText.toLowerCase());
      if (!g) { problems.push(`Line ${i + 1}: the group is not one of ${groups.map((x) => x.name).join(", ")}.`); return; }
      group = g.id;
    }
    rows.push({ email, name: name.slice(0, 120), group });
  });
  if (rows.length > 500) return { rows: [], problems: ["Add at most 500 people at a time."] };
  return { rows, problems };
}

export const DEFAULT_TEXT = {
  invitation: {
    subject: "Help us decide what comes first: {{session}}",
    body: [
      "Hello {{name}},",
      "",
      "We are choosing what to build first and your view counts. It takes a few minutes, on your phone or your computer.",
      "",
      "Your answers are anonymous to the other participants. {{closes}}",
    ].join("\n"),
  },
  reminder: {
    subject: "A reminder to vote: {{session}}",
    body: ["Hello {{name}},", "", "You have not voted yet in {{session}}. {{closes}} It only takes a few minutes."].join("\n"),
  },
} as const;

export type MailContext = { name: string | null; session: string; closesAt: string | null; link: string; unsubscribe: string | null };
const whenText = (iso: string | null) => (iso ? `Voting closes on ${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC.` : "");

import { buildEmail, type TemplateText } from "./email/registry/registry";
import { DEFAULT_SITE_URL } from "./email/registry/layout";

/**
 * The email one participant gets: the platform's frame (registry keys alignment.invitation and alignment.reminder) around the workspace
 * admin's own subject and text. The personal link is always the button (the writer cannot leave it out), reminders carry a stop link,
 * and there are no tracking images. Everything written by a person is escaped, and an unknown {{macro}} is dropped, never sent raw.
 */
export function buildParticipantEmail(m: { kind: "invitation" | "reminder"; subject: string; body: string }, c: MailContext & { siteUrl?: string; override?: Partial<TemplateText> | null }): { subject: string; text: string; html: string } {
  const body = m.body.replace(/\{\{\s*link\s*\}\}/gi, "").replace(/[ \t]+\n/g, "\n").trim();
  const subject = m.subject.replace(/\{\{\s*link\s*\}\}/gi, "");
  const r = buildEmail(m.kind === "reminder" ? "alignment.reminder" : "alignment.invitation", {
    values: { name: c.name, session: c.session, closes: whenText(c.closesAt), link: c.link },
    siteUrl: c.siteUrl ?? DEFAULT_SITE_URL,
    buttonUrl: c.link,
    extraLink: c.unsubscribe && m.kind === "reminder" ? { label: "Do not want reminders? Stop them here:", url: c.unsubscribe } : null,
    workspaceText: { subject, body },
    override: c.override,
  });
  return { ...r, subject: r.subject.slice(0, 150) };
}

/** The email for a participant who asked for a new link. Registry key alignment.new-link. */
export function buildNewLinkEmail(c: { name: string | null; session: string; closesAt: string | null; link: string; siteUrl?: string; override?: Partial<TemplateText> | null }): { subject: string; text: string; html: string } {
  const r = buildEmail("alignment.new-link", { values: { name: c.name, session: c.session, closes: whenText(c.closesAt), link: c.link }, siteUrl: c.siteUrl ?? DEFAULT_SITE_URL, buttonUrl: c.link, override: c.override });
  return { ...r, subject: r.subject.slice(0, 150) };
}

export type ParticipantRowState = { email_status: string; invited_at: string | null; consent_at: string | null; unsubscribed_at: string | null; removed_at: string | null; voted: boolean; email_error?: string | null };

/** One short word for the participant list, always text (never colour alone). */
export function participantState(p: ParticipantRowState): { label: string; tone: "ok" | "warn" | "bad" | "muted" } {
  if (p.removed_at) return { label: "Removed", tone: "muted" };
  if (p.voted) return { label: "Voted", tone: "ok" };
  if (p.email_status === "bounced") return { label: "Bounced: the address did not accept the email", tone: "bad" };
  if (p.email_status === "complained") return { label: "Marked as spam", tone: "bad" };
  if (p.email_status === "failed") return { label: `Not sent${p.email_error ? `: ${p.email_error}` : ""}`, tone: "bad" };
  if (p.consent_at) return { label: "Joined, not voted yet", tone: "warn" };
  if (!p.invited_at) return { label: "Not invited yet", tone: "muted" };
  return { label: p.email_status === "delivered" ? "Invited, delivered" : "Invited", tone: "warn" };
}

export const MAILING_STATE_LABEL: Record<string, string> = { draft: "Draft, not sent", confirmed: "Confirmed, sending", sending: "Sending", done: "Sent", cancelled: "Cancelled" };
