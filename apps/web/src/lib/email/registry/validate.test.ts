import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES, templateByKey, type TemplateText } from "./registry";
import { editableFields, validateTemplateText } from "./validate";

const text = (k: Parameters<typeof templateByKey>[0], over: Partial<TemplateText> = {}): TemplateText => {
  const t = templateByKey(k);
  return { subject: t.subject, preheader: t.preheader, heading: t.heading, body: t.body, button: t.button, note: t.note, ...over };
};

describe("template wording rules (issue #370)", () => {
  it("every code default passes its own rules", () => {
    for (const t of EMAIL_TEMPLATES) expect(validateTemplateText(t, text(t.key)), t.key).toEqual([]);
  });
  it("a template cannot contain HTML, a script, a typed link or an image", () => {
    const k = "app.invitation";
    for (const bad of ["<b>x</b>", "<script>alert(1)</script>", "<img src=x onerror=y>", "see https://evil.example/login", "mail me: mailto:a@b.c", "www.evil.example"]) {
      expect(validateTemplateText(templateByKey(k), text(k, { body: bad })).length, bad).toBeGreaterThan(0);
    }
  });
  it("unknown macros and macros the template does not allow are refused", () => {
    expect(validateTemplateText(templateByKey("app.link-code"), text("app.link-code", { body: "Hi {{nmae}}" }))).toEqual(["Body: Unknown macro {{nmae}}."]);
    expect(validateTemplateText(templateByKey("app.link-code"), text("app.link-code", { body: "Hi {{inviter}}" }))).toEqual(["Body: {{inviter}} is not available in this email."]);
    expect(validateTemplateText(templateByKey("app.invitation"), text("app.invitation", { body: "Hi {{inviter}} at {{workspace}}" }))).toEqual([]);
  });
  it("keeps the button: cannot be added where there is none, or emptied where there is one", () => {
    expect(validateTemplateText(templateByKey("app.link-code"), text("app.link-code", { button: "Click" }))).toEqual(["This email has no button; its wording cannot add one."]);
    expect(validateTemplateText(templateByKey("app.invitation"), text("app.invitation", { button: "" })).length).toBeGreaterThan(0);
  });
  it("one-line fields refuse line breaks and everything has a length limit", () => {
    expect(validateTemplateText(templateByKey("app.invitation"), text("app.invitation", { subject: "a\nb" }))).toContain("Subject must be one line.");
    expect(validateTemplateText(templateByKey("app.invitation"), text("app.invitation", { body: "x".repeat(4001) })).join(" ")).toContain("too long");
    expect(validateTemplateText(templateByKey("app.invitation"), text("app.invitation", { heading: "  " })).join(" ")).toContain("cannot be empty");
  });
  it("alignment emails: only the frame is editable, the text belongs to the workspace admin", () => {
    expect(editableFields(templateByKey("alignment.invitation"))).toEqual(["preheader", "heading", "button", "note"]);
    expect(validateTemplateText(templateByKey("alignment.reminder"), text("alignment.reminder", { body: "Changed" })).join(" ")).toContain("Body cannot be changed");
    expect(validateTemplateText(templateByKey("alignment.reminder"), text("alignment.reminder", { heading: "New heading {{session}}" }))).toEqual([]);
  });
});
