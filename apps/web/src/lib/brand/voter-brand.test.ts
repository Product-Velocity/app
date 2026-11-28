import { describe, expect, it } from "vitest";
import { contrast } from "@pv/domain";
import { emailBrandFrom, voterBrandFor, type BrandRow } from "./voter-brand";

const row: BrandRow = { status: "confirmed", use_on_voting: true, display_name: "Acme Media", primary_color: "#0b6e4f", accent_color: "#f59e0b", logo_path: "brand/t/x.png", public_token: "a".repeat(32) };

describe("which brand a voting session shows", () => {
  it("uses a confirmed brand that is switched on for voting, with the derived colours", () => {
    const v = voterBrandFor(row, "Acme Inc", true)!;
    expect(v.name).toBe("Acme Media");
    expect(v.logoPath).toBe(`/b/${"a".repeat(32)}/logo.png`);
    expect(v.vars["--brand"]).toBe("#0b6e4f");
    expect(contrast(v.vars["--on-brand"]!, v.vars["--brand"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v.vars["--brand-strong"]!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
  it("falls back to the workspace name, and to no logo, when the brand has none", () => {
    expect(voterBrandFor({ ...row, display_name: " ", logo_path: null }, "Acme Inc", true)).toMatchObject({ name: "Acme Inc", logoPath: null });
  });
  it("shows the Product Velocity look unless the brand is confirmed, switched on, not opted out of and has a colour", () => {
    expect(voterBrandFor(null, "A", true)).toBeNull();
    expect(voterBrandFor({ ...row, status: "draft" }, "A", true)).toBeNull();
    expect(voterBrandFor({ ...row, use_on_voting: false }, "A", true)).toBeNull();
    expect(voterBrandFor(row, "A", false)).toBeNull();
    expect(voterBrandFor({ ...row, primary_color: null }, "A", true)).toBeNull();
    expect(voterBrandFor({ ...row, primary_color: "nope" }, "A", true)).toBeNull();
  });
  it("makes any colour readable: a pale brand gets dark button text and a darker text colour", () => {
    const v = voterBrandFor({ ...row, primary_color: "#ffeb3b" }, "A", true)!;
    expect(contrast(v.vars["--on-brand"]!, "#ffeb3b")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v.vars["--brand-strong"]!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
  it("gives the email an absolute logo address and the button and link colours", () => {
    const e = emailBrandFrom(voterBrandFor(row, "A", true), "https://app.example/")!;
    expect(e).toMatchObject({ name: "Acme Media", logoUrl: `https://app.example/b/${"a".repeat(32)}/logo.png`, color: "#0b6e4f" });
    expect(emailBrandFrom(null, "https://app.example")).toBeNull();
    expect(emailBrandFrom(voterBrandFor({ ...row, logo_path: null }, "A", true), "https://app.example")!.logoUrl).toBeNull();
  });
});
