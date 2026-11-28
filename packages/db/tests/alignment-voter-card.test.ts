import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #746, slice 3: coin defaults per project, and the card voters can open (Business Line, Business Value, Effort).
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string;
let items: string[];
let projectA: string, projectB: string;

const create = (user: string, ids: string[], method = "coins") =>
  db.asUser(user, async (q) => (await q("select public.alignment_session_create('Card', $1, $2::uuid[]) as id", [method, ids])).rows[0].id as string, { commit: true, via: "UI" });
const open = (user: string, sid: string) => db.asUser(user, (q) => q("select public.alignment_session_set_state($1, 'open')", [sid]), { commit: true });
const session = async (sid: string) => (await db.admin.query("select * from public.alignment_sessions where id = $1", [sid])).rows[0];
const shown = async (sid: string) => (await db.admin.query("select a.item_id, a.shown_name, a.shown_business_line, a.shown_business_value, a.shown_effort from public.alignment_items a join public.items i on i.id = a.item_id where a.session_id = $1", [sid])).rows;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "card-creator@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  projectA = (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [f.tenantA])).rows[0].id;
  projectB = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'Second project') returning id", [f.tenantA])).rows[0].id;
  for (let n = 0; n < 3; n++) await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id, business_line, value_12m, effort, summary) values ($1, $2, $3, $4, $5, 'M', 'A summary')", [f.tenantA, `Card item ${n}`, n < 2 ? projectA : projectB, `Line ${n}`, 100000 * (n + 1)]);
  items = (await db.admin.query("select id from public.items where tenant_id = $1 and initiative_name like 'Card item %' order by initiative_name", [f.tenantA])).rows.map((r) => r.id);
});
afterAll(async () => { await db.close(); });

describe("the card voters can open", () => {
  it("copies the three card fields when the session opens, by default", async () => {
    const sid = await create(f.alice, [items[0]!, items[1]!]);
    expect((await session(sid)).voter_fields).toEqual(["business_line", "business_value", "effort"]);
    await open(f.alice, sid);
    const rows = await shown(sid);
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.item_id === items[0])!;
    expect(first).toMatchObject({ shown_business_line: "Line 0", shown_effort: "M" });
    expect(Number(first.shown_business_value)).toBe(100000);
  });

  it("copies only the fields the admin left ticked: an unticked field never reaches the snapshot", async () => {
    const sid = await create(f.alice, [items[0]!, items[1]!]);
    await db.asUser(f.alice, (q) => q("select public.alignment_session_set_voter_fields($1, array['business_line'])", [sid]), { commit: true });
    await open(f.alice, sid);
    for (const r of await shown(sid)) expect(r).toMatchObject({ shown_business_value: null, shown_effort: null });
    expect((await shown(sid)).every((r) => typeof r.shown_business_line === "string")).toBe(true);
    const none = await create(f.alice, [items[0]!, items[1]!]);
    await db.asUser(f.alice, (q) => q("select public.alignment_session_set_voter_fields($1, '{}')", [none]), { commit: true });
    await open(f.alice, none);
    for (const r of await shown(none)) expect(r).toMatchObject({ shown_business_line: null, shown_business_value: null, shown_effort: null, shown_name: expect.any(String) });
  });

  it("is a setting of the draft: locked when the session opens, admins only, known fields only", async () => {
    const sid = await create(f.alice, [items[0]!, items[1]!]);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.alignment_session_set_voter_fields($1, array['revenue'])", [sid]), { commit: true }))).toBe("22023");
    expect(await errorCode(db.asUser(creator, (q) => q("select public.alignment_session_set_voter_fields($1, '{}')", [sid]), { commit: true }))).toBe("42501");
    expect(await errorCode(db.asUser(f.bob, (q) => q("select public.alignment_session_set_voter_fields($1, '{}')", [sid]), { commit: true }))).toBe("42501");
    await open(f.alice, sid);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.alignment_session_set_voter_fields($1, '{}')", [sid]), { commit: true }))).toBe("PV009");
    expect((await session(sid)).voter_fields).toEqual(["business_line", "business_value", "effort"]);
  });

  it("the snapshot does not follow later changes to the initiative", async () => {
    const sid = await create(f.alice, [items[0]!, items[1]!]);
    await open(f.alice, sid);
    await db.admin.query("update public.items set value_12m = 1, business_line = 'Changed', effort = 'XL' where id = $1", [items[0]]);
    const row = (await shown(sid)).find((r) => r.item_id === items[0])!;
    expect(row).toMatchObject({ shown_business_line: "Line 0", shown_effort: "M" });
    expect(Number(row.shown_business_value)).toBe(100000);
    await db.admin.query("update public.items set value_12m = 100000, business_line = 'Line 0', effort = 'M' where id = $1", [items[0]]);
  });
});

describe("coin defaults per project", () => {
  const set = (user: string, project: string, total: number, max: number) => db.asUser(user, (q) => q("select public.project_alignment_defaults_set($1, $2, $3)", [project, total, max]), { commit: true });
  const use = (user: string, sid: string) => db.asUser(user, (q) => q("select public.alignment_session_use_project_defaults($1)", [sid]), { commit: true });

  it("an admin sets them, within bounds, and nobody else can", async () => {
    await set(f.alice, projectA, 50, 20);
    expect((await db.admin.query("select alignment_coins_total as t, alignment_coins_max_per_item as m from public.projects where id = $1", [projectA])).rows[0]).toEqual({ t: 50, m: 20 });
    expect(await errorCode(set(f.alice, projectA, 5, 2))).toBe("22023");
    expect(await errorCode(set(f.alice, projectA, 50, 60))).toBe("22023");
    expect(await errorCode(set(f.alice, projectA, 2000, 30))).toBe("22023");
    expect(await errorCode(set(creator, projectA, 100, 30))).toBe("42501");
    expect(await errorCode(set(f.bob, projectA, 100, 30))).toBe("42501");
    expect((await db.admin.query("select alignment_coins_total as t from public.projects where id = $1", [projectA])).rows[0].t).toBe(50);
  });

  it("a new session takes the defaults of its project when all its initiatives belong to one, else keeps 100 and 30", async () => {
    await set(f.alice, projectA, 50, 20);
    const one = await create(f.alice, [items[0]!, items[1]!]);
    await use(f.alice, one);
    expect(await session(one)).toMatchObject({ coins_total: 50, coins_max_per_item: 20 });
    const mixed = await create(f.alice, [items[0]!, items[2]!]);
    await use(f.alice, mixed);
    expect(await session(mixed)).toMatchObject({ coins_total: 100, coins_max_per_item: 30 });
  });

  it("a change to the project never alters a session that is already open", async () => {
    await set(f.alice, projectA, 50, 20);
    const sid = await create(f.alice, [items[0]!, items[1]!]);
    await use(f.alice, sid);
    await open(f.alice, sid);
    await set(f.alice, projectA, 200, 40);
    await use(f.alice, sid); // does nothing once open
    expect(await session(sid)).toMatchObject({ coins_total: 50, coins_max_per_item: 20 });
    await set(f.alice, projectA, 100, 30);
  });

  it("only an admin of the workspace can use them on a draft", async () => {
    const sid = await create(f.alice, [items[0]!, items[1]!]);
    expect(await errorCode(use(creator, sid))).toBe("42501");
    expect(await errorCode(use(f.bob, sid))).toBe("42501");
  });
});
