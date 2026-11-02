import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Atlassian tokens are stored encrypted (AES-256-GCM, decision 2026-11-02). Stored form: v1.<keyId>.<iv>.<tag>.<ciphertext>,
// all base64url. The key lives only in the ATLASSIAN_TOKEN_KEY environment variable (32 random bytes, base64). A previous key
// can stay in ATLASSIAN_TOKEN_KEY_OLD while tokens are re-encrypted; the key id says which one a stored value used.

export type KeyRing = { current: Buffer; old?: Buffer };

export const keyIdOf = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8);

function parseKey(b64: string | undefined): Buffer | undefined {
  if (!b64) return undefined;
  const key = Buffer.from(b64, "base64");
  return key.length === 32 ? key : undefined;
}

export function keyRing(env: Record<string, string | undefined> = process.env): KeyRing | null {
  const current = parseKey(env.ATLASSIAN_TOKEN_KEY);
  if (!current) return null;
  const old = parseKey(env.ATLASSIAN_TOKEN_KEY_OLD);
  return { current, ...(old ? { old } : {}) };
}

export function encryptToken(plain: string, ring: KeyRing): { value: string; keyId: string } {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", ring.current, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const keyId = keyIdOf(ring.current);
  return { value: ["v1", keyId, iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join("."), keyId };
}

export function decryptToken(stored: string, ring: KeyRing): string {
  const [v, keyId, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !keyId || !iv || !tag || !ct) throw new Error("Unknown token format");
  const key = [ring.current, ring.old].find((k) => k && keyIdOf(k) === keyId);
  if (!key) throw new Error("No key for this token");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
