import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, leader: string, commenter: string, bot: string;

const DENIED = "42501";
const FK = "23503";
const CHECK = "23514";
const UNIQUE = "23505";
const BLOCKED = "PV004"; // Claude / service accounts cannot set rank, decision or value

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator@example.test");
  leader = await createUser(db, "leader@example.test");
  commenter = await createUser(db, "commenter@example.test");
  bot = await createUser(db, "bot@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, leader, "leadership");
  await addMember(db, f.alice, f.tenantA, commenter, "commenter");
  await addMember(db, f.alice, f.tenantA, bot, "creator", { serviceAccount: true });
});
afterAll(async () => {
  await db.close();
});

const ranks = async (tenant: string, cycle: string | null = null) =>
  (
    await db.admin.query(
      "select initiative_name as title, stack_rank from public.items where tenant_id = $1 and cycle_id is not distinct from $2 order by stack_rank",
      [tenant, cycle],
    )
  ).rows.map((r) => [r.title, r.stack_rank]);

const addItem = (user: string, tenant: string, title: string, project: string, opts: { via?: string; cycle?: string } = {}) =>
  db.asUser(
    user,
    async (q) =>
      (
        await q(
          "insert into public.items (tenant_id, initiative_name, home_project_id, cycle_id) values ($1, $2, $3, $4) returning id, item_code as key, stack_rank",
          [tenant, title, project, opts.cycle ?? null],
        )
      ).rows[0],
    { commit: true, via: opts.via },
  );

/** A brand-new item in tenant A, so a test never depends on rows other tests deleted or moved. */
const fresh = async (title = "Fresh") => (await addItem(f.alice, f.tenantA, title, f.seedA.project)).id as string;

const move = (user: string, itemId: string, to: number, via?: string) =>
  db.asUser(user, (q) => q("select public.move_item($1, $2)", [itemId, to]), { commit: true, via });

describe("who can do what", () => {
  it("every member can read projects, items, teams and scopes of their tenant", async () => {
    for (const u of [f.alice, f.carol, creator, leader, commenter]) {
      await db.asUser(u, async (q) => {
        expect((await q("select * from public.items")).rows.length).toBeGreaterThanOrEqual(3);
        expect((await q("select * from public.projects")).rows).toHaveLength(1);
        expect((await q("select * from public.teams")).rows).toHaveLength(1);
        expect((await q("select * from public.saved_scopes")).rows).toHaveLength(1);
      });
    }
  });

  it("viewer, commenter and leadership cannot change items", async () => {
    for (const u of [f.carol, commenter, leader]) {
      expect(await errorCode(addItem(u, f.tenantA, "Nope", f.seedA.project))).toBe(DENIED);
      const n = await db.asUser(u, async (q) => (await q("update public.items set initiative_name = 'x'")).rowCount, { commit: true });
      expect(n).toBe(0);
      const d = await db.asUser(u, async (q) => (await q("delete from public.items")).rowCount, { commit: true });
      expect(d).toBe(0);
      expect(await errorCode(move(u, f.seedA.items[2]!, 1))).toBe(DENIED);
    }
  });

  it("creators and admins can create, edit and delete items", async () => {
    const a = await addItem(creator, f.tenantA, "By creator", f.seedA.project);
    const b = await addItem(f.alice, f.tenantA, "By admin", f.seedA.project);
    for (const [u, id] of [[creator, a.id], [f.alice, b.id]] as const) {
      const n = await db.asUser(u, async (q) => (await q("update public.items set initiative_name = initiative_name || '!' where id = $1", [id])).rowCount, { commit: true });
      expect(n).toBe(1);
    }
    for (const id of [a.id, b.id]) {
      expect(await db.asUser(creator, async (q) => (await q("delete from public.items where id = $1", [id])).rowCount, { commit: true })).toBe(1);
    }
  });

  it("only admins manage projects and teams", async () => {
    for (const u of [creator, f.carol]) {
      expect(await errorCode(db.asUser(u, (q) => q("insert into public.projects (tenant_id, name) values ($1, 'X')", [f.tenantA])))).toBe(DENIED);
      expect(await errorCode(db.asUser(u, (q) => q("insert into public.teams (tenant_id, name) values ($1, 'X')", [f.tenantA])))).toBe(DENIED);
    }
    await db.asUser(f.alice, (q) => q("insert into public.projects (tenant_id, name) values ($1, 'Growth')", [f.tenantA]), { commit: true });
    await db.asUser(f.alice, (q) => q("delete from public.projects where name = 'Growth' and tenant_id = $1", [f.tenantA]), { commit: true });
  });

  it("creators manage saved scopes; viewers cannot", async () => {
    await db.asUser(creator, (q) => q("insert into public.saved_scopes (tenant_id, name) values ($1, 'Mine')", [f.tenantA]), { commit: true });
    expect(await errorCode(db.asUser(f.carol, (q) => q("insert into public.saved_scopes (tenant_id, name) values ($1, 'No')", [f.tenantA])))).toBe(DENIED);
  });
});

