import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, viewer: string;
const PV004 = "PV004";
const CHECK = "23514";

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "profile-creator@example.test");
  viewer = await createUser(db, "profile-viewer@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  await addMember(db, f.alice, f.tenantA, viewer, "viewer");
  // the fixture seeds a profile for the isolation tests; these tests start from none
  await db.admin.query("delete from public.company_profiles where tenant_id = $1", [f.tenantA]);
  await db.admin.query("delete from public.company_profile_versions where tenant_id = $1", [f.tenantA]);
});
afterAll(async () => { await db.close(); });

const sections = (industry: string) => JSON.stringify({ industry });
const save = (user: string, tenant: string, json: string, via = "UI") =>
  db.asUser(user, async (q) => (await q("insert into public.company_profiles (tenant_id, sections) values ($1, $2) returning tenant_id", [tenant, json])).rowCount, { commit: true, via });
const edit = (user: string, tenant: string, set: string, params: unknown[] = [], via = "UI") =>
  db.asUser(user, async (q) => (await q(`update public.company_profiles set ${set} where tenant_id = $1`, [tenant, ...params])).rowCount, { commit: true, via });
const row = async (tenant: string) => (await db.admin.query("select * from public.company_profiles where tenant_id = $1", [tenant])).rows[0];

describe("company_url", () => {
  it("takes a web address and refuses anything else", async () => {
    const set = (v: string) => db.asUser(f.alice, async (q) => (await q("update public.tenants set company_url = $2 where id = $1", [f.tenantA, v])).rowCount, { commit: true });
    expect(await set("https://www.meridian.example/about")).toBe(1);
    expect(await errorCode(set("javascript:alert(1)"))).toBe(CHECK);
    expect(await errorCode(set("not a url"))).toBe(CHECK);
  });
  it("only an admin can change it", async () => {
    const n = await db.asUser(creator, async (q) => (await q("update public.tenants set company_url = 'https://evil.example' where id = $1", [f.tenantA])).rowCount, { commit: true });
    expect(n).toBe(0);
  });
});

describe("company profile: drafts, confirmation and versions", () => {
  it("a creator (or Claude as that creator) saves a draft: version 1, AI draft when through Claude", async () => {
    await save(creator, f.tenantA, sections("Media"), "Claude MCP");
    const r = await row(f.tenantA);
    expect(r).toMatchObject({ status: "draft", version: 1, ai_draft: true, created_via: "Claude MCP" });
  });
  it("one profile per workspace", async () => {
    expect(await errorCode(save(creator, f.tenantA, sections("again")))).toBe("23505");
  });
  it("a viewer cannot write", async () => {
    expect(await edit(viewer, f.tenantA, "sections = $2", [sections("x")])).toBe(0);
  });
  it("a change to the sections bumps the version and keeps the old one", async () => {
    await edit(creator, f.tenantA, "sections = $2", [sections("Media and entertainment")], "Claude MCP");
    expect((await row(f.tenantA)).version).toBe(2);
    const v = (await db.admin.query("select version, sections->>'industry' as i, saved_via from public.company_profile_versions where tenant_id = $1 order by version", [f.tenantA])).rows;
    expect(v.map((x) => [x.version, x.i])).toEqual([[1, "Media"], [2, "Media and entertainment"]]);
    expect(v[1].saved_via).toBe("Claude MCP");
  });
  it("Claude cannot confirm, not even as an admin; a creator cannot confirm either", async () => {
    expect(await errorCode(edit(f.alice, f.tenantA, "status = 'confirmed'", [], "Claude MCP"))).toBe(PV004);
    expect(await errorCode(edit(creator, f.tenantA, "status = 'confirmed'"))).toBe(PV004);
    expect((await row(f.tenantA)).status).toBe("draft");
  });
  it("an admin confirms: confirmer and time recorded, no longer an AI draft", async () => {
    await edit(f.alice, f.tenantA, "status = 'confirmed'");
    const r = await row(f.tenantA);
    expect(r).toMatchObject({ status: "confirmed", ai_draft: false, confirmed_by: f.alice });
    expect(r.confirmed_at).not.toBeNull();
  });
  it("once confirmed, a creator cannot change or reopen it", async () => {
    expect(await errorCode(edit(creator, f.tenantA, "sections = $2", [sections("overwritten")]))).toBe(PV004);
    expect(await errorCode(edit(creator, f.tenantA, "status = 'draft'"))).toBe(PV004);
    expect((await row(f.tenantA)).sections.industry).toBe("Media and entertainment");
  });
  it("an admin's own edit keeps it confirmed", async () => {
    await edit(f.alice, f.tenantA, "sections = $2", [sections("Media, entertainment and publishing")]);
    expect(await row(f.tenantA)).toMatchObject({ status: "confirmed", version: 3 });
  });
  it("a change by Claude (as the admin) sends it back to draft as an AI draft", async () => {
    await edit(f.alice, f.tenantA, "sections = $2", [sections("Claude's refresh")], "Claude MCP");
    const r = await row(f.tenantA);
    expect(r).toMatchObject({ status: "draft", ai_draft: true, version: 4, confirmed_by: null, confirmed_at: null });
  });
  it("audits actor, source and the change without the text", async () => {
    const { rows } = await db.admin.query("select field, old, new, via, actor_id from public.audit_log where entity = 'company_profiles' and entity_id = $1 order by id", [f.tenantA]);
    const s = rows.filter((r) => r.field === "status");
    expect(s.some((r) => r.new === "confirmed" && r.via === "UI" && r.actor_id === f.alice)).toBe(true);
    const sec = rows.filter((r) => r.field === "sections");
    expect(sec.length).toBeGreaterThan(2);
    expect(JSON.stringify(sec)).not.toContain("Claude's refresh");
  });
});

describe("isolation", () => {
  it("another workspace cannot read or write it", async () => {
    expect((await db.asUser(f.bob, async (q) => (await q("select 1 from public.company_profiles where tenant_id = $1", [f.tenantA])).rowCount)) ?? 0).toBe(0);
    expect(await edit(f.bob, f.tenantA, "sections = $2", [sections("x")])).toBe(0);
    expect((await db.asUser(f.bob, async (q) => (await q("select 1 from public.company_profile_versions where tenant_id = $1", [f.tenantA])).rowCount)) ?? 0).toBe(0);
  });
  it("nobody can delete a profile or write a version by hand", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("delete from public.company_profiles where tenant_id = $1", [f.tenantA]), { commit: true }))).toBe("42501");
    expect(await errorCode(db.asUser(f.alice, (q) => q("insert into public.company_profile_versions (tenant_id, version, sections) values ($1, 99, '{}')", [f.tenantA]), { commit: true }))).toBe("42501");
  });
});
