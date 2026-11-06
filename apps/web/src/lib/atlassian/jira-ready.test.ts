import { describe, expect, it } from "vitest";
import { decideReady, planJiraReady, todoTransitionsOf, writeJiraReady } from "./jira-ready";
import type { JiraRequest } from "./jira-write";

const tr = (id: string, name: string, to: string, cat: string) => ({ id, name, to: { id: `s${id}`, name: to, statusCategory: { key: cat } } });
function fakeJira(status: { name: string; cat: string }, transitions: unknown[], posts: unknown[] = []): JiraRequest {
  return async (method, path, body) => {
    if (method === "POST") { posts.push([path, body]); return { status: 204, json: null }; }
    if (path.includes("/transitions")) return { status: 200, json: { transitions } };
    return { status: 200, json: { fields: { status: { name: status.name, statusCategory: { key: status.cat } } } } };
  };
}

describe("decideReady", () => {
  const t = [{ id: "11", name: "To do", toStatusName: "To do" }];
  it("moves from Backlog (category To Do) to To do", () => {
    expect(decideReady({ name: "Backlog", category: "new" }, t)).toMatchObject({ state: "set", text: "Move to To do", transition: { id: "11" } });
  });
  it("never moves In Progress or Done, and leaves To do alone", () => {
    expect(decideReady({ name: "In Progress", category: "indeterminate" }, t).state).toBe("ahead");
    expect(decideReady({ name: "Done", category: "done" }, t).state).toBe("ahead");
    expect(decideReady({ name: "To Do", category: "new" }, t).state).toBe("already");
  });
  it("says so when the workflow allows no To do transition, or several without one named To do", () => {
    expect(decideReady({ name: "Backlog", category: "new" }, [])).toMatchObject({ state: "blocked" });
    const two = [{ id: "1", name: "a", toStatusName: "Selected" }, { id: "2", name: "b", toStatusName: "Triage" }];
    expect(decideReady({ name: "Backlog", category: "new" }, two).state).toBe("blocked");
    expect(decideReady({ name: "Backlog", category: "new" }, [...two, { id: "3", name: "c", toStatusName: "To Do" }])).toMatchObject({ state: "set", transition: { id: "3" } });
  });
});

describe("todoTransitionsOf", () => {
  it("keeps only transitions into the category To Do", () => {
    const j = { transitions: [tr("1", "Start", "In Progress", "indeterminate"), tr("2", "Back", "To Do", "new"), tr("3", "Finish", "Done", "done"), { id: "x!", to: { statusCategory: { key: "new" } } }] };
    expect(todoTransitionsOf(j).map((x) => x.id)).toEqual(["2"]);
  });
});

describe("planJiraReady / writeJiraReady", () => {
  it("posts one transition into To do when the issue is in Backlog", async () => {
    const posts: unknown[] = [];
    const call = fakeJira({ name: "Backlog", cat: "new" }, [tr("21", "Ready", "To Do", "new"), tr("22", "Start", "In Progress", "indeterminate")], posts);
    expect(await writeJiraReady(call, "PLAT-1")).toEqual({ ok: true, result: "set", status: "To Do" });
    expect(posts).toEqual([["/issue/PLAT-1/transitions", { transition: { id: "21" } }]]);
  });
  it("writes nothing for an issue in progress or done, and never reads transitions for it", async () => {
    for (const cat of ["indeterminate", "done"]) {
      const posts: unknown[] = [];
      const paths: string[] = [];
      const inner = fakeJira({ name: "X", cat }, [tr("21", "Back", "To Do", "new")], posts);
      const call: JiraRequest = (m, p, b) => { paths.push(p); return inner(m, p, b); };
      expect(await writeJiraReady(call, "PLAT-1")).toMatchObject({ ok: true, result: "already_ahead" });
      expect(posts).toEqual([]);
      expect(paths.some((p) => p.includes("/transitions"))).toBe(false);
    }
  });
  it("a blocked workflow writes nothing and says so", async () => {
    const posts: unknown[] = [];
    const r = await planJiraReady(fakeJira({ name: "Backlog", cat: "new" }, [], posts), "PLAT-1");
    expect(r).toMatchObject({ ok: true, plan: { state: "blocked" } });
    expect(await writeJiraReady(fakeJira({ name: "Backlog", cat: "new" }, [], posts), "PLAT-1")).toMatchObject({ ok: false });
    expect(posts).toEqual([]);
  });
  it("refuses a value that is not an issue key", async () => {
    expect(await planJiraReady(fakeJira({ name: "a", cat: "new" }, []), "bad key")).toMatchObject({ ok: false });
  });
});
