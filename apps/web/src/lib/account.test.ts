import { describe, expect, it } from "vitest";
import { canUnlink, leaveMessage, profileFromMetadata, signedInRecently, validateProfile } from "./account";

describe("profile", () => {
  it("reads stored values with defaults for anything missing or invalid", () => {
    expect(profileFromMetadata(null)).toEqual({ fullName: "", language: "en", timeZone: "UTC", dateFormat: "locale" });
    expect(profileFromMetadata({ full_name: "Ashu", language: "xx", time_zone: "Europe/Amsterdam", date_format: "bogus" })).toEqual({ fullName: "Ashu", language: "en", timeZone: "Europe/Amsterdam", dateFormat: "locale" });
  });
  it("validates the form: tidy name, known language, real time zone, known date format", () => {
    expect(validateProfile({ fullName: "  Ashu   M  ", language: "en", timeZone: "Europe/Amsterdam", dateFormat: "yyyy-mm-dd" })).toEqual({ ok: true, profile: { fullName: "Ashu M", language: "en", timeZone: "Europe/Amsterdam", dateFormat: "yyyy-mm-dd" } });
    expect(validateProfile({ fullName: "x".repeat(121), language: "en", timeZone: "UTC", dateFormat: "yyyy-mm-dd" })).toMatchObject({ ok: false });
    expect(validateProfile({ fullName: "A", language: "fr", timeZone: "UTC", dateFormat: "yyyy-mm-dd" })).toMatchObject({ ok: false });
    expect(validateProfile({ fullName: "A", language: "en", timeZone: "Mars/Olympus", dateFormat: "yyyy-mm-dd" })).toMatchObject({ ok: false });
    expect(validateProfile({ fullName: "A", language: "en", timeZone: "UTC", dateFormat: "dd-dd" })).toMatchObject({ ok: false });
  });
});

describe("sign-in methods", () => {
  it("never removes the last one", () => {
    expect(canUnlink([{ provider: "google" }], "google")).toBe(false);
    expect(canUnlink([{ provider: "google" }, { provider: "email" }], "google")).toBe(true);
    expect(canUnlink([{ provider: "google" }, { provider: "email" }], "github")).toBe(false);
  });
  it("treats a sign-in within 15 minutes as recent", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(signedInRecently("2026-10-23T11:50:00Z", now)).toBe(true);
    expect(signedInRecently("2026-10-23T11:30:00Z", now)).toBe(false);
    expect(signedInRecently(null, now)).toBe(false);
    expect(signedInRecently("not a date", now)).toBe(false);
  });
});

describe("leaving a workspace", () => {
  it("says why the last admin cannot leave", () => {
    expect(leaveMessage("PV003")).toContain("only admin");
    expect(leaveMessage(undefined)).toContain("could not");
  });
});
