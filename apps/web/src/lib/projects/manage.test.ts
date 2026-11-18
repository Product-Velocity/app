import { describe, expect, it } from "vitest";
import { deleteWarning, nameMatches, projectErrorText } from "./manage";

describe("nameMatches", () => {
  it("ignores case and extra spaces, and never matches an empty name", () => {
    expect(nameMatches("  jira  TEST ", "JIRA test")).toBe(true);
    expect(nameMatches("Jira tes", "Jira test")).toBe(false);
    expect(nameMatches("", "")).toBe(false);
    expect(nameMatches("x", "")).toBe(false);
  });
});

describe("projectErrorText", () => {
  it("says why, per code, and always that nothing changed when it is not clear", () => {
    expect(projectErrorText("42501", "delete")).toMatch(/Only a workspace admin can delete/);
    expect(projectErrorText("23505", "rename")).toMatch(/already exists/);
    expect(projectErrorText("22023", "delete")).toMatch(/does not match.*nothing was deleted/);
    expect(projectErrorText("22023", "rename")).toMatch(/1 to 120/);
    expect(projectErrorText("PV011", "delete")).toMatch(/Nothing was deleted/);
    expect(projectErrorText("XX000", "rename")).toMatch(/Nothing was changed/);
    expect(projectErrorText(undefined, "delete")).toMatch(/Nothing was changed/);
  });
});

describe("deleteWarning", () => {
  it("names the exact counts, what else goes, that the tracker is not changed, and that it cannot be undone", () => {
    const w = deleteWarning({ name: "JIRA test", live: 4, trashed: 2, tracker: "jira" });
    expect(w.total).toBe(6);
    expect(w.lines[0]).toBe("4 initiatives in “JIRA test” go to the Trash and are then deleted for good, together with 2 initiatives already in the Trash.");
    const all = w.lines.join(" ");
    expect(all).toMatch(/documents, attachments and files, votes, comments/);
    expect(all).toMatch(/Jira is not changed/);
    expect(w.lines.at(-1)).toBe("This cannot be undone.");
  });
  it("reads right for one initiative, no Trash, GitHub, no tracker and an empty project", () => {
    expect(deleteWarning({ name: "P", live: 1, trashed: 0, tracker: "github" }).lines[0]).toBe("1 initiative in “P” goes to the Trash and is then deleted for good.");
    expect(deleteWarning({ name: "P", live: 1, trashed: 0, tracker: "github" }).lines.join(" ")).toMatch(/GitHub is not changed/);
    expect(deleteWarning({ name: "P", live: 2, trashed: 0, tracker: null }).lines.join(" ")).not.toMatch(/not changed: its issues/);
    expect(deleteWarning({ name: "P", live: 0, trashed: 3, tracker: null }).lines[0]).toBe("3 initiatives of “P” already in the Trash are deleted for good.");
    const empty = deleteWarning({ name: "P", live: 0, trashed: 0, tracker: null });
    expect(empty.total).toBe(0);
    expect(empty.lines[0]).toMatch(/has no initiatives/);
  });
});