describe("quick-add defaults, keys and stack rank", () => {
  it("a name and a project are enough; the key and the last rank are assigned", async () => {
    const before = (await ranks(f.tenantA)).length;
    const item = await addItem(creator, f.tenantA, "Quick one", f.seedA.project);
    expect(item.key).toMatch(/^R-\d{2,}$/);
    expect(item.stack_rank).toBe(before + 1);
  });

  it("keys count per tenant and never repeat", async () => {
    const x = await addItem(f.bob, f.tenantB, "B item", f.seedB.project);
    const keysB = (await db.admin.query("select item_code as key from public.items where tenant_id = $1 order by item_code", [f.tenantB])).rows.map((r) => r.key);
    expect(new Set(keysB).size).toBe(keysB.length);
    expect(keysB).toContain("R-01"); // tenant B starts at R-01 independently of tenant A
    expect(x.key).toBe(`R-${String(keysB.length).padStart(2, "0")}`);
  });

  it("each planning cycle has its own rank list", async () => {
    const cycle = "00000000-0000-0000-0000-0000000000c1";
    const a = await addItem(creator, f.tenantA, "In cycle 1", f.seedA.project, { cycle });
    const b = await addItem(creator, f.tenantA, "In cycle 2", f.seedA.project, { cycle });
    expect([a.stack_rank, b.stack_rank]).toEqual([1, 2]);
  });

  it("the database refuses duplicate ranks", async () => {
    const code = await errorCode(
      db.admin.query(
        "update public.items set stack_rank = 1 where tenant_id = $1 and cycle_id is null and stack_rank = 2",
        [f.tenantB],
      ),
    );
    expect(code).toBe(UNIQUE);
  });
});

