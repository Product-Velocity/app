import { describe, expect, it } from "vitest";
import { cleanGithubUsername, GITHUB_USERNAME, githubUsernameMessage } from "./github-username";

describe("GitHub username", () => {
  it("accepts what GitHub accepts and nothing else", () => {
    for (const ok of ["a", "Ana-GH", "ben-gh", "x1", "a-b-c", "a".repeat(39)]) expect(GITHUB_USERNAME.test(ok), ok).toBe(true);
    for (const bad of ["", "-a", "a-", "a--b", "a b", "a".repeat(40), "a_b", "a;b", "é", "a/b"]) expect(GITHUB_USERNAME.test(bad), bad).toBe(false);
  });
  it("drops spaces and a leading @ before saving", () => {
    expect(cleanGithubUsername("  @ana-gh ")).toBe("ana-gh");
    expect(cleanGithubUsername("   ")).toBe("");
  });
  it("answers a failed save in plain words", () => {
    expect(githubUsernameMessage("23505")).toMatch(/already uses/);
    expect(githubUsernameMessage("22023")).toMatch(/not a GitHub username/);
    expect(githubUsernameMessage("42501")).toMatch(/your own/);
    expect(githubUsernameMessage("P0002")).toMatch(/not a member/);
    expect(githubUsernameMessage(undefined)).toMatch(/could not save/);
  });
});
