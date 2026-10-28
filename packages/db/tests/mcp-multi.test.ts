import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// R-115: one Claude connection that covers several workspaces. Everything runs as the signed-in person with a Claude token,
// in the role `authenticated`: no service role, so the functions, row-level security and the grants are what is tested.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let cora: string; // creator in A and in B
let tenantC: string; // a third workspace, with Claude on, where cora is a creator too
const CLIENT = "client-multi";

type Q = (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
const asClaude = <T>(user: string, fn: (q: Q) => Promise<T>, client = CLIENT) => db.asUser(user, fn as never, { commit: true, claims: { client_id: client } }) as Promise<T>;
const asPerson = <T>(user: string, fn: (q: Q) => Promise<T>) => db.asUser(user, fn as never, { commit: true }) as Promise<T>;

const connect = (tenants: string[], client = CLIENT) => asPerson(cora, async (q) => (await q("select * from public.mcp_connect_many($1::uuid[], $2, 'Claude') as id", [tenants, client])).rows.map((r) => r.id as string));
const live = async (user = cora, client = CLIENT) => (await db.admin.query("select tenant_id, id, last_write_at from public.mcp_connections where user_id = $1 and client_id = $2 and revoked_at is null order by created_at, id", [user, client])).rows;
const authorizeAll = () => asClaude(cora, async (q) => (await q("select * from public.mcp_authorize_all()")).rows);
const create = (tenant: string | null, project: string, name: string, client = CLIENT) =>
  asClaude(cora, async (q) => (await q("select public.mcp_apply('create_items', $1::jsonb, false, null, $2) as r", [JSON.stringify([{ ops: [{ op: "create_item", row: { initiative_name: name, home_project_id: project } }] }]), tenant])).rows[0]!.r as { change_set: string; units: { ok: boolean; ops?: { id: string }[]; error?: string }[] }, client);
const item = async (id: string) => (await db.admin.query("select * from public.items where id = $1", [id])).rows[0]!;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  cora = await createUser(db, "cora-multi@example.test");
  await addMember(db, f.alice, f.tenantA, cora, "creator");
  await addMember(db, f.bob, f.tenantB, cora, "creator");
  tenantC = await asPerson(f.dave, async (q) => (await q("select public.create_tenant('Tenant C') as id")).rows[0]!.id as string);
  await db.admin.query("update public.tenants set claude_enabled = true where id = $1", [tenantC]);
  await addMember(db, f.dave, tenantC, cora, "viewer");
});
afterAll(async () => { await db.close(); });

describe("connecting several workspaces", () => {
  it("one approval creates one live row per workspace; approving again replaces them all", async () => {
    expect(await connect([f.tenantA, f.tenantB])).toHaveLength(2);
    expect((await live()).map((r) => r.tenant_id).sort()).toEqual([f.tenantA, f.tenantB].sort());
    // the old single-workspace call still works and replaces the whole set
    await asPerson(cora, (q) => q("select public.mcp_connect($1, $2, 'Claude')", [f.tenantA, CLIENT]));
    expect((await live()).map((r) => r.tenant_id)).toEqual([f.tenantA]);
    expect(await connect([f.tenantA, f.tenantB, f.tenantA])).toHaveLength(2); // duplicates collapse
  });

  it("refuses a workspace the person is not in, one with Claude off, and an empty choice, creating nothing", async () => {
    const before = (await live()).length;
    expect(await errorCode(connect([f.tenantA, (await asPerson(f.dave, async (q) => (await q("select public.create_tenant('Not hers') as id")).rows[0]!.id as string))]))).toBe("42501");
    await db.admin.query("update public.tenants set claude_enabled = false where id = $1", [tenantC]);
    expect(await errorCode(connect([f.tenantA, tenantC]))).toBe("P0001");
    await db.admin.query("update public.tenants set claude_enabled = true where id = $1", [tenantC]);
    expect(await errorCode(connect([]))).toBe("P0001");
    expect((await live()).length).toBe(before); // the transaction rolled back: still A and B
  });

  it("Claude cannot connect or change connections itself", async () => {
    expect(await errorCode(asClaude(cora, (q) => q("select * from public.mcp_connect_many($1::uuid[], $2, 'x')", [[f.tenantA], "other"])))).toBe("42501");
  });
});