describe("move_item: re-rank in one transaction, audited", () => {
  it("moves an item up and keeps ranks unique and dense", async () => {
    const t = (await db.admin.query("select id from public.items where tenant_id = $1 and cycle_id is null and stack_rank = 3", [f.tenantA])).rows[0].id;
    const before = await ranks(f.tenantA);
    await move(f.alice, t, 1);
    const after = await ranks(f.tenantA);
    expect(after[0]).toEqual([before[2]![0], 1]);
    expect(after.map((r) => r[1])).toEqual(after.map((_, i) => i + 1));
    expect(after.slice(1, 3).map((r) => r[0])).toEqual([before[0]![0], before[1]![0]]);
  });

  it("moves an item down", async () => {
    const first = (await db.admin.query("select id, initiative_name as title from public.items where tenant_id = $1 and cycle_id is null and stack_rank = 1", [f.tenantA])).rows[0];
    const n = (await ranks(f.tenantA)).length;
    await move(creator, first.id, n);
    const after = await ranks(f.tenantA);
    expect(after.at(-1)).toEqual([first.title, n]);
    expect(after.map((r) => r[1])).toEqual(after.map((_, i) => i + 1));
  });

  it("clamps out-of-range positions and ignores a move to the same place", async () => {
    const id = (await db.admin.query("select id from public.items where tenant_id = $1 and cycle_id is null and stack_rank = 2", [f.tenantA])).rows[0].id;
    await move(f.alice, id, 9999);
    expect((await ranks(f.tenantA)).at(-1)![1]).toBe((await ranks(f.tenantA)).length);
    await move(f.alice, id, -5);
    expect((await ranks(f.tenantA))[0]![1]).toBe(1);
    const auditBefore = (await db.admin.query("select count(*)::int n from public.audit_log where entity = 'items'")).rows[0].n;
    await move(f.alice, id, 1); // already first
    expect((await db.admin.query("select count(*)::int n from public.audit_log where entity = 'items'")).rows[0].n).toBe(auditBefore);
  });

  it("writes one audit row per item whose rank changed, with actor and source, and sets previous_rank on the moved item", async () => {
    const rows = (await db.admin.query("select id, stack_rank from public.items where tenant_id = $1 and cycle_id is null order by stack_rank", [f.tenantA])).rows;
    const last = rows.at(-1)!;
    const mark = (await db.admin.query("select coalesce(max(id), 0) m from public.audit_log")).rows[0].m;
    await db.asUser(f.alice, (q) => q("select public.move_item($1, 1)", [last.id]), { commit: true, via: "UI" });
    const audit = (await db.admin.query("select entity_id, old, new, actor_id, via from public.audit_log where id > $1 and entity = 'items' and field = 'stack_rank' order by id", [mark])).rows;
    expect(audit).toHaveLength(rows.length); // everything between old and new position shifted by one
    expect(audit.every((r) => r.actor_id === f.alice && r.via === "UI")).toBe(true);
    const movedRow = audit.find((r) => r.entity_id === last.id)!;
    expect([movedRow.old, movedRow.new]).toEqual([rows.length, 1]);
    const prev = (await db.admin.query("select previous_rank from public.items where id = $1", [last.id])).rows[0].previous_rank;
    expect(prev).toBe(rows.length);
  });

  it("refuses items of another tenant and unknown ids", async () => {
    expect(await errorCode(move(f.alice, f.seedB.items[0]!, 1))).toBe(DENIED);
    expect(await errorCode(move(f.alice, "00000000-0000-0000-0000-000000000000", 1))).toBe(DENIED);
  });

  it("deleting items closes the gaps in one statement", async () => {
    const t = (await db.admin.query("select id from public.items where tenant_id = $1 and cycle_id is null and stack_rank in (1, 3)", [f.tenantA])).rows.map((r) => r.id);
    await db.asUser(f.alice, (q) => q("delete from public.items where id = any($1)", [t]), { commit: true });
    const after = await ranks(f.tenantA);
    expect(after.map((r) => r[1])).toEqual(after.map((_, i) => i + 1));
  });

  it("deleting a whole tenant still works", async () => {
    const owner = await createUser(db, "delete-me@example.test");
    const tenant = await db.asUser(owner, async (q) => (await q("select public.create_tenant('Gone') as id")).rows[0].id as string, { commit: true });
    const project = (await db.admin.query("insert into public.projects (tenant_id, name) values ($1, 'P') returning id", [tenant])).rows[0].id;
    for (const n of ["a", "b", "c"]) await db.admin.query("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, $2, $3)", [tenant, n, project]);
    await db.admin.query("delete from public.tenants where id = $1", [tenant]);
    expect((await db.admin.query("select count(*)::int n from public.items where tenant_id = $1", [tenant])).rows[0].n).toBe(0);
  });
});

describe("GitHub-driven fields are not user-writable", () => {
  const columns: [string, string][] = [
    ["status", "'closed'"],
    ["delivery_progress_pct", "50"],
    ["planned_scope", "4"],
    ["scope_added", "2"],
    ["github_issue_url", "'https://github.com/x/y/issues/1'"],
    ["last_synced_at", "now()"],
    ["status_changed_at", "now()"],
  ];
  it.each(columns)("%s cannot be updated, even by an admin", async (col, val) => {
    const code = await errorCode(db.asUser(f.alice, (q) => q(`update public.items set ${col} = ${val} where tenant_id = $1`, [f.tenantA])));
    expect(code).toBe(DENIED);
  });

  it.each(columns)("%s cannot be set on insert either", async (col, val) => {
    const code = await errorCode(
      db.asUser(f.alice, (q) =>
        q(`insert into public.items (tenant_id, initiative_name, home_project_id, ${col}) values ($1, 'x', $2, ${val})`, [f.tenantA, f.seedA.project]),
      ),
    );
    expect(code).toBe(DENIED);
  });

  it("neither can key, rank, previous rank, cycle or tenant", async () => {
    for (const set of ["item_code = 'R-99'", "stack_rank = 99", "previous_rank = 1", "cycle_id = gen_random_uuid()", `tenant_id = '${f.tenantB}'`]) {
      expect(await errorCode(db.asUser(f.alice, (q) => q(`update public.items set ${set} where tenant_id = $1`, [f.tenantA]))), set).toBe(DENIED);
    }
  });

  it("the sync engine (service role) can write them, and it is audited with its source", async () => {
    const id = await fresh("Sync target");
    await db.asService(
      (q) => q("update public.items set status = 'in_progress', delivery_progress_pct = 40, github_issue_url = 'https://github.com/x/y/issues/7', last_synced_at = now() where id = $1", [id]),
      { via: "GitHub webhook", commit: true },
    );
    const a = (await db.admin.query("select actor_id, via, new from public.audit_log where entity = 'items' and entity_id = $1 and field = 'status' order by id desc limit 1", [id])).rows[0];
    expect(a).toMatchObject({ actor_id: null, via: "GitHub webhook", new: "in_progress" });
  });
});

