import { describe, expect, it, vi } from "vitest";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";
import { createPage, failure, getPage, getPageWithText, getSpaceById, listChildPages, listChildren, listRootFolders, listRootPages, getSpaceByKey, listSpaces, updatePage, whyConfluence, type ConfluenceRequest } from "./client";

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
    expect(calls[0]).toEqual({ method: "PUT", path: "/api/v2/pages/123", body: { id: "123", status: "current", title: "PRD", body: { representation: "storage", value: "<p>x</p>" }, version: { number: 4 } } });
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
    expect(await listRootPages(call, "777", nosleep)).toEqual({ ok: true, pages: [{ id: "10", title: "Archive", kind: "page" }, { id: "20", title: "Home", kind: "page" }, { id: "30", title: "Roadmap", kind: "page" }] });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/v2/spaces/777/pages?depth=root&limit=250&status=current&sort=title" });
  });
  it("lists the sub pages directly under a page", async () => {
    const { call, calls } = fake([{ status: 200, json: { results: [{ id: "2", title: "B" }, { id: "1", title: "A" }] } }]);
    expect(await listChildPages(call, "20", nosleep)).toEqual({ ok: true, pages: [{ id: "1", title: "A", kind: "page" }, { id: "2", title: "B", kind: "page" }] });
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

describe("folders in the page tree (a space can keep its pages in folders, which are not pages)", () => {
  const R = (results: unknown[], next?: string) => ({ status: 200, json: { results, ...(next ? { _links: { next } } : {}) } });
  it("finds the top-level folders from the pages in them, follows a folder up to the space, and skips folders under a page", async () => {
    const f = fake([
      R([{ id: "1", parentType: "page", parentId: "9" }, { id: "2", parentType: "folder", parentId: "50" }, { id: "3", parentType: "folder", parentId: "60" }], "/wiki/api/v2/spaces/777/pages?cursor=abc%3D&limit=250"),
      R([{ id: "4", parentType: "folder", parentId: "50" }, { id: "5", parentType: "folder", parentId: "70" }]),
      { status: 200, json: { id: "50", title: "Roadmap", parentType: "space" } }, // top level
      { status: 200, json: { id: "60", title: "Q3", parentType: "folder", parentId: "50" } }, // under 50: already known
      { status: 200, json: { id: "70", title: "In a page", parentType: "page", parentId: "9" } }, // reached through its page
    ]);
    expect(await listRootFolders(f.call, "777", nosleep)).toEqual({ ok: true, folders: [{ id: "50", title: "Roadmap", kind: "folder" }] });
    expect(f.calls[0]!.path).toBe("/api/v2/spaces/777/pages?limit=250&status=current");
    expect(f.calls[1]!.path).toContain("cursor=abc%3D");
    expect(f.calls.slice(2).map((c) => c.path)).toEqual(["/api/v2/folders/50", "/api/v2/folders/60", "/api/v2/folders/70"]);
    for (const c of f.calls) expect(c.path).not.toContain("rest/api");
  });
  it("says so when folders cannot be read (the permission is missing) and refuses a bad id without asking", async () => {
    expect(await listRootFolders(fake([R([{ id: "2", parentType: "folder", parentId: "50" }]), { status: 401 }]).call, "777", nosleep)).toMatchObject({ ok: false, kind: "forbidden" });
    const f = fake([]);
    expect((await listRootFolders(f.call, "../x", nosleep)).ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
  it("a folder is opened with the folder call and lists its pages and sub folders; other kinds of content are left out", async () => {
    const f = fake([{ status: 200, json: { results: [{ id: "3", type: "page", title: "Spec" }, { id: "2", type: "folder", title: "Q3" }, { id: "4", type: "whiteboard", title: "Board" }] } }]);
    expect(await listChildren(f.call, "50", "folder", nosleep)).toEqual({ ok: true, pages: [{ id: "2", title: "Q3", kind: "folder" }, { id: "3", title: "Spec", kind: "page" }] });
    expect(f.calls[0]!.path).toBe("/api/v2/folders/50/direct-children?limit=250");
  });
  it("a page's children include its folders; a sign-in without that permission falls back to its sub pages", async () => {
    const ok = fake([{ status: 200, json: { results: [{ id: "2", type: "folder", title: "F" }] } }]);
    expect(await listChildren(ok.call, "20", "page", nosleep)).toMatchObject({ ok: true, pages: [{ id: "2", kind: "folder" }] });
    expect(ok.calls[0]!.path).toBe("/api/v2/pages/20/direct-children?limit=250");
    const old = fake([{ status: 401 }, { status: 200, json: { results: [{ id: "1", title: "A" }] } }]);
    expect(await listChildren(old.call, "20", "page", nosleep)).toEqual({ ok: true, pages: [{ id: "1", title: "A", kind: "page" }] });
    expect(old.calls[1]!.path).toBe("/api/v2/pages/20/children?limit=250");
    expect(await listChildren(fake([{ status: 403 }]).call, "50", "folder", nosleep)).toMatchObject({ ok: false, kind: "forbidden" });
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
