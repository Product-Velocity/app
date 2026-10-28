import { describe, expect, it } from "vitest";
import { parseDeliveryEvent } from "./webhook";
describe("parseDeliveryEvent", () => {
  const base = { action: "closed", installation: { id: 9 }, repository: { full_name: "Acme/App", default_branch: "main" } };
  it("reads only the repository and the pull request, branch or release that changed", () => {
    expect(parseDeliveryEvent("pull_request", { ...base, pull_request: { number: 40, title: "secret", body: "closes #1" } })).toEqual({ kind: "pull_request", action: "closed", installationId: 9, repo: "Acme/App", number: 40 });
    expect(parseDeliveryEvent("check_suite", { ...base, action: "completed", check_suite: { head_branch: "main", conclusion: "success" } })).toEqual({ kind: "check_suite", action: "completed", installationId: 9, repo: "Acme/App", headBranch: "main", defaultBranch: "main" });
    expect(parseDeliveryEvent("release", { ...base, action: "published", release: { body: "notes" } })).toEqual({ kind: "release", action: "published", installationId: 9, repo: "Acme/App" });
  });
  it("is null for anything that is not shaped like one", () => {
    expect(parseDeliveryEvent("issues", base)).toBeNull();
    expect(parseDeliveryEvent("pull_request", base)).toBeNull();
    expect(parseDeliveryEvent("pull_request", { ...base, pull_request: { number: 0 } })).toBeNull();
    expect(parseDeliveryEvent("check_suite", { ...base, check_suite: {} })).toBeNull();
    expect(parseDeliveryEvent("release", { ...base, repository: { full_name: "not a repo" } })).toBeNull();
    expect(parseDeliveryEvent("release", { ...base, installation: {} })).toBeNull();
    expect(parseDeliveryEvent("release", null)).toBeNull();
  });
});

import { parseIssueEvent } from "./webhook";
describe("parseIssueEvent: assignees", () => {
  const payload = (assignees: unknown) => ({ action: "assigned", installation: { id: 9 }, repository: { full_name: "Acme/App" }, issue: { number: 7, id: 70, node_id: "I_7", state: "open", updated_at: "2026-10-27T10:00:00Z", title: "t", assignees } });
  it("reads only the logins of the assignees", () => {
    expect(parseIssueEvent("issues", payload([{ login: "ana-gh", id: 1, email: "x" }, { login: 5 }, null, {}]))?.assignees).toEqual(["ana-gh"]);
    expect(parseIssueEvent("issues", payload(undefined))?.assignees).toEqual([]);
  });
});
