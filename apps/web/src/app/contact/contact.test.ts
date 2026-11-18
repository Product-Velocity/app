import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SUPPORT_CONTACT } from "@/lib/public-contact";
import { buildContactEmail } from "@/lib/email/access";
import { GET as llms } from "../llms.txt/route";
import ConnectorPage from "../connector/page";
import PrivacyPage from "../privacy/page";
import { ContactForm } from "./contact-form";
import { CONTACT_SUBJECTS, checkContact, readContact, subjectFromSlug } from "./contact";

const f = (o: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(o)) d.set(k, v); return d; };
const ok = { name: "Ana", email: "ana@example.com", subject: CONTACT_SUBJECTS[0].label, message: "How does approval work?" };

describe("contact form rules", () => {
  it("needs a name, an address, a known subject and a message", () => {
    expect(Object.keys(checkContact(readContact(f({})))).sort()).toEqual(["email", "message", "name", "subject"]);
    expect(checkContact(readContact(f(ok)))).toEqual({});
    expect(checkContact(readContact(f({ ...ok, email: "nope" })))).toHaveProperty("email");
    expect(checkContact(readContact(f({ ...ok, subject: "Free money" })))).toHaveProperty("subject");
    expect(checkContact(readContact(f({ ...ok, message: "hi" })))).toHaveProperty("message");
  });
  it("cleans single-line fields, keeps line breaks in the message and caps its length", () => {
    const v = readContact(f({ ...ok, name: " Ana\nTest ", email: " ANA@Example.com ", message: "Line one\r\nLine two" + "x".repeat(5000) }));
    expect(v.name).toBe("Ana Test");
    expect(v.email).toBe("ana@example.com");
    expect(v.message.startsWith("Line one\nLine two")).toBe(true);
    expect(v.message.length).toBe(4000);
  });
  it("maps ?subject= links to a dropdown choice and ignores unknown ones", () => {
    expect(subjectFromSlug("privacy")).toBe("Privacy or my data");
    expect(subjectFromSlug("connector")).toBe("Connecting Claude or another AI assistant");
    expect(subjectFromSlug("nonsense")).toBe("");
    expect(subjectFromSlug(undefined)).toBe("");
  });
  it("offers every subject in the dropdown, preselects the linked one and has a hidden bot field", () => {
    const html = renderToStaticMarkup(createElement(ContactForm, { subject: "Privacy or my data" }));
    for (const s of CONTACT_SUBJECTS) expect(html).toContain(s.label);
    expect(html).toMatch(/<option[^>]*selected[^>]*>Privacy or my data|<option[^>]*>Privacy or my data/);
    expect(html).toContain('name="website"');
  });
});

describe("the owner's name and address stay off the public pages", () => {
  const html = (el: React.ReactElement) => renderToStaticMarkup(el);
  it("is not printed on /connector, /privacy, the help footer or llms.txt, and the pages link to /contact", async () => {
    const pages = [html(createElement(ConnectorPage)), html(createElement(PrivacyPage)), await llms().text()];
    for (const p of pages) {
      expect(p).not.toContain(SUPPORT_CONTACT.email);
      expect(p).not.toContain(SUPPORT_CONTACT.name);
      expect(p).toContain("/contact");
    }
  });
  it("is not in any public page source", () => {
    const root = join(__dirname, "..");
    for (const file of ["connector/page.tsx", "privacy/page.tsx", "(marketing)/home.tsx", "llms.txt/route.ts", "../components/public-page.tsx", "../components/help/help-ui.tsx"]) {
      const src = readFileSync(join(root, file), "utf8");
      expect(src, file).not.toMatch(/SUPPORT_CONTACT|mailto:/);
    }
  });
});

describe("contact email", () => {
  it("carries the sender, subject and message and escapes markup", () => {
    const m = buildContactEmail({ name: "Ana", email: "ana@example.com", subject: "Privacy or my data", message: "Hello <b>there</b>\nSecond line" });
    expect(m.subject).toContain("Privacy or my data");
    expect(m.text).toContain("ana@example.com");
    expect(m.text).toContain("Second line");
    expect(m.html).not.toContain("<b>there</b>");
  });
});
