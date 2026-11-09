import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planAuthEmail, verifyHookSignature } from "../auth-hook";
import { MACRO_CATALOG, macrosIn, renderMacros, validateMacros, validatePlainText } from "./macros";
import { EMAIL_TEMPLATES, previewTemplate, renderTemplate, templateForAction } from "./registry";

describe("macros", () => {
  it("refuses unknown macros and macros the template does not allow", () => {
    expect(validateMacros("Hi {{name}}", ["name"])).toEqual([]);
    expect(validateMacros("Hi {{nmae}}", ["name"])).toEqual(["Unknown macro {{nmae}}."]);
    expect(validateMacros("Code {{code}}", ["name"])).toEqual(["{{code}} is not available in this email."]);
    expect(validateMacros("Oops {{name", ["name"]).length).toBe(1);
  });
  it("uses the fallback for a missing value, so no raw placeholder is ever sent", () => {
    for (const v of [undefined, null, "", "   "]) expect(renderMacros("Hi {{name}}", { name: v }, "text")).toBe("Hi there");
    expect(renderMacros("Hi {{unknown}} {{ name }} {{", {}, "text")).toBe("Hi  there ");
  });
  it("escapes values for HTML and leaves plain text alone", () => {
    expect(renderMacros("{{workspace}}", { workspace: `<b>"A&B"</b>` }, "html")).toBe("&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;");
    expect(renderMacros("{{workspace}}", { workspace: "A&B" }, "text")).toBe("A&B");
  });
  it("a template cannot contain HTML, a script or a typed link", () => {
    expect(validatePlainText("Plain words.")).toEqual([]);
    for (const bad of ["<script>x</script>", "<b>hi</b>", "see https://evil.example", "www.evil.example", "javascript:alert(1)", "<img src=x>"]) expect(validatePlainText(bad).length, bad).toBeGreaterThan(0);
  });
  it("finds every macro used", () => expect(macrosIn("{{a}} {{ b }} {{a}}")).toEqual(["a", "b"]));
});

describe("registry", () => {
  it("every entry has a trigger, recipient, code path, unique key and only catalog macros", () => {
    expect(new Set(EMAIL_TEMPLATES.map((t) => t.key)).size).toBe(EMAIL_TEMPLATES.length);
    for (const t of EMAIL_TEMPLATES) {
      expect(t.trigger.length, t.key).toBeGreaterThan(5);
      expect(t.recipient.length, t.key).toBeGreaterThan(5);
      expect(t.path.length, t.key).toBeGreaterThan(5);
      for (const m of t.macros) expect(Object.keys(MACRO_CATALOG), t.key).toContain(m);
      for (const f of [t.subject, t.preheader, t.heading, t.body, t.note, t.button ?? ""]) {
        expect(validateMacros(f, t.macros), `${t.key}: ${f}`).toEqual([]);
        expect(validatePlainText(f), `${t.key}: ${f}`).toEqual([]);
      }
    }
  });
  it("each Supabase auth action maps to exactly one template", () => {
    for (const a of ["signup", "magiclink", "recovery", "reauthentication", "invite", "email_change"]) expect(EMAIL_TEMPLATES.filter((t) => t.authAction === a)).toHaveLength(1);
    expect(templateForAction("unknown")).toBeUndefined();
  });
  it("previews render with sample data, no raw macros, no scripts, one logo, tagline", () => {
    for (const t of EMAIL_TEMPLATES) {
      const r = previewTemplate(t);
      for (const s of [r.subject, r.html, r.text]) expect(s, t.key).not.toMatch(/\{\{|\}\}/);
      expect(r.html).not.toMatch(/<script/i);
      expect([...r.html.matchAll(/src="([^"]+)"/g)].map((m) => m[1])).toEqual(["https://app.example/email/logo.png"]);
      expect(r.text).toContain("One roadmap for humans and AI.");
    }
  });
  it("a published override changes the words only; a broken override value still sends no raw text", () => {
    const t = templateForAction("recovery")!;
    const r = renderTemplate(t, { values: { expires: "30 minutes" }, siteUrl: "https://x.test", buttonUrl: "https://x.test/auth/callback?a=1", override: { heading: "New <heading> {{product}}" } });
    expect(r.html).toContain("New &lt;heading&gt; Product Velocity");
    expect(r.html).toContain('href="https://x.test/auth/callback?a=1"');
    expect(r.text).toContain("30 minutes");
  });
});

describe("no send site without a registry entry", () => {
  it("every auth email type the hook can send comes from the registry; app send sites are listed until phase 2 moves them", () => {
    const root = join(__dirname, "../../..");
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p); } };
    walk(root);
    const callers = files.filter((f) => /\bsendEmail\(/.test(readFileSync(f, "utf8")) && !f.endsWith("lib/email/resend.ts")).map((f) => f.slice(root.length + 1)).sort();
    // Phase 2 (issue #370) moves these onto the registry and empties this list. Adding a new send site fails here until it has an entry.
    expect(callers).toEqual([
      "app/(workspace)/account/actions.ts",
      "app/(workspace)/settings/members/actions.ts",
      "app/a/[token]/actions.ts",
      "app/api/auth/send-email/route.ts",
      "lib/access-requests.ts",
    ]);
  });
});

