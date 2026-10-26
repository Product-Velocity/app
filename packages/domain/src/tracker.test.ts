import { describe, expect, it } from "vitest";
import { isOpenableUrl, trackerIssueLabel } from "./tracker";

describe("trackerIssueLabel", () => {
  it("is #number for a GitHub issue", () => {
    expect(trackerIssueLabel("https://github.com/acme/road/issues/142", 142)).toBe("#142");
    expect(trackerIssueLabel(null, 7)).toBe("#7");
  });
  it("is the key for a Jira issue", () => {
    expect(trackerIssueLabel("https://acme.atlassian.net/browse/PROD-104", null)).toBe("PROD-104");
    expect(trackerIssueLabel("https://acme.atlassian.net/browse/PROD-104?focusedId=1", null)).toBe("PROD-104");
  });
  it("is null when nothing is linked yet", () => {
    expect(trackerIssueLabel(null, null)).toBeNull();
    expect(trackerIssueLabel("https://github.com/acme/road", null)).toBeNull();
  });
});
describe("isOpenableUrl", () => {
  it("allows https only", () => {
    expect(isOpenableUrl("https://github.com/a/b/issues/1")).toBe(true);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("http://x")).toBe(false);
    expect(isOpenableUrl(null)).toBe(false);
  });
});
