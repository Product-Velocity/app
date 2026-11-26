import { describe, expect, it, vi } from "vitest";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";
import { createPage, failure, getPage, listSpaces, updatePage, whyConfluence, type ConfluenceRequest } from "./client";

type Answer = { status: number; json?: unknown; retryAfterSec?: number };
const fake = (answers: Answer[]) => {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const call: ConfluenceRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    const a = answers.shift() ?? { status: 500 };
    return { status: a.status, json: a.json ?? null, ...(a.retryAfterSec ? { retryAfterSec: a.retryAfterSec } : {}) };
  };
  return { call, calls };
};
const nosleep = async () => {};
const PAGE = { id: "123", title: "PRD", version: { number: 3 }, space: { key: "PRD" }, _links: { base: "https://acme.atlassian.net/wiki", webui: "/spaces/PRD/pages/123/PRD" } };

describe("list spaces", () => {
  it("returns the spaces sorted by name and drops entries without a usable key", async () => {
    const { call, calls } = fake([{ status: 200, json: { results: [{ key: "ZED", name: "Zed", type: "global" }, { key: "A B", name: "Bad", type: "global" }, { key: "ABC", name: "Alpha", type: "global" }] } }]);
    const r = await listSpaces(call, nosleep);
    expect(r).toEqual({ ok: true, spaces: [{ key: "ABC", name: "Alpha", type: "global" }, { key: "ZED", name: "Zed", type: "global" }] });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/space?limit=100&type=global" });
  });
  it("says so when the answer is not a list", async () => {
    expect(await listSpaces(fake([{ status: 200, json: { nope: true } }]).call, nosleep)).toMatchObject({ ok: false, kind: "rejected" });
  });
});

describe("read a page", () => {
  it("gives the id, title, version, space and a https address", async () => {
    const { call, calls } = fake([{ status: 200, json: PAGE }]);
    expect(await getPage(call, "123", null, nosleep)).toEqual({ ok: true, page: { id: "123", title: "PRD", version: 3, spaceKey: "PRD", url: "https://acme.atlassian.net/wiki/spaces/PRD/pages/123/PRD" } });
    expect(calls[0]!.path).toBe("/content/123?expand=version,space");
  });
  it("builds the address from the site when the answer has no links, and keeps no address that is not https", async () => {
    const bare = { id: "9", title: "T", version: { number: 1 }, space: { key: "K" } };
    expect(await getPage(fake([{ status: 200, json: bare }]).call, "9", "https://acme.atlassian.net", nosleep)).toMatchObject({ ok: true, page: { url: "https://acme.atlassian.net/wiki/spaces/K/pages/9" } });
    expect(await getPage(fake([{ status: 200, json: { ...PAGE, _links: { base: "http://insecure.test/wiki", webui: "/x" } } }]).call, "123", null, nosleep)).toMatchObject({ ok: true, page: { url: null } });
  });
  it("refuses an id that is not a number without asking Confluence, and reads a deleted page as gone", async () => {
    const f = fake([]);
    expect(await getPage(f.call, "12/../x", null, nosleep)).toMatchObject({ ok: false, kind: "rejected" });
    expect(f.calls).toHaveLength(0);
    expect(await getPage(fake([{ status: 404 }]).call, "123", null, nosleep)).toMatchObject({ ok: false, kind: "gone" });
  });
  it("an answer without a version is not accepted", async () => {
    expect(await getPage(fake([{ status: 200, json: { id: "1", title: "T" } }]).call, "1", null, nosleep)).toMatchObject({ ok: false, kind: "rejected" });
  });
});

describe("create a page", () => {
  it("sends the space, the parent, the title and the body in storage format", async () => {
    const { call, calls } = fake([{ status: 200, json: { ...PAGE, version: { number: 1 } } }]);
    const r = await createPage(call, { spaceKey: "PRD", parentId: "55", title: "PRD", body: "<p>hi</p>" }, null, nosleep);
    expect(r).toMatchObject({ ok: true, page: { id: "123", version: 1, spaceKey: "PRD" } });
    expect(calls[0]).toEqual({ method: "POST", path: "/content", body: { type: "page", title: "PRD", space: { key: "PRD" }, ancestors: [{ id: "55" }], body: { storage: { value: "<p>hi</p>", representation: "storage" } } } });
  });
  it("leaves the parent out when there is none", async () => {
    const { call, calls } = fake([{ status: 200, json: PAGE }]);
    await createPage(call, { spaceKey: "PRD", parentId: null, title: "T", body: "" }, null, nosleep);
    expect(calls[0]!.body).not.toHaveProperty("ancestors");
  });
  it("tells the person when the title is taken, and that nothing was written", async () => {
    const r = await createPage(fake([{ status: 400, json: { message: "A page with this title already exists: A page already exists in the space with the same title" } }]).call, { spaceKey: "K", parentId: null, title: "T", body: "" }, null, nosleep);
    expect(r).toMatchObject({ ok: false, kind: "title_taken", message: expect.stringContaining("Nothing was written") });
  });
});

describe("update a page", () => {
  it("writes the next version", async () => {
    const { call, calls } = fake([{ status: 200, json: { ...PAGE, version: { number: 4 } } }]);
    const r = await updatePage(call, { id: "123", currentVersion: 3, title: "PRD", body: "<p>x</p>" }, null, nosleep);
    expect(r).toMatchObject({ ok: true, page: { version: 4 } });
    expect(calls[0]).toEqual({ method: "PUT", path: "/content/123", body: { type: "page", title: "PRD", version: { number: 4 }, body: { storage: { value: "<p>x</p>", representation: "storage" } } } });
  });
  it("a 409 means somebody saved first: it is a conflict and nothing was overwritten", async () => {
    expect(await updatePage(fake([{ status: 409 }]).call, { id: "1", currentVersion: 1, title: "T", body: "" }, null, nosleep)).toMatchObject({ ok: false, kind: "conflict", message: expect.stringContaining("Nothing was written") });
  });
});

describe("refusals, retries and the sign-in", () => {
  it("a 403 says the sign-in may lack Confluence permission and how to add it", () => {
    expect(failure(403, { message: "No permission" }, true)).toMatchObject({ kind: "forbidden", message: expect.stringMatching(/Settings, Integrations, Jira.*No permission.*Nothing was written/) });
  });
  it("a 401 asks for a new sign-in; a failed transport is 'could not be reached'", async () => {
    expect(failure(401, null, false)).toMatchObject({ kind: "reconnect" });
    const boom: ConfluenceRequest = async () => { throw new Error("network down"); };
    expect(await listSpaces(boom, nosleep)).toMatchObject({ ok: false, kind: "unavailable" });
    const reconnect: ConfluenceRequest = async () => { throw new ReconnectNeeded(); };
    expect(await createPage(reconnect, { spaceKey: "K", parentId: null, title: "T", body: "" }, null, nosleep)).toMatchObject({ ok: false, kind: "reconnect" });
  });
  it("a 429 is retried with the pause Confluence asks for, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const { call, calls } = fake([{ status: 429, retryAfterSec: 2 }, { status: 200, json: { results: [] } }]);
    expect(await listSpaces(call, sleep)).toEqual({ ok: true, spaces: [] });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });
  it("Confluence's text is shown short, as plain text", () => {
    const why = whyConfluence({ message: `bad\u0000 ${"x".repeat(1000)}`, data: { errors: [{ message: { translation: "Title is required" } }] } });
    expect(why.length).toBeLessThanOrEqual(300);
    expect(why).not.toContain("\u0000");
    expect(whyConfluence({ data: { errors: [{ message: { translation: "Title is required" } }] } })).toBe("Title is required");
  });
});
