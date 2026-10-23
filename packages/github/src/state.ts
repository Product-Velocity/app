import { createHmac, timingSafeEqual } from "node:crypto";

// The `state` value carried through GitHub's install page and back to our setup URL. It ties the install to one
// workspace, one admin and one connection row, and expires, so a pasted or replayed link cannot bind an installation
// to another workspace.
export type InstallState = { tenantId: string; userId: string; connectionId: string; exp: number };

const key = (secret: string) => createHmac("sha256", secret).update("pv-github-install-state-v1").digest();
const sign = (body: string, secret: string) => createHmac("sha256", key(secret)).update(body).digest("base64url");

export function signInstallState(s: InstallState, secret: string): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyInstallState(token: string | null | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): InstallState | null {
  if (!token) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<InstallState>;
    if (typeof s.tenantId !== "string" || typeof s.userId !== "string" || typeof s.connectionId !== "string" || typeof s.exp !== "number") return null;
    return s.exp > nowSeconds ? (s as InstallState) : null;
  } catch {
    return null;
  }
}
