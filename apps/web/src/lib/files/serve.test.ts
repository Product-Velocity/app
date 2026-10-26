import { describe, expect, it } from "vitest";
import { fileResponse, isShareToken, newShareToken, shareUrl } from "./serve";

describe("share tokens", () => {
  it("are long, unique and URL-safe", () => {
    const a = newShareToken(), b = newShareToken();
    expect(a).not.toBe(b);
    expect(isShareToken(a)).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });
  it("rejects guesses of the wrong shape", () => {
    for (const t of ["", "short", "a/b".padEnd(40, "x"), "x".repeat(65), "../".padEnd(40, "x")]) expect(isShareToken(t)).toBe(false);
  });
  it("builds the public address with an encoded name", () => {
    expect(shareUrl("https://app.example", "T".repeat(43), "Design v2 é.png")).toBe(`https://app.example/f/${"T".repeat(43)}/Design%20v2%20%C3%A9.png`);
  });
});

describe("fileResponse keeps uploads inert", () => {
  const r = fileResponse(new Uint8Array([1, 2, 3]), "image/png", 'we"ird é.png');
  it("sets safety headers", () => {
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-robots-tag")).toContain("noindex");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it("names the file safely and keeps the real type", () => {
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("content-disposition")).toMatch(/^inline; filename="we_ird _\.png"; filename\*=UTF-8''/);
  });
  it("can force a download", () => {
    expect(fileResponse(new Uint8Array([1]), "application/pdf", "a.pdf", { download: true }).headers.get("content-disposition")).toMatch(/^attachment/);
  });
});
