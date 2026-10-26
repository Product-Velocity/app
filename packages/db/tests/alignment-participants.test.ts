import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let creator: string, items: string[];
const DENIED = "42501";
const GROUPS = JSON.stringify([{ id: "eng", name: "Engineering" }, { id: "sales", name: "Sales" }]);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

const newSession = async (open = true) => {
  const id = await db.asUser(f.alice, async (q) => (await q("select public.alignment_session_create('Priorities', 'coins', $1::uuid[]) as id", [items])).rows[0].id as string, { commit: true, via: "UI" });
  await db.asUser(f.alice, (q) => q("select public.alignment_session_configure($1, 'Priorities', 'coins', $2::jsonb, 'equal', '{}', 100, 30, false, 12, null)", [id, GROUPS]), { commit: true });
  if (open) await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'open')", [id]), { commit: true });
  return id;
};
const add = (user: string, session: string, rows: unknown[]) => db.asUser(user, async (q) => (await q("select public.alignment_participants_add($1, $2::jsonb) as r", [session, JSON.stringify(rows)])).rows[0].r as { added: number; merged: number; invalid: number }, { commit: true, via: "UI" });
const list = (user: string, session: string) => db.asUser(user, async (q) => (await q("select * from public.alignment_participants_list($1)", [session])).rows);
const draft = (user: string, session: string, kind = "invitation", opts: { via?: string } = {}) =>
  db.asUser(user, async (q) => (await q("select public.alignment_mailing_draft($1, $2, 'You are invited', 'Please vote') as id", [session, kind])).rows[0].id as string, { commit: true, via: opts.via ?? "UI" });
const confirm = (user: string, id: string, n: number, via = "UI") => db.asUser(user, (q) => q("select public.alignment_mailing_confirm($1, $2)", [id, n]), { commit: true, via });
const recipients = (id: string) => db.asService(async (q) => (await q("select * from public.alignment_mailing_recipients($1)", [id])).rows, { commit: true });
const handled = async (m: string, p: string, ok = true) => {
  await db.asService((q) => q("select public.alignment_mailing_issue($1, $2, $3)", [m, p, hash(`tok-${p}-${m}`)]), { commit: true });
  await db.asService((q) => q("select public.alignment_mailing_result($1::uuid, $2::uuid, $3::boolean, $4, 'x')", [m, p, ok, `prov-${p}`]), { commit: true });
};

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  creator = await createUser(db, "creator-part@example.test");
  await addMember(db, f.alice, f.tenantA, creator, "creator");
  items = (await db.admin.query("select id from public.items where tenant_id = $1 and deleted_at is null order by stack_rank limit 3", [f.tenantA])).rows.map((r) => r.id);
});
afterAll(async () => { await db.close(); });

describe("participants", () => {
  it("admins add people; capitals and repeats merge, bad addresses and unknown groups are counted, not stored", async () => {
    const s = await newSession();
    const r = await add(f.alice, s, [
      { email: "Ann@Example.test", name: "Ann", group: "eng" },
      { email: " ann@example.test ", name: "Other", group: "eng" },
      { email: "bob@example.test", group: "sales" },
      { email: "not-an-email", group: "eng" },
      { email: "cy@example.test", group: "nope" },
    ]);
    expect(r).toEqual({ added: 2, merged: 1, invalid: 2 });
    const rows = await list(f.alice, s);
    expect(rows.map((x) => x.email)).toEqual(["ann@example.test", "bob@example.test"]);
    expect(rows[0]).toMatchObject({ name: "Ann", email_status: "not_sent", voted: false });
  });
  it("only admins add or list; the other workspace's admin cannot either", async () => {
    const s = await newSession();
    expect(await errorCode(add(creator, s, [{ email: "a@example.test", group: "eng" }]))).toBe(DENIED);
    expect(await errorCode(add(f.bob, s, [{ email: "a@example.test", group: "eng" }]))).toBe(DENIED);
    await add(f.alice, s, [{ email: "a@example.test", group: "eng" }]);
    expect(await errorCode(list(creator, s))).toBe(DENIED);
    expect(await errorCode(list(f.bob, s))).toBe(DENIED);
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from public.alignment_participants")))).toBe(DENIED);
  });
  it("people cannot be added to a closed session", async () => {
    const s = await newSession();
    await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'closed')", [s]), { commit: true });
    expect(await errorCode(add(f.alice, s, [{ email: "a@example.test", group: "eng" }]))).toBe("22023");
  });
  it("removing clears the personal data and keeps the row; the audit trail never holds an address, a name or a token", async () => {
    const s = await newSession();
    await add(f.alice, s, [{ email: "secret.person@example.test", name: "Secret Person", group: "eng" }]);
    const [p] = await list(f.alice, s);
    await db.admin.query("update public.alignment_participants set token_hash = $2 where id = $1", [p.id, hash("t")]);
    await db.asUser(f.alice, (q) => q("select public.alignment_participant_remove($1)", [p.id]), { commit: true, via: "UI" });
    const [after] = await list(f.alice, s);
    expect(after).toMatchObject({ email: null, name: null });
    expect(after.removed_at).not.toBeNull();
    const raw = (await db.admin.query("select * from public.alignment_participants where id = $1", [p.id])).rows[0];
    expect(raw).toMatchObject({ email_hash: null, token_hash: null });
    const audit = JSON.stringify((await db.admin.query("select * from public.audit_log where entity_id = $1", [p.id])).rows);
    expect(audit).toContain("removed_at");
    expect(audit).not.toMatch(/secret\.person|Secret Person|"token_hash"|email_hash/);
  });
});