describe("Send Email hook", () => {
  const secret = "v1,whsec_" + Buffer.from("test-secret-bytes").toString("base64");
  const sign = (id: string, ts: number, body: string) => `v1,${createHmac("sha256", Buffer.from("test-secret-bytes")).update(`${id}.${ts}.${body}`).digest("base64")}`;
  const body = '{"a":1}';
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  it("accepts a good signature and rejects bad, stale or missing ones", () => {
    expect(verifyHookSignature(body, { id: "m1", timestamp: String(ts), signature: sign("m1", ts, body) }, secret, now)).toBe(true);
    expect(verifyHookSignature(body + " ", { id: "m1", timestamp: String(ts), signature: sign("m1", ts, body) }, secret, now)).toBe(false);
    expect(verifyHookSignature(body, { id: "m1", timestamp: String(ts - 600), signature: sign("m1", ts - 600, body) }, secret, now)).toBe(false);
    expect(verifyHookSignature(body, { id: null, timestamp: null, signature: null }, secret, now)).toBe(false);
    expect(verifyHookSignature(body, { id: "m1", timestamp: String(ts), signature: sign("m1", ts, body) }, "", now)).toBe(false);
  });
  const payload = (action: string, extra = {}) => ({ user: { email: "a@b.test" }, email_data: { token: "123456", token_hash: "hash-1", redirect_to: "https://app.test/auth/callback?next=%2Finvite%2Fx", site_url: "https://proj.supabase.co", email_action_type: action, ...extra } });
  it("builds one email per auth action with a link to our own callback", () => {
    for (const [action, type] of [["signup", "signup"], ["magiclink", "email"], ["recovery", "recovery"], ["invite", "invite"], ["email_change", "email_change"]] as const) {
      const p = planAuthEmail(payload(action), "https://app.test/");
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      expect(p.mails).toHaveLength(1);
      expect(p.mails[0]!.to).toBe("a@b.test");
      const href = /href="([^"]+)"/.exec(p.mails[0]!.mail.html)![1]!.replace(/&amp;/g, "&");
      const u = new URL(href);
      expect(u.origin + u.pathname).toBe("https://app.test/auth/callback");
      expect(u.searchParams.get("token_hash")).toBe("hash-1");
      expect(u.searchParams.get("type")).toBe(type);
      expect(u.searchParams.get("next")).toBe("/invite/x");
    }
  });
  it("reauthentication sends the code and no link; an off-site redirect is ignored", () => {
    const p = planAuthEmail(payload("reauthentication"), "https://app.test");
    expect(p.ok && p.mails[0]!.mail.text).toContain("123456");
    expect(p.ok && p.mails[0]!.mail.html).not.toContain("<a ");
    const q = planAuthEmail(payload("magiclink", { redirect_to: "https://evil.test/x?next=%2Fowned" }), "https://app.test");
    expect(q.ok && q.mails[0]!.mail.html).not.toContain("evil.test");
    expect(q.ok && q.mails[0]!.mail.html).not.toContain("owned");
  });
  it("an email change goes to the new address with its own link, and to the current one when Supabase sends a second hash", () => {
    const one = planAuthEmail({ user: { email: "old@b.test", new_email: "new@b.test" }, email_data: { token_hash: "h1", email_action_type: "email_change" } }, "https://app.test");
    expect(one.ok && one.mails.map((m) => m.to)).toEqual(["new@b.test"]);
    const two = planAuthEmail({ user: { email: "old@b.test", new_email: "new@b.test" }, email_data: { token_hash: "h1", token_hash_new: "h2", email_action_type: "email_change" } }, "https://app.test");
    expect(two.ok && two.mails.map((m) => m.to)).toEqual(["new@b.test", "old@b.test"]);
    expect(two.ok && two.mails[0]!.mail.html).toContain("token_hash=h2");
    expect(two.ok && two.mails[1]!.mail.html).toContain("token_hash=h1");
  });
  it("refuses an unhandled action or a broken payload without sending", () => {
    expect(planAuthEmail(payload("something_else"), "https://app.test")).toEqual({ ok: false, reason: "unsupported-action" });
    expect(planAuthEmail(payload("magiclink", { token_hash: "" }), "https://app.test")).toEqual({ ok: false, reason: "bad-payload" });
    expect(planAuthEmail({}, "https://app.test")).toEqual({ ok: false, reason: "bad-payload" });
  });
});
