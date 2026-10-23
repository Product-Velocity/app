import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { isSandboxPath, verifySignature } = await import("./github-app");

const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifySignature", () => {
  it("accepts a correct signature and rejects wrong, missing or malformed ones", () => {
    expect(verifySignature("{}", sign("{}", "s"), "s")).toBe(true);
    expect(verifySignature("{}", sign("{}", "other"), "s")).toBe(false);
    expect(verifySignature("{}", sign("{ }", "s"), "s")).toBe(false);
    expect(verifySignature("{}", null, "s")).toBe(false);
    expect(verifySignature("{}", "sha1=abc", "s")).toBe(false);
  });
});

describe("isSandboxPath", () => {
  it("allows the sandbox repo and org, and refuses the app repo", () => {
    expect(isSandboxPath("/repos/Product-Velocity/Test-Repo-01/issues")).toBe(true);
    expect(isSandboxPath("/orgs/Product-Velocity/issue-types")).toBe(true);
    expect(isSandboxPath("/repos/Product-Velocity/app/issues")).toBe(false);
    expect(isSandboxPath("/repos/Product-Velocity/Test-Repo-01-evil/issues")).toBe(false);
    expect(isSandboxPath("/app/installations/1/access_tokens")).toBe(false);
  });
});
