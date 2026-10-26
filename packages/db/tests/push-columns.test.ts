import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, twoTenantFixture, type TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); await twoTenantFixture(db); });
afterAll(async () => { await db.close(); });

// The columns the GitHub push reads (ITEM_SELECT in apps/web/src/lib/github/push.ts, which has a test pinning the same list).
// A column that does not exist makes the whole read fail, and the push says the initiative is gone (0.29.0 asked for g2m_date_est).
describe("GitHub push reads real columns", () => {
  it("every column of the push select exists on items", async () => {
    const r = await db.admin.query("select id, item_code, initiative_name, summary, description, hypothesis, moscow, stack_rank, change_type, end_date, theme, home_project_id from public.items limit 1");
    expect(r.fields.map((f) => f.name)).toEqual(["id", "item_code", "initiative_name", "summary", "description", "hypothesis", "moscow", "stack_rank", "change_type", "end_date", "theme", "home_project_id"]);
  });
});
