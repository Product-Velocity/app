import { describe, expect, it } from "vitest";
import { countryOptions, currencyOptions, parseWorkspaceProfile, timeZoneOptions } from "./workspace-profile";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe("parseWorkspaceProfile", () => {
  it("reads the profile and normalises domains", () => {
    expect(parseWorkspaceProfile(form({ country: " Spain ", currency: "eur", time_zone: "Europe/Madrid", domains: "Acme.com, @acme.io" }), { requireDomain: true }))
      .toEqual({ country: "Spain", currency: "EUR", timeZone: "Europe/Madrid", domains: ["acme.com", "acme.io"] });
  });
  it("needs a domain when asked to, and refuses free-mail", () => {
    expect(parseWorkspaceProfile(form({ domains: "" }), { requireDomain: true })).toEqual({ error: "Add at least one authorized email domain, for example your company's." });
    expect(parseWorkspaceProfile(form({ domains: "" }), { requireDomain: false })).toMatchObject({ domains: [] });
    expect(parseWorkspaceProfile(form({ domains: "gmail.com" }), { requireDomain: false })).toEqual({ error: "gmail.com is a free email provider. Use your company domain." });
  });
  it("refuses a malformed currency", () => {
    expect(parseWorkspaceProfile(form({ currency: "euro" }), { requireDomain: false })).toEqual({ error: "Choose a currency from the list." });
  });
});

describe("option lists", () => {
  it("offer common values", () => {
    expect(currencyOptions()).toContain("EUR");
    expect(timeZoneOptions()).toContain("Europe/Madrid");
    expect(countryOptions()).toContain("Spain");
  });
});
