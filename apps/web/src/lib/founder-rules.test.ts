import { describe, expect, it } from "vitest";
import { firstNameOf, firstNameOfUser, isFollowupCandidate } from "./founder-rules";
import { fromLine } from "./email/resend";
import { buildFollowupPersonalEmail, buildWelcomePersonalEmail } from "./email/access";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe("first name", () => {
  it("takes the first word and never leaves the greeting empty", () => {
    expect(firstNameOf("Ana Ruiz")).toBe("Ana");
    expect(firstNameOf("  ")).toBe("there");
    expect(firstNameOf(undefined)).toBe("there");
    expect(firstNameOf("x".repeat(60))).toBe("there");
  });
});

describe("follow-up candidates", () => {
  it("only two to fourteen days old, and only while nothing is set up", () => {
    expect(isFollowupCandidate({ createdAt: ago(1), now: NOW, items: 0, trackers: 0 })).toBe(false);
    expect(isFollowupCandidate({ createdAt: ago(2), now: NOW, items: 0, trackers: 0 })).toBe(true);
    expect(isFollowupCandidate({ createdAt: ago(14), now: NOW, items: 0, trackers: 0 })).toBe(true);
    expect(isFollowupCandidate({ createdAt: ago(30), now: NOW, items: 0, trackers: 0 })).toBe(false);
    expect(isFollowupCandidate({ createdAt: ago(3), now: NOW, items: 1, trackers: 0 })).toBe(false);
    expect(isFollowupCandidate({ createdAt: ago(3), now: NOW, items: 0, trackers: 1 })).toBe(false);
  });
});

describe("the From line", () => {
  it("shows a person's name on the verified address and refuses header tricks", () => {
    expect(fromLine("Product Velocity <hello@pv.test>", "Ashu from Product Velocity")).toBe("Ashu from Product Velocity <hello@pv.test>");
    expect(fromLine("hello@pv.test", "Ashu")).toBe("Ashu <hello@pv.test>");
    expect(fromLine("hello@pv.test", 'Ashu"\r\nBcc: x@y.test <')).toBe("AshuBcc: x@y.test <hello@pv.test>"); // no line break, no angle bracket or quote survives in the name
    expect(fromLine("Product Velocity <hello@pv.test>")).toBe("Product Velocity <hello@pv.test>");
  });
});

describe("the personal emails", () => {
  it("greet by first name, are plain, and carry the stop line", () => {
    for (const m of [buildWelcomePersonalEmail({ firstname: "Ana", workspace: "Meridian <Media>" }), buildFollowupPersonalEmail({ firstname: "Ana", workspace: "Meridian <Media>" })]) {
      expect(m.text).toContain("Hi Ana,");
      expect(m.text).toContain('reply "stop"');
      expect(m.html).not.toMatch(/<img|<table|<a /i);
    }
    expect(buildWelcomePersonalEmail({ firstname: "Ana", workspace: "Meridian <Media>" }).html).toContain("Meridian &lt;Media&gt;");
  });
});

describe("first name from a profile", () => {
  it("uses the name onboarding stored, the full name once the person changed it, and a provider's name", () => {
    expect(firstNameOfUser({ first_name: "Mary Ann", last_name: "Smith", full_name: "Mary Ann Smith" })).toBe("Mary Ann");
    expect(firstNameOfUser({ first_name: "Mary Ann", last_name: "Smith", full_name: "Marianne Smith" })).toBe("Marianne"); // edited later on Account
    expect(firstNameOfUser({ full_name: "Ana Ruiz" })).toBe("Ana");
    expect(firstNameOfUser({ name: "Jo Park" })).toBe("Jo");
    expect(firstNameOfUser({})).toBe("there");
    expect(firstNameOfUser(null)).toBe("there");
  });
});
