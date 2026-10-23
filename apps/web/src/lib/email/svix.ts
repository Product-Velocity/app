import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Resend webhook (they sign with Svix): HMAC-SHA256 over `id.timestamp.body` with the base64 secret after "whsec_".
 * Rejects a missing header, a bad signature and a timestamp more than five minutes from now.
 */
export function verifySvix(rawBody: string, h: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, now = Date.now()): boolean {
  if (!h.id || !h.timestamp || !h.signature || !secret) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest();
  for (const part of h.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** Resend event names to the delivery state shown on the invitation. Anything else is ignored. */
export const EVENT_STATUS: Record<string, "delivered" | "bounced" | "complained"> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};
