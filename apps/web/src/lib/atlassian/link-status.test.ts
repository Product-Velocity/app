import { describe, expect, it } from "vitest";
import { JIRA_NOTICE } from "@/components/jira-connections-view";
import { PROBLEM_STATUSES, unlinkStatus } from "./link-status";

describe("unlinkStatus", () => {
  it("says why an unlink was refused: initiatives are linked to Jira issues (PV008), not a generic error", () => {
    expect(unlinkStatus("PV008")).toBe("unlink-linked");
    expect(unlinkStatus("42501")).toBe("not-admin");
    expect(unlinkStatus("XX000")).toBe("error");
    expect(unlinkStatus(undefined)).toBe("error");
  });
});

describe("the messages", () => {
  it("every problem status has a message, so a refusal is never silent", () => {
    for (const s of PROBLEM_STATUSES) expect(JIRA_NOTICE[s], s).toBeTruthy();
  });
  it("the unlink refusal names the cause and what to do", () => {
    expect(JIRA_NOTICE["unlink-linked"]).toMatch(/linked to Jira issues/);
    expect(JIRA_NOTICE["unlink-linked"]).toMatch(/Remove|unlink/);
  });
  it("a successful link or unlink is not a problem", () => {
    expect(PROBLEM_STATUSES.has("linked")).toBe(false);
    expect(PROBLEM_STATUSES.has("unlinked")).toBe(false);
  });
});
