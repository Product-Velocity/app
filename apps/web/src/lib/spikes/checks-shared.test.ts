import { describe, expect, it } from "vitest";
import { compact, fixFor, permissionGaps, summariseDeliveries } from "./checks-shared";

describe("compact", () => {
  it("drops url, avatar and owner noise but keeps real data", () => {
    expect(compact({ id: 1, html_url: "x", url: "y", owner: { login: "a" }, title: "t", labels: [{ name: "l", node_id: "n" }] })).toEqual({
      id: 1,
      title: "t",
      labels: [{ name: "l" }],
    });
  });
});

describe("permissionGaps", () => {
  it("reports missing and too-weak permissions only", () => {
    expect(permissionGaps({ issues: "write", issue_types: "read" }, { issues: "write", issue_types: "write", organization_projects: "write" })).toEqual([
      "issue_types (needs write, has read)",
      "organization_projects (needs write, has none)",
    ]);
    expect(permissionGaps({ issues: "admin" }, { issues: "write" })).toEqual([]);
  });
});

describe("fixFor", () => {
  it("names the needed permission on 403 and the secret on 401", () => {
    expect(fixFor(403, "Resource not accessible by integration", "issue_types=read")).toContain("issue_types=read");
    expect(fixFor(401, "Bad credentials")).toContain("GITHUB_APP_PRIVATE_KEY_B64");
  });
});

describe("summariseDeliveries", () => {
  it("counts per event, action and status", () => {
    expect(summariseDeliveries([{ event: "issues", action: "opened", status_code: 200 }, { event: "issues", action: "opened", status_code: 200 }, { event: "ping", status_code: 401 }])).toEqual({
      "issues/opened -> 200": 2,
      "ping/- -> 401": 1,
    });
  });
});