describe("authorizing every workspace of a connection", () => {
  it("answers once per workspace with the role in each", async () => {
    const rows = await authorizeAll();
    expect(rows.map((r) => [r.tenant_id, r.status, r.role]).sort()).toEqual([[f.tenantA, "ok", "creator"], [f.tenantB, "ok", "creator"]].sort());
    expect(rows.every((r) => typeof r.tenant_name === "string")).toBe(true);
  });

  it("a workspace switched off or left is reported on its own while the other stays ok", async () => {
    await db.admin.query("update public.tenants set claude_enabled = false where id = $1", [f.tenantB]);
    expect((await authorizeAll()).map((r) => [r.tenant_id, r.status]).sort()).toEqual([[f.tenantA, "ok"], [f.tenantB, "workspace_off"]].sort());
    await db.admin.query("update public.tenants set claude_enabled = true where id = $1", [f.tenantB]);
  });

  it("an admin's \"only on its own\" setting refuses new multi connections and shuts an existing one out of that workspace", async () => {
    await asPerson(f.bob, (q) => q("update public.tenants set claude_single_only = true where id = $1", [f.tenantB]));
    expect(await errorCode(connect([f.tenantA, f.tenantB]))).toBe("P0001"); // new approval
    expect((await authorizeAll()).map((r) => [r.tenant_id, r.status]).sort()).toEqual([[f.tenantA, "ok"], [f.tenantB, "single_only"]].sort()); // existing
    await asPerson(f.bob, (q) => q("update public.tenants set claude_single_only = false where id = $1", [f.tenantB]));
    expect((await authorizeAll()).every((r) => r.status === "ok")).toBe(true);
  });

  it("only an admin can change that setting, and Claude cannot", async () => {
    expect(await asPerson(cora, async (q) => (await q("update public.tenants set claude_single_only = true where id = $1", [f.tenantB])).rowCount)).toBe(0); // a creator
    expect(await errorCode(asClaude(f.bob, (q) => q("update public.tenants set claude_single_only = true where id = $1", [f.tenantB]), "bob-client"))).not.toBeNull();
    expect((await db.admin.query("select claude_single_only from public.tenants where id = $1", [f.tenantB])).rows[0]!.claude_single_only).toBe(false);
  });
});

describe("writes go to the workspace that was named", () => {
  it("mcp_apply with the workspace writes there, stamps that workspace's connection and nowhere else", async () => {
    const a = await create(f.tenantA, f.seedA.project, "Multi in A");
    const b = await create(f.tenantB, f.seedB.project, "Multi in B");
    const idA = a.units[0]!.ops![0]!.id, idB = b.units[0]!.ops![0]!.id;
    expect(await item(idA)).toMatchObject({ tenant_id: f.tenantA, created_via: "Claude MCP", ai_draft: true });
    expect(await item(idB)).toMatchObject({ tenant_id: f.tenantB, created_via: "Claude MCP", ai_draft: true });
    const conns = Object.fromEntries((await live()).map((r) => [r.tenant_id as string, r.id as string]));
    const audit = async (id: string) => (await db.admin.query("select distinct connection_id from public.audit_log where entity = 'items' and entity_id = $1", [id])).rows.map((r) => r.connection_id);
    expect(await audit(idA)).toEqual([conns[f.tenantA]]);
    expect(await audit(idB)).toEqual([conns[f.tenantB]]);
    // each change set belongs to its own workspace's connection
    expect((await db.admin.query("select tenant_id, connection_id from public.mcp_change_sets where id = any($1) order by tenant_id", [[a.change_set, b.change_set]])).rows.map((r) => [r.tenant_id, r.connection_id]).sort())
      .toEqual([[f.tenantA, conns[f.tenantA]], [f.tenantB, conns[f.tenantB]]].sort());
  });

  it("without a workspace a connection with two is refused, never guessed", async () => {
    const r = await create(null, f.seedA.project, "Unnamed workspace").catch((e) => e);
    expect(r).toBeInstanceOf(Error);
    expect((await db.admin.query("select 1 from public.items where initiative_name = 'Unnamed workspace'")).rowCount).toBe(0);
  });

  it("a workspace that is not part of the connection is refused even though the person is a member there", async () => {
    const r = await create(tenantC, (await db.admin.query("select id from public.projects where tenant_id = $1 limit 1", [tenantC])).rows[0]?.id as string ?? f.seedA.project, "Not in the connection").catch((e) => e);
    expect(r).toBeInstanceOf(Error);
    expect((await db.admin.query("select 1 from public.items where initiative_name = 'Not in the connection'")).rowCount).toBe(0);
  });

  it("a project of the other workspace cannot be smuggled in: the write is refused", async () => {
    const r = await create(f.tenantA, f.seedB.project, "Cross project");
    expect(r.units[0]!.ok).toBe(false);
    expect((await db.admin.query("select 1 from public.items where initiative_name = 'Cross project'")).rowCount).toBe(0);
  });

  it("with exactly one workspace nothing changes: no workspace argument is needed", async () => {
    await asPerson(cora, (q) => q("select public.mcp_connect($1, $2, 'Claude')", [f.tenantA, "client-single"]));
    const r = await create(null, f.seedA.project, "Single as before", "client-single");
    expect(r.units[0]!.ok).toBe(true);
    expect(await item(r.units[0]!.ops![0]!.id)).toMatchObject({ tenant_id: f.tenantA });
  });

  it("direct writes with a Claude token (files, documents) are stamped with the connection of the row's own workspace", async () => {
    const itemB = (await db.admin.query("select id from public.items where tenant_id = $1 and deleted_at is null limit 1", [f.tenantB])).rows[0]!.id as string;
    const doc = await asClaude(cora, async (q) => (await q("insert into public.item_documents (tenant_id, item_id, title, body) values ($1, $2, 'Doc in B', 'x') returning id", [f.tenantB, itemB])).rows[0]!.id as string);
    const connB = (await live()).find((r) => r.tenant_id === f.tenantB)!.id;
    expect((await db.admin.query("select distinct connection_id, via from public.audit_log where entity = 'item_documents' and entity_id = $1", [doc])).rows).toEqual([{ connection_id: connB, via: "Claude MCP" }]);
  });
});

