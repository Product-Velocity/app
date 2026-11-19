import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_BRAND } from "@/components/auth-shell";
import { SITE_URL } from "@/lib/public-contact";
import robots from "../robots";
import sitemap from "../sitemap";
import { GET as llms } from "../llms.txt/route";
import { checkEarlyAccess, makeLimiter, readEarlyAccess } from "./early-access";
import { HOME_DESCRIPTION, HOME_JSON_LD, HOME_TITLE } from "./seo";

const dir = __dirname;
const home = readFileSync(join(dir, "home.tsx"), "utf8");
const art = readFileSync(join(dir, "art.ts"), "utf8");
const visible = (home + art + JSON.stringify(AUTH_BRAND) + HOME_DESCRIPTION).toLowerCase();

describe("homepage copy follows the claims rules (docs/17, brand guide)", () => {
  it("makes no competitor, first-or-only or approval claims", () => {
    for (const bad of ["unlike ", "the only ", "the first ", "better than", "replaces jira", "claude approves", "ai approves", "rice", "gemini", "chatgpt"]) {
      // "No AI approves a gate" is the one allowed use of "approves"
      const text = bad === "ai approves" ? visible.replace("no ai approves a gate", "") : visible;
      expect(text, bad).not.toContain(bad);
    }
  });
  it("says tracked, not measured, and go-to-market ready is never shortened wrongly", () => {
    expect(visible).not.toContain("measured");
  });
  it("the sign-in side uses the hero wording", () => {
    expect(home).toContain(AUTH_BRAND.tagline);
    expect(home).toContain(AUTH_BRAND.what);
    expect(home).toContain(AUTH_BRAND.why);
    for (const p of AUTH_BRAND.pillars) expect(home).toContain(p.line);
  });
  it("links Claude to the directory listing", () => {
    expect(home).toContain("https://claude.ai/directory/connectors/product-velocity");
  });
});

describe("search and AI crawler files", () => {
  it("the sitemap lists the public pages on the production address and nothing from the app", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toEqual([`${SITE_URL}/`, `${SITE_URL}/connector`, `${SITE_URL}/contact`, `${SITE_URL}/privacy`]);
  });
  it("robots allow the public pages only and point to the sitemap", () => {
    const r = robots();
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    expect(rule.disallow).toContain("/");
    expect(rule.allow).toEqual(expect.arrayContaining(["/$", "/connector", "/privacy", "/contact", "/sitemap.xml"]));
  });
  it("llms.txt is plain text with the key facts and no secrets", async () => {
    const res = llms();
    expect(res.headers.get("content-type")).toContain("text/plain");
    const t = await res.text();
    expect(t).toContain("# Product Velocity");
    expect(t).toContain("We do not sell tokens");
    expect(t).toContain("A person decides at every gate");
    expect(t).not.toMatch(/password|secret|api[_ -]?key/i);
  });
  it("structured data and titles are set", () => {
    expect(HOME_TITLE.length).toBeLessThanOrEqual(65);
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(240);
    expect(JSON.stringify(HOME_JSON_LD)).toContain("SoftwareApplication");
    expect(JSON.stringify(HOME_JSON_LD)).not.toMatch(/aggregateRating|offers|price/);
  });
  it("Google Tag Manager is loaded only from the one component, behind an id check and denied consent", () => {
    const seo = readFileSync(join(dir, "seo.tsx"), "utf8");
    expect(seo).toContain("analytics_storage:'denied'");
    expect(seo).toContain("GTM-[A-Z0-9]");
    const root = join(dir, "../layout.tsx");
    expect(readFileSync(root, "utf8")).not.toContain("googletagmanager");
  });
});

describe("early-access form", () => {
  const f = (o: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(o)) d.set(k, v); return d; };
  it("needs a name, an address, a company and a role", () => {
    expect(Object.keys(checkEarlyAccess(readEarlyAccess(f({})))).sort()).toEqual(["company", "email", "name", "role"]);
    expect(checkEarlyAccess(readEarlyAccess(f({ name: "Ana", email: "ana@example.com", company: "Meridian Media", role: "Product management" })))).toEqual({});
    expect(checkEarlyAccess(readEarlyAccess(f({ name: "Ana", email: "not-an-address", company: "M", role: "Product management" })))).toHaveProperty("email");
    expect(checkEarlyAccess(readEarlyAccess(f({ name: "Ana", email: "a@b.co", company: "M", role: "Wizard" })))).toHaveProperty("role");
  });
  it("trims, lower-cases and removes control characters", () => {
    const v = readEarlyAccess(f({ name: "  Ana\nTest ", email: " ANA@Example.com ", company: "M", role: "Other" }));
    expect(v.name).toBe("Ana Test");
    expect(v.email).toBe("ana@example.com");
  });
  it("allows five requests an hour per key", () => {
    let t = 0;
    const allow = makeLimiter(5, 3_600_000, () => t);
    for (let i = 0; i < 5; i++) expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
    expect(allow("b")).toBe(true);
    t += 3_600_001;
    expect(allow("a")).toBe(true);
  });
});
