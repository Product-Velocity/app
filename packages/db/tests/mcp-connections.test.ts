import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

const DENIED = "42501";
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
});
afterAll(async () => {
  await db.close();
});

const connect = (user: string, tenant: string, client: string) =>
  db.asUser(user, async (q) => (await q("select public.mcp_connect($1, $2, 'Claude') as id", [tenant, client])).rows[0].id as string, { commit: true });
const authorize = (user: string, client: string) =>
  db.asUser(user, async (q) => (await q("select * from public.mcp_authorize()")).rows[0], { claims: { client_id: client } });
const record = (user: string, client: string, conn: string, items = 0, bytes = 0) =>
  db.asUser(user, async (q) => (await q("select public.mcp_record_call($1, $2, $3) as r", [conn, items, bytes])).rows[0].r, {
    claims: { client_id: client },
    commit: true,
  });

describe("workspace switch", () => {
  it("is off for a new workspace and nobody can connect until an admin turns it on", async () => {
    const t = await db.asUser(f.dave, async (q) => (await q("select public.create_tenant('Fresh') as id")).rows[0].id as string, { commit: true });
    expect((await db.admin.query("select claude_enabled from public.tenants where id = $1", [t])).rows[0].claude_enabled).toBe(false);
    const code = await errorCode(connect(f.dave, t, "c-fresh"));
    expect(code).toBe("P0001");
    await db.asUser(f.dave, (q) => q("update public.tenants set claude_enabled = true where id = $1", [t]), { commit: true });
    await expect(connect(f.dave, t, "c-fresh")).resolves.toBeTruthy();
  });

  it("only an admin can change it, and the change is audited", async () => {
    const n = await db.asUser(f.carol, async (q) => (await q("update public.tenants set claude_enabled = false where id = $1", [f.tenantA])).rowCount, { commit: true });
    expect(n).toBe(0); // carol is a viewer
    await db.asUser(f.alice, (q) => q("update public.tenants set claude_enabled = false where id = $1", [f.tenantA]), { commit: true });
    await db.asUser(f.alice, (q) => q("update public.tenants set claude_enabled = true where id = $1", [f.tenantA]), { commit: true });
    const { rows } = await db.admin.query("select actor_id, via, old, new from public.audit_log where entity = 'tenants' and field = 'claude_enabled' and tenant_id = $1 order by id", [f.tenantA]);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.at(-1)).toMatchObject({ actor_id: f.alice, via: "API", new: true });
  });

  it("Claude cannot switch itself on or off", async () => {
    const code = await errorCode(
      db.asUser(f.alice, (q) => q("update public.tenants set claude_enabled = false where id = $1", [f.tenantA]), { claims: { client_id: "client-a" } }),
    );
    expect(code).not.toBeNull();
    expect((await db.admin.query("select claude_enabled from public.tenants where id = $1", [f.tenantA])).rows[0].claude_enabled).toBe(true);
  });
});

