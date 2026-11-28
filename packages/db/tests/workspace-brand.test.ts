import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #750: the company brand (logo, colours, fonts) of a workspace. Admins set and confirm it; Claude may propose, never confirm.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string;
const sha = "a".repeat(64);

const row = async (tenant = f.tenantA) => (await db.admin.query("select * from public.workspace_brand where tenant_id = $1", [tenant])).rows[0];
const asAdmin = <T>(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>, via = "UI") => db.asUser(f.alice, fn as never, { commit: true, via }) as Promise<T>;
const reset = async () => { await db.admin.query("delete from public.workspace_brand where tenant_id = $1", [f.tenantA]); };

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "brand-creator@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
});
afterAll(async () => { await db.close(); });

describe("the company brand", () => {
  it("an admin creates it as a draft with a public address of its own, and nothing else can set the address", async () => {
    await reset();
    await asAdmin((q) => q("insert into public.workspace_brand (tenant_id, display_name, primary_color, accent_color) values ($1, 'Acme Media', '#0b6e4f', '#f59e0b')", [f.tenantA]));
    const r = await row();
    expect(r).toMatchObject({ status: "draft", version: 1, ai_draft: false, primary_color: "#0b6e4f", use_on_voting: false, use_in_app: false, created_by: f.alice });
    expect(r.public_token).toMatch(/^[0-9a-f]{32}$/);
    expect(await errorCode(asAdmin((q) => q("update public.workspace_brand set public_token = repeat('0', 32) where tenant_id = $1", [f.tenantA])))).toBe("42501"); // no grant
    await db.admin.query("update public.workspace_brand set status = 'draft' where tenant_id = $1", [f.tenantA]);
  });

  it("refuses colours that are not #rrggbb, fonts and names that are too long", async () => {
    await reset();
    for (const bad of ["blue", "#12", "#GGGGGG", "0b6e4f", "#0B6E4F"]) {
      expect(await errorCode(asAdmin((q) => q("insert into public.workspace_brand (tenant_id, primary_color) values ($1, $2)", [f.tenantA, bad]))), bad).toBe("23514");
    }
    expect(await errorCode(asAdmin((q) => q("insert into public.workspace_brand (tenant_id, heading_font) values ($1, $2)", [f.tenantA, "x".repeat(81)])))).toBe("23514");
    expect(await errorCode(asAdmin((q) => q("insert into public.workspace_brand (tenant_id, display_name) values ($1, '   ')", [f.tenantA])))).toBe("23514");
  });

  it("only an admin writes it; everyone in the workspace reads it; another workspace sees nothing", async () => {
    await reset();
    await asAdmin((q) => q("insert into public.workspace_brand (tenant_id, primary_color) values ($1, '#0b6e4f')", [f.tenantA]));
    expect(await errorCode(db.asUser(creator, (q) => q("update public.workspace_brand set primary_color = '#000000' where tenant_id = $1", [f.tenantA]), { commit: true }))).toBeNull(); // RLS: no row visible to update, nothing changes
    expect((await row()).primary_color).toBe("#0b6e4f");
    const seen = (user: string) => db.asUser(user, async (q) => Number((await q("select count(*) as n from public.workspace_brand where tenant_id = $1", [f.tenantA])).rows[0].n));
    expect(await seen(f.alice)).toBe(1);
    expect(await seen(creator)).toBe(1);
    expect(await seen(f.bob)).toBe(0);
    expect(await errorCode(db.asUser(f.bob, (q) => q("insert into public.workspace_brand (tenant_id, primary_color) values ($1, '#000000')", [f.tenantA]), { commit: true }))).toBe("42501");
  });

  it("confirming needs an admin and a main colour; a confirmed brand stamps who and when; every change is audited", async () => {
    await reset();
    await asAdmin((q) => q("insert into public.workspace_brand (tenant_id, display_name) values ($1, 'Acme')", [f.tenantA]));
    expect(await errorCode(asAdmin((q) => q("update public.workspace_brand set status = 'confirmed' where tenant_id = $1", [f.tenantA])))).toBe("22023"); // no main colour yet
    const t0 = (await db.admin.query("select coalesce(max(id), 0) as m from public.audit_log")).rows[0].m;
    await asAdmin((q) => q("update public.workspace_brand set primary_color = '#0b6e4f' where tenant_id = $1", [f.tenantA]));
    await asAdmin((q) => q("update public.workspace_brand set status = 'confirmed' where tenant_id = $1", [f.tenantA]));
    const r = await row();
    expect(r).toMatchObject({ status: "confirmed", confirmed_by: f.alice, ai_draft: false, version: 2 });
    expect(r.confirmed_at).not.toBeNull();
    const audit = (await db.admin.query("select field, actor_id, via from public.audit_log where id > $1 and entity = 'workspace_brand' order by id", [t0])).rows;
    expect(audit.map((a) => a.field)).toEqual(expect.arrayContaining(["primary_color", "status", "version", "confirmed_by"]));
    for (const a of audit) expect(a).toMatchObject({ actor_id: f.alice, via: "UI" });
  });

  it("Claude may propose, never confirm; a change by Claude to a confirmed brand sends it back to draft as an AI draft", async () => {
    await reset();
    await asAdmin((q) => q("insert into public.workspace_brand (tenant_id, primary_color, source) values ($1, '#0b6e4f', 'claude')", [f.tenantA]), "MCP");
    expect(await row()).toMatchObject({ status: "draft", ai_draft: true });
    expect(await errorCode(asAdmin((q) => q("update public.workspace_brand set status = 'confirmed' where tenant_id = $1", [f.tenantA]), "MCP"))).toBe("PV004");
    await asAdmin((q) => q("update public.workspace_brand set status = 'confirmed' where tenant_id = $1", [f.tenantA]));
    expect(await row()).toMatchObject({ status: "confirmed", ai_draft: false });
    await asAdmin((q) => q("update public.workspace_brand set primary_color = '#ff0000' where tenant_id = $1", [f.tenantA]), "MCP");
    expect(await row()).toMatchObject({ status: "draft", ai_draft: true, primary_color: "#ff0000", confirmed_by: null, confirmed_at: null });
  });

  it("the switches for voting and the interface are an admin's, and are kept when a proposal sends the brand back to draft", async () => {
    await reset();
    await asAdmin((q) => q("insert into public.workspace_brand (tenant_id, primary_color, use_on_voting, use_in_app) values ($1, '#0b6e4f', true, true)", [f.tenantA]));
    await asAdmin((q) => q("update public.workspace_brand set status = 'confirmed' where tenant_id = $1", [f.tenantA]));
    await asAdmin((q) => q("update public.workspace_brand set accent_color = '#f59e0b' where tenant_id = $1", [f.tenantA]), "MCP");
    expect(await row()).toMatchObject({ status: "draft", use_on_voting: true, use_in_app: true }); // not effective while a draft: the readers check the status too
    await asAdmin((q) => q("update public.workspace_brand set use_in_app = false where tenant_id = $1", [f.tenantA]));
    expect((await row()).use_in_app).toBe(false);
  });
});

