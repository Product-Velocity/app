import { afterEach, describe, expect, it, vi } from "vitest";
import { isDemoEmail } from "./demo-account";

afterEach(() => vi.unstubAllEnvs());

describe("isDemoEmail", () => {
  it("is true only for the configured demo address, ignoring case and spaces", () => {
    vi.stubEnv("DEMO_VIEWER_EMAIL", "Demo@Example.com");
    expect(isDemoEmail(" demo@example.com ")).toBe(true);
    expect(isDemoEmail("someone@example.com")).toBe(false);
    expect(isDemoEmail(null)).toBe(false);
  });
  it("is false for everyone when no demo account is configured", () => {
    vi.stubEnv("DEMO_VIEWER_EMAIL", "");
    expect(isDemoEmail("demo@example.com")).toBe(false);
  });
});
