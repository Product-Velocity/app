import "server-only";

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** Email is switched on by two environment variables: the Resend API key and a sender on a domain verified at Resend. */
export const emailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

/**
 * Sends one email through Resend's REST API (no library). Returns a short error text that never contains the recipient, the body
 * or the key, so it is safe to show to an admin and to log.
 */
export async function sendEmail(input: { to: string; subject: string; text: string; html: string }): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: "Email is not set up on this deployment yet." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { id?: unknown };
      return typeof j.id === "string" ? { ok: true, id: j.id } : { ok: false, error: "The email service did not confirm the message." };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, error: "The email service refused the key or the sender domain is not verified." };
    if (res.status === 422) return { ok: false, error: "The email service rejected the address or the sender." };
    if (res.status === 429) return { ok: false, error: "The email service is rate limiting us; try again in a minute." };
    return { ok: false, error: `The email service answered ${res.status}.` };
  } catch {
    return { ok: false, error: "We could not reach the email service." };
  }
}
