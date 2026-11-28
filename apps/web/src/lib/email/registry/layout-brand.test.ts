import { describe, expect, it } from "vitest";
import { buildParticipantEmail, buildNewLinkEmail } from "../../alignment-mail";
import { renderHtml, renderText, TAGLINE, type EmailBrand, type LayoutInput } from "./layout";

// Issue #750: a voting session that uses the company brand sends emails with the company's logo, name and colours and no Product Velocity branding.
const brand: EmailBrand = { name: "Acme Media", logoUrl: "https://app.example/b/" + "a".repeat(32) + "/logo.png", color: "#0b6e4f", onColor: "#ffffff", linkColor: "#0a5a41" };
const input: LayoutInput = { subject: "Your vote", preheader: "p", heading: "Vote on Q1", body: "Hi Sam", button: { label: "Open your personal link", url: "https://app.example/a/tok" }, note: "Please do not forward this.", extraLink: { label: "Stop reminders:", url: "https://app.example/a/tok/unsubscribe" }, siteUrl: "https://app.example" };

describe("voter emails with a company brand", () => {
  const html = renderHtml({ ...input, brand });
  it("shows the company's logo and name, and its button and link colours", () => {
    expect(html).toContain(brand.logoUrl!);
    expect(html).toContain("Acme Media");
    expect(html).toContain('bgcolor="#0b6e4f"');
    expect(html).toContain("color:#ffffff;text-decoration:none");
    expect(html).toContain("color:#0a5a41;word-break:break-all");
  });
  it("has no Product Velocity name, logo or tagline anywhere", () => {
    expect(html).not.toContain("Product Velocity");
    expect(html).not.toContain("/email/logo.png");
    expect(html).not.toContain(TAGLINE);
    const text = renderText({ ...input, brand });
    expect(text).not.toContain("Product Velocity");
    expect(text).not.toContain(TAGLINE);
    expect(text).toContain("Acme Media");
  });
  it("shows the name as live text when the brand has no logo", () => {
    const h = renderHtml({ ...input, brand: { ...brand, logoUrl: null } });
    expect(h).toContain("Acme Media");
    expect(h).not.toContain("<img");
  });
  it("escapes the company's name and colours", () => {
    const h = renderHtml({ ...input, brand: { ...brand, name: "A<b>&\"co", color: '#0b6e4f" onload="x' } });
    expect(h).not.toContain("<b>");
    expect(h).not.toContain('onload="x"');
  });
  it("is unchanged without a brand: the Product Velocity look", () => {
    const h = renderHtml(input);
    expect(h).toContain("Product Velocity");
    expect(h).toContain("/email/logo.png");
    expect(h).toContain('bgcolor="#2270ed"');
  });
});

describe("the alignment emails carry the brand", () => {
  it("the invitation, the reminder and the new-link email use it", () => {
    const ctx = { name: "Sam Lee", session: "Q1 priorities", closesAt: null, link: "https://app.example/a/tok", unsubscribe: "https://app.example/a/tok/unsubscribe", siteUrl: "https://app.example", brand };
    for (const kind of ["invitation", "reminder"] as const) {
      const m = buildParticipantEmail({ kind, subject: "Vote on {{session}}", body: "Hi {{firstname}}, please vote.\n\n{{link}}" }, ctx);
      expect(m.html, kind).toContain("Acme Media");
      expect(m.html, kind).not.toContain("Product Velocity");
    }
    const n = buildNewLinkEmail({ name: "Sam", session: "Q1 priorities", closesAt: null, link: "https://app.example/a/tok", siteUrl: "https://app.example", brand });
    expect(n.html).toContain("Acme Media");
    expect(n.html).not.toContain("Product Velocity");
    expect(buildNewLinkEmail({ name: "Sam", session: "Q1", closesAt: null, link: "https://app.example/a/tok", siteUrl: "https://app.example" }).html).toContain("Product Velocity");
  });
});
