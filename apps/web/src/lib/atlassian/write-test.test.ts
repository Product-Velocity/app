import { describe, expect, it } from "vitest";
import { adf, adfShape, runWriteTest, type JiraCall } from "./write-test";

function fakeJira(opts: { failChild?: boolean; failDelete?: string } = {}) {
  const calls: string[] = [];
  let n = 100;
  const call: JiraCall = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    if (method === "GET" && path === "/project/SCRUM") return { status: 200, json: { issueTypes: [{ id: "1", name: "Epic", hierarchyLevel: 1 }, { id: "2", name: "Story", hierarchyLevel: 0 }, { id: "3", name: "Subtask", hierarchyLevel: -1, subtask: true }] } };
    if (method === "POST" && path === "/issue") {
      const f = (body as { fields: { parent?: unknown } }).fields;
      if (f.parent && opts.failChild) return { status: 400, json: { errors: { parent: "not allowed" } } };
      return { status: 201, json: { key: `SCRUM-${++n}` } };
    }
    if (method === "GET" && path === "/field") return { status: 200, json: [{ id: "customfield_10016", name: "Story point estimate" }] };
    if (method === "GET" && path.endsWith("/transitions")) return { status: 200, json: { transitions: [{ id: "21", name: "In Progress", to: { statusCategory: { key: "indeterminate" } } }] } };
    if (method === "GET" && path.startsWith("/issue/")) return { status: 200, json: { fields: { labels: ["pv-spike"], description: adf(["Second version written by spike J4."], ["only point"]), parent: { key: "SCRUM-101" } } } };
    if (method === "DELETE") return { status: path.includes(opts.failDelete ?? "never") ? 403 : 204, json: {} };
    return { status: 204, json: {} };
  };
  return { call, calls };
}

describe("Jira write test", () => {
  it("creates, changes, moves and reads back, then deletes everything it created, child first", async () => {
    const { call, calls } = fakeJira();
    const steps = await runWriteTest(call, "SCRUM");
    expect(steps.some((s) => s.label.startsWith("Read back") && s.note.includes("identical"))).toBe(true);
    const del = calls.filter((c) => c.startsWith("DELETE"));
    expect(del).toEqual(["DELETE /issue/SCRUM-102?deleteSubtasks=true", "DELETE /issue/SCRUM-101?deleteSubtasks=true"]);
  });
  it("still deletes the epic when the child cannot be created", async () => {
    const { call, calls } = fakeJira({ failChild: true });
    const steps = await runWriteTest(call, "SCRUM");
    expect(steps.find((s) => s.label.startsWith("Create a child"))?.status).toBe(400);
    expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual(["DELETE /issue/SCRUM-101?deleteSubtasks=true"]);
  });
  it("says which issue to remove by hand when a delete is refused", async () => {
    const { call } = fakeJira({ failDelete: "SCRUM-102" });
    const steps = await runWriteTest(call, "SCRUM");
    expect(steps.find((s) => s.label === "Delete SCRUM-102")?.note).toContain("remove it by hand");
  });
  it("writes nothing when the project has no Epic type", async () => {
    const calls: string[] = [];
    const call: JiraCall = async (m, p) => {
      calls.push(`${m} ${p}`);
      return { status: 200, json: { issueTypes: [{ id: "2", name: "Task", hierarchyLevel: 0 }] } };
    };
    await runWriteTest(call, "X");
    expect(calls).toEqual(["GET /project/X"]);
  });
  it("describes the structure of a document", () => {
    expect(adfShape(adf(["a"], ["b"]))).toBe("doc > paragraph > text[strong] > bulletList > listItem > paragraph > text");
  });
});
