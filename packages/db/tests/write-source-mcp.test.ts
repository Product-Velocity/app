import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, type TestDb } from "./helpers";

let db: TestDb;
let user: string;
beforeAll(async () => {
  db = await createTestDb();
  user = await createUser(db, "erin@example.test");
});
afterAll(async () => {
  await db.close();
});

/** Creates a tenant as `user` with the given token claims / headers and returns its created_via. */
async function sourceOf(opts: { headers?: Record<string, string>; claims?: Record<string, unknown>; via?: string }) {
  const id = await db.asUser(
    user,
    async (q) => (await q("select public.create_tenant('T') as id")).rows[0].id as string,
    { commit: true, ...opts },
  );
  return (await db.admin.query("select created_via from public.tenants where id = $1", [id])).rows[0]
    .created_via as string;
}

describe("write source 'MCP' cannot be forged (S8b)", () => {
  it("a plain API call that sends x-pv-via: MCP is recorded as API", async () => {
    expect(await sourceOf({ headers: { "x-pv-via": "MCP" } })).toBe("API");
  });

  it("the old source name is not honoured either", async () => {
    expect(await sourceOf({ headers: { "x-pv-via": "Claude MCP" } })).toBe("API");
  });

  it("the old source name is no longer a valid server-set source", async () => {
    await expect(sourceOf({ via: "Claude MCP" })).rejects.toThrow(/invalid write source/);
  });

  it("the UI header still works", async () => {
    expect(await sourceOf({ headers: { "x-pv-via": "UI" } })).toBe("UI");
  });

  it("a token issued by the OAuth server (client_id claim) is always MCP", async () => {
    expect(await sourceOf({ claims: { client_id: "c-123" } })).toBe("MCP");
  });

  it("an OAuth token cannot relabel itself as UI with the header", async () => {
    expect(await sourceOf({ claims: { client_id: "c-123" }, headers: { "x-pv-via": "UI" } })).toBe("MCP");
  });

  it("server-set app.via is unchanged", async () => {
    expect(await sourceOf({ via: "import" })).toBe("import");
  });
});
