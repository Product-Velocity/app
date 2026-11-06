import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUTH_TEMPLATES } from "./auth-templates";
import { parseCallbackParams } from "@/lib/auth/callback-params";

const dir = new URL("../../../email-templates/", import.meta.url);

describe("branded auth emails (route A)", () => {
  it("the committed files match the generator (run `pnpm email:templates`)", () => {
    for (const t of AUTH_TEMPLATES) {
      expect(readFileSync(fileURLToPath(new URL(t.file, dir)), "utf8"), t.file).toBe(t.html);
    }
  });

  it.each(AUTH_TEMPLATES.map((t) => [t.file, t] as const))("%s links back to our own callback with a one-time token", (_f, t) => {
    const hrefs = [...t.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\{\{ \.RedirectTo \}\}&token_hash=\{\{ \.TokenHash \}\}&type=(email|recovery)$/);
    }
    // the callback accepts exactly that link type
    const type = hrefs[0]!.split("type=")[1]!;
    expect(parseCallbackParams(new URLSearchParams(`token_hash=abc&type=${type}&next=/`)).kind).toBe("otp");
  });

  it("uses no remote assets except the logo on our own site, and no scripts", () => {
    for (const t of AUTH_TEMPLATES) {
      const srcs = [...t.html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
      expect(srcs, t.file).toEqual(["{{ .SiteURL }}/email/logo.png"]);
      expect(t.html).not.toMatch(/<script|https?:\/\//i);
    }
  });

  it("follows the brand voice: tagline, no emoji, no claims about Claude approving", () => {
    for (const t of AUTH_TEMPLATES) {
      expect(t.html).toContain("One roadmap for humans and AI.");
      expect(t.html).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(t.html).not.toMatch(/approve|best|first|only/i);
    }
  });

  it("has a subject for every template", () => {
    expect(AUTH_TEMPLATES.map((t) => t.file).sort()).toEqual(["confirm-signup.html", "magic-link.html", "reset-password.html"]);
    for (const t of AUTH_TEMPLATES) expect(t.subject.length).toBeGreaterThan(10);
  });
});
