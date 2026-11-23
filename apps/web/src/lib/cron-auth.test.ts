import { describe, expect, it } from "vitest";
import { isCronRequest } from "./cron-auth";

const req = (auth?: string) => new Request("https://x.test/api/cron/github", auth ? { headers: { authorization: auth } } : {});

describe("isCronRequest", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isCronRequest(req("Bearer s3cret"), "s3cret")).toBe(true);
    expect(isCronRequest(req("Bearer s3cret2"), "s3cret")).toBe(false);
    expect(isCronRequest(req("s3cret"), "s3cret")).toBe(false);
    expect(isCronRequest(req(), "s3cret")).toBe(false);
  });
  it("refuses everybody when no secret is configured", () => {
    expect(isCronRequest(req("Bearer "), "")).toBe(false);
    expect(isCronRequest(req("Bearer undefined"), undefined)).toBe(false);
  });
});
