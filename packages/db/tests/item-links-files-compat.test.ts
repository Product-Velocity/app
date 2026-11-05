import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, twoTenantFixture, type TestDb } from "./helpers";

// The older app (0.94) still reads item_links and item_files; they are read-only views over item_attachments.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
beforeAll(async () => { db = await createTestDb(); f = await twoTenantFixture(db); });
afterAll(async () => { await db.close(); });

describe("old table names as views", () => {
  it("show links as label and url and files with their type, for the signed-in member's workspace only", async () => {
    const links = await db.asUser(f.alice, async (q) => (await q("select label, url from public.item_links order by label")).rows);
    expect(links).toEqual([{ label: "PRD", url: "https://example.test/prd" }]);
    const files = await db.asUser(f.alice, async (q) => (await q("select name, kind, mime_type from public.item_files")).rows);
    expect(files).toEqual([{ name: "shot.png", kind: "screenshot", mime_type: null }]);
    expect(await db.asUser(f.alice, async (q) => (await q("select 1 from public.item_links where tenant_id = $1", [f.tenantB])).rowCount)).toBe(0);
    expect(await db.asAnon(async (q) => (await q("select 1 from public.item_links")).rowCount).catch(() => "denied")).toBe("denied");
  });
  it("cannot be written to", async () => {
    await expect(db.asUser(f.alice, (q) => q("delete from public.item_links"))).rejects.toThrow();
  });
});
