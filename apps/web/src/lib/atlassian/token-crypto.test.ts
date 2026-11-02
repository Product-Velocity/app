import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, keyIdOf, keyRing } from "./token-crypto";

const b64 = () => randomBytes(32).toString("base64");

describe("token encryption", () => {
  it("round-trips, and the stored form holds no plain text", () => {
    const ring = keyRing({ ATLASSIAN_TOKEN_KEY: b64() })!;
    const { value, keyId } = encryptToken("secret-refresh-token", ring);
    expect(value).not.toContain("secret");
    expect(value.startsWith(`v1.${keyId}.`)).toBe(true);
    expect(decryptToken(value, ring)).toBe("secret-refresh-token");
  });
  it("uses a fresh nonce each time", () => {
    const ring = keyRing({ ATLASSIAN_TOKEN_KEY: b64() })!;
    expect(encryptToken("x", ring).value).not.toBe(encryptToken("x", ring).value);
  });
  it("refuses a wrong key and a tampered value", () => {
    const a = keyRing({ ATLASSIAN_TOKEN_KEY: b64() })!;
    const b = keyRing({ ATLASSIAN_TOKEN_KEY: b64() })!;
    const { value } = encryptToken("x", a);
    expect(() => decryptToken(value, b)).toThrow();
    const parts = value.split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptToken(parts.join("."), a)).toThrow();
  });
  it("still reads values from the previous key while they are re-encrypted", () => {
    const oldKey = b64();
    const before = encryptToken("x", keyRing({ ATLASSIAN_TOKEN_KEY: oldKey })!).value;
    const ring = keyRing({ ATLASSIAN_TOKEN_KEY: b64(), ATLASSIAN_TOKEN_KEY_OLD: oldKey })!;
    expect(decryptToken(before, ring)).toBe("x");
    expect(keyIdOf(ring.current)).not.toBe(keyIdOf(ring.old!));
  });
  it("needs a 32 byte key", () => {
    expect(keyRing({})).toBeNull();
    expect(keyRing({ ATLASSIAN_TOKEN_KEY: Buffer.from("short").toString("base64") })).toBeNull();
  });
});
