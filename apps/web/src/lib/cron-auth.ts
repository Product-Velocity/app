import { createHash, timingSafeEqual } from "node:crypto";

/** Whether the request carries `Authorization: Bearer <CRON_SECRET>` (Vercel Cron). Compared in constant time; no secret set means nobody is let in. */
export function isCronRequest(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}
