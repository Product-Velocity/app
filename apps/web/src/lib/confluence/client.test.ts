import { describe, expect, it, vi } from "vitest";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";
import { createPage, failure, getPage, getPageWithText, getSpaceById, listChildPages, listRootPages, getSpaceByKey, listSpaces, updatePage, whyConfluence, type ConfluenceRequest } from "./client";

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
// the v2 shape: a page has a spaceId (not a space key) and a web path in _links
const PAGE = { id: "123", status: "current", title: "PRD", spaceId: "777", version: { number: 3 }, _links: { webui: "/spaces/PRD/pages/123/PRD" } };
const SITE = "https://acme.atlassian.net";

describe("every call uses the v2 API (the v1 endpoints were removed: the first real site answered 410)", () => {
  it("never touches /wiki/rest/api", async () => {
    const f = fake([{ status: 200, json: { results: [] } }, { status: 200, json: { results: [] } }, { status: 200, json: PAGE }, { status: 200, json: PAGE }, { status: 200, json: PAGE }]);
    await listSpaces(f.call, nosleep);
    await getSpaceByKey(f.call, "PRD", nosleep);
    await getPage(f.call, "123", SITE, nosleep);
    await createPage(f.call, { spaceId: "777", parentId: null, title: "T", body: "" }, SITE, nosleep);
    await updatePage(f.call, { id: "123", currentVersion: 3, title: "T", body: "" }, SITE, nosleep);
    expect(f.calls).toHaveLength(5);
    for (const c of f.calls) { expect(c.path, c.path).toMatch(/^\/api\/v2\//); expect(c.path).not.toContain("rest/api"); }
  });
});

describe("list spaces", () => {
  it("returns the spaces with their ids, sorted by name, and drops entries without a usable id or key", async () => {
    const { call, calls } = fake([{ status: 200, json: { results: [{ id: "2", key: "ZED", name: "Zed", type: "global" }, { id: "x", key: "BAD", name: "No numeric id" }, { id: "3", key: "A B", name: "Bad key" }, { id: "1", key: "ABC", name: "Alpha", type: "global" }] } }]);
    const r = await listSpaces(call, nosleep);
    expect(r).toEqual({ ok: true, spaces: [{ id: "1", key: "ABC", name: "Alpha", type: "global" }, { id: "2", key: "ZED", name: "Zed", type: "global" }] });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/v2/spaces?limit=250&type=global&status=current" });
  });
  it("says so when the answer is not a list", async () => {
    expect(await listSpaces(fake([{ status: 200, json: { nope: true } }]).call, nosleep)).toMatchObject({ ok: false, kind: "rejected" });
  });
  it("the 410 of the removed endpoint is shown in words as a fault of ours, not of the customer's Confluence", async () => {
    const r = await listSpaces(fake([{ status: 410, json: { message: "com.atlassian.confluence.api.service.exceptions.pagesmodes.GoneException: This deprecated endpoint has been removed." } }]).call, nosleep);
    expect(r).toMatchObject({ ok: false, kind: "rejected", message: expect.stringMatching(/no longer supported \(410\).*This deprecated endpoint has been removed\. This is a fault in Product Velocity/) });
    expect((r as { message: string }).message).not.toContain("..");
  });
});

describe("find a space by key", () => {
  it("returns the space id the page must be created in", async () => {
    const { call, calls } = fake([{ status: 200, json: { results: [{ id: "777", key: "PRD", name: "Product", type: "global" }] } }]);
    expect(await getSpaceByKey(call, "PRD", nosleep)).toEqual({ ok: true, space: { id: "777", key: "PRD", name: "Product", type: "global" } });
    expect(calls[0]!.path).toBe("/api/v2/spaces?keys=PRD&limit=1");
  });
  it("a key that is not a key is refused without asking; an unknown key is 'no space'; another space's answer is not accepted", async () => {
    const f = fake([]);
    expect(await getSpaceByKey(f.call, "../x", nosleep)).toMatchObject({ ok: false, kind: "rejected" });
    expect(f.calls).toHaveLength(0);
    expect(await getSpaceByKey(fake([{ status: 200, json: { results: [] } }]).call, "NOPE", nosleep)).toMatchObject({ ok: false, kind: "gone", message: expect.stringContaining("NOPE") });
    expect(await getSpaceByKey(fake([{ status: 200, json: { results: [{ id: "9", key: "OTHER", name: "Other" }] } }]).call, "PRD", nosleep)).toMatchObject({ ok: false, kind: "gone" });
  });
});

describe("read a page", () => {
  it("gives the id, title, version, space id and a https address built from the site and the web path", async () => {
    const { call, calls } = fake([{ status: 200, json: PAGE }]);
    expect(await getPage(call, "123", SITE, nosleep)).toEqual({ ok: true, page: { id: "123", title: "PRD", version: 3, spaceId: "777", url: "https://acme.atlassian.net/wiki/spaces/PRD/pages/123/PRD" } });
    expect(calls[0]!.path).toBe("/api/v2/pages/123");
  });
  it("uses the base of the answer when it has one, and falls back to the page's own id address when there is no web path; never a non-https address", async () => {
    expect(await getPage(fake([{ status: 200, json: { ...PAGE, _links: { base: "https://acme.atlassian.net/wiki", webui: "/spaces/PRD/pages/123/PRD" } } }]).call, "123", null, nosleep)).toMatchObject({ page: { url: "https://acme.atlassian.net/wiki/spaces/PRD/pages/123/PRD" } });
    expect(await getPage(fake([{ status: 200, json: { ...PAGE, _links: {} } }]).call, "123", SITE, nosleep)).toMatchObject({ page: { url: "https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=123" } });
    expect(await getPage(fake([{ status: 200, json: { ...PAGE, _links: { base: "http://insecure.test/wiki", webui: "/x" } } }]).call, "123", null, nosleep)).toMatchObject({ page: { url: null } });
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
  it("sends the space id, the parent, the title and the body in storage format", async () => {
    const { call, calls } = fake([{ status: 200, json: { ...PAGE, version: { number: 1 } } }]);
    const r = await createPage(call, { spaceId: "777", parentId: "55", title: "PRD", body: "<p>hi</p>" }, SITE, nosleep);
    expect(r).toMatchObject({ ok: true, page: { id: "123", version: 1, spaceId: "777" } });
    expect(calls[0]).toEqual({ method: "POST", path: "/api/v2/pages", body: { spaceId: "777", status: "current", title: "PRD", parentId: "55", body: { representation: "storage", value: "<p>hi</p>" } } });
  });
  it("leaves the parent out when there is none, and refuses a space id that is not a number without asking", async () => {
    const f = fake([{ status: 200, json: PAGE }]);
    await createPage(f.call, { spaceId: "777", parentId: null, title: "T", body: "" }, SITE, nosleep);
    expect(f.calls[0]!.body).not.toHaveProperty("parentId");
    const g = fake([]);
    expect(await createPage(g.call, { spaceId: "PRD", parentId: null, title: "T", body: "" }, SITE, nosleep)).toMatchObject({ ok: false, kind: "rejected" });
    expect(g.calls).toHaveLength(0);
  });
  it("tells the person when the title is taken (the v2 error shape), and that nothing was written", async () => {
    const r = await createPage(fake([{ status: 400, json: { errors: [{ status: 400, code: "INVALID_REQUEST_PARAMETER", title: "A page with this title already exists", detail: "A page already exists in the space with the same title" }] } }]).call, { spaceId: "7", parentId: null, title: "T", body: "" }, SITE, nosleep);
    expect(r).toMatchObject({ ok: false, kind: "title_taken", message: expect.stringContaining("Nothing was written") });
  });
});

describe("update a page", () => {
  it("writes the next version with the id, the status and the body", async () => {
    const { call, calls } = fake([{ status: 200, json: { ...PAGE, version: { number: 4 } } }]);
    const r = await updatePage(call, { id: "123", currentVersion: 3, title: "PRD", body: "<p>x</p>" }, SITE, nosleep);
    expect(r).toMatchObject({ ok: true, page: { version: 4 } });
    expect(calls[0]).toEqual({ method: "PUT", path: "/api/v2/pages/123", body: { id: "123", status: "current", title: "PRD", body: { representation: "storage", value: "<p>x</p>" }, version: { number: 4, message: "Published from Product Velocity" } } });
  });
  it("a 409 means somebody saved first: it is a conflict and nothing was overwritten", async () => {
    expect(await updatePage(fake([{ status: 409 }]).call, { id: "1", currentVersion: 1, title: "T", body: "" }, null, nosleep)).toMatchObject({ ok: false, kind: "conflict", message: expect.stringContaining("Nothing was written") });
  });
});

describe("refusals, retries and the sign-in", () => {
  it("a 403 says the sign-in may lack Confluence permission and how to add it", () => {
    expect(failure(403, { errors: [{ title: "Forbidden", detail: "No permission" }] }, true)).toMatchObject({ kind: "forbidden", message: expect.stringMatching(/Settings, Integrations, Confluence.*Forbidden: No permission.*Nothing was written/) });
  });
  it("a 401 shows Atlassian's own reason and says which permission to check (it is usually a missing permission, not an expired sign-in); a refused token refresh is the 'sign in again' case", async () => {
    expect(failure(401, { message: "Unauthorized; scope does not match" }, false)).toMatchObject({ kind: "forbidden", message: expect.stringMatching(/Atlassian says: Unauthorized; scope does not match\..*Settings, Integrations, Confluence.*Reconnect/) });
    expect(failure(401, null, true).message).toContain("Nothing was written");
    const boom: ConfluenceRequest = async () => { throw new Error("network down"); };
    expect(await listSpaces(boom, nosleep)).toMatchObject({ ok: false, kind: "unavailable" });
    const reconnect: ConfluenceRequest = async () => { throw new ReconnectNeeded(); };
    expect(await createPage(reconnect, { spaceId: "7", parentId: null, title: "T", body: "" }, null, nosleep)).toMatchObject({ ok: false, kind: "reconnect", message: expect.stringContaining("Settings, Integrations, Confluence") });
  });
  it("a 429 is retried with the pause Confluence asks for, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const { call, calls } = fake([{ status: 429, retryAfterSec: 2 }, { status: 200, json: { results: [] } }]);
    expect(await listSpaces(call, sleep)).toEqual({ ok: true, spaces: [] });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });
  it("Confluence's text is shown short, as plain text, in both the v2 and the older shape", () => {
    const why = whyConfluence({ message: `bad\u0000 ${"x".repeat(1000)}`, errors: [{ title: "T", detail: "D" }] });
    expect(why.length).toBeLessThanOrEqual(300);
    expect(why).not.toContain("\u0000");
    expect(whyConfluence({ errors: [{ title: "Title is required", detail: "Give it one" }] })).toBe("Title is required: Give it one");
    expect(whyConfluence({ data: { errors: [{ message: { translation: "Old shape" } }] } })).toBe("Old shape");
  });
});

describe("browse the pages of a space (the page tree)", () => {
  it("lists the top-level pages of a space by title, with ids a person never has to type", async () => {
    const { call, calls } = fake([{ status: 200, json: { results: [{ id: "30", title: "Roadmap" }, { id: "10", title: "Archive" }, { id: "x", title: "no numeric id" }, { id: "20", title: "Home" }] } }]);
    expect(await listRootPages(call, "777", nosleep)).toEqual({ ok: true, pages: [{ id: "10", title: "Archive" }, { id: "20", title: "Home" }, { id: "30", title: "Roadmap" }] });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/v2/spaces/777/pages?depth=root&limit=250&status=current&sort=title" });
  });
  it("lists the sub pages directly under a page", async () => {
    const { call, calls } = fake([{ status: 200, json: { results: [{ id: "2", title: "B" }, { id: "1", title: "A" }] } }]);
    expect(await listChildPages(call, "20", nosleep)).toEqual({ ok: true, pages: [{ id: "1", title: "A" }, { id: "2", title: "B" }] });
    expect(calls[0]!.path).toBe("/api/v2/pages/20/children?limit=250");
  });
  it("refuses a bad id without asking, says so when the answer is not a list, and shows a refusal in words", async () => {
    const f = fake([]);
    expect((await listRootPages(f.call, "../x", nosleep)).ok).toBe(false);
    expect((await listChildPages(f.call, "abc", nosleep)).ok).toBe(false);
    expect(f.calls).toHaveLength(0);
    expect(await listChildPages(fake([{ status: 200, json: { nope: 1 } }]).call, "1", nosleep)).toMatchObject({ ok: false, kind: "rejected" });
    expect(await listRootPages(fake([{ status: 403 }]).call, "1", nosleep)).toMatchObject({ ok: false, kind: "forbidden" });
  });
});

describe("find a space by its id", () => {
  it("returns the key and name; refuses a bad id without asking", async () => {
    const { call, calls } = fake([{ status: 200, json: { id: "777", key: "PRD", name: "Product", type: "global" } }]);
    expect(await getSpaceById(call, "777", nosleep)).toEqual({ ok: true, space: { id: "777", key: "PRD", name: "Product", type: "global" } });
    expect(calls[0]!.path).toBe("/api/v2/spaces/777");
    const f = fake([]);
    expect(await getSpaceById(f.call, "../x", nosleep)).toMatchObject({ ok: false, kind: "rejected" });
    expect(f.calls).toHaveLength(0);
  });
});

describe("read a page with its text (issue #693 slice A2)", () => {
  it("asks for the storage format and returns the page with its text", async () => {
    const { call, calls } = fake([{ status: 200, json: { ...PAGE, body: { storage: { representation: "storage", value: "<p>Hello</p>" } } } }]);
    expect(await getPageWithText(call, "123", SITE, nosleep)).toMatchObject({ ok: true, page: { id: "123", version: 3, spaceId: "777", storage: "<p>Hello</p>" } });
    expect(calls[0]!.path).toBe("/api/v2/pages/123?body-format=storage");
  });
  it("an answer without the text says the sign-in may lack the permission to read content; a bad id is refused without asking", async () => {
    expect(await getPageWithText(fake([{ status: 200, json: PAGE }]).call, "123", SITE, nosleep)).toMatchObject({ ok: false, kind: "rejected", message: expect.stringContaining("permission to read page content") });
    const f = fake([]);
    expect(await getPageWithText(f.call, "abc", SITE, nosleep)).toMatchObject({ ok: false, kind: "rejected" });
    expect(f.calls).toHaveLength(0);
    expect(await getPageWithText(fake([{ status: 403 }]).call, "123", SITE, nosleep)).toMatchObject({ ok: false, kind: "forbidden" });
  });
});