describe("the logo", () => {
  const set = (user: string, tenant: string, path: string, s = sha, via = "UI") => db.asUser(user, (q) => q("select public.workspace_brand_set_logo($1, $2, $3, 400, 120)", [tenant, path, s]), { commit: true, via });

  it("is recorded only through the function, only for a path inside this workspace, only by an admin", async () => {
    await reset();
    const own = `brand/${f.tenantA}/${sha}.png`;
    expect(await errorCode(set(creator, f.tenantA, own))).toBe("42501");
    expect(await errorCode(set(f.bob, f.tenantA, own))).toBe("42501");
    expect(await errorCode(set(f.alice, f.tenantA, `brand/${f.tenantB}/${sha}.png`))).toBe("22023"); // someone else's folder
    expect(await errorCode(set(f.alice, f.tenantA, `brand/${f.tenantA}/${"b".repeat(64)}.png`))).toBe("22023"); // hash and path disagree
    expect(await errorCode(set(f.alice, f.tenantA, "../../etc/passwd"))).toBe("22023");
    expect(await errorCode(asAdmin((q) => q("update public.workspace_brand set logo_path = $2 where tenant_id = $1", [f.tenantA, own])))).toBe("42501"); // no grant on the column
    await set(f.alice, f.tenantA, own);
    expect(await row()).toMatchObject({ logo_path: own, logo_sha: sha, logo_width: 400, logo_height: 120 });
    // a new logo changes the version; clearing removes it; a creator cannot clear it
    expect(await errorCode(db.asUser(creator, (q) => q("select public.workspace_brand_clear_logo($1)", [f.tenantA]), { commit: true }))).toBe("42501");
    await db.asUser(f.alice, (q) => q("select public.workspace_brand_clear_logo($1)", [f.tenantA]), { commit: true });
    expect(await row()).toMatchObject({ logo_path: null, logo_sha: null });
  });

  it("the plan seam answers yes for every workspace until plans exist", async () => {
    expect((await db.admin.query("select public.tenant_has_feature($1, 'branding') as ok", [f.tenantA])).rows[0].ok).toBe(true);
  });
});
