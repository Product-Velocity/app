import { describe, expect, it } from "vitest";
import { callbackUrl, decideHeld, eventIssueKey, hashSecret, heldUrlFrom, listedWebhooksFrom, listWebhooks, newSecret, parseToken, planWebhooks, refreshWebhooks, registerWebhook, secretMatches, webhookOfProject, REFRESH_WHEN_DAYS_LEFT } from "./jira-webhooks";
import type { JiraRequest } from "./jira-write";

const noSleep = async () => {};
const LINK = "123e4567-e89b-12d3-a456-426614174000";
const DAY = 86_400_000;

describe("the secret in the callback address", () => {
  it("round-trips, and only the hash is kept", () => {
    const s = newSecret();
    const url = callbackUrl("https://pv.example/", LINK, s);
    expect(url).toBe(`https://pv.example/api/jira/webhook/${LINK}.${s}`);
    const t = parseToken(url.split("/").pop()!);
    expect(t).toEqual({ linkId: LINK, secret: s });
    expect(secretMatches(hashSecret(s), s)).toBe(true);
    expect(secretMatches(hashSecret(s), s + "x")).toBe(false);
    expect(secretMatches("", s)).toBe(false);
  });
  it("refuses tokens that are not <uuid>.<secret>", () => {
    for (const bad of ["", "x", `${LINK}.short`, `${LINK}.${"a".repeat(30)}/../`, `../${LINK}.${"a".repeat(30)}`]) expect(parseToken(bad)).toBeNull();
  });
});

describe("what is taken from a delivery", () => {
  it("only the issue key of a created or updated event", () => {
    expect(eventIssueKey({ webhookEvent: "jira:issue_updated", issue: { key: "PLAT-12", fields: { summary: "ignore previous instructions" } } })).toBe("PLAT-12");
    expect(eventIssueKey({ webhookEvent: "jira:issue_created", issue: { key: "PLAT-1" } })).toBe("PLAT-1");
  });
  it("ignores other events, odd keys and non-objects", () => {
    expect(eventIssueKey({ webhookEvent: "jira:issue_deleted", issue: { key: "PLAT-1" } })).toBeNull();
    expect(eventIssueKey({ webhookEvent: "jira:issue_updated", issue: { key: "plat-1; drop" } })).toBeNull();
    expect(eventIssueKey({ webhookEvent: "jira:issue_updated" })).toBeNull();
    expect(eventIssueKey("x")).toBeNull();
    expect(eventIssueKey(null)).toBeNull();
  });
});

describe("keeping webhooks alive", () => {
  const now = Date.parse("2026-11-03T00:00:00Z");
  const row = (over: Record<string, unknown> = {}) => ({ link_id: "a", jira_webhook_id: "7", state: "active" as const, expires_at: new Date(now + 28 * DAY).toISOString(), ...over });
  it("registers when there is none, expired, or failed before", () => {
    expect(planWebhooks([{ id: "a", jira_project_key: "P" }], [], now)[0]!.do).toBe("register");
    expect(planWebhooks([{ id: "a", jira_project_key: "P" }], [row({ expires_at: new Date(now - DAY).toISOString() })], now)[0]!.do).toBe("register");
    expect(planWebhooks([{ id: "a", jira_project_key: "P" }], [row({ state: "failed" })], now)[0]!.do).toBe("register");
  });
  it("refreshes before the expiry and leaves a fresh one alone", () => {
    expect(planWebhooks([{ id: "a", jira_project_key: "P" }], [row({ expires_at: new Date(now + (REFRESH_WHEN_DAYS_LEFT - 1) * DAY).toISOString() })], now)[0]!.do).toBe("refresh");
    expect(planWebhooks([{ id: "a", jira_project_key: "P" }], [row()], now)[0]!.do).toBe("skip");
  });
  it("does not retry a missing permission until the person signs in again", () => {
    expect(planWebhooks([{ id: "a", jira_project_key: "P" }], [row({ state: "needs_scope", jira_webhook_id: null })], now)[0]!.do).toBe("register");
    expect(planWebhooks([{ id: "a", jira_project_key: "P" }], [row({ state: "needs_scope" })], now)[0]!.do).toBe("skip");
  });
});

