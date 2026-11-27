import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
type Tables = Record<string, unknown>;
let tables: Tables = {};
let authUsers: Record<string, { email?: string }> = {};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => { const c: Record<string, unknown> = {}; for (const m of ["select", "eq"]) c[m] = () => c; c.maybeSingle = async () => ({ data: tables[t] ?? null }); return c; },
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: authUsers[id] ?? null } }) } },
  }),
}));

import { addAssignee, findJiraAccount, findJiraAccountByName, productManagerContact } from "./jira-assignee";
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
  it("sends no assignee and no Jira call without a Product Manager, or with neither an email nor a name", async () => {
    for (const pm of [{ email: null, none: true }, { email: null, name: null, none: false }]) {
      const a = asks(200, [user()]);
      const plan = { fields: {} as Record<string, unknown>, notes: [] as string[] };
      await addAssignee(plan, a.call, pm);
      expect(plan.fields).toEqual({});
      expect(plan.notes[0]).toMatch(/^Assignee not set:/);
      expect(a.paths).toEqual([]);
    }
  });
});

describe("findJiraAccountByName (a Product Manager with no email)", () => {
  const ana = (o: object = {}) => user({ displayName: "Ana Núñez", emailAddress: undefined, ...o });
  it("accepts exactly one active Atlassian user with exactly that name (case and accents ignored)", async () => {
    expect(await findJiraAccountByName(asks(200, [ana(), user({ accountId: "b", displayName: "Ana Nunez Ruiz" })]).call, "ana nunez")).toEqual({ ok: true, accountId: "acc-1", name: "Ana Núñez" });
  });
  it("is no match for none, for several with the same name, for a partial name, an app or an inactive user", async () => {
    for (const people of [[], [ana(), ana({ accountId: "b" })], [ana({ displayName: "Ana Nunez Ruiz" })], [ana({ accountType: "app" })], [ana({ active: false })]]) {
      const r = await findJiraAccountByName(asks(200, people).call, "Ana Nunez");
      expect(r.ok).toBe(false);
    }
  });
  it("asks Jira nothing for a name that is too short, and fails softly on a refusal", async () => {
    const a = asks(200, []);
    expect((await findJiraAccountByName(a.call, "Al")).ok).toBe(false);
    expect(a.paths).toEqual([]);
    expect(await findJiraAccountByName(asks(403, {}).call, "Ana Nunez")).toMatchObject({ ok: false, note: expect.stringMatching(/browse users/) });
  });
});

describe("addAssignee with a name", () => {
  it("uses the email first, and the name only when the email finds nobody; the preview says it was matched by name", async () => {
    const plan = { fields: {} as Record<string, unknown>, notes: [] as string[] };
    const people = [user({ accountId: "n1", displayName: "Ana Nunez", emailAddress: undefined })];
    // the same answer for both searches: the email search sees a hidden-email user (accepted only when it is the single result), so make the email search fail by an email that differs
    const call: JiraRequest = async (_m, path) => ({ status: 200, json: decodeURIComponent(path).includes("@") ? [] : people });
    await addAssignee(plan, call, { email: "ana@acme.test", name: "Ana Nunez", none: false });
    expect(plan.fields.assignee).toEqual({ accountId: "n1" });
    expect(plan.notes.join(" ")).toMatch(/matched by name because no email was found: check it is the right person/);
    expect(plan.notes.join(" ")).not.toContain("ana@acme.test");
  });
  it("names no person when neither the email nor the name finds exactly one", async () => {
    const plan = { fields: {} as Record<string, unknown>, notes: [] as string[] };
    await addAssignee(plan, asks(200, []).call, { email: null, name: "Ana Nunez", none: false });
    expect(plan.fields).toEqual({});
    expect(plan.notes[0]).toMatch(/^Assignee not set: Jira has no user with exactly the Product Manager's name/);
  });
});

describe("productManagerContact (the Product Manager is a person of the people directory)", () => {
  it("a person without an account: their own email and their name", async () => {
    tables = { people: { name: "Ana Núñez", first_name: "Ana", last_name: "Núñez", email: "ana@acme.test", user_id: null } };
    expect(await productManagerContact("t1", "p1")).toEqual({ email: "ana@acme.test", name: "Ana Núñez" });
  });
  it("a person without an account and without an email: the name only", async () => {
    tables = { people: { name: "Ana Núñez", first_name: null, last_name: null, email: null, user_id: null } };
    expect(await productManagerContact("t1", "p1")).toEqual({ email: null, name: "Ana Núñez" });
  });
  it("a member: the email of the account behind the person (when they belong to the workspace)", async () => {
    tables = { people: { name: "Jan", first_name: "Jan", last_name: "Roda", email: null, user_id: "u1" }, tenant_members: { user_id: "u1" } };
    authUsers = { u1: { email: "jan@acme.test" } };
    expect(await productManagerContact("t1", "u1")).toEqual({ email: "jan@acme.test", name: "Jan Roda" });
  });
  it("an account behind the person that is not a member gives no email, and a database failure gives nothing", async () => {
    tables = { people: { name: "Jan", first_name: null, last_name: null, email: null, user_id: "u2" } };
    authUsers = { u2: { email: "jan@acme.test" } };
    expect((await productManagerContact("t1", "p2")).email).toBeNull();
    tables = { people: undefined };
    authUsers = {};
    expect(await productManagerContact("t1", "gone")).toEqual({ email: null, name: null });
  });
});
