import { describe, expect, it } from "vitest";
import { parseCallbackParams } from "./callback-params";

const p = (qs: string) => parseCallbackParams(new URLSearchParams(qs));

describe("parseCallbackParams", () => {
  it("prefers a one-time token link (works in any browser)", () => {
    expect(p("token_hash=abc123&type=email&next=%2Finvite%2Fx")).toEqual({
      kind: "otp",
      tokenHash: "abc123",
      type: "email",
      next: "/invite/x",
    });
  });

  it("accepts signup and recovery types only", () => {
    expect(p("token_hash=a&type=signup")).toMatchObject({ kind: "otp", type: "signup" });
    expect(p("token_hash=a&type=recovery")).toMatchObject({ kind: "otp", type: "recovery" });
    for (const bad of ["magiclink", "invite", "email_change", "admin", ""]) {
      expect(p(`token_hash=a&type=${bad}`)).toEqual({ kind: "none" });
    }
  });

  it("falls back to the PKCE code", () => {
    expect(p("code=xyz&next=%2Fhome")).toEqual({ kind: "code", code: "xyz", next: "/home" });
  });

  it("sanitises next in every case", () => {
    expect(p("code=xyz&next=https%3A%2F%2Fevil.example")).toMatchObject({ next: "/" });
    expect(p("token_hash=a&type=email&next=%2F%2Fevil.example")).toMatchObject({ next: "/" });
  });

  it("returns none when there is nothing to exchange", () => {
    expect(p("")).toEqual({ kind: "none" });
    expect(p("token_hash=&type=email")).toEqual({ kind: "none" });
  });
});
