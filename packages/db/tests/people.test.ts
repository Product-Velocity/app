import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, inviteRow, twoTenantFixture, type TestDb } from "./helpers";

// Issue #691: a people directory. A member is a person whose id is their user id; someone named before they have an account is a
// person with no user_id. The five person columns of items point at people.

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let editor: string; // a creator of tenant A

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  editor = await createUser(db, "erin@example.test");
  await addMember(db, f.alice, f.tenantA, editor, "creator");
});
afterAll(async () => {
  await db.close();
});

const dir = (userId: string, tenant: string) =>
  db.asUser(userId, async (q) => (await q("select * from public.people_directory($1)", [tenant])).rows);
const add = (userId: string, tenant: string, name: string, email: string | null = null) =>
  db.asUser(userId, async (q) => (await q("select public.add_person($1, $2, $3) as id", [tenant, name, email])).rows[0].id as string, { commit: true, via: "UI" });

describe("members are people", () => {
  it("every member has a person with the same id as their user id, and nothing else is stored for them", async () => {
    const { rows } = await db.admin.query("select id, user_id, name, email from public.people where tenant_id = $1 and user_id = $2", [f.tenantA, f.carol]);
    expect(rows).toEqual([{ id: f.carol, user_id: f.carol, name: null, email: null }]);
  });

  it("the directory lists active members with the name and email of their account", async () => {
    const rows = await dir(f.carol, f.tenantA);
    expect(rows.map((r) => [r.email, r.status, r.role])).toEqual(expect.arrayContaining([["alice@example.test", "active", "admin"], ["carol@example.test", "active", "viewer"]]));
    expect(rows.every((r) => r.person_id === r.user_id)).toBe(true);
  });

  it("the directory of another workspace is empty, in both directions", async () => {
    expect(await dir(f.alice, f.tenantB)).toEqual([]);
    expect(await dir(f.bob, f.tenantA)).toEqual([]);
    expect(await dir(f.dave, f.tenantA)).toEqual([]);
  });

  it("is not available to anonymous callers", async () => {
    expect(await errorCode(db.asAnon((q) => q("select * from public.people_directory($1)", [f.tenantA])))).toBe("42501");
  });
});

