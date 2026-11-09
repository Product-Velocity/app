import { createHmac, timingSafeEqual } from "node:crypto";
import { renderTemplate, templateForAction, type Rendered } from "./registry/registry";

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
  user?: { email?: unknown };
  email_data?: { token?: unknown; token_hash?: unknown; redirect_to?: unknown; site_url?: unknown; email_action_type?: unknown };
};

export type HookPlan = { ok: true; to: string; mail: Rendered } | { ok: false; reason: "bad-payload" | "unsupported-action" };

/** Pure: payload in, email out. The link goes to our own /auth/callback with the one-time token hash; an off-site redirect is ignored. */
export function planAuthEmail(payload: HookPayload, appUrl: string): HookPlan {
  const to = payload.user?.email;
  const d = payload.email_data;
  const action = d?.email_action_type;
  if (typeof to !== "string" || !to.includes("@") || !d || typeof action !== "string") return { ok: false, reason: "bad-payload" };
  const t = templateForAction(action);
  if (!t) return { ok: false, reason: "unsupported-action" };
  const base = appUrl.replace(/\/+$/, "");
  let buttonUrl: string | null = null;
  if (t.linkType) {
    if (typeof d.token_hash !== "string" || !d.token_hash) return { ok: false, reason: "bad-payload" };
    const u = new URL(`${base}/auth/callback`);
    // keep the destination Supabase was told about, but only when it is on our own site
    try {
      const r = typeof d.redirect_to === "string" ? new URL(d.redirect_to) : null;
      const next = r && r.origin === new URL(base).origin ? r.searchParams.get("next") : null;
      if (next) u.searchParams.set("next", next);
    } catch { /* ignore a malformed redirect */ }
    u.searchParams.set("token_hash", d.token_hash);
    u.searchParams.set("type", t.linkType);
    buttonUrl = u.toString();
  }
  const code = typeof d.token === "string" ? d.token : null;
  if (t.macros.includes("code") && !code) return { ok: false, reason: "bad-payload" };
  return { ok: true, to, mail: renderTemplate(t, { values: { link: buttonUrl, code, expires: "60 minutes" }, siteUrl: base, buttonUrl }) };
}