describe("mailings and the confirm step", () => {
  it("nothing is readable by the server before a person confirmed, and the people are fixed at the draft", async () => {
    const s = await newSession();
    await add(f.alice, s, [{ email: "a@example.test", group: "eng" }, { email: "b@example.test", group: "sales" }]);
    const m = await draft(f.alice, s);
    expect(await errorCode(recipients(m))).toBe("PV010");
    expect((await db.admin.query("select status, array_length(recipient_ids, 1) as n from public.alignment_mailings where id = $1", [m])).rows[0]).toEqual({ status: "draft", n: 2 });
    // a late arrival makes the confirmed number stale
    await add(f.alice, s, [{ email: "c@example.test", group: "eng" }]);
    expect(await errorCode(confirm(f.alice, m, 2))).toBe("22023");
    await db.asUser(f.alice, (q) => q("select public.alignment_mailing_edit($1, 'You are invited', 'Please vote now')", [m]), { commit: true });
    await confirm(f.alice, m, 3);
    expect((await recipients(m)).map((r) => r.email)).toEqual(["a@example.test", "b@example.test", "c@example.test"]);
    expect((await db.admin.query("select status, confirmed_by from public.alignment_mailings where id = $1", [m])).rows[0]).toMatchObject({ status: "sending", confirmed_by: f.alice });
  });
  it("Claude and service accounts can draft but never confirm; creators cannot confirm either", async () => {
    const s = await newSession();
    await add(f.alice, s, [{ email: "a@example.test", group: "eng" }]);
    const m = await draft(f.alice, s, "invitation", { via: "Claude MCP" });
    expect((await db.admin.query("select created_via from public.alignment_mailings where id = $1", [m])).rows[0].created_via).toBe("Claude MCP");
    expect(await errorCode(confirm(f.alice, m, 1, "Claude MCP"))).toBe("PV004");
    expect(await errorCode(confirm(creator, m, 1))).toBe(DENIED);
    expect(await errorCode(recipients(m))).toBe("PV010");
    await confirm(f.alice, m, 1);
    expect(await recipients(m)).toHaveLength(1);
  });
  it("confirming needs an open session; a cancelled mailing cannot be confirmed or sent", async () => {
    const s = await newSession(false);
    await add(f.alice, s, [{ email: "a@example.test", group: "eng" }]);
    const m = await draft(f.alice, s);
    expect(await errorCode(confirm(f.alice, m, 1))).toBe("22023");
    await db.asUser(f.alice, (q) => q("select public.alignment_mailing_cancel($1)", [m]), { commit: true });
    expect(await errorCode(recipients(m))).toBe("PV010");
  });
  it("a link and a result can only be recorded for a confirmed mailing and its own recipients", async () => {
    const s = await newSession();
    await add(f.alice, s, [{ email: "a@example.test", group: "eng" }, { email: "b@example.test", group: "eng" }]);
    const m = await draft(f.alice, s);
    const [pa, pb] = (await list(f.alice, s)).map((x) => x.id);
    expect(await errorCode(db.asService((q) => q("select public.alignment_mailing_issue($1, $2, $3)", [m, pa, hash("x")]), { commit: true }))).toBe("PV010");
    await confirm(f.alice, m, 2);
    await recipients(m);
    await handled(m, pa);
    await handled(m, pb, false);
    const rows = await list(f.alice, s);
    expect(rows[0]).toMatchObject({ email_status: "sent" });
    expect(rows[0].invited_at).not.toBeNull();
    expect(rows[1]).toMatchObject({ email_status: "failed" });
    expect(rows[1].invited_at).toBeNull();
    expect((await db.admin.query("select status, sent_count, failed_count from public.alignment_mailings where id = $1", [m])).rows[0]).toEqual({ status: "done", sent_count: 1, failed_count: 1 });
    expect(await recipients(m).catch((e) => e.code)).toBe("PV010");
    // the person whose send failed is still to be invited
    const m2 = await draft(f.alice, s);
    expect((await db.admin.query("select recipient_ids from public.alignment_mailings where id = $1", [m2])).rows[0].recipient_ids).toEqual([pb]);
  });
  it("reminders go to invited people who have not voted, not to the unsubscribed, bounced or removed", async () => {
    const s = await newSession();
    await add(f.alice, s, [1, 2, 3, 4, 5].map((n) => ({ email: `p${n}@example.test`, group: "eng" })));
    const ids = (await list(f.alice, s)).map((x) => x.id);
    await db.admin.query("update public.alignment_participants set invited_at = now(), email_status = 'sent' where id = any($1::uuid[])", [ids]);
    await db.admin.query("insert into public.alignment_ballots (tenant_id, session_id, participant_id, group_id, state, submitted_at) values ($1, $2, $3, 'eng', 'submitted', now())", [f.tenantA, s, ids[0]]);
    await db.admin.query("update public.alignment_participants set unsubscribed_at = now() where id = $1", [ids[1]]);
    await db.admin.query("update public.alignment_participants set email_status = 'bounced' where id = $1", [ids[2]]);
    await db.asUser(f.alice, (q) => q("select public.alignment_participant_remove($1)", [ids[3]]), { commit: true });
    const m = await draft(f.alice, s, "reminder");
    expect((await db.admin.query("select recipient_ids from public.alignment_mailings where id = $1", [m])).rows[0].recipient_ids).toEqual([ids[4]]);
    expect((await list(f.alice, s))[0].voted).toBe(true);
  });
  it("nobody to send to is refused; the mailing list is visible to members without any address", async () => {
    const s = await newSession();
    expect(await errorCode(draft(f.alice, s))).toBe("22023");
    await add(f.alice, s, [{ email: "a@example.test", group: "eng" }]);
    const m = await draft(f.alice, s);
    const seen = await db.asUser(creator, async (q) => (await q("select * from public.alignment_mailings where id = $1", [m])).rows);
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain("a@example.test");
  });
});