describe("naming someone who is not a member", () => {
  it("an editor adds a person with a name and no email; everyone in the workspace sees the name", async () => {
    const id = await add(editor, f.tenantA, "  Jane Doe ");
    const row = (await dir(f.carol, f.tenantA)).find((r) => r.person_id === id);
    expect(row).toMatchObject({ name: "Jane Doe", user_id: null, status: "not_invited", email: null, role: null });
  });

  it("the email of a person without an account is for editors and admins only", async () => {
    const id = await add(editor, f.tenantA, "Ravi Rao", "Ravi@Example.test");
    expect((await dir(editor, f.tenantA)).find((r) => r.person_id === id)!.email).toBe("ravi@example.test");
    expect((await dir(f.alice, f.tenantA)).find((r) => r.person_id === id)!.email).toBe("ravi@example.test");
    const seenByViewer = (await dir(f.carol, f.tenantA)).find((r) => r.person_id === id)!;
    expect(seenByViewer.email).toBeNull();
    expect(seenByViewer.name).toBe("Ravi Rao");
  });

  it("a viewer cannot add, rename or remove a person", async () => {
    expect(await errorCode(add(f.carol, f.tenantA, "Nope"))).toBe("42501");
    const id = await add(editor, f.tenantA, "Kept");
    expect(await errorCode(db.asUser(f.carol, (q) => q("select public.update_person($1, $2, 'x', null)", [f.tenantA, id])))).toBe("42501");
    expect(await errorCode(db.asUser(f.carol, (q) => q("select public.remove_person($1, $2)", [f.tenantA, id])))).toBe("42501");
  });

  it("a creator cannot remove a person; an admin can, and the initiatives that named them are cleared", async () => {
    const id = await add(editor, f.tenantA, "Short Stay");
    await db.admin.query("update public.items set engineering_manager = $1 where id = $2", [id, f.seedA.items[0]]);
    expect(await errorCode(db.asUser(editor, (q) => q("select public.remove_person($1, $2)", [f.tenantA, id])))).toBe("42501");
    await db.asUser(f.alice, (q) => q("select public.remove_person($1, $2)", [f.tenantA, id]), { commit: true });
    const { rows } = await db.admin.query("select engineering_manager from public.items where id = $1", [f.seedA.items[0]]);
    expect(rows[0].engineering_manager).toBeNull();
  });

  it("refuses a member's email and a repeated email, and a bad name or email", async () => {
    expect(await errorCode(add(editor, f.tenantA, "Alice again", "alice@example.test"))).toBe("PV006");
    await add(editor, f.tenantA, "Once", "once@example.test");
    expect(await errorCode(add(editor, f.tenantA, "Twice", "ONCE@example.test"))).toBe("PV006");
    expect(await errorCode(add(editor, f.tenantA, "   "))).toBe("PV005");
    expect(await errorCode(add(editor, f.tenantA, "x".repeat(121)))).toBe("PV005");
    expect(await errorCode(add(editor, f.tenantA, "Bad", "not-an-email"))).toBe("PV005");
  });

  it("cannot add a person to another workspace", async () => {
    expect(await errorCode(add(f.alice, f.tenantB, "Intruder"))).toBe("42501");
  });

  it("a person can be renamed and given an email, but a member's own row is refused", async () => {
    const id = await add(editor, f.tenantA, "Typo Nmae");
    await db.asUser(editor, (q) => q("select public.update_person($1, $2, 'Typo Name', 'typo@example.test')", [f.tenantA, id]), { commit: true });
    const row = (await dir(editor, f.tenantA)).find((r) => r.person_id === id)!;
    expect([row.name, row.email]).toEqual(["Typo Name", "typo@example.test"]);
    expect(await errorCode(db.asUser(editor, (q) => q("select public.update_person($1, $2, 'x', null)", [f.tenantA, f.carol])))).toBe("PV006");
    expect(await errorCode(db.asUser(editor, (q) => q("select public.remove_person($1, $2)", [f.tenantA, f.carol])))).toBe("42501"); // admins only, and never a member
  });

  it("the table has no direct write path for signed-in users and only admins can read it", async () => {
    expect(await errorCode(db.asUser(editor, (q) => q("insert into public.people (tenant_id, name) values ($1, 'direct')", [f.tenantA])))).toBe("42501");
    expect((await db.asUser(f.carol, async (q) => (await q("select * from public.people")).rows)).length).toBe(0);
    expect((await db.asUser(f.alice, async (q) => (await q("select * from public.people")).rows)).length).toBeGreaterThan(0);
  });

  it("writes are audited with the actor and the source", async () => {
    const id = await add(editor, f.tenantA, "Audited");
    const { rows } = await db.admin.query("select actor_id, via, new from public.audit_log where entity = 'people' and entity_id = $1 and field = 'name'", [id]);
    expect(rows[0]).toMatchObject({ actor_id: editor, via: "UI", new: "Audited" });
  });
});

describe("items point at people", () => {
  it("a person without an account can be Product Manager and Engineering Manager, a person of another workspace cannot", async () => {
    const id = await add(editor, f.tenantA, "Named Only");
    await db.asUser(editor, (q) => q("update public.items set owner_user_id = $1, engineering_manager = $1, designer = $1, analyst = $1, business_manager = $1 where id = $2", [id, f.seedA.items[1]]), { commit: true });
    const other = await add(f.bob, f.tenantB, "Other Tenant");
    expect(await errorCode(db.asUser(editor, (q) => q("update public.items set designer = $1 where id = $2", [other, f.seedA.items[1]])))).toBe("23503");
  });

  it("a member can still be named with their user id (values stored before this change stay valid)", async () => {
    await db.asUser(editor, (q) => q("update public.items set owner_user_id = $1 where id = $2", [f.carol, f.seedA.items[2]]), { commit: true });
    expect((await db.admin.query("select owner_user_id from public.items where id = $1", [f.seedA.items[2]])).rows[0].owner_user_id).toBe(f.carol);
  });
});

