import { describe, expect, it } from "vitest";
import { buildAccessApprovedEmail, buildAccessRequestEmail } from "./access";

describe("access request email (to the admins)", () => {
  const mail = buildAccessRequestEmail({ workspace: "Acme <Co>", requester: "pat@acme.test", link: "https://app.test/settings/members" });
  it("names the person, the workspace and links to the members grid", () => {
    expect(mail.subject).toBe("pat@acme.test asked to join Acme <Co> on Product Velocity");
    expect(mail.text).toContain("pat@acme.test");
    expect(mail.text).toContain("https://app.test/settings/members");
    expect(mail.text).toContain("Requested Access");
  });
  it("escapes names in the HTML", () => {
    expect(mail.html).toContain("Acme &lt;Co&gt;");
    expect(mail.html).not.toContain("<Co>");
  });
});

describe("approval email (to the person)", () => {
  const mail = buildAccessApprovedEmail({ workspace: "Acme", link: "https://app.test/" });
  it("confirms access and gives the direct link", () => {
    expect(mail.subject).toBe("You now have access to Acme on Product Velocity");
    expect(mail.text).toContain("https://app.test/");
    expect(mail.html).toContain('href="https://app.test/"');
  });
});
