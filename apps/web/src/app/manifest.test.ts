import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest", () => {
  const m = manifest() as unknown as { start_url: string; display: string; share_target: { action: string; method: string; params: Record<string, string> }; icons: unknown[] };
  it("is installable and opens For you", () => { expect(m.display).toBe("standalone"); expect(m.start_url).toBe("/for-you"); expect(m.icons.length).toBeGreaterThan(0); });
  it("receives shares by GET so no file or body is uploaded", () => {
    expect(m.share_target).toEqual({ action: "/share", method: "GET", params: { title: "title", text: "text", url: "url" } });
  });
});
