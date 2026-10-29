import { describe, expect, it } from "vitest";
import { atlassianConfig, buildAuthorizeUrl, JIRA_SCOPES } from "./oauth";

describe("atlassian oauth", () => {
  it("builds the authorize url with the scopes, the redirect and the state", () => {
    const u = new URL(buildAuthorizeUrl({ clientId: "cid", redirectUri: "https://x.test/api/atlassian/callback" }, JIRA_SCOPES, "abc"));
    expect(u.searchParams.get("audience")).toBe("api.atlassian.com");
    expect(u.searchParams.get("scope")).toBe("read:jira-work read:jira-user write:jira-work offline_access");
    expect(u.searchParams.get("state")).toBe("abc");
    expect(u.searchParams.get("redirect_uri")).toBe("https://x.test/api/atlassian/callback");
  });
  it("asks for no scope that can change a customer's Jira setup", () => {
    expect(JIRA_SCOPES.some((s) => s.startsWith("manage:"))).toBe(false);
  });
  it("needs all three variables", () => {
    expect(atlassianConfig({ ATLASSIAN_CLIENT_ID: "a", ATLASSIAN_CLIENT_SECRET: "b" })).toBeNull();
    expect(atlassianConfig({ ATLASSIAN_CLIENT_ID: "a", ATLASSIAN_CLIENT_SECRET: "b", ATLASSIAN_REDIRECT_URI: "c" })).not.toBeNull();
  });
});
