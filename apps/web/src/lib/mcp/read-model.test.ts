import { describe, expect, it } from "vitest";
import { buildContext, clip, presentRow, reachesGithub } from "./read-model";

const names = { projects: [{ id: "p1", name: "Core" }], members: [{ id: "u1", name: "ann@x.test" }] };

describe("presentRow", () => {
  const row = { id: "i1", item_code: "R-01", initiative_name: "Views", home_project: "p1", product_manager: "u1", sponsor: null, tags: "", _created_by: "u9", stack_rank: 1, description: "text" };
  it("shows names for projects and people, drops bookkeeping and empty values", () => {
    expect(presentRow(row, names)).toEqual({ id: "i1", item_code: "R-01", initiative_name: "Views", home_project: "Core", product_manager: "ann@x.test", stack_rank: 1, description: "text" });
  });
  it("can keep empty values and restrict to some fields", () => {
    expect(presentRow(row, names, { keepEmpty: true }).sponsor).toBeNull();
    expect(presentRow(row, names, { only: ["item_code"] })).toEqual({ id: "i1", item_code: "R-01" });
  });
  it("leaves an unknown id as it is", () => {
    expect(presentRow({ ...row, product_manager: "ux" }, names).product_manager).toBe("ux");
  });
});

describe("reachesGithub", () => {
  it("is true for the allowlist and the link list, false for commercial fields", () => {
    for (const k of ["initiative_name", "description", "moscow", "artifacts"]) expect(reachesGithub(k), k).toBe(true);
    for (const k of ["value_12m", "confidence", "customers_requesting", "decision", "kr_metric"]) expect(reachesGithub(k), k).toBe(false);
  });
});

describe("buildContext", () => {
  const base = {
    tenant: { id: "t1", name: "Meridian" }, userId: "u1", role: "creator",
    projects: [{ id: "p1", name: "Core", default_repo: "Org/Repo", tracker: "github" }, { id: "p2", name: "Jira work", default_repo: null, tracker: "jira" }, { id: "p3", name: "Empty", default_repo: null, tracker: null }],
    groups: ["Roadmap views"], teams: [], members: [{ id: "u1", name: "ann@x.test", role: "creator" }],
    githubConnected: true, repoPrivate: new Map([["org/repo", true]]),
  };
  it("reports the role, what Claude may do, and the GitHub state per project", () => {
    const c = buildContext(base);
    expect(c.you.role).toBe("creator");
    expect(c.you.may.join(" ")).toMatch(/Create draft/);
    expect(c.projects.map((p) => p.github)).toEqual([{ connected: true, repo_private: true }, { connected: false, repo_private: null }, { connected: true, repo_private: null }]);
    expect(c.cycles).toEqual([]);
  });
  it("tells a viewer it is read-only", () => {
    expect(buildContext({ ...base, role: "viewer" }).you.may_not[0]).toMatch(/read-only/);
  });
});

describe("clip", () => {
  it("cuts long text and says how long it was", () => {
    expect(clip("a".repeat(250))).toMatch(/^a{200}… \(250 characters\)$/);
    expect(clip("short")).toBe("short");
    expect(clip(5)).toBe(5);
  });
});
