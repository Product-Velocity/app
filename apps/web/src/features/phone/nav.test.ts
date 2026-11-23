import { describe, expect, it } from "vitest";
import { MORE_ENTRIES, PHONE_TABS, phoneTabFor } from "./nav";

describe("phone navigation", () => {
  it("has five bottom-bar items with quick add in the middle", () => expect(PHONE_TABS.map((t) => t.id)).toEqual(["initiatives", "decide", "add", "tracker", "insights"]));
  it("marks the current item", () => {
    expect(phoneTabFor("/cards")).toBe("initiatives");
    expect(phoneTabFor("/portfolio/R-1")).toBe("initiatives");
    expect(phoneTabFor("/for-you")).toBe("initiatives");
    expect(phoneTabFor("/new")).toBe("add");
    expect(phoneTabFor("/decisions")).toBe("decide");
    expect(phoneTabFor("/alignment/abc/results")).toBe("decide");
    expect(phoneTabFor("/tracker")).toBe("tracker");
    expect(phoneTabFor("/insights")).toBe("insights");
    expect(phoneTabFor("/leadership")).toBe("insights");
    expect(phoneTabFor("/reports")).toBe("insights");
    expect(phoneTabFor("/settings/members")).toBeNull();
  });
  it("lists only what works on a phone", () => {
    expect(MORE_ENTRIES.map((e) => e.label)).not.toContain("Grid");
    expect(MORE_ENTRIES.map((e) => e.label)).not.toContain("Gantt");
  });
});
