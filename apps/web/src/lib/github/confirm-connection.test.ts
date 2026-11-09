import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { applyConnectionEvent, confirmInstalledConnection, recordInstallation } = await import("./server");

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

/** A small in-memory stand-in for the admin client: github_connections is a real table, the rest answer empty. Filters are honoured, so a conditional update really is conditional. */
function fakeAdmin(connections: Row[]) {
  const from = (table: string) => {
    const make = (op: "select" | "update", patch?: Row) => {
      const filters: Filter[] = [];
      const run = () => {
        if (table !== "github_connections") return { data: op === "select" ? [] : null, error: null };
        const hit = connections.filter((r) => filters.every((f) => f(r)));
        if (op === "update") { for (const r of hit) Object.assign(r, patch); return { data: null, error: null }; }
        return { data: hit.map((r) => ({ ...r })), error: null };
      };
      const q: Record<string, unknown> = {
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
        in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; },
        ilike: (k: string, v: string) => { filters.push((r) => String(r[k] ?? "").toLowerCase() === v.toLowerCase()); return q; },
        select: () => q, is: () => q, not: () => q,
        maybeSingle: async () => { const out = run(); return { data: (out.data as Row[] | null)?.[0] ?? null, error: null }; },
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      return q;
    };
    return { select: () => make("select"), update: (p: Row) => make("update", p), insert: () => make("update") };
  };
  return { from, rpc: async () => ({ data: null, error: null }) } as unknown as Parameters<typeof applyConnectionEvent>[0];
}

const installation = { id: 9, accountLogin: "dev-nbm", accountType: "User" as const, repositorySelection: "selected" as const, permissions: {}, events: [], suspended: false };
const sourceControl = (inst: typeof installation | null = installation) =>
  ({ getInstallation: async () => inst, listRepositories: async () => [], listIssueTypes: async () => [] }) as unknown as Parameters<typeof applyConnectionEvent>[1];
const waiting = (extra: Row = {}): Row => ({ id: "c1", tenant_id: "t1", expected_account: "dev-nbm", installation_id: null, account_login: null, state: "requested", ...extra });
const event = { kind: "installation" as const, action: "created" as const, installationId: 9, accountLogin: "dev-nbm", accountType: "User" as const, repositorySelection: "selected" as const };

describe("recordInstallation (issue #364)", () => {
  it("moves a waiting connection to installing and saves what GitHub said", async () => {
    const rows = [waiting()];
    expect(await recordInstallation(fakeAdmin(rows), "c1", installation)).toBeNull();
    expect(rows[0]).toMatchObject({ state: "installing", installation_id: 9, account_login: "dev-nbm", account_type: "User", repository_selection: "selected" });
  });
  it("never writes installing over a connection the webhook already connected", async () => {
    const rows = [waiting({ state: "connected", installation_id: 9 })];
    expect(await recordInstallation(fakeAdmin(rows), "c1", installation)).toBeNull();
    expect(rows[0]!.state).toBe("connected");
  });
});

describe("both orders end connected", () => {
  it("webhook first, then the install-return step", async () => {
    const rows = [waiting()];
    const admin = fakeAdmin(rows);
    await applyConnectionEvent(admin, sourceControl(), event); // finds the one connection waiting for dev-nbm
    expect(rows[0]!.state).toBe("connected");
    await recordInstallation(admin, "c1", installation);
    expect(await confirmInstalledConnection(admin, sourceControl(), rows[0] as never)).toBe("connected");
    expect(rows[0]!.state).toBe("connected");
  });
  it("install-return step first, then the webhook", async () => {
    const rows = [waiting()];
    const admin = fakeAdmin(rows);
    await recordInstallation(admin, "c1", installation);
    expect(rows[0]!.state).toBe("installing");
    expect(await confirmInstalledConnection(admin, sourceControl(), rows[0] as never)).toBe("connected");
    await applyConnectionEvent(admin, sourceControl(), event); // the late webhook changes nothing
    expect(rows[0]!.state).toBe("connected");
  });
});

describe("confirmInstalledConnection", () => {
  it("connects an installed connection whose webhook never worked", async () => {
    const rows = [waiting({ state: "installing", installation_id: 9, account_login: "dev-nbm" })];
    expect(await confirmInstalledConnection(fakeAdmin(rows), sourceControl(), rows[0] as never)).toBe("connected");
    expect(rows[0]!.state).toBe("connected");
  });
  it("refuses without an installation, when GitHub does not know it, for another account, and when suspended", async () => {
    const base = waiting({ state: "installing", installation_id: 9 });
    expect(await confirmInstalledConnection(fakeAdmin([base]), sourceControl(), { ...base, installation_id: null } as never)).toBe("not-installed");
    expect(await confirmInstalledConnection(fakeAdmin([base]), sourceControl(null), base as never)).toBe("not-found");
    expect(await confirmInstalledConnection(fakeAdmin([base]), sourceControl({ ...installation, accountLogin: "someone-else" }), base as never)).toBe("wrong-account");
    const rows = [waiting({ state: "installing", installation_id: 9 })];
    expect(await confirmInstalledConnection(fakeAdmin(rows), sourceControl({ ...installation, suspended: true }), rows[0] as never)).toBe("suspended");
    expect(rows[0]!.state).toBe("installing");
  });
  it("treats an unreachable GitHub as not found", async () => {
    const sc = { getInstallation: async () => { throw new Error("down"); } } as unknown as Parameters<typeof applyConnectionEvent>[1];
    const base = waiting({ state: "installing", installation_id: 9 });
    expect(await confirmInstalledConnection(fakeAdmin([base]), sc, base as never)).toBe("not-found");
  });
  it("leaves a disconnected connection alone", async () => {
    const rows = [waiting({ state: "disconnected", installation_id: 9 })];
    expect(await confirmInstalledConnection(fakeAdmin(rows), sourceControl(), rows[0] as never)).toBe("pending");
    expect(rows[0]!.state).toBe("disconnected");
  });
});