describe("links, resending and retention", () => {
  it("a replaced link still finds its person; a new link is limited to one a minute and six in all, and only for invited people", async () => {
    const s = await newSession();
    await add(f.alice, s, [{ email: "a@example.test", group: "eng" }, { email: "b@example.test", group: "eng" }]);
    const [pa, pb] = (await list(f.alice, s)).map((x) => x.id);
    await db.admin.query("update public.alignment_participants set token_hash = $2, invited_at = now(), email_status = 'sent', email_sent_at = now() - interval '5 minutes', email_send_count = 1 where id = $1", [pa, hash("first")]);
    await db.admin.query("update public.alignment_participants set token_hash = $2 where id = $1", [pb, hash("never-invited")]);
    const resend = (old: string, next: string) => db.asService(async (q) => (await q("select * from public.alignment_link_resend($1, $2)", [hash(old), hash(next)])).rows, { commit: true });
    expect(await resend("never-invited", "n1")).toHaveLength(0);
    expect(await resend("unknown", "n2")).toHaveLength(0);
    expect((await resend("first", "second"))[0]).toMatchObject({ id: pa, email: "a@example.test", session_name: "Priorities" });
    expect(await resend("second", "third")).toHaveLength(0); // within a minute
    await db.admin.query("update public.alignment_participants set email_sent_at = now() - interval '5 minutes' where id = $1", [pa]);
    expect(await resend("first", "third")).toHaveLength(1); // the replaced link still works as a way to ask
    await db.admin.query("update public.alignment_participants set email_sent_at = now() - interval '5 minutes', email_send_count = 6 where id = $1", [pa]);
    expect(await resend("third", "fourth")).toHaveLength(0);
  });
  it("personal data is cleared after the retention time following the close", async () => {
    const s = await newSession();
    await add(f.alice, s, [{ email: "a@example.test", name: "A", group: "eng" }]);
    await db.asUser(f.alice, (q) => q("select public.alignment_session_set_state($1, 'closed')", [s]), { commit: true });
    expect(await db.asService(async (q) => (await q("select public.alignment_purge_personal_data() as n")).rows[0].n, { commit: true })).toBe(0);
    await db.admin.query("update public.alignment_sessions set closed_at = now() - interval '13 months' where id = $1", [s]);
    expect(await db.asService(async (q) => (await q("select public.alignment_purge_personal_data() as n")).rows[0].n, { commit: true })).toBeGreaterThanOrEqual(1);
    expect((await list(f.alice, s))[0]).toMatchObject({ email: null, name: null });
  });
});
