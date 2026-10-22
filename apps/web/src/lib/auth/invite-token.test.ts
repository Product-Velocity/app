import { describe, expect, it } from "vitest";
import { generateInviteToken, hashInviteToken } from "./invite-token";

describe("invite tokens", () => {
  it("are URL-safe, 256 bits and unique", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateInviteToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("hash to lowercase hex SHA-256 (same as the database function)", () => {
    expect(hashInviteToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
