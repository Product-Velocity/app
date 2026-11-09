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
  it("has no form, no input and no button: nothing here can edit or send", () => {
    expect(html).not.toMatch(/<form|<input|<button|<textarea/i);
  });
});
