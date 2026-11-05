import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A database that is one release behind the code: item_github_links / item_jira_links have no frozen_at (migration tracker_freeze, 0.98 not
// applied). Postgres answers a read that names it with 42703 and Supabase returns { data: null, error } instead of throwing. Before the fix
// the Jira check said "Jira could not be read just now" and the GitHub reads said "Not on GitHub" / ignored the webhook / checked 0 items.
const PRE_FREEZE_ERROR = { code: "42703", message: "column item_jira_links.frozen_at does not exist" };

function preFreezeAdmin(rows: Record<string, unknown[]> = {}) {
  const from = (table: string) => {
    let broken = false;
    const q: Record<string, unknown> = {};
    for (const m of ["not", "neq", "ilike", "limit", "order", "or", "in", "range"]) q[m] = () => q;
    q.eq = () => q;
    q.is = (col: string) => { if (col === "frozen_at") broken = true; return q; };
    const result = () => (broken ? { data: null, error: PRE_FREEZE_ERROR } : { data: rows[table] ?? [], error: null });
    q.maybeSingle = () => Promise.resolve(broken ? result() : { data: (rows[table] ?? [])[0] ?? null, error: null });
    q.then = (resolve: (v: unknown) => void) => resolve(result());
    return { select: () => q, update: () => { const u: Record<string, unknown> = {}; u.eq = () => u; u.then = (r: (v: unknown) => void) => r({ data: null, error: null }); return u; }, insert: () => Promise.resolve({ data: null, error: null }) };
  };
  return { from, rpc: async () => ({ data: null, error: null }) };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => preFreezeAdmin({ items: [{ id: "i1", item_code: "R-1", initiative_name: "One" }] }) }));
vi.mock("@/lib/atlassian/server", () => ({ jiraGet: async () => ({}) }));

const { explainDbError, isSchemaDrift, safeReadMessage, DbReadError } = await import("./db-error");
const { applyLinkedStatuses } = await import("./atlassian/refresh-jira");
const { receiveFromGithub } = await import("./github/receive");
const { reconcileConnection, ingestIssueEvent } = await import("./github/sync");
const { MemorySourceControl } = await import("@pv/github");

const jiraLink = { id: "p1", tenant_id: "t1", connection_id: "c1", site_id: "s1", jira_project_key: "SCRUM" } as never;
const ghConnection = { id: "c1", tenant_id: "t1", expected_account: "Acme", installation_id: 9, account_login: "Acme", state: "connected" as const };

describe("explainDbError", () => {
  it("names a missing column as a missing database update, with the code and no row data", () => {
    const e = explainDbError("the Jira links", PRE_FREEZE_ERROR);
    expect(e).toBeInstanceOf(DbReadError);
    expect(e.schemaDrift).toBe(true);
    expect(e.message).toContain("missing an update");
    expect(e.message).toContain("42703");
    expect(e.message).not.toContain("frozen_at"); // the raw database text is never shown
  });
  it("treats the PostgREST schema-cache codes the same way", () => {
    for (const code of ["42P01", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"]) expect(isSchemaDrift({ code })).toBe(true);
  });
  it("keeps a plain failure apart from schema drift", () => {
    const e = explainDbError("the Jira links", { code: "57014", message: "canceling statement due to statement timeout" });
    expect(e.schemaDrift).toBe(false);
    expect(e.message).toContain("57014");
    expect(e.message).not.toContain("missing an update");
  });
  it("safeReadMessage keeps a database explanation and gives anything else the generic text", () => {
    expect(safeReadMessage(explainDbError("x", PRE_FREEZE_ERROR), "generic")).toContain("missing an update");
    expect(safeReadMessage(new Error("socket hang up"), "generic")).toBe("generic");
  });
});

describe("a database without frozen_at (0.98 migration not applied) is reported, not hidden", () => {
  it("Jira: reading the linked initiatives fails with the specific reason, not 'could not be read just now'", async () => {
    const err = await applyLinkedStatuses(jiraLink, "https://x.atlassian.net", { itemIds: ["i1"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbReadError);
    expect((err as Error).message).toContain("the linked initiatives");
    expect((err as Error).message).toContain("missing an update");
  });

  it("GitHub receive: every initiative says why, instead of 'Not on GitHub'", async () => {
    const out = await receiveFromGithub(preFreezeAdmin({ items: [{ id: "i1", item_code: "R-1", initiative_name: "One" }] }) as never, new MemorySourceControl(), ghConnection, ["i1", "i2"]);
    expect(out).toHaveLength(2);
    for (const r of out) {
      expect(r.status).toBe("error");
      expect(r.message).toContain("missing an update");
    }
  });

  it("GitHub daily check and issue webhook: throw (the sync log records the reason) instead of checking nothing / ignoring", async () => {
    await expect(reconcileConnection(preFreezeAdmin() as never, new MemorySourceControl(), ghConnection)).rejects.toThrow(/missing an update/);
    const admin = preFreezeAdmin({ github_connections: [{ id: "c1", tenant_id: "t1" }] });
    await expect(ingestIssueEvent(admin as never, { installationId: 9, repo: "Acme/App", number: 3 } as never, "d1")).rejects.toThrow(/missing an update/);
  });
});
