import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildInvitationEmail, emailStatusText, sendLimit } from "./invitation";
import { EVENT_STATUS, verifySvix } from "./svix";

describe("invitation email", () => {
  const mail = buildInvitationEmail({ workspace: "Meridian <Media>", inviter: "Ana", role: "creator", isApprover: true, link: "https://app.example/invite/abc" });
  it("names the workspace, who invited, the role, the link and the 7 days, in plain words", () => {
    expect(mail.subject).toBe("Ana invited you to Meridian <Media> on Product Velocity");
    expect(mail.text).toContain("as Creator and Approver");
    expect(mail.text).toContain("https://app.example/invite/abc");
    expect(mail.text).toContain("expires in 7 days");
    expect(mail.html).not.toMatch(/<img|pixel|track/i);
  });
  it("escapes names in the HTML", () => {
    expect(mail.html).toContain("Meridian &lt;Media&gt;");
    expect(mail.html).not.toContain("<Media>");
  });
});

describe("send limits", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  it("pauses between sends, caps per invitation and per workspace", () => {
    expect(sendLimit({ sendCount: 0, lastSentAt: null, workspaceLastDay: 0, now })).toBeNull();
    expect(sendLimit({ sendCount: 1, lastSentAt: "2026-10-23T11:59:30Z", workspaceLastDay: 0, now })).toContain("Wait 30 seconds");
    expect(sendLimit({ sendCount: 1, lastSentAt: "2026-10-23T11:58:00Z", workspaceLastDay: 0, now })).toBeNull();
    expect(sendLimit({ sendCount: 5, lastSentAt: null, workspaceLastDay: 0, now })).toContain("5 times");
    expect(sendLimit({ sendCount: 0, lastSentAt: null, workspaceLastDay: 100, now })).toContain("today's limit");
  });
});

describe("status text", () => {
  it("is plain and says what happened", () => {
    expect(emailStatusText("not_sent", null, null)).toBe("Link only: not emailed");
    expect(emailStatusText("bounced", null, null)).toContain("did not accept");
    expect(emailStatusText("failed", "The email service answered 500.", null)).toBe("Not sent: The email service answered 500.");
  });
});

describe("Resend webhook signature", () => {
  const secret = "whsec_" + Buffer.from("super secret key").toString("base64");
  const body = JSON.stringify({ type: "email.bounced", data: { email_id: "e1" } });
  const sign = (id: string, ts: string) => `v1,${createHmac("sha256", Buffer.from("super secret key")).update(`${id}.${ts}.${body}`).digest("base64")}`;
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);
  it("accepts a good signature, also among several", () => {
    expect(verifySvix(body, { id: "m1", timestamp: ts, signature: sign("m1", ts) }, secret, now)).toBe(true);
    expect(verifySvix(body, { id: "m1", timestamp: ts, signature: `v1,AAAA ${sign("m1", ts)}` }, secret, now)).toBe(true);
  });
  it("rejects a wrong body, a missing header, a wrong secret and an old timestamp", () => {
    expect(verifySvix(body + " ", { id: "m1", timestamp: ts, signature: sign("m1", ts) }, secret, now)).toBe(false);
    expect(verifySvix(body, { id: null, timestamp: ts, signature: sign("m1", ts) }, secret, now)).toBe(false);
    expect(verifySvix(body, { id: "m1", timestamp: ts, signature: sign("m1", ts) }, "whsec_" + Buffer.from("other").toString("base64"), now)).toBe(false);
    const old = String(now / 1000 - 3600);
    expect(verifySvix(body, { id: "m1", timestamp: old, signature: sign("m1", old) }, secret, now)).toBe(false);
  });
  it("maps only the events that change the delivery state", () => {
    expect(EVENT_STATUS["email.bounced"]).toBe("bounced");
    expect(EVENT_STATUS["email.opened"]).toBeUndefined();
  });
});