describe("connect, revoke and authorize", () => {
  it("a viewer can connect and is authorised with the viewer role", async () => {
    await connect(f.carol, f.tenantA, "c-carol");
    const r = await authorize(f.carol, "c-carol");
    expect(r).toMatchObject({ status: "ok", role: "viewer", tenant_id: f.tenantA });
  });

  it("a person who is not a member cannot connect to the workspace", async () => {
    expect(await errorCode(connect(f.dave, f.tenantA, "c-dave"))).toBe(DENIED);
  });

  it("a Claude token cannot connect, or revoke anything", async () => {
    const id = (await db.admin.query("select id from public.mcp_connections where tenant_id = $1 and client_id = 'client-a'", [f.tenantA])).rows[0].id;
    const viaClaude = { claims: { client_id: "client-a" } };
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.mcp_connect($1, 'x', 'X')", [f.tenantA]), viaClaude))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select public.mcp_revoke($1)", [id]), viaClaude))).toBe(DENIED);
  });

  it("approving again for the same client replaces the old connection", async () => {
    const first = await connect(f.alice, f.tenantA, "c-replace");
    const second = await connect(f.alice, f.tenantA, "c-replace");
    expect(second).not.toBe(first);
    const { rows } = await db.admin.query("select id, revoked_at from public.mcp_connections where client_id = 'c-replace' order by created_at");
    expect(rows.filter((r) => r.revoked_at === null).map((r) => r.id)).toEqual([second]);
    expect((await authorize(f.alice, "c-replace")).connection_id).toBe(second);
  });

  it("revoking takes effect on the next call", async () => {
    const id = await connect(f.carol, f.tenantA, "c-revoke");
    expect((await authorize(f.carol, "c-revoke")).status).toBe("ok");
    expect(await db.asUser(f.carol, async (q) => (await q("select public.mcp_revoke($1) as r", [id])).rows[0].r, { commit: true })).toBe(true);
    expect((await authorize(f.carol, "c-revoke")).status).toBe("revoked");
    expect(await errorCode(record(f.carol, "c-revoke", id))).toBe(DENIED);
  });

  it("someone else cannot revoke it; a workspace admin can", async () => {
    const id = await connect(f.carol, f.tenantA, "c-other");
    const bobTry = await db.asUser(f.bob, (q) => q("select public.mcp_revoke($1) as r", [id]), { commit: true }).then(
      (r) => r.rows[0].r,
      (e) => (e as { code?: string }).code,
    );
    expect([false, DENIED]).toContain(bobTry);
    expect((await authorize(f.carol, "c-other")).status).toBe("ok");
    expect(await db.asUser(f.alice, async (q) => (await q("select public.mcp_revoke($1) as r", [id])).rows[0].r, { commit: true })).toBe(true);
    expect((await authorize(f.carol, "c-other")).status).toBe("revoked");
  });

  it("an unknown client or a browser session is not authorised", async () => {
    expect((await authorize(f.alice, "never-connected")).status).toBe("no_connection");
    const browser = await db.asUser(f.alice, async (q) => (await q("select * from public.mcp_authorize()")).rows[0]);
    expect(browser.status).toBe("no_connection");
  });

  it("with the workspace switch off every connection is refused, with the reason", async () => {
    await connect(f.carol, f.tenantA, "c-off");
    await db.asUser(f.alice, (q) => q("update public.tenants set claude_enabled = false where id = $1", [f.tenantA]), { commit: true });
    for (const [u, c] of [[f.carol, "c-off"], [f.alice, "client-a"]] as const) {
      expect((await authorize(u, c)).status).toBe("workspace_off");
    }
    await db.asUser(f.alice, (q) => q("update public.tenants set claude_enabled = true where id = $1", [f.tenantA]), { commit: true });
    expect((await authorize(f.carol, "c-off")).status).toBe("ok");
  });

  it("a person who left the workspace is refused", async () => {
    const u = await createUser(db, "leaver@example.test");
    await db.asUser(f.alice, (q) => q("insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'creator')", [f.tenantA, u]), { commit: true });
    await connect(u, f.tenantA, "c-leaver");
    await db.admin.query("delete from public.tenant_members where user_id = $1", [u]);
    expect((await authorize(u, "c-leaver")).status).toBe("not_member");
  });

  it("create and revoke are audited", async () => {
    const { rows } = await db.admin.query("select field from public.audit_log where entity = 'mcp_connections' and tenant_id = $1", [f.tenantA]);
    expect(rows.map((r) => r.field)).toContain("client_id");
    expect(rows.map((r) => r.field)).toContain("revoked_at");
  });
});

describe("who can read the connection list", () => {
  it("a member sees only their own connections", async () => {
    const rows = await db.asUser(f.carol, async (q) => (await q("select user_id from public.mcp_connections")).rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set([f.carol]));
  });

  it("an admin sees everyone's connections of their workspace, and nothing of another workspace", async () => {
    const rows = await db.asUser(f.alice, async (q) => (await q("select tenant_id, user_id from public.mcp_connections")).rows);
    expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([f.tenantA]));
    const users = new Set(rows.map((r) => r.user_id));
    expect(users.has(f.alice) && users.has(f.carol)).toBe(true);
    expect(users.has(f.bob)).toBe(false);
  });

  it("only admins read ai_usage", async () => {
    expect((await db.asUser(f.alice, async (q) => (await q("select * from public.ai_usage")).rows)).length).toBeGreaterThan(0);
    expect(await db.asUser(f.carol, async (q) => (await q("select * from public.ai_usage")).rows)).toHaveLength(0);
  });
});

