import { describe, expect, it } from "vitest";
import { buildNewLinkEmail, buildParticipantEmail, DEFAULT_TEXT, parseParticipants, participantState } from "./alignment-mail";

const groups = [{ id: "eng", name: "Engineering" }, { id: "sales", name: "Sales" }];

describe("parseParticipants", () => {
  it("reads email, name and group from commas, semicolons and tabs, skips a header, uses the default group", () => {
    const r = parseParticipants("email,name,group\nann@example.test,Ann,sales\nbob@example.test;Bob Builder\ncy@example.test\tCy\tENGINEERING", groups, "eng");
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([
      { email: "ann@example.test", name: "Ann", group: "sales" },
      { email: "bob@example.test", name: "Bob Builder", group: "eng" },
      { email: "cy@example.test", name: "Cy", group: "eng" },
    ]);
  });
  it("accepts a bare list of addresses and quoted names with commas", () => {
    const r = parseParticipants('a@example.test\n"Doe, Jane",jane@example.test,Sales', groups, "eng");
    expect(r.rows.map((x) => x.email)).toEqual(["a@example.test", "jane@example.test"]);
    expect(r.rows[1]).toMatchObject({ name: "Doe, Jane", group: "sales" });
  });
  it("names the line of a problem and never echoes the address", () => {
    const r = parseParticipants("a@example.test\nbroken@\nb@example.test,B,Marketing", groups, "eng");
    expect(r.rows).toHaveLength(1);
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toMatch(/^Line 2/);
    expect(r.problems.join(" ")).not.toContain("broken@");
    expect(r.problems.join(" ")).not.toContain("b@example.test");
  });
});

describe("buildParticipantEmail", () => {
  const ctx = { name: "Ann <b>", session: "Q1 priorities", closesAt: "2026-11-30T17:00:00Z", link: "https://pv.example/a/TOKEN", unsubscribe: "https://pv.example/a/TOKEN/unsubscribe" };
  it("fills the placeholders, always adds the personal link and escapes what people wrote", () => {
    const e = buildParticipantEmail({ kind: "invitation", ...DEFAULT_TEXT.invitation }, ctx);
    expect(e.subject).toBe("Help us decide what comes first: Q1 priorities");
    expect(e.text).toContain("Hello Ann <b>,");
    expect(e.text).toContain("Voting closes on 30 November 2026");
    expect(e.text).toContain("https://pv.example/a/TOKEN");
    expect(e.html).toContain("Hello Ann &lt;b&gt;,");
    expect(e.html).not.toContain("<b>");
    expect(e.html).not.toMatch(/<img|pixel|track/i);
    expect(e.text).not.toContain("Stop them here");
  });
  it("puts the link once even when the writer used {{link}}, and a reminder offers to stop reminders", () => {
    const e = buildParticipantEmail({ kind: "reminder", subject: "Reminder", body: "Go to {{link}} now" }, ctx);
    expect(e.text.match(/https:\/\/pv\.example\/a\/TOKEN(?!\/)/g)).toHaveLength(1);
    expect(e.text).toContain("/unsubscribe");
    expect(e.html).toContain("Stop them here");
  });
  it("says 'there' without a name, and the new-link email names the session", () => {
    expect(buildParticipantEmail({ kind: "invitation", subject: "S", body: "Hi {{name}}" }, { ...ctx, name: null }).text).toContain("Hi there");
    const n = buildNewLinkEmail({ name: null, session: "Q1", closesAt: null, link: "https://pv.example/a/N" });
    expect(n.text).toContain("https://pv.example/a/N");
    expect(n.subject).toBe("Your new link: Q1");
  });
});

describe("participantState", () => {
  const base = { email_status: "not_sent", invited_at: null, consent_at: null, unsubscribed_at: null, removed_at: null, voted: false };
  it("always has a word", () => {
    expect(participantState(base).label).toBe("Not invited yet");
    expect(participantState({ ...base, invited_at: "x", email_status: "sent" }).label).toBe("Invited");
    expect(participantState({ ...base, invited_at: "x", email_status: "bounced" }).tone).toBe("bad");
    expect(participantState({ ...base, invited_at: "x", consent_at: "x" }).label).toBe("Joined, not voted yet");
    expect(participantState({ ...base, voted: true }).label).toBe("Voted");
    expect(participantState({ ...base, removed_at: "x" }).label).toBe("Removed");
  });
});
