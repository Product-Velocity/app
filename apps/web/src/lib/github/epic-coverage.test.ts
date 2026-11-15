import { describe, expect, it } from "vitest";
import { classifyGithubEpics, type SeenParentIssue } from "./epic-coverage";
import { EPIC_COPY, needsDecision } from "@/lib/atlassian/epic-coverage";

const items = [{ id: "i1", code: "R-01", name: "Takeover" }, { id: "i2", code: "R-02", name: "Checkout" }];
const p = (repo: string, number: number, parent: SeenParentIssue["parent"] = null, subIssues = 2): SeenParentIssue => ({ repo, number, title: `Parent ${number}`, subIssues, parent, url: `https://github.com/${repo}/issues/${number}`, updatedAt: null });

describe("classifyGithubEpics", () => {
  const rows = classifyGithubEpics({
    seen: [p("Acme/web", 1), p("acme/web", 2), p("acme/web", 3, { repo: "Acme/Web", number: 50 }), p("acme/api", 4, { repo: "acme/roadmap", number: 9 }), p("acme/web", 5)],
    items,
    links: [{ itemId: "i1", repo: "acme/WEB", number: 1 }, { itemId: "i2", repo: "acme/web", number: 50 }],
    tree: [{ itemId: "i2", repo: "ACME/web", number: 2 }],
  });
  const by = (n: number) => rows.find((r) => r.key.endsWith(`#${n}`))!;

  it("an epic that is an initiative's own issue is Linked, whatever the case of the repository name", () => {
    expect(by(1)).toMatchObject({ state: "linked", initiative: { code: "R-01" } });
  });
  it("an epic in the tree of a linked parent issue, or directly under it, is Linked (under its parent issue)", () => {
    expect(by(2)).toMatchObject({ state: "under", initiative: { code: "R-02" } });
    expect(by(3)).toMatchObject({ state: "under", initiative: { code: "R-02" } });
  });
  it("an epic under a parent issue that is not an initiative says which, spelled as GitHub spells it", () => {
    expect(by(4)).toMatchObject({ state: "initiative_not_in_pv", note: "acme/roadmap#9", initiative: null });
  });
  it("an epic with no link and no parent is Not linked; nothing is ever Waiting for Sync until the request flow exists", () => {
    expect(by(5)).toMatchObject({ state: "not_linked" });
    expect(rows.some((r) => r.state === "requested")).toBe(false);
  });
  it("keeps the repository's own spelling for display, sorts the ones that need a decision first, and counts them", () => {
    expect(rows.map((r) => r.state)).toEqual(["not_linked", "initiative_not_in_pv", "under", "under", "linked"]);
    expect(by(1).key).toBe("Acme/web#1");
    expect(needsDecision(rows)).toBe(2);
    expect(by(1).status).toBe("Open, 2 sub-issues");
  });
  it("says 1 sub-issue in the singular", () => {
    expect(classifyGithubEpics({ seen: [p("a/b", 1, null, 1)], items, links: [], tree: [] })[0]!.status).toBe("Open, 1 sub-issue");
  });
});

describe("the wording is the same as Jira's, with GitHub's own nouns", () => {
  it("has the same states except Waiting for Sync, which waits for #458", () => {
    expect(EPIC_COPY.github.states).toEqual(EPIC_COPY.jira.states.filter((s) => s !== "requested"));
    expect(EPIC_COPY.github.labels.not_linked).toBe(EPIC_COPY.jira.labels.not_linked);
    expect(EPIC_COPY.github.canList).toBe(false);
  });
});
