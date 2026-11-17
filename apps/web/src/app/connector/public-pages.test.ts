import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { toolsFor } from "@/lib/mcp/rpc";
import { CONNECTOR_URL, SUPPORT_CONTACT } from "@/lib/public-contact";
import ConnectorPage from "./page";
import PrivacyPage from "../privacy/page";

// The two pages the Connectors Directory submission links to. They must open without signing in, say who to write to, and stay in step with the server.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const connector = renderToStaticMarkup(createElement(ConnectorPage));
const privacy = renderToStaticMarkup(createElement(PrivacyPage));

describe("connector documentation (/connector)", () => {
  it("gives the connector address, the setup steps, the support contact and a link to the privacy policy", () => {
    const t = text(connector);
    expect(t).toContain(CONNECTOR_URL);
    expect(t).toContain("claude mcp add --transport http product-velocity " + CONNECTOR_URL);
    expect(t).toMatch(/Approve/);
    expect(t).toContain(SUPPORT_CONTACT.email);
    expect(connector).toContain('href="/privacy"');
  });
  it("lists every tool Claude is shown, with its effect, and nothing else", () => {
    const names = [...connector.matchAll(/<td><code>([a-z_]+)<\/code><\/td>/g)].map((m) => m[1]);
    expect(names).toEqual(toolsFor("claude").map((t) => t.name));
    expect(names).not.toContain("get_playbook"); // ChatGPT only
  });
  it("says what Claude cannot do and never claims it approves", () => {
    const t = text(connector);
    expect(t).toMatch(/Approve anything or mark work ready for build/);
    expect(t).toMatch(/Set Stack Rank, Decision or Value/);
    expect(t).not.toMatch(/Claude (can )?approve[sd]? /i);
  });
  it("uses the product name in full and no competitor claims", () => {
    const t = text(connector) + text(privacy);
    expect(t).not.toMatch(/\bPV\b|ProductVelocity/);
    expect(t).not.toMatch(/\b(the best|the first|the only|number one|world-class|market-leading|unlike [A-Z])/i); // brand guide: no invented competitor claims
  });
});

describe("privacy policy (/privacy)", () => {
  it("names who to write to and covers the parts a directory reviewer looks for", () => {
    const t = text(privacy);
    expect(t).toContain(SUPPORT_CONTACT.name);
    expect(t).toContain(SUPPORT_CONTACT.email);
    for (const part of ["What we store", "Why we use it", "AI assistants and the connector", "Who processes data for us", "How long we keep it", "Your rights", "Security"]) expect(t, part).toContain(part);
    for (const provider of ["Supabase", "Vercel", "Resend"]) expect(t, provider).toContain(provider);
  });
  it("states the AI promises the product keeps", () => {
    const t = text(privacy);
    expect(t).toMatch(/do not sell personal data/);
    expect(t).toMatch(/do not use workspace content to train AI models/);
    expect(t).toMatch(/revoke a connection at any time/);
    expect(t).toMatch(/Commercial fields such as value, confidence, customer names, decisions and their reasons are never sent to GitHub or Jira/);
  });
});

describe("public pages do not need a session", () => {
  it("neither page imports the session helpers", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["connector/page.tsx", "privacy/page.tsx", "../components/public-page.tsx"]) {
      expect(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), f).not.toMatch(/requireWorkspace|requireUser|lib\/session/);
    }
  });
});
