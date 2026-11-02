import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The OAuth `state` of the real Jira connection: signed, tied to one signed-in admin and one workspace, valid 10 minutes.
// Signed with a key derived from ATLASSIAN_TOKEN_KEY, so no extra secret is needed. Format: pv1.<payload>.<signature>.

export type ConnectState = { t: string; u: string; exp: number; n: string };

const sign = (payload: string, key: Buffer) => createHmac("sha256", createHmac("sha256", key).update("atlassian-connect-state").digest()).update(payload).digest("base64url");

export function signConnectState(tenantId: string, userId: string, key: Buffer, now = Date.now()): string {
  const body: ConnectState = { t: tenantId, u: userId, exp: Math.floor(now / 1000) + 600, n: randomBytes(9).toString("base64url") };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `pv1.${payload}.${sign(payload, key)}`;
}

export function verifyConnectState(state: string | null | undefined, key: Buffer, now = Date.now()): ConnectState | null {
  const [v, payload, sig] = (state ?? "").split(".");
  if (v !== "pv1" || !payload || !sig) return null;
  const want = Buffer.from(sign(payload, key));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ConnectState;
    return typeof body.t === "string" && typeof body.u === "string" && body.exp > Math.floor(now / 1000) ? body : null;
  } catch {
    return null;
  }
}
