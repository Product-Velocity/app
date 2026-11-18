import { describe, expect, it } from "vitest";
import { JIRA_NOTICE } from "@/components/jira-connections-view";
import { PROBLEM_STATUSES, releaseChoice, unlinkConfirmation, unlinkStatus } from "./link-status";

describe("unlinkStatus", () => {
  it("says why an unlink was refused: initiatives are linked to Jira issues (PV008), not a generic error", () => {
    expect(unlinkStatus("PV008")).toBe("unlink-linked");
    expect(unlinkStatus("PV010")).toBe("unlink-delete-failed");
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

describe("unlink with linked initiatives", () => {
  it("anything but an explicit delete keeps the initiatives", () => {
    expect(releaseChoice("delete")).toBe("delete");
    for (const v of ["keep", "", null, undefined, "DELETE", "x"]) expect(releaseChoice(v)).toBe("keep");
  });
  it("the keep text says what stays, what is cleared, that Jira is not changed and that the marker re-links them", () => {
    const c = unlinkConfirmation(4, "keep");
    expect(c.button).toBe("Unlink and keep 4 initiatives");
    expect(c.danger).toBe(false);
    const all = c.consequences.join(" ");
    expect(all).toMatch(/All 4 initiatives stay/);
    expect(all).toMatch(/Build Status and the delivery counts are cleared/);
    expect(all).toMatch(/Jira is not changed/);
    expect(all).toMatch(/marker label/);
  });
  it("the delete text names the Trash, the 30 days, and is marked dangerous; one initiative reads as singular", () => {
    const c = unlinkConfirmation(1, "delete");
    expect(c.button).toBe("Unlink and delete 1 initiative");
    expect(c.danger).toBe(true);
    expect(c.consequences.join(" ")).toMatch(/The initiative moves to the Trash\. You can restore it for 30 days/);
    expect(unlinkConfirmation(2, "delete").consequences[0]).toMatch(/All 2 initiatives move to the Trash/);
  });
});
