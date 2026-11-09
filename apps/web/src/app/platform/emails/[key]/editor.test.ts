import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { templateByKey, type EmailKey } from "@/lib/email/registry/registry";
import { TemplateEditor } from "./editor";

const noop = () => {};
const render = (key: EmailKey, over: Partial<{ hasDraft: boolean; hasPublished: boolean; initial: Record<string, string | null> }> = {}) => {
  const t = templateByKey(key);
  return renderToStaticMarkup(createElement(TemplateEditor, {
    templateKey: key, siteUrl: "https://app.example", isAuth: key.startsWith("auth."),
    initial: { subject: t.subject, preheader: t.preheader, heading: t.heading, body: t.body, button: t.button, note: t.note, ...(over.initial ?? {}) },
    hasDraft: over.hasDraft ?? false, hasPublished: over.hasPublished ?? false,
    saveAction: noop, testAction: noop, publishAction: noop, discardAction: noop,
  }));
};

const tag = (h: string, id: string) => /<button[^>]*>/g[Symbol.match](h)!.find((b) => b.includes(`data-testid="${id}"`))!;

describe("wording editor (issue #370 phase 4)", () => {
  it("an auth email shows the warning that everyone who signs in will see the change; an app email does not", () => {
    expect(render("auth.sign-in-link")).toContain("everyone who signs in");
    expect(render("app.invitation")).not.toContain("everyone who signs in");
  });
  it("shows a live preview with sample data, the allowed macros, and no raw macro", () => {
    const h = render("app.invitation");
    expect(h).toContain("Sam Rivera invited you to Meridian Media");
    expect(h).toContain("{{inviter}}");
    expect(h).toContain('sandbox=""');
    expect(h).not.toMatch(/<iframe[^>]*srcDoc="[^"]*\{\{/);
  });
  it("starts with save and publish off (nothing changed, no draft) and test send on", () => {
    const h = render("app.invitation");
    expect(tag(h, "save-draft")).toContain("disabled");
    expect(tag(h, "publish")).toContain("disabled");
    expect(tag(h, "send-test")).not.toContain("disabled");
  });
  it("a copy that breaks the rules shows the problem and keeps test send off", () => {
    const h = render("app.invitation", { initial: { body: "Click https://evil.example <b>now</b>" } });
    expect(h).toContain('data-testid="problems"');
    expect(h).toContain("HTML is not allowed");
    expect(tag(h, "send-test")).toContain("disabled");
    expect(tag(h, "save-draft")).toContain("disabled");
  });
  it("an email without a button has no button field; alignment emails lock the subject and text", () => {
    expect(render("app.link-code")).not.toContain('name="button"');
    const al = render("alignment.invitation");
    expect(al).toMatch(/<input id="f-subject"[^>]*disabled/);
    expect(al).toContain("written by the workspace admin");
  });
});

describe("test send goes only to the signed-in owner (source check)", () => {
  const src = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
  it("the recipient is the session's own address, never a form value", () => {
    expect(src).toContain("to: user.email");
    expect(src).not.toMatch(/form\.get\(\s*["']to["']/);
    expect(src).not.toMatch(/to:\s*(?!user\.email)[a-zA-Z_.]+\s*[,}]/);
  });
  it("is labelled Test, rate limited per person, logged as a test, and refused inside a customer account", () => {
    expect(src).toContain("`Test: ${r.subject}`");
    expect(src).toContain("TEST_SENDS_PER_HOUR");
    expect(src).toContain('.eq("actor_id", user.id)');
    expect(src).toContain("isTest: true");
    expect(src).toContain("currentPlatformEntry");
  });
});