describe("joining links the named person to the account", () => {
  it("a person named with an email becomes the member with that email; the id and everything that names them stay", async () => {
    const id = await add(editor, f.tenantA, "Later Member", "later@example.test");
    await db.admin.query("update public.items set engineering_manager = $1 where id = $2", [id, f.seedA.items[0]]);
    expect((await dir(editor, f.tenantA)).find((r) => r.person_id === id)!.status).toBe("not_invited");

    // an invitation to that email: the person shows as invited
    await db.asUser(f.alice, (q) => inviteRow(q, f.tenantA, "later@example.test", "viewer", "tok-later"), { commit: true });
    expect((await dir(editor, f.tenantA)).find((r) => r.person_id === id)!.status).toBe("invited");

    const later = await createUser(db, "later@example.test");
    await db.asUser(later, (q) => q("select public.accept_invitation($1)", ["tok-later"]), { commit: true });

    const row = (await dir(editor, f.tenantA)).find((r) => r.person_id === id)!;
    expect(row).toMatchObject({ user_id: later, status: "active", email: "later@example.test", name: "Later Member", role: "viewer" });
    const people = await db.admin.query("select id, email from public.people where tenant_id = $1 and user_id = $2", [f.tenantA, later]);
    expect(people.rows).toEqual([{ id, email: null }]); // one row, the stored email moved to the account
    expect((await db.admin.query("select engineering_manager from public.items where id = $1", [f.seedA.items[0]])).rows[0].engineering_manager).toBe(id);
  });

  it("joining by any other way (domain auto-join, added by an admin) links by email too", async () => {
    const id = await add(editor, f.tenantA, "Auto Joiner", "auto@example.test");
    const auto = await createUser(db, "auto@example.test");
    await addMember(db, f.alice, f.tenantA, auto, "viewer");
    const rows = (await db.admin.query("select id from public.people where tenant_id = $1 and user_id = $2", [f.tenantA, auto])).rows;
    expect(rows).toEqual([{ id }]);
  });

  it("a member with no matching name just gets their own person", async () => {
    const solo = await createUser(db, "solo@example.test");
    await addMember(db, f.alice, f.tenantA, solo, "viewer");
    expect((await db.admin.query("select id from public.people where tenant_id = $1 and user_id = $2", [f.tenantA, solo])).rows).toEqual([{ id: solo }]);
  });

  it("an expired or revoked invitation does not show as invited", async () => {
    const id = await add(editor, f.tenantA, "Expired", "expired@example.test");
    await db.asUser(f.alice, (q) => inviteRow(q, f.tenantA, "expired@example.test", "viewer", "tok-exp"), { commit: true });
    await db.admin.query("update public.invitations set expires_at = now() - interval '1 day' where tenant_id = $1 and email = 'expired@example.test'", [f.tenantA]);
    expect((await dir(editor, f.tenantA)).find((r) => r.person_id === id)!.status).toBe("not_invited");
  });
});