describe("limits, undo and held diffs stay per workspace", () => {
  it("a writing call notes last_write_at on that workspace's row only, and usage is counted per workspace", async () => {
    const rows = await live();
    const conn = (t: string) => rows.find((r) => r.tenant_id === t)!.id as string;
    await asClaude(cora, (q) => q("select public.mcp_record_call($1, 1, 0, true)", [conn(f.tenantA)]));
    await asClaude(cora, (q) => q("select public.mcp_record_call($1, 0, 0, false)", [conn(f.tenantB)]));
    const after = Object.fromEntries((await live()).map((r) => [r.tenant_id as string, r.last_write_at]));
    expect(after[f.tenantA]).not.toBeNull();
    expect(after[f.tenantB]).toBeNull();
    const usage = (t: string) => db.admin.query("select coalesce(sum(calls), 0)::int as calls, coalesce(sum(items_written), 0)::int as items from public.ai_usage where tenant_id = $1", [t]);
    expect((await usage(f.tenantA)).rows[0]).toMatchObject({ items: expect.any(Number) });
    expect((await usage(f.tenantB)).rows[0]!.items).toBe(0);
  });

  it("undo_last with a workspace undoes only that workspace's last change", async () => {
    const a = await create(f.tenantA, f.seedA.project, "Undo me in A");
    const b = await create(f.tenantB, f.seedB.project, "Keep me in B");
    const undone = await asClaude(cora, async (q) => (await q("select public.mcp_undo_last($1) as r", [f.tenantA])).rows[0]!.r as { undone: boolean });
    expect(undone.undone).toBe(true);
    expect((await item(a.units[0]!.ops![0]!.id)).deleted_at).not.toBeNull();
    expect((await item(b.units[0]!.ops![0]!.id)).deleted_at).toBeNull();
    expect(await errorCode(asClaude(cora, (q) => q("select public.mcp_undo_last()")))).not.toBeNull(); // no workspace, two live: refused
  });

  it("a held diff belongs to the workspace and connection that made it", async () => {
    const saved = await asClaude(cora, async (q) => (await q("select * from public.mcp_pending_save('[]'::jsonb, '[]'::jsonb, $1)", [f.tenantA])).rows[0]!.id as string);
    const row = (await db.admin.query("select tenant_id from public.mcp_pending_changes where id = $1", [saved])).rows[0]!;
    expect(row.tenant_id).toBe(f.tenantA);
    // claimed through the other workspace: refused, and still unclaimed
    const claim = await asClaude(cora, (q) => q("select public.mcp_apply('confirm_changes', '[]'::jsonb, false, $1, $2)", [saved, f.tenantB])).catch((e) => e);
    expect(claim).toBeInstanceOf(Error);
    expect((await db.admin.query("select applied_at from public.mcp_pending_changes where id = $1", [saved])).rows[0]!.applied_at).toBeNull();
  });
});

describe("revoking and visibility", () => {
  it("revoking one workspace leaves the other live; the owner sees only their own rows and an admin only their workspace's", async () => {
    await connect([f.tenantA, f.tenantB]);
    const rows = await live();
    await asPerson(cora, (q) => q("select public.mcp_revoke($1)", [rows.find((r) => r.tenant_id === f.tenantB)!.id]));
    expect((await live()).map((r) => r.tenant_id)).toEqual([f.tenantA]);
    expect((await authorizeAll()).map((r) => [r.tenant_id, r.status])).toEqual([[f.tenantA, "ok"]]);
    // bob administers B only: he sees the revoked B row's workspace but never A's connection rows
    await connect([f.tenantA, f.tenantB]);
    const seen = await asPerson(f.bob, async (q) => (await q("select tenant_id from public.mcp_connections")).rows.map((r) => r.tenant_id));
    expect(new Set(seen)).toEqual(new Set([f.tenantB]));
  });

  it("when every workspace is revoked the answer is revoked, as before", async () => {
    for (const r of await live()) await asPerson(cora, (q) => q("select public.mcp_revoke($1)", [r.id]));
    expect((await authorizeAll())[0]).toMatchObject({ status: "revoked" });
  });
});
