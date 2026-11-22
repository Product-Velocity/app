import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AUTH_BRAND } from "@/components/auth-shell";
import { SITE_URL } from "@/lib/public-contact";
import robots from "../robots";
import sitemap from "../sitemap";
import { GET as llms } from "../llms.txt/route";
import { checkEarlyAccess, makeLimiter, readEarlyAccess } from "./early-access";
import { ClassicHome } from "./home-classic";
import { Home } from "./home";
import { HOME_DESCRIPTION, HOME_JSON_LD, HOME_TITLE } from "./seo";
import { GET as llmsFull } from "../llms-full.txt/route";
import { sectionText } from "./plain-text";

const dir = __dirname;
const home = readFileSync(join(dir, "home.tsx"), "utf8");
const classic = readFileSync(join(dir, "home-classic.tsx"), "utf8");
const art = readFileSync(join(dir, "art.ts"), "utf8");
const artV2 = readFileSync(join(dir, "art-v2.ts"), "utf8");
const visible = (home + classic + art + artV2 + JSON.stringify(AUTH_BRAND) + HOME_DESCRIPTION).toLowerCase();

describe("homepage copy follows the claims rules (docs/17, brand guide)", () => {
  it("makes no competitor, first-or-only or approval claims", () => {
    for (const bad of ["unlike ", "the only ", "the first ", "better than", "replaces jira", "claude approves", "ai approves", "rice"]) {
      // "No AI approves a gate" is the one allowed use of "approves"
      const text = bad === "ai approves" ? visible.replace("no ai approves a gate", "") : visible;
      expect(text, bad).not.toContain(bad);
    }
  });
  it("says tracked, not measured, and go-to-market ready is never shortened wrongly", () => {
    expect(visible).not.toContain("measured");
  });
  it("the classic page still carries the wording the sign-in side uses", () => {
    expect(classic).toContain(AUTH_BRAND.tagline);
    expect(classic).toContain(AUTH_BRAND.what);
    expect(classic).toContain(AUTH_BRAND.why);
  });
  it("links Claude to the directory listing", () => {
    expect(home).toContain("https://claude.ai/directory/connectors/product-velocity");
  });
  it("the homepage leads with the agentic product management headline", () => {
    const h = renderToStaticMarkup(createElement(Home, { viewer: null }));
    expect(h).toContain("<h1>Deliver bigger, better outcomes. Faster.</h1>");
    expect(h).toContain("Agentic product management platform");
    expect(h.match(/<h1[ >]/g)).toHaveLength(1);
  });
  it("tells the story in eight chapters with a four-link header and a menu for small screens (issue #578)", () => {
    const h = renderToStaticMarkup(createElement(Home, { viewer: null }));
    for (const id of ["problem", "what", "how", "usecases", "velocity", "changes", "trust", "early-access"]) expect(h).toContain(`id="${id}"`);
    const nav = /<nav aria-label="Main">([\s\S]*?)<\/nav>/.exec(h)![1]!;
    expect(nav.match(/<a /g)).toHaveLength(4);
    expect(h).toContain('class="burger"');
    expect(h).toContain("One roadmap for humans and their AI.");
    for (const tab of ["Align", "Decide", "Deliver", "Report", "Learn"]) expect(h).toContain(`>${tab}</button>`);
  });
  it("velocity is team level only", () => {
    expect(artV2.toLowerCase()).toContain("team-level only, never individuals");
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
    expect(rule.allow).toEqual(expect.arrayContaining(["/$", "/connector", "/privacy", "/contact", "/sitemap.xml", "/llms.txt", "/llms-full.txt"]));
    expect(rule.allow).not.toContain("/classic");
  });
  it("names the AI crawlers with the same public paths and never opens /classic", () => {
    const rules = (robots().rules as { userAgent: string | string[]; allow: string[]; disallow: string[] }[]);
    const ai = rules.find((r) => Array.isArray(r.userAgent) && r.userAgent.includes("GPTBot"))!;
    expect(ai.userAgent).toEqual(expect.arrayContaining(["ClaudeBot", "PerplexityBot", "Google-Extended"]));
    expect(ai.disallow).toContain("/");
    expect(ai.allow).not.toContain("/classic");
  });
  it("the sitemap never lists /classic", () => {
    expect(sitemap().map((e) => e.url).join(" ")).not.toContain("classic");
  });
  it("llms-full.txt carries the homepage sections as plain text", async () => {
    const t = await llmsFull().text();
    expect(t).toContain("# Product Velocity: agentic product management platform");
    expect(t).toContain("## The PM connects the dots. Now there are more of them, and they move faster.");
    expect(t).toContain("## See where the time goes, before leadership asks.");
    expect(t).toContain("### Align");
    expect(t).not.toContain("<");
    expect(t).not.toMatch(/password|secret|api[_ -]?key/i);
    expect(sectionText("<h2>A &amp; B</h2><p class=\"lead2\">Text</p><ul><li>One</li></ul>")).toBe("## A & B\n\nText\n\n- One");
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
    expect(HOME_TITLE).toContain("agentic product management");
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(240);
    expect(JSON.stringify(HOME_JSON_LD)).toContain("SoftwareApplication");
    expect(JSON.stringify(HOME_JSON_LD)).not.toMatch(/aggregateRating|offers|price/);
  });
  it("Google Tag Manager is loaded only from the one component, behind an id check and denied consent", () => {
    const seo = readFileSync(join(dir, "seo.tsx"), "utf8");
    expect(seo).toContain("analytics_storage:'denied'");
    expect(seo).toContain("GTM-[A-Z0-9]");
    expect(home).toContain("<GoogleTagManager />");
    expect(classic).toContain("<GoogleTagManager />");
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

describe("the website is separate from the app (issue #570)", () => {
  const html = (viewer: "member" | "demo" | null) => renderToStaticMarkup(createElement(Home, { viewer }));
  it("signed-out visitors see Sign in and the demo", () => {
    const h = html(null);
    expect(h).toContain('href="/sign-in"');
    expect(h).toContain('href="/demo"');
    expect(h).not.toContain('href="/app"');
  });
  it("a member sees Open app instead of Sign in and the demo", () => {
    const h = html("member");
    expect(h).toContain('href="/app"');
    expect(h).toContain("Open app");
    expect(h).not.toContain('href="/sign-in"');
    expect(h).not.toContain('href="/demo"');
  });
  it("someone in the demo account sees Back to the demo and still sees Sign in", () => {
    for (const h of [html("demo"), renderToStaticMarkup(createElement(ClassicHome, { viewer: "demo" }))]) {
      expect(h).toContain("Back to the demo");
      expect(h).toContain('href="/sign-in"');
    }
  });
});

describe("the classic page (issue #574)", () => {
  it("renders the previous homepage and keeps the viewer rules", () => {
    const h = renderToStaticMarkup(createElement(ClassicHome, { viewer: null }));
    expect(h).toContain("AI changed the PM");
    expect(h).toContain('href="/sign-in"');
    expect(h).not.toContain("application/ld+json");
  });
  it("is noindex with the homepage as its canonical address", () => {
    const page = readFileSync(join(dir, "../classic/page.tsx"), "utf8");
    expect(page).toContain("index: false");
    expect(page).toContain('canonical: "/"');
  });
});
