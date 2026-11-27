import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraRequest } from "./jira-write";
import { hashSecret } from "./jira-webhooks";

vi.mock("server-only", () => ({}));

const LINK = "123e4567-e89b-12d3-a456-426614174000";
const OLD = "68a2fdca-c863-4891-979d-406d749154f1";
const ORIGIN = "https://pv.example";
const HELD_SECRET = "QKx3hKHTRLpTy5Llszx7Vy5-EY7CdTD_";

type Write = { kind: "upsert" | "update"; row: Record<string, unknown> };
let writes: Write[];
let rows: Record<string, unknown>[];
let allLinkIds: string[];
let removerCalls: string[][];
let removerAnswer: { ok: boolean; status: number };
let posts: string[]; // the callback address of each registration attempt
let heldFor: string | null; // the address Jira says it holds (null: registration works)
let listed: unknown[];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let cols = "";
      const data = () => {
        if (table === "jira_connections") return [{ id: "c1", scopes: "manage:jira-webhook read:jira-work" }];
        if (table === "jira_project_links") return cols === "id" ? allLinkIds.map((id) => ({ id })) : [{ id: LINK, tenant_id: "t1", connection_id: "c1", site_id: "s1", jira_project_key: "RR" }];
        if (table === "jira_webhooks") return rows;
        return [];
      };
      const c: Record<string, unknown> = {};
      c.select = (x: string) => { cols = x; return c; };
      c.in = () => c;
      c.eq = () => c;
      c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: data() }).then(res);
      c.upsert = async (row: Record<string, unknown>) => { writes.push({ kind: "upsert", row }); return { error: null }; };
      c.update = (row: Record<string, unknown>) => { writes.push({ kind: "update", row }); return { eq: async () => ({ error: null }) }; };
      return c;
    },
  }),
}));
vi.mock("./server", () => ({
  jiraRequest: (): JiraRequest => async (method, path, body) => {
    if (method === "POST" && path === "/webhook") {
      const url = (body as { url: string }).url;
      posts.push(url);
      if (heldFor && posts.length === 1) return { status: 200, json: { webhookRegistrationResult: [{ errors: [`Only a single URL per user is allowed to be registered via REST API. The currently used URL: ${heldFor}`] }] } };
      return { status: 200, json: { webhookRegistrationResult: [{ createdWebhookId: 99 }] } };
    }
    if (method === "GET" && path.startsWith("/webhook")) return { status: 200, json: { values: listed } };
    return { status: 500, json: {} };
  },
  jiraWebhookRemover: () => async (ids: string[]) => { removerCalls.push(ids); return removerAnswer; },
}));

import { maintainWebhooks } from "./jira-webhooks-server";

beforeEach(() => {
  writes = []; rows = []; allLinkIds = [LINK]; removerCalls = []; removerAnswer = { ok: true, status: 202 }; posts = []; heldFor = `${ORIGIN}/api/jira/webhook/${OLD}.${HELD_SECRET}`;
  listed = [{ id: 5, jqlFilter: "project = RR", expirationDate: "2026-12-20T10:00:00.000+0000" }];
  process.env.JIRA_WEBHOOKS = "1"; process.env.JIRA_WEBHOOK_ORIGIN = ORIGIN;
});

describe("maintainWebhooks after a reconnect (issue 744)", () => {
  it("removes the registration left over from before the reconnect (its link exists nowhere) and registers the new one in the same run", async () => {
    const out = await maintainWebhooks(new Set());
    expect(out).toMatchObject({ registered: 1, failed: 0 });
    expect(removerCalls).toEqual([["5"]]);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toContain(`/api/jira/webhook/${LINK}.`);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: "upsert", row: { link_id: LINK, jira_webhook_id: "99", state: "active", last_error: null } });
    // the secret stored is the one in the address that was registered the second time
    const secret = posts[1]!.split(`${LINK}.`)[1]!;
    expect(writes[0]!.row.secret_hash).toBe(hashSecret(secret));
  });
  it("adopts the address when it is this link's own: its secret is kept, the webhook is found by its project filter, nothing is removed", async () => {
    heldFor = `${ORIGIN}/api/jira/webhook/${LINK}.${HELD_SECRET}`;
    const out = await maintainWebhooks(new Set());
    expect(out).toMatchObject({ registered: 1, failed: 0 });
    expect(removerCalls).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: "upsert", row: { link_id: LINK, jira_webhook_id: "5", state: "active", secret_hash: hashSecret(HELD_SECRET), expires_at: "2026-12-20T10:00:00.000Z" } });
  });
  it("leaves the registration of another existing link alone, and says so", async () => {
    allLinkIds = [LINK, OLD];
    const out = await maintainWebhooks(new Set());
    expect(out.failed).toBe(1);
    expect(removerCalls).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: "upsert", row: { state: "failed", jira_webhook_id: null, last_error: expect.stringMatching(/another linked project/) } });
  });
  it("an address that is not ours is never touched", async () => {
    heldFor = "https://elsewhere.example/hook/xyz";
    await maintainWebhooks(new Set());
    expect(removerCalls).toEqual([]);
    expect(writes[0]).toMatchObject({ row: { state: "failed", last_error: expect.stringMatching(/not one of Product Velocity's/) } });
  });
  it("when Jira will not remove the old registration nothing else is tried; the reason is kept for tomorrow", async () => {
    removerAnswer = { ok: false, status: 403 };
    const out = await maintainWebhooks(new Set());
    expect(out.failed).toBe(1);
    expect(posts).toHaveLength(1);
    expect(writes[0]).toMatchObject({ row: { state: "failed", last_error: expect.stringMatching(/would not remove the webhook left from before the reconnect \(403\)/) } });
  });
  it("a failed attempt never replaces the secret of a registration that works: only its state and reason change", async () => {
    allLinkIds = [LINK, OLD];
    rows = [{ link_id: LINK, jira_webhook_id: "7", state: "failed", expires_at: new Date(Date.now() + 10 * 86_400_000).toISOString() }];
    await maintainWebhooks(new Set());
    expect(writes).toHaveLength(1);
    expect(writes[0]!.kind).toBe("update");
    expect(writes[0]!.row).not.toHaveProperty("secret_hash");
    expect(writes[0]!.row).toMatchObject({ state: "failed" });
  });
  it("a registration that simply works is stored as before", async () => {
    heldFor = null;
    const out = await maintainWebhooks(new Set());
    expect(out).toMatchObject({ registered: 1, failed: 0 });
    expect(removerCalls).toEqual([]);
    expect(writes[0]).toMatchObject({ kind: "upsert", row: { jira_webhook_id: "99", state: "active" } });
  });
});
