import { describe, expect, it } from "vitest";
import {
  FREE_MAIL_DOMAINS,
  MEMBER_STATUSES,
  allowedStatusTargets,
  canChangeStatus,
  domainOfEmail,
  parseEmailDomains,
  statusAfterSignup,
} from "./members";

describe("parseEmailDomains", () => {
  it("lowercases, trims, strips a leading @ and removes duplicates", () => {
    expect(parseEmailDomains(" Acme.com, @acme.com\nExample.ORG ")).toEqual({ ok: true, domains: ["acme.com", "example.org"] });
  });
  it("accepts an empty list", () => {
    expect(parseEmailDomains("  ")).toEqual({ ok: true, domains: [] });
  });
  it("rejects things that are not a domain", () => {
    for (const bad of ["acme", "a b.com", "acme..com", "-acme.com", "acme.c", "http://acme.com", "me@acme.com", "acme.com/path"]) {
      const r = parseEmailDomains(bad);
      expect(r.ok, bad).toBe(false);
    }
  });
  it("rejects free-mail domains by name", () => {
    const r = parseEmailDomains("gmail.com");
    expect(r).toEqual({ ok: false, error: "gmail.com is a free email provider. Use your company domain." });
    expect(FREE_MAIL_DOMAINS).toContain("outlook.com");
  });
  it("allows at most 20 domains", () => {
    const many = Array.from({ length: 21 }, (_, i) => `d${i}.com`).join(",");
    expect(parseEmailDomains(many).ok).toBe(false);
  });
});

describe("domainOfEmail", () => {
  it("returns the lowercase domain", () => {
    expect(domainOfEmail("Ann@Acme.COM")).toBe("acme.com");
    expect(domainOfEmail("nope")).toBeNull();
  });
});

describe("status transitions", () => {
  it("lists the five lifecycle states in order, Invited being derived from invitations", () => {
    expect(MEMBER_STATUSES).toEqual(["requested", "invited", "active", "paused", "revoked"]);
  });
  it("allows the transitions an admin can make", () => {
    expect(allowedStatusTargets("requested")).toEqual(["active", "revoked"]);
    expect(allowedStatusTargets("invited")).toEqual(["revoked"]);
    expect(allowedStatusTargets("active")).toEqual(["paused", "revoked"]);
    expect(allowedStatusTargets("paused")).toEqual(["active", "revoked"]);
    expect(allowedStatusTargets("revoked")).toEqual(["active"]);
  });
  it("checks a whole selection at once", () => {
    expect(canChangeStatus(["requested", "requested", "paused"], "active")).toBe(true);
    expect(canChangeStatus(["requested", "active"], "active")).toBe(false);
    expect(canChangeStatus([], "active")).toBe(false);
  });
  it("sends an approval email only when someone becomes active from requested or invited", () => {
    expect(statusAfterSignup("requested", "active")).toBe(true);
    expect(statusAfterSignup("invited", "active")).toBe(true);
    expect(statusAfterSignup("paused", "active")).toBe(false);
    expect(statusAfterSignup("revoked", "active")).toBe(false);
  });
});
