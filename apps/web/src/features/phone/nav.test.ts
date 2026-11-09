import { describe, expect, it } from "vitest";
import { MORE_ENTRIES, PHONE_TABS, phoneTabFor } from "./nav";

describe("phone navigation", () => {
  it("has four bottom-bar items", () => expect(PHONE_TABS.map((t) => t.id)).toEqual(["for-you", "initiatives", "decisions", "more"]));
  it("marks the current item", () => {
    expect(phoneTabFor("/attention")).toBe("for-you");
    expect(phoneTabFor("/cards")).toBe("initiatives");
    expect(phoneTabFor("/portfolio/R-1")).toBe("initiatives");
    expect(phoneTabFor("/decisions")).toBe("decisions");
    expect(phoneTabFor("/leadership")).toBe("more");
    expect(phoneTabFor("/settings/members")).toBeNull();
  });
  it("lists desktop-only entries separately", () => {
    expect(MORE_ENTRIES.filter((e) => e.desktopOnly).map((e) => e.label)).toContain("Grid");
    expect(MORE_ENTRIES.find((e) => e.label === "Reports")?.desktopOnly).toBeFalsy();
  });
});