describe("Claude and service accounts never set rank, Decision or Value", () => {
  it("a human editor can set value and decision", async () => {
    const id = await fresh("Valued");
    const n = await db.asUser(creator, async (q) => (await q("update public.items set value_12m = 120000, confidence = 'High', decision = 'Go' where id = $1", [id])).rowCount, { commit: true, via: "UI" });
    expect(n).toBe(1);
  });

  it("source 'Claude MCP' is blocked from value, decision and rank, but may edit other fields", async () => {
    const id = await fresh("Claude target");
    for (const set of ["value_12m = 1", "decision = 'Kill'"]) {
      expect(await errorCode(db.asUser(f.alice, (q) => q(`update public.items set ${set} where id = $1`, [id]), { via: "Claude MCP" })), set).toBe(BLOCKED);
    }
    expect(await errorCode(move(f.alice, id, 1, "Claude MCP"))).toBe(BLOCKED);
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.items (tenant_id, initiative_name, home_project_id, value_12m) values ($1, 'AI draft', $2, 5)", [f.tenantA, f.seedA.project]), { via: "Claude MCP" }))).toBe(BLOCKED);
    expect(await db.asUser(f.alice, async (q) => (await q("update public.items set initiative_name = 'Renamed by Claude', summary = 'draft' where id = $1", [id])).rowCount, { via: "Claude MCP", commit: true })).toBe(1);
    // Claude can add a draft item; it just goes to the end of the list and has no value or decision
    const draft = await addItem(f.alice, f.tenantA, "AI draft", f.seedA.project, { via: "Claude MCP" });
    expect(draft.stack_rank).toBeGreaterThan(0);
  });

  it("deleting an item as Claude closes the gap without counting as Claude setting a rank", async () => {
    const draft = await addItem(f.alice, f.tenantA, "Draft to delete", f.seedA.project, { via: "Claude MCP" });
    const first = (await db.admin.query("select id from public.items where tenant_id = $1 and cycle_id is null and stack_rank = 1", [f.tenantA])).rows[0].id;
    await db.asUser(f.alice, (q) => q("delete from public.items where id = $1", [first]), { via: "Claude MCP", commit: true });
    const after = await ranks(f.tenantA);
    expect(after.map((r) => r[1])).toEqual(after.map((_, i) => i + 1));
    expect(draft.id).toBeTruthy();
  });

  it("a service-account member is blocked the same way", async () => {
    const id = await fresh("Bot target");
    expect(await errorCode(db.asUser(bot, (q) => q("update public.items set value_12m = 9 where id = $1", [id]), { via: "API" }))).toBe(BLOCKED);
    expect(await errorCode(move(bot, id, 1, "API"))).toBe(BLOCKED);
  });
});

