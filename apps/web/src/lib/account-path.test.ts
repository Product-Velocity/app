import { describe, expect, it } from "vitest";
import { accountHref, parseAccountPath, screenOf, stripAccountPath, tabHref } from "./account-path";

const A = "0b6f2a1c-3d4e-4f50-8a9b-1c2d3e4f5a6b";
const B = "f1e2d3c4-b5a6-4978-8a69-5b4c3d2e1f00";

describe("account in the address (R-111 FR-1.3)", () => {
  it("parses /w/{account}/{page} and defaults to the grid", () => {
    expect(parseAccountPath(`/w/${A}/gantt`)).toEqual({ tenantId: A, rest: "/gantt" });
    expect(parseAccountPath(`/w/${A}/settings/members`)).toEqual({ tenantId: A, rest: "/settings/members" });
    expect(parseAccountPath(`/w/${A}`)).toEqual({ tenantId: A, rest: "/portfolio" });
    expect(parseAccountPath(`/w/${A}/`)).toEqual({ tenantId: A, rest: "/portfolio" });
    expect(parseAccountPath(`/w/${A.toUpperCase()}/cards`)?.tenantId).toBe(A);
  });
  it("ignores everything else, including look-alikes", () => {
    for (const p of ["/gantt", "/w/not-a-uuid/gantt", `/w/${A}x/gantt`, `/x/w/${A}/gantt`, `/a/${A}`, "/w", "/"]) expect(parseAccountPath(p), p).toBeNull();
  });
  it("keeps the tab when switching account", () => {
    expect(tabHref(B, `/w/${A}/gantt`)).toBe(`/w/${B}/gantt`);
    expect(tabHref(B, "/cards")).toBe(`/w/${B}/cards`);
    expect(tabHref(B, "/leadership")).toBe(`/w/${B}/leadership`);
    expect(tabHref(B, "/portfolio")).toBe(`/w/${B}/portfolio`);
  });
  it("sends an item or a session of the old account to the tab, not to an id that does not exist in the new one", () => {
    expect(tabHref(B, `/w/${A}/portfolio/R-12`)).toBe(`/w/${B}/portfolio`);
    expect(tabHref(B, "/alignment/3c9a1b2e")).toBe(`/w/${B}/alignment`);
  });
  it("falls back to the grid for pages without a tab (home, platform console, unknown)", () => {
    expect(tabHref(B, "/")).toBe(`/w/${B}/portfolio`);
    expect(tabHref(B, "/platform/accounts")).toBe(`/w/${B}/portfolio`);
  });
  it("accountHref and stripAccountPath round-trip", () => {
    expect(stripAccountPath(`/w/${A}/gantt`)).toBe("/gantt");
    expect(stripAccountPath("/gantt")).toBe("/gantt");
    expect(accountHref(B, `/w/${A}/gantt`, "?scope=x")).toBe(`/w/${B}/gantt?scope=x`);
  });
});

describe("screen label for the audit log", () => {
  it("names the tab, with or without the account prefix", () => {
    expect(screenOf("/portfolio")).toBe("grid");
    expect(screenOf(`/w/${A}/gantt`)).toBe("gantt");
    expect(screenOf("/portfolio/R-12")).toBe("grid");
    expect(screenOf("/settings/members")).toBe("members");
    expect(screenOf("/settings/security")).toBe("settings");
    expect(screenOf("/nowhere")).toBeNull();
  });
});
