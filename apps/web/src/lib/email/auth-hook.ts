import { createHmac, timingSafeEqual } from "node:crypto";
import { renderTemplate, templateForAction, type EmailKey, type Rendered, type TemplateText } from "./registry/registry";

/**
 * Supabase Send Email hook (issue #370). Supabase signs hook calls with the Standard Webhooks scheme: headers webhook-id,
 * webhook-timestamp, webhook-signature ("v1,<base64 HMAC-SHA256 of id.timestamp.body>"), secret "v1,whsec_<base64>".
 * [SPIKE] unverified against current Supabase docs and a real project (docs/08, S10); the route stays off until the secret is set.
 */
export function verifyHookSignature(rawBody: string, h: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, now = Date.now()): boolean {
  if (!h.id || !h.timestamp || !h.signature || !secret) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest();
  for (const part of h.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

export type HookPayload = {
  user?: { email?: unknown; new_email?: unknown };
  email_data?: { token?: unknown; token_hash?: unknown; redirect_to?: unknown; site_url?: unknown; email_action_type?: unknown; token_hash_new?: unknown; token_new?: unknown };
};

export type HookPlan = { ok: true; mails: { key: EmailKey; to: string; mail: Rendered }[] } | { ok: false; reason: "bad-payload" | "unsupported-action" };

/**
 * Pure: payload in, emails out (one, or two for an email change that must be confirmed at both addresses). The link goes to our own
 * /auth/callback with the one-time token hash; an off-site redirect is ignored.
 * [SPIKE] which hash goes to which address on an email change (token_hash to the current address, token_hash_new to the new one) is
 * from memory of GoTrue and unverified (docs/08, S10).
 */
export function planAuthEmail(payload: HookPayload, appUrl: string, override?: Partial<TemplateText> | null): HookPlan {
  const to = payload.user?.email;
  const d = payload.email_data;
  const action = d?.email_action_type;
  if (typeof to !== "string" || !to.includes("@") || !d || typeof action !== "string") return { ok: false, reason: "bad-payload" };
  const t = templateForAction(action);
  if (!t) return { ok: false, reason: "unsupported-action" };
  const base = appUrl.replace(/\/+$/, "");
  let next: string | null = null;
  try {
    const r = typeof d.redirect_to === "string" ? new URL(d.redirect_to) : null;
    next = r && r.origin === new URL(base).origin ? r.searchParams.get("next") : null;
  } catch { /* ignore a malformed redirect */ }
  const link = (hash: unknown): string | null => {
    if (typeof hash !== "string" || !hash || !t.linkType) return null;
    const u = new URL(`${base}/auth/callback`);
    if (next) u.searchParams.set("next", next);
    u.searchParams.set("token_hash", hash);
    u.searchParams.set("type", t.linkType);
    return u.toString();
  };
  const make = (address: string, buttonUrl: string | null, code: string | null): { key: EmailKey; to: string; mail: Rendered } => ({
    key: t.key,
    to: address,
    mail: renderTemplate(t, { values: { link: buttonUrl, code, expires: "60 minutes" }, siteUrl: base, buttonUrl, override }),
  });
  if (t.linkType) {
    const first = link(d.token_hash);
    if (!first) return { ok: false, reason: "bad-payload" };
    const mails = [];
    const newTo = payload.user?.new_email;
    if (action === "email_change" && typeof newTo === "string" && newTo.includes("@")) {
      // two addresses: the new one gets its own hash when Supabase sends one, otherwise the single hash goes to the new address only
      const second = link(d.token_hash_new);
      mails.push(make(newTo, second ?? first, null));
      if (second) mails.push(make(to, first, null));
    } else mails.push(make(to, first, null));
    return { ok: true, mails };
  }
  const code = typeof d.token === "string" ? d.token : null;
  if (t.macros.includes("code") && !code) return { ok: false, reason: "bad-payload" };
  return { ok: true, mails: [make(to, null, code)] };
}
