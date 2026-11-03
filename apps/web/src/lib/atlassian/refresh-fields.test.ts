import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { samplePath } from "./refresh-fields";

describe("the sample request", () => {
  it("asks for the newest 100 issues of the project with all fields, read only", () => {
    const p = samplePath("PLAT");
    expect(p.startsWith("/search/jql?")).toBe(true);
    const q = new URLSearchParams(p.split("?")[1]);
    expect(q.get("jql")).toBe('project = "PLAT" ORDER BY updated DESC');
    expect(q.get("maxResults")).toBe("100");
    expect(q.get("fields")).toBe("*all");
  });
  it("refuses a key that is not a Jira project key, so nothing odd reaches the JQL", () => {
    for (const bad of ['PLAT" OR project = "X', "plat", "", "A"]) expect(() => samplePath(bad)).toThrow(/project key/);
  });
});
