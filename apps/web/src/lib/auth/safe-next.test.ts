import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps same-site paths, queries and hashes", () => {
    expect(safeNext("/home")).toBe("/home");
    expect(safeNext("/invite/abc_DEF-123")).toBe("/invite/abc_DEF-123");
    expect(safeNext("/settings/members?x=1#top")).toBe("/settings/members?x=1#top");
  });

  it.each([
    "https://evil.example",
    "http://evil.example/home",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "home",
    "",
    "/ok\nSet-Cookie: x=1",
    "/ok\u0000",
    "/" + "a".repeat(2001),
  ])("rejects %j", (bad) => {
    expect(safeNext(bad, "/fallback")).toBe("/fallback");
  });

  it("uses the fallback for null and undefined", () => {
    expect(safeNext(null, "/x")).toBe("/x");
    expect(safeNext(undefined)).toBe("/");
  });
});
