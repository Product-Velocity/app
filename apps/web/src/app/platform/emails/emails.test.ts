import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES } from "@/lib/email/registry/registry";
import { EmailsTable } from "./emails-table";

describe("platform Emails overview (read-only)", () => {
  const html = renderToStaticMarkup(
    createElement(EmailsTable, { templates: EMAIL_TEMPLATES, stats: [{ template_key: "app.invitation", sends: "12", failures: "2", delivered: "9", bounced: "1", last_sent: null }] }),
  );
  it("lists every template with its trigger, recipient, path, confirm-first and limits", () => {
    for (const t of EMAIL_TEMPLATES) {
      expect(html).toContain(t.key);
      expect(html).toContain(`/platform/emails/${encodeURIComponent(t.key)}`);
    }
    expect(html).toContain("Yes: a person confirms the preview");
  });
  it("shows the 30-day sends and failures, and zero when there are none", () => {
    expect(html).toMatch(/<td>12<\/td><td>2<\/td>/);
    expect(html).toMatch(/<td>0<\/td><td>0<\/td>/);
  });
  it("shows gate notifications as in-app only, with no template", () => {
    expect(html).toContain("In-app notifications only");
    expect(html).toContain("No email");
  });
  it("cannot edit wording or send from here: no text field, and the only controls are the Pause and Activate switches", () => {
    expect(html).not.toMatch(/<textarea|type="text"|type="email"/i);
    const inputs = [...html.matchAll(/<input[^>]*>/gi)].map((m) => m[0]);
    for (const i of inputs) expect(i, i).toMatch(/type="hidden"/);
    const buttons = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/gi)].map((m) => m[1]);
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(["Pause", "Activate"]).toContain(b);
  });
  it("shows Active or Paused as words, and no switch for an email that must always go out", () => {
    expect(html).toContain("Always on");
    expect(html).toMatch(/Paused/);
    expect(html).toMatch(/Active/);
    const signIn = html.slice(html.indexOf("auth.sign-in-link") - 900, html.indexOf("auth.sign-in-link"));
    expect(signIn).not.toMatch(/<button/);
  });
});

import { openText } from "./emails-table";
describe("open text", () => {
  it("says what an email that is not tracked, has no sends, or has opens shows", () => {
    expect(openText(undefined, false)).toBe("Not tracked");
    expect(openText(undefined, true)).toBe("No sends yet");
    expect(openText({ template_key: "app.invitation", tracked: "12", opened: "3" }, true)).toBe("3 of 12 (25%)");
  });
});