describe("a member who leaves stays as a name", () => {
  it("is still named on the initiatives and shows as not invited, with their name and email", async () => {
    const leaver = await createUser(db, "leaver@example.test");
    await addMember(db, f.alice, f.tenantA, leaver, "viewer");
    await db.admin.query("update public.items set analyst = $1 where id = $2", [leaver, f.seedA.items[0]]);
    await db.admin.query("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, leaver]);
    const row = (await dir(editor, f.tenantA)).find((r) => r.person_id === leaver)!;
    expect(row).toMatchObject({ user_id: null, status: "not_invited", name: "leaver@example.test", email: "leaver@example.test" });
    expect((await db.admin.query("select analyst from public.items where id = $1", [f.seedA.items[0]])).rows[0].analyst).toBe(leaver);
  });

  it("when the account itself is deleted only 'Former member' is kept", async () => {
    const gone = await createUser(db, "gone@example.test");
    await addMember(db, f.alice, f.tenantA, gone, "viewer");
    await db.admin.query("update public.items set designer = $1 where id = $2", [gone, f.seedA.items[0]]);
    await db.admin.query("delete from auth.users where id = $1", [gone]);
    const { rows } = await db.admin.query("select user_id, email from public.people where id = $1", [gone]);
    expect(rows).toEqual([{ user_id: null, email: null }]); // nothing about them is kept...
    expect((await dir(editor, f.tenantA)).find((r) => r.person_id === gone)).toMatchObject({ name: "Former member", email: null, status: "not_invited" }); // ...and the directory says so
    expect((await db.admin.query("select designer from public.items where id = $1", [f.seedA.items[0]])).rows[0].designer).toBe(gone);
  });

  it("a member who comes back is reconnected to the same person", async () => {
    const back = await createUser(db, "back@example.test");
    await addMember(db, f.alice, f.tenantA, back, "viewer");
    await db.admin.query("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, back]);
    await addMember(db, f.alice, f.tenantA, back, "viewer");
    const rows = (await db.admin.query("select id, user_id from public.people where tenant_id = $1 and (id = $2 or user_id = $2)", [f.tenantA, back])).rows;
    expect(rows).toEqual([{ id: back, user_id: back }]);
  });
});

describe("outcome reviews go to the account behind the Product Manager", () => {
  it("skips a Product Manager without an account and asks the creator instead", async () => {
    const id = await add(editor, f.tenantA, "No Account PM");
    const item = (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id, owner_user_id, start_rollout, created_by) values ($1, 'Review me', $2, $3, current_date, $4) returning id", [f.tenantA, f.seedA.project, id, editor])).rows[0].id as string;
    await db.asUser(editor, (q) => q("select public.request_outcome_review($1, 30)", [item]), { commit: true });
    const { rows } = await db.admin.query("select requested_to from public.outcome_reviews where item_id = $1", [item]);
    expect(rows[0].requested_to).toBe(editor); // the creator of the initiative
  });

  it("asks the Product Manager when they are a member, also after they were linked from a named person", async () => {
    const id = await add(editor, f.tenantA, "Linked PM", "linkedpm@example.test");
    const pm = await createUser(db, "linkedpm@example.test");
    await addMember(db, f.alice, f.tenantA, pm, "viewer");
    const item = (await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id, owner_user_id, start_rollout, created_by) values ($1, 'Review 2', $2, $3, current_date, $4) returning id", [f.tenantA, f.seedA.project, id, editor])).rows[0].id as string;
    await db.asUser(editor, (q) => q("select public.request_outcome_review($1, 60)", [item]), { commit: true });
    const { rows } = await db.admin.query("select requested_to from public.outcome_reviews where item_id = $1", [item]);
    expect(rows[0].requested_to).toBe(pm);
  });
});

describe("people_usage and link_person (slice 2)", () => {
  it("counts the initiatives that name a person without an account, once per initiative, for editors only", async () => {
    const id = await add(editor, f.tenantA, "Counted");
    await db.admin.query("update public.items set owner_user_id = $1, engineering_manager = $1 where id = $2", [id, f.seedA.items[0]]);
    await db.admin.query("update public.items set designer = $1 where id = $2", [id, f.seedA.items[1]]);
    const usage = (userId: string) => db.asUser(userId, async (q) => (await q("select * from public.people_usage($1)", [f.tenantA])).rows);
    expect((await usage(editor)).find((r) => r.person_id === id)).toMatchObject({ initiatives: 2 });
    expect(await usage(f.carol)).toEqual([]); // a viewer sees none
    expect(await db.asUser(f.bob, async (q) => (await q("select * from public.people_usage($1)", [f.tenantA])).rows)).toEqual([]);
  });

  it("an admin links a named person to a member with another email: what named the person now names the member", async () => {
    const id = await add(editor, f.tenantA, "Other Address", "work@example.test");
    const joined = await createUser(db, "private@example.test");
    await addMember(db, f.alice, f.tenantA, joined, "viewer");
    await db.admin.query("update public.items set engineering_manager = $1, analyst = $1 where id = $2", [id, f.seedA.items[0]]);
    expect(await errorCode(db.asUser(editor, (q) => q("select public.link_person($1, $2, $3)", [f.tenantA, id, joined])))).toBe("42501"); // admins only
    await db.asUser(f.alice, (q) => q("select public.link_person($1, $2, $3)", [f.tenantA, id, joined]), { commit: true });
    const { rows } = await db.admin.query("select engineering_manager, analyst from public.items where id = $1", [f.seedA.items[0]]);
    expect(rows[0]).toEqual({ engineering_manager: joined, analyst: joined });
    expect((await db.admin.query("select 1 from public.people where id = $1", [id])).rows).toHaveLength(0);
  });

  it("refuses to link to someone who is not an active member of the workspace, or a person who has an account", async () => {
    const id = await add(editor, f.tenantA, "Nobody Yet");
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.link_person($1, $2, $3)", [f.tenantA, id, f.bob])))).toBe("PV006"); // a member of another workspace
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.link_person($1, $2, $3)", [f.tenantA, f.carol, f.carol])))).toBe("PV006"); // a member is already a person with an account
    expect(await errorCode(db.asUser(f.bob, (q) => q("select public.link_person($1, $2, $3)", [f.tenantA, id, f.bob])))).toBe("42501"); // another workspace's admin
  });
});

describe("the same account in two workspaces", () => {
  it("has a person in each, with the same id, and what happens in one never touches the other", async () => {
    const consultant = await createUser(db, "consultant@example.test");
    await addMember(db, f.alice, f.tenantA, consultant, "viewer");
    await addMember(db, f.bob, f.tenantB, consultant, "viewer");
    const rows = (await db.admin.query("select tenant_id, id, user_id from public.people where id = $1 order by tenant_id", [consultant])).rows;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([f.tenantA, f.tenantB]));
    // leaving one workspace turns only that person into a name
    await db.admin.query("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, consultant]);
    const after = (await db.admin.query("select tenant_id, user_id from public.people where id = $1", [consultant])).rows;
    expect(after.find((r) => r.tenant_id === f.tenantA)!.user_id).toBeNull();
    expect(after.find((r) => r.tenant_id === f.tenantB)!.user_id).toBe(consultant);
    // renaming the name-only person in A, by id, cannot reach the one in B
    await db.asUser(editor, (q) => q("select public.update_person($1, $2, 'Renamed In A', null)", [f.tenantA, consultant]), { commit: true });
    expect((await db.admin.query("select name from public.people where tenant_id = $1 and id = $2", [f.tenantB, consultant])).rows[0].name).toBeNull();
  });
});

describe("paused, revoked and requested members keep their name (issue #698)", () => {
  it("are in the directory with their status, and a name that is still on an initiative resolves", async () => {
    const out: Record<string, string> = {};
    for (const status of ["paused", "revoked", "requested"]) {
      const u = await createUser(db, `${status}@example.test`);
      await addMember(db, f.alice, f.tenantA, u, "viewer");
      await db.admin.query("update public.tenant_members set status = $1 where tenant_id = $2 and user_id = $3", [status, f.tenantA, u]);
      out[status] = u;
    }
    await db.admin.query("update public.items set engineering_manager = $1 where id = $2", [out.paused, f.seedA.items[0]]);
    const rows = await dir(f.carol, f.tenantA);
    for (const [status, u] of Object.entries(out)) expect(rows.find((r) => r.person_id === u), status).toMatchObject({ status, email: `${status}@example.test`, user_id: u });
    // an active member and a named person are as before
    expect(rows.find((r) => r.person_id === f.carol)!.status).toBe("active");
    // a paused member has no access, but is still a name
    expect((await db.admin.query("select engineering_manager from public.items where id = $1", [f.seedA.items[0]])).rows[0].engineering_manager).toBe(out.paused);
  });

  it("another workspace sees none of them", async () => {
    expect((await dir(f.bob, f.tenantB)).some((r) => String(r.email).startsWith("paused@"))).toBe(false);
  });
});


describe("first and last name (issue #702)", () => {
  const names = (userId: string, tenant: string) => db.asUser(userId, async (q) => (await q("select * from public.person_names($1)", [tenant])).rows);

  it("splits a typed name: first word and the rest; 'Last, First' with a comma; one word is a first name only", async () => {
    const split = async (n: string) => (await db.admin.query("select * from public.split_person_name($1)", [n])).rows[0];
    expect(await split("Jane Doe")).toEqual({ first_name: "Jane", last_name: "Doe" });
    expect(await split("  Mary   Ann  Smith ")).toEqual({ first_name: "Mary", last_name: "Ann Smith" });
    expect(await split("Doe, Jane")).toEqual({ first_name: "Jane", last_name: "Doe" });
    expect(await split("Cher")).toEqual({ first_name: "Cher", last_name: null });
    expect(await split("   ")).toEqual({ first_name: null, last_name: null });
  });

  it("add_person_names keeps both names and a joined display name; the one-name add_person splits for older callers", async () => {
    const a = await db.asUser(editor, async (q) => (await q("select public.add_person_names($1, ' Ines ', 'Vega', null) as id", [f.tenantA])).rows[0].id as string, { commit: true });
    const b = await add(editor, f.tenantA, "Omar Haddad");
    const rows = (await db.admin.query("select id, name, first_name, last_name from public.people where id = any($1)", [[a, b]])).rows;
    expect(rows.find((r) => r.id === a)).toMatchObject({ name: "Ines Vega", first_name: "Ines", last_name: "Vega" });
    expect(rows.find((r) => r.id === b)).toMatchObject({ name: "Omar Haddad", first_name: "Omar", last_name: "Haddad" });
  });

  it("needs a first name; a last name is optional; both are limited to 60 characters", async () => {
    const call = (first: string | null, last: string | null) => errorCode(db.asUser(editor, (q) => q("select public.add_person_names($1, $2, $3, null)", [f.tenantA, first, last])));
    expect(await call("", "Doe")).toBe("PV005");
    expect(await call(null, "Doe")).toBe("PV005");
    expect(await call("x".repeat(61), null)).toBe("PV005");
    expect(await call("Jo", "y".repeat(61))).toBe("PV005");
    expect(await call("Jo", null)).toBeNull();
  });

  it("update_person_names changes both names and the display name; a member's own row is refused; a viewer cannot", async () => {
    const id = await add(editor, f.tenantA, "Tpyo Name");
    await db.asUser(editor, (q) => q("select public.update_person_names($1, $2, 'Typo', 'Name', null)", [f.tenantA, id]), { commit: true });
    expect((await db.admin.query("select name, first_name, last_name from public.people where id = $1", [id])).rows[0]).toEqual({ name: "Typo Name", first_name: "Typo", last_name: "Name" });
    expect(await errorCode(db.asUser(editor, (q) => q("select public.update_person_names($1, $2, 'X', null, null)", [f.tenantA, f.carol])))).toBe("PV006");
    expect(await errorCode(db.asUser(f.carol, (q) => q("select public.update_person_names($1, $2, 'X', null, null)", [f.tenantA, id])))).toBe("42501");
  });

  it("person_names gives a member's names from their own profile, else the names typed for them, and says which row is mine", async () => {
    const u = await createUser(db, "profiled@example.test");
    await addMember(db, f.alice, f.tenantA, u, "viewer");
    await db.admin.query("update auth.users set raw_user_meta_data = $1 where id = $2", [JSON.stringify({ first_name: "Pia", last_name: "Roos", full_name: "Pia Roos" }), u]);
    const google = await createUser(db, "google@example.test");
    await addMember(db, f.alice, f.tenantA, google, "viewer");
    await db.admin.query("update auth.users set raw_user_meta_data = $1 where id = $2", [JSON.stringify({ full_name: "Greta van Berg" }), google]);
    const rows = await names(u, f.tenantA);
    expect(rows.find((r) => r.person_id === u)).toMatchObject({ first_name: "Pia", last_name: "Roos", is_me: true });
    expect(rows.find((r) => r.person_id === google)).toMatchObject({ first_name: "Greta", last_name: "van Berg", is_me: false });
    // nothing in a profile, names typed before they joined: those are used
    const id = await db.asUser(editor, async (q) => (await q("select public.add_person_names($1, 'Lena', 'Ortiz', 'lena.o@example.test') as id", [f.tenantA])).rows[0].id as string, { commit: true });
    const lena = await createUser(db, "lena.o@example.test");
    await addMember(db, f.alice, f.tenantA, lena, "viewer");
    expect((await names(lena, f.tenantA)).find((r) => r.person_id === id)).toMatchObject({ first_name: "Lena", last_name: "Ortiz", user_id: lena, is_me: true });
    // a named person without an account, as seen by any member
    const named = await add(editor, f.tenantA, "Ravi Rao");
    expect((await names(f.carol, f.tenantA)).find((r) => r.person_id === named)).toMatchObject({ first_name: "Ravi", last_name: "Rao", user_id: null });
  });

  it("person_names shows nothing of another workspace, and nothing to anonymous callers", async () => {
    expect(await names(f.bob, f.tenantA)).toEqual([]);
    expect(await names(f.dave, f.tenantA)).toEqual([]);
    expect(await errorCode(db.asAnon((q) => q("select * from public.person_names($1)", [f.tenantA])))).toBe("42501");
  });
});