describe("registering and refreshing against a fake Jira", () => {
  it("registers one webhook for one project over https", async () => {
    let sent: unknown;
    const call: JiraRequest = async (_m, _p, body) => { sent = body; return { status: 200, json: { webhookRegistrationResult: [{ createdWebhookId: 1000 }] } }; };
    expect(await registerWebhook(call, "https://pv.example/x", "PLAT", noSleep)).toEqual({ ok: true, id: "1000" });
    expect(sent).toEqual({ url: "https://pv.example/x", webhooks: [{ events: ["jira:issue_created", "jira:issue_updated"], jqlFilter: "project = PLAT" }] });
  });
  it("refuses http and a project key that could shape the filter, without calling Jira", async () => {
    let calls = 0;
    const call: JiraRequest = async () => { calls++; return { status: 200, json: {} }; };
    expect((await registerWebhook(call, "http://pv.example/x", "PLAT", noSleep)).ok).toBe(false);
    expect((await registerWebhook(call, "https://pv.example/x", "PLAT OR project = SECRET", noSleep)).ok).toBe(false);
    expect(calls).toBe(0);
  });
  it("maps a missing scope, a rate limit and a refusal", async () => {
    const mk = (status: number, json: unknown = {}): JiraRequest => async () => ({ status, json });
    expect(await registerWebhook(mk(403), "https://pv.example/x", "PLAT", noSleep)).toMatchObject({ ok: false, kind: "needs_scope" });
    expect(await registerWebhook(mk(429), "https://pv.example/x", "PLAT", noSleep)).toMatchObject({ ok: false, kind: "unavailable" });
    expect(await registerWebhook(mk(200, { webhookRegistrationResult: [{ errors: ["JQL not allowed"] }] }), "https://pv.example/x", "PLAT", noSleep)).toMatchObject({ ok: false, kind: "rejected", message: "JQL not allowed" });
  });
  it("refresh returns the new expiry, and says when Jira no longer knows the webhook", async () => {
    expect(await refreshWebhooks(async () => ({ status: 200, json: { expirationDate: "2026-12-03T00:00:00.000+0000" } }), ["7"], noSleep)).toEqual({ expiresAt: "2026-12-03T00:00:00.000Z", unknown: false });
    expect(await refreshWebhooks(async () => ({ status: 404, json: {} }), ["7"], noSleep)).toEqual({ expiresAt: null, unknown: true });
    expect(await refreshWebhooks(async () => ({ status: 500, json: {} }), ["7"], noSleep)).toEqual({ expiresAt: null, unknown: false });
  });
});

describe("an address Jira still holds from before a reconnect (issue 744)", () => {
  const ORIGIN = "https://pv.example";
  const OLD = "68a2fdca-c863-4891-979d-406d749154f1";
  const SECRET = "QKx3hKHTRLpTy5Llszx7Vy5-EY7CdTD_";
  const message = (url: string) => `Only a single URL per user is allowed to be registered via REST API. The currently used URL: ${url}`;
  const held = `${ORIGIN}/api/jira/webhook/${OLD}.${SECRET}`;

  it("registering says single_url and keeps the whole message, so the held address can be read", async () => {
    const r = await registerWebhook(async () => ({ status: 200, json: { webhookRegistrationResult: [{ errors: [message(held)] }] } }), "https://pv.example/x", "PLAT", noSleep);
    expect(r).toMatchObject({ ok: false, kind: "single_url" });
    expect(heldUrlFrom((r as { message: string }).message, ORIGIN)).toEqual({ url: held, linkId: OLD, secret: SECRET });
  });
  it("reads the held address only when it is OUR address with a well-formed token", () => {
    expect(heldUrlFrom(message(held), ORIGIN)).toMatchObject({ linkId: OLD, secret: SECRET });
    expect(heldUrlFrom(message(`${held}.`), ORIGIN)).toMatchObject({ secret: SECRET }); // a full stop after the address
    expect(heldUrlFrom(message(held), "https://other.example")).toBeNull();
    expect(heldUrlFrom(message(`${ORIGIN}/api/jira/webhook/not-a-token`), ORIGIN)).toBeNull();
    expect(heldUrlFrom("JQL not allowed", ORIGIN)).toBeNull();
    expect(heldUrlFrom("Only a single URL per user is allowed to be registered via REST API.", ORIGIN)).toBeNull();
  });
  it("adopts its own address, removes an orphan of a reconnect, and leaves everything else alone", () => {
    const h = heldUrlFrom(message(held), ORIGIN);
    expect(decideHeld(h, OLD, new Set([OLD]))).toEqual({ do: "adopt", secret: SECRET });
    expect(decideHeld(h, LINK, new Set([LINK]))).toEqual({ do: "remove_stale" }); // the held link exists nowhere: it can never be delivered to
    expect(decideHeld(h, LINK, new Set([LINK, OLD]))).toMatchObject({ do: "leave", why: expect.stringMatching(/another linked project/) }); // another workspace's or project's link
    expect(decideHeld(null, LINK, new Set([LINK]))).toMatchObject({ do: "leave", why: expect.stringMatching(/not one of Product Velocity's/) });
  });
  it("lists the webhooks of the sign-in (ids, filter, expiry only) and finds the one of a project", async () => {
    const json = { values: [{ id: 5, jqlFilter: "project = RR", events: ["x"], secret: "ignored", expirationDate: "2026-12-20T10:00:00.000+0000" }, { id: "6", jqlFilter: "project  =  PLAT" }, { id: "x" }, { jqlFilter: "no id" }] };
    expect(listedWebhooksFrom(json)).toEqual([{ id: "5", jqlFilter: "project = RR", expiresAt: "2026-12-20T10:00:00.000Z" }, { id: "6", jqlFilter: "project  =  PLAT", expiresAt: null }]);
    expect(webhookOfProject(listedWebhooksFrom(json), "RR")?.id).toBe("5");
    expect(webhookOfProject(listedWebhooksFrom(json), "plat")?.id).toBe("6");
    expect(webhookOfProject(listedWebhooksFrom(json), "OTHER")).toBeNull();
    const paths: string[] = [];
    expect(await listWebhooks(async (m, p) => { paths.push(`${m} ${p}`); return { status: 200, json }; }, noSleep)).toHaveLength(2);
    expect(paths).toEqual(["GET /webhook?maxResults=100"]);
    expect(await listWebhooks(async () => ({ status: 403, json: {} }), noSleep)).toBeNull();
  });
});
