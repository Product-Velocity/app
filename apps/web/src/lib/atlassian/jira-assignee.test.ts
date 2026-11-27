import { describe, expect, it } from "vitest";
import { addAssignee, findJiraAccount } from "./jira-assignee";
import type { JiraRequest } from "./jira-write";

const asks = (status: number, json: unknown) => { const paths: string[] = []; const call: JiraRequest = async (_m, path) => { paths.push(path); return { status, json }; }; return { call, paths }; };
const user = (o: object = {}) => ({ accountId: "acc-1", displayName: "Jane Doe", active: true, accountType: "atlassian", emailAddress: "jane@acme.test", ...o });

describe("findJiraAccount", () => {
  it("matches the one active user with that email, asking Jira only with the email in the query", async () => {
    const { call, paths } = asks(200, [user(), user({ accountId: "acc-2", emailAddress: "other@acme.test" })]);
    expect(await findJiraAccount(call, "Jane@acme.test")).toEqual({ ok: true, accountId: "acc-1", name: "Jane Doe" });
    expect(paths).toHaveLength(1);
    expect(decodeURIComponent(paths[0]!)).toContain("/user/search?query=Jane@acme.test");
  });
  it("accepts a hidden email only when Jira finds exactly one user", async () => {
    expect((await findJiraAccount(asks(200, [user({ emailAddress: undefined })]).call, "jane@acme.test")).ok).toBe(true);
    expect((await findJiraAccount(asks(200, [user({ emailAddress: undefined }), user({ accountId: "b", emailAddress: undefined })]).call, "jane@acme.test")).ok).toBe(false);
  });
  it("never picks an app, an inactive user or a different email, and says why without the email", async () => {
    for (const people of [[], [user({ active: false })], [user({ accountType: "app" })], [user({ emailAddress: "x@acme.test" })]]) {
      const r = await findJiraAccount(asks(200, people).call, "jane@acme.test");
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain("jane@acme.test");
    }
  });
  it("leaves the assignee empty on a refusal, a failure or a bad address, never throwing", async () => {
    expect(await findJiraAccount(asks(403, {}).call, "jane@acme.test")).toMatchObject({ ok: false, note: expect.stringMatching(/browse users/) });
    expect((await findJiraAccount(asks(500, {}).call, "jane@acme.test")).ok).toBe(false);
    expect((await findJiraAccount((async () => { throw new Error("down"); }) as JiraRequest, "jane@acme.test")).ok).toBe(false);
    const none = asks(200, []);
    expect((await findJiraAccount(none.call, "not an email")).ok).toBe(false);
    expect(none.paths).toEqual([]);
  });
});

describe("addAssignee", () => {
  it("adds the account id to a create and says it is set once", async () => {
    const plan = { fields: { summary: "x" } as Record<string, unknown>, notes: [] as string[] };
    await addAssignee(plan, asks(200, [user()]).call, { email: "jane@acme.test", none: false });
    expect(plan.fields.assignee).toEqual({ accountId: "acc-1" });
    expect(plan.notes.join(" ")).toMatch(/Jane Doe.*only when the issue is created/);
    expect(plan.notes.join(" ")).not.toContain("jane@acme.test");
  });
  it("sends no assignee and no Jira call without a Product Manager or an email", async () => {
    for (const pm of [{ email: null, none: true }, { email: null, none: false }]) {
      const a = asks(200, [user()]);
      const plan = { fields: {} as Record<string, unknown>, notes: [] as string[] };
      await addAssignee(plan, a.call, pm);
      expect(plan.fields).toEqual({});
      expect(plan.notes[0]).toMatch(/^Assignee not set:/);
      expect(a.paths).toEqual([]);
    }
  });
});
