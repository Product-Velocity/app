import { createHash, randomBytes } from "node:crypto";

/** 256 random bits, URL-safe. Shown to the admin once; only the hash is stored. */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Must match `encode(sha256(convert_to(token, 'utf8')), 'hex')` in accept_invitation(). */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
