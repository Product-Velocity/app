/** Pure rules of alignment participants and invitation emails (issue #124): reading a pasted list, the email text, the states admins see. */
import type { Group } from "./alignment";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

function fill(template: string, c: MailContext): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, c.name?.trim() || "there")
    .replace(/\{\{\s*session\s*\}\}/gi, c.session)
    .replace(/\{\{\s*closes\s*\}\}/gi, whenText(c.closesAt))
    .replace(/\{\{\s*link\s*\}\}/gi, c.link)
    .replace(/[ \t]+\n/g, "\n");
}

/**
 * The email one participant gets. The personal link is always added at the end (the writer cannot leave it out), reminders carry an
 * unsubscribe link, and there are no images and no tracking. Everything written by a person is escaped in the HTML.
 */
export function buildParticipantEmail(m: { kind: "invitation" | "reminder"; subject: string; body: string }, c: MailContext): { subject: string; text: string; html: string } {
  const subject = fill(m.subject, c).replace(/\s+/g, " ").trim().slice(0, 150);
  const body = fill(m.body.replace(/\{\{\s*link\s*\}\}/gi, ""), c).trim();
  const foot = c.unsubscribe && m.kind === "reminder" ? `Do not want reminders? Stop them here: ${c.unsubscribe}` : "";
  const text = [body, "", "Open your personal link to take part:", c.link, "", "The link is only for you. Please do not forward it.", ...(foot ? ["", foot] : [])].join("\n");
  const paragraphs = body.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`);
  const html = [
    ...paragraphs,
    `<p>Open your personal link to take part:<br><a href="${escapeHtml(c.link)}">${escapeHtml(c.link)}</a></p>`,
    "<p>The link is only for you. Please do not forward it.</p>",
    ...(foot ? [`<p>Do not want reminders? <a href="${escapeHtml(c.unsubscribe!)}">Stop them here</a>.</p>`] : []),
  ].join("\n");
  return { subject, text, html };
}

/** The email for a participant who asked for a new link. */
export function buildNewLinkEmail(c: { name: string | null; session: string; closesAt: string | null; link: string }): { subject: string; text: string; html: string } {
  const lines = [`Hello ${c.name?.trim() || "there"},`, "", `Here is your new personal link for ${c.session}. ${whenText(c.closesAt)}`.trim(), c.link, "", "The earlier link no longer works. Please do not forward this one."];
  return {
    subject: `Your new link: ${c.session}`.slice(0, 150),
    text: lines.join("\n"),
    html: `<p>${escapeHtml(lines[0]!)}</p><p>${escapeHtml(lines[2]!)}<br><a href="${escapeHtml(c.link)}">${escapeHtml(c.link)}</a></p><p>${escapeHtml(lines[5]!)}</p>`,
  };
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
