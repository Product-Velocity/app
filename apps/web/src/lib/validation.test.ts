import { describe, expect, it } from "vitest";
import { normalizeEmail, parseInviteForm, parseTenantName } from "./validation";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("validation", () => {
  it("normalizes emails", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
    for (const bad of ["", "ana", "ana@", "@x.com", "a b@x.com", "ana@x", 42, null]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
    expect(normalizeEmail("a@" + "b".repeat(260) + ".com")).toBeNull();
  });

  it("parses an invite form", () => {
    expect(parseInviteForm(form({ email: "A@x.io", role: "creator", is_approver: "on" }))).toEqual({
      email: "a@x.io",
      role: "creator",
      isApprover: true,
    });
    expect(parseInviteForm(form({ email: "a@x.io", role: "viewer" }))).toMatchObject({ isApprover: false });
    expect(parseInviteForm(form({ email: "nope", role: "viewer" }))).toHaveProperty("error");
    expect(parseInviteForm(form({ email: "a@x.io", role: "owner" }))).toHaveProperty("error");
  });

  it("validates tenant names", () => {
    expect(parseTenantName("  Meridian Media ")).toBe("Meridian Media");
    expect(parseTenantName("   ")).toBeNull();
    expect(parseTenantName("x".repeat(121))).toBeNull();
  });
});