describe("data integrity", () => {
  it("rejects references to another tenant's rows", async () => {
    // item -> project of another tenant
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'x', $2)", [f.tenantA, f.seedB.project])))).toBe(FK);
    // item -> owner who is not a member of the tenant
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.items (tenant_id, initiative_name, home_project_id, product_manager) values ($1, 'x', $2, $3)", [f.tenantA, f.seedA.project, f.bob])))).toBe(FK);
    // scope -> project of another tenant; item_teams -> team of another tenant
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.saved_scope_projects (tenant_id, scope_id, project_id) values ($1, $2, $3)", [f.tenantA, f.seedA.scope, f.seedB.project])))).toBe(FK);
    expect(await errorCode(db.asUser(f.alice, async (q) => q("insert into public.item_teams (tenant_id, item_id, team_id) values ($1, $2, $3)", [f.tenantA, await fresh("Linked"), f.seedB.team])))).toBe(FK);
  });

  it("a project with items cannot be deleted", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("delete from public.projects where id = $1", [f.seedA.project])))).toBe(FK);
  });

  it("removing a member clears them as item owner", async () => {
    const id = await fresh("Owned");
    await db.asUser(f.alice, (q) => q("update public.items set product_manager = $1 where id = $2", [commenter, id]), { commit: true });
    await db.asUser(f.alice, (q) => q("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantA, commenter]), { commit: true });
    const owner = (await db.admin.query("select product_manager from public.items where id = $1", [id])).rows[0].product_manager;
    expect(owner).toBeNull();
  });

  it("validates values", async () => {
    const target = await fresh("Validated");
    const bad: [string, unknown[]][] = [
      ["moscow = 'maybe'", []], ["effort = 'XXL'", []], ["confidence = 'Extreme'", []], ["value_12m = -1", []],
      ["health = 'great'", []], ["date_precision = 'week'", []], ["start_date = '2026-05-01', g2m_date_est = '2026-04-01'", []],
      ["initiative_name = '   '", []], ["effort_by_skill = '[1]'::jsonb", []],
    ];
    for (const [set] of bad) {
      expect(await errorCode(db.asUser(f.alice, (q) => q(`update public.items set ${set} where id = $1`, [target]))), set).toBe(CHECK);
    }
    for (const set of ["moscow = 'Must'", "effort = 'XL'", "health = 'At Risk'", "start_date = '2026-01-01', g2m_date_est = '2026-03-31'", "date_precision = 'Quarter'"]) {
      expect(await errorCode(db.asUser(f.alice, (q) => q(`update public.items set ${set} where id = $1`, [target]))), set).toBeNull();
    }
  });

  it("project names are unique per tenant, case-insensitively; team splits must add up", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.projects (tenant_id, name) values ($1, ' platform ')", [f.tenantA])))).toBe(UNIQUE);
    await db.asUser(f.bob, (q) => q("insert into public.projects (tenant_id, name) values ($1, 'Platform 2')", [f.tenantB]), { commit: true });
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.teams (tenant_id, name, split_maintenance, split_bugs, split_new) values ($1, 'T2', 30, 30, 30)", [f.tenantA])))).toBe(CHECK);
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.teams (tenant_id, name, focus_factor) values ($1, 'T3', 1.5)", [f.tenantA])))).toBe(CHECK);
  });
});

describe("audit of every write", () => {
  it("records inserts, updates and deletes of items with actor and source", async () => {
    const mark = (await db.admin.query("select coalesce(max(id), 0) m from public.audit_log")).rows[0].m;
    const item = await db.asUser(
      creator,
      async (q) => (await q("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, 'Audited', $2) returning id", [f.tenantA, f.seedA.project])).rows[0],
      { via: "UI", commit: true },
    );
    await db.asUser(creator, (q) => q("update public.items set initiative_name = 'Audited 2', moscow = 'Could' where id = $1", [item.id]), { via: "UI", commit: true });
    await db.asUser(creator, (q) => q("delete from public.items where id = $1", [item.id]), { via: "UI", commit: true });
    const rows = (await db.admin.query("select field, old, new, actor_id, via from public.audit_log where id > $1 and entity = 'items' and entity_id = $2 order by id", [mark, item.id])).rows;
    expect(rows.every((r) => r.actor_id === creator && r.via === "UI")).toBe(true);
    expect(rows.find((r) => r.field === "initiative_name" && r.new === "Audited 2")).toMatchObject({ old: "Audited" });
    expect(rows.find((r) => r.field === "moscow")).toMatchObject({ old: null, new: "Could" });
    expect(rows.find((r) => r.field === "initiative_name" && r.new === null)).toMatchObject({ old: "Audited 2" }); // delete
  });

  it("records project, team and scope writes", async () => {
    for (const [entity, id] of [["projects", f.seedA.project], ["teams", f.seedA.team], ["saved_scopes", f.seedA.scope]] as const) {
      const n = (await db.admin.query("select count(*)::int n from public.audit_log where entity = $1 and entity_id = $2", [entity, id])).rows[0].n;
      expect(n, entity).toBeGreaterThan(0);
    }
  });

  it("the audit log is readable by admins only, through the fast policy", async () => {
    const admin = await db.asUser(f.alice, async (q) => (await q("select count(*)::int n from public.audit_log")).rows[0].n);
    expect(admin).toBeGreaterThan(0);
    for (const u of [creator, f.carol, leader]) {
      expect(await db.asUser(u, async (q) => (await q("select count(*)::int n from public.audit_log")).rows[0].n)).toBe(0);
    }
  });
});