describe("write source and audit", () => {
  const rename = (claims: Record<string, unknown> | undefined, headers: Record<string, string> | undefined, name: string) =>
    db.asUser(f.alice, (q) => q("update public.tenants set name = $2 where id = $1", [f.tenantA, name]), { commit: true, claims, headers });
  const lastAudit = async (name: string) =>
    (await db.admin.query("select via, connection_id from public.audit_log where entity = 'tenants' and field = 'name' and new = to_jsonb($1::text)", [name])).rows[0];

  it("a Claude write is recorded as Claude MCP with the connection id", async () => {
    await rename({ client_id: "client-a" }, undefined, "Renamed by Claude");
    const conn = (await db.admin.query("select id from public.mcp_connections where client_id = 'client-a' and revoked_at is null")).rows[0].id;
    expect(await lastAudit("Renamed by Claude")).toEqual({ via: "Claude MCP", connection_id: conn });
  });

  it("a forged x-pv-via header changes nothing: the write is API with no connection id", async () => {
    await rename(undefined, { "x-pv-via": "Claude MCP" }, "Forged");
    expect(await lastAudit("Forged")).toEqual({ via: "API", connection_id: null });
  });

  it("a Claude token cannot relabel itself with the header", async () => {
    await rename({ client_id: "client-a" }, { "x-pv-via": "UI" }, "Relabel attempt");
    expect((await lastAudit("Relabel attempt")).via).toBe("Claude MCP");
  });

  it("a revoked connection leaves no connection id on later writes", async () => {
    const id = await connect(f.alice, f.tenantA, "c-gone");
    await db.asUser(f.alice, (q) => q("select public.mcp_revoke($1)", [id]), { commit: true });
    await rename({ client_id: "c-gone" }, undefined, "After revoke");
    expect((await lastAudit("After revoke")).connection_id).toBeNull();
  });
});

describe("rate limits and usage", () => {
  it("writes a usage row per connection and day and counts calls", async () => {
    const id = await connect(f.bob, f.tenantB, "c-usage");
    expect(await record(f.bob, "c-usage", id, 3, 1000)).toEqual({ ok: true });
    expect(await record(f.bob, "c-usage", id)).toEqual({ ok: true });
    const u = (await db.admin.query("select calls, items_written, bytes_uploaded from public.ai_usage where connection_id = $1", [id])).rows[0];
    expect(u).toEqual({ calls: 2, items_written: 3, bytes_uploaded: "1000" });
    const c = (await db.admin.query("select call_count, last_used_at from public.mcp_connections where id = $1", [id])).rows[0];
    expect(c.call_count).toBe(2);
    expect(c.last_used_at).not.toBeNull();
  });

  it("refuses past 200 items a day for the workspace and records nothing for the refused call", async () => {
    const id = await connect(f.bob, f.tenantB, "c-items");
    const used = Number((await db.admin.query("select coalesce(sum(items_written),0)::int n from public.ai_usage where tenant_id = $1", [f.tenantB])).rows[0].n);
    expect(await record(f.bob, "c-items", id, 200 - used)).toEqual({ ok: true });
    const r = await record(f.bob, "c-items", id, 1);
    expect(r).toMatchObject({ ok: false, reason: "workspace_items", limit: 200, used: 200 });
    expect(Number((await db.admin.query("select sum(items_written)::int n from public.ai_usage where tenant_id = $1", [f.tenantB])).rows[0].n)).toBe(200);
    // reads still work: a call with no items does not pass the item limit
    expect(await record(f.bob, "c-items", id)).toEqual({ ok: true });
  });

  it("refuses past 100 MB a day for the workspace", async () => {
    const id = await connect(f.alice, f.tenantA, "c-bytes");
    expect(await record(f.alice, "c-bytes", id, 0, 100 * 1024 * 1024)).toEqual({ ok: true });
    expect(await record(f.alice, "c-bytes", id, 0, 1)).toMatchObject({ ok: false, reason: "workspace_bytes" });
  });

  it("limits calls per connection", async () => {
    const id = await connect(f.carol, f.tenantA, "c-calls");
    await db.admin.query("insert into public.ai_usage (connection_id, day, tenant_id, calls) values ($1, (now() at time zone 'utc')::date, $2, 2000)", [id, f.tenantA]);
    expect(await record(f.carol, "c-calls", id)).toMatchObject({ ok: false, reason: "connection_calls", limit: 2000 });
  });

  it("only the connection's own OAuth token can record usage", async () => {
    const id = await connect(f.carol, f.tenantA, "c-own");
    const browser = db.asUser(f.carol, (q) => q("select public.mcp_record_call($1, 0, 0)", [id]), { commit: true });
    expect(await errorCode(browser)).toBe(DENIED);
    expect(await errorCode(record(f.alice, "c-own", id))).toBe(DENIED); // someone else's connection
    expect(await errorCode(record(f.carol, "other-client", id))).toBe(DENIED); // another client's token
  });
});
