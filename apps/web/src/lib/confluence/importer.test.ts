import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ConfluenceRequest } from "./client";
import { pageBody } from "@pv/domain";
import { confirmImport, confirmRefresh, previewImport, previewRefresh, readPageByUrl, type ExternalBinding, type ImportDeps, type NewExternalBinding, type RefreshDeps } from "./importer";

const SITE = "https://acme.atlassian.net";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type FakePage = { id: string; title: string; version: number; spaceId: string; storage: string };

/** An in-memory Confluence (the v2 API): pages with text in storage format, and spaces by id. */
function confluence(seed: FakePage[]) {
  const pages = new Map(seed.map((p) => [p.id, { ...p }]));
  const call: ConfluenceRequest = async (method, path) => {
    const page = /^\/api\/v2\/pages\/(\d+)\?body-format=storage$/.exec(path);
    const space = /^\/api\/v2\/spaces\/(\d+)$/.exec(path);
    if (method === "GET" && page) { const p = pages.get(page[1]!); return p ? { status: 200, json: { id: p.id, status: "current", title: p.title, spaceId: p.spaceId, version: { number: p.version }, body: { storage: { representation: "storage", value: p.storage } }, _links: { webui: `/spaces/GTM/pages/${p.id}/x` } } } : { status: 404, json: null }; }
    if (method === "GET" && space) return space[1] === "999" ? { status: 200, json: { id: "999", key: "GTM", name: "Go-to-market", type: "global" } } : { status: 404, json: null };
    return { status: 500, json: null };
  };
  return { call, pages, edit: (id: string, storage: string, title?: string) => { const p = pages.get(id)!; p.version += 1; p.storage = storage; if (title) p.title = title; } };
}
const PAGE: FakePage = { id: "42", title: "GTM one-pager", version: 3, spaceId: "999", storage: "<h1>GTM</h1><p>Plan with <strong>bold</strong> text.</p>" };
const URL42 = `${SITE}/wiki/spaces/GTM/pages/42/GTM+one-pager`;

function importSetup(seed: FakePage[] = [PAGE], documentCount = 0) {
  const c = confluence(seed);
  const created: { kind: string; title: string; body: string }[] = [];
  const bindings: { documentId: string; b: NewExternalBinding }[] = [];
  const state = { failCreate: false, failBinding: false };
  const deps = (): ImportDeps => ({
    call: c.call, siteUrl: SITE, documentCount, hash, now: () => "2026-11-26T12:00:00Z",
    store: {
      createDocument: async (d) => { if (state.failCreate) return { ok: false, error: "db down" }; created.push(d); return { ok: true, id: "doc-1", version: 1 }; },
      insertBinding: async (documentId, b) => { if (state.failBinding) return { ok: false, error: "db down" }; bindings.push({ documentId, b }); return { ok: true }; },
    },
  });
  return { c, created, bindings, deps, state };
}

describe("read a page by its address", () => {
  it("only an address on the connected site, and only a page address", async () => {
    const c = confluence([PAGE]);
    expect(await readPageByUrl(c.call, SITE, URL42)).toMatchObject({ ok: true, page: { pageId: "42", title: "GTM one-pager", version: 3, markdown: "# GTM\n\nPlan with **bold** text." } });
    expect(await readPageByUrl(c.call, SITE, "https://other.atlassian.net/wiki/spaces/GTM/pages/42/x")).toMatchObject({ ok: false, kind: "invalid", message: expect.stringContaining("another Confluence site") });
    expect(await readPageByUrl(c.call, SITE, `${SITE}/wiki/x/short`)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await readPageByUrl(c.call, SITE, `${SITE}/wiki/spaces/GTM/pages/404/missing`)).toMatchObject({ ok: false, kind: "gone" });
  });
});

describe("import a page as a document", () => {
  it("the preview shows the converted text and the space, writes nothing and gives a token", async () => {
    const s = importSetup();
    const p = await previewImport(s.deps(), { pageUrl: URL42, kind: "go_to_market", mode: "sync" });
    expect(p).toMatchObject({ ok: true, title: "GTM one-pager", kind: "go_to_market", mode: "sync", page: { id: "42", version: 3, spaceKey: "GTM" }, excerpt: "# GTM\n\nPlan with **bold** text.", characters: "# GTM\n\nPlan with **bold** text.".length, lost: [] });
    expect(p.ok && p.notes.join(" ")).toMatch(/pages you may not see in Confluence/);
    expect(s.created).toEqual([]);
  });

  it("confirm creates the document from the text and links it as an external source; 'keep in sync' stays linked", async () => {
    const s = importSetup();
    const input = { pageUrl: URL42, kind: "go_to_market", mode: "sync" as const };
    const p = await previewImport(s.deps(), input);
    const done = await confirmImport(s.deps(), { ...input, confirm: p.ok ? p.confirm : "" });
    expect(done).toMatchObject({ ok: true, documentId: "doc-1", page: { version: 3 } });
    expect(s.created).toEqual([{ kind: "go_to_market", title: "GTM one-pager", body: "# GTM\n\nPlan with **bold** text." }]);
    expect(s.bindings).toEqual([{ documentId: "doc-1", b: expect.objectContaining({ spaceKey: "GTM", pageId: "42", syncMode: "sync", publishedVersion: 1, remoteVersion: 3, unlinkedAt: null, contentHash: hash("# GTM\n\nPlan with **bold** text.") }) }]);
  });

  it("'once' copies the text and ends the link at the same time", async () => {
    const s = importSetup();
    const input = { pageUrl: URL42, mode: "once" as const };
    const p = await previewImport(s.deps(), input);
    await confirmImport(s.deps(), { ...input, confirm: p.ok ? p.confirm : "" });
    expect(s.bindings[0]!.b).toMatchObject({ syncMode: "once", unlinkedAt: "2026-11-26T12:00:00Z" });
    expect(s.created[0]!.kind).toBe("other");
  });

  it("a confirmation without the token, or after the page changed, copies nothing", async () => {
    const s = importSetup();
    const input = { pageUrl: URL42, mode: "once" as const };
    expect(await confirmImport(s.deps(), input)).toMatchObject({ ok: false, kind: "changed" });
    const p = await previewImport(s.deps(), input);
    s.c.edit("42", "<p>Edited in between</p>");
    expect(await confirmImport(s.deps(), { ...input, confirm: p.ok ? p.confirm : "" })).toMatchObject({ ok: false, kind: "changed" });
    expect(s.created).toEqual([]);
  });

  it("refuses a kind that is not in the list, a full initiative, an empty page and a page that is too long, in words", async () => {
    expect(await previewImport(importSetup().deps(), { pageUrl: URL42, kind: "diary", mode: "once" })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await previewImport(importSetup([PAGE], 20).deps(), { pageUrl: URL42, mode: "once" })).toMatchObject({ ok: false, message: expect.stringContaining("at most 20") });
    expect(await previewImport(importSetup([{ ...PAGE, storage: "<ac:structured-macro ac:name=\"toc\" />" }]).deps(), { pageUrl: URL42, mode: "once" })).toMatchObject({ ok: false, message: expect.stringContaining("no text") });
    const long = importSetup([{ ...PAGE, storage: `<p>${"x".repeat(200_001)}</p>` }]);
    expect(await previewImport(long.deps(), { pageUrl: URL42, mode: "once" })).toMatchObject({ ok: false, kind: "too_long" });
  });

  it("says what was not carried over", async () => {
    const s = importSetup([{ ...PAGE, storage: '<p>Chart <ac:image><ri:attachment ri:filename="c.png" /></ac:image></p>' }]);
    const p = await previewImport(s.deps(), { pageUrl: URL42, mode: "once" });
    expect(p).toMatchObject({ ok: true, lost: ["1 image could not be copied; the file name is kept as text."] });
  });

  it("if the document was made but the link could not be recorded, the person is told", async () => {
    const s = importSetup();
    s.state.failBinding = true;
    const input = { pageUrl: URL42, mode: "sync" as const };
    const p = await previewImport(s.deps(), input);
    expect(await confirmImport(s.deps(), { ...input, confirm: p.ok ? p.confirm : "" })).toMatchObject({ ok: false, kind: "not_recorded", message: expect.stringContaining("link to the page could not be recorded") });
    expect(s.created).toHaveLength(1);
  });
});

function refreshSetup(opts: { page?: Partial<FakePage>; docBody?: string; docVersion?: number; status?: string } = {}) {
  const c = confluence([{ ...PAGE, ...opts.page }]);
  const body = "# GTM\n\nPlan with **bold** text.";
  const binding: ExternalBinding = { id: "bind-1", pageId: "42", pageUrl: URL42, pageTitle: "GTM one-pager", syncMode: "sync", publishedVersion: 1, remoteVersion: 3, contentHash: hash(body) };
  const updates: { id: string; patch: unknown }[] = [];
  const bindingUpdates: { id: string; patch: unknown }[] = [];
  let version = opts.docVersion ?? 1;
  const deps = (): RefreshDeps => ({
    call: c.call, siteUrl: SITE, hash, now: () => "2026-11-26T13:00:00Z",
    doc: { id: "doc-1", title: "GTM one-pager", body: opts.docBody ?? body, version, status: opts.status ?? "draft" }, binding,
    store: {
      updateDocument: async (id, patch) => { updates.push({ id, patch }); version += 1; return { ok: true, version }; },
      updateBinding: async (id, patch) => { bindingUpdates.push({ id, patch }); return { ok: true }; },
    },
  });
  return { c, deps, updates, bindingUpdates };
}

describe("update a document from its page", () => {
  it("nothing to do when the page has not changed", async () => {
    const s = refreshSetup();
    expect(await previewRefresh(s.deps())).toMatchObject({ ok: true, action: "unchanged", localEdits: false });
    const p = await previewRefresh(s.deps());
    expect(await confirmRefresh(s.deps(), { confirm: p.ok ? p.confirm : "" })).toMatchObject({ ok: true, action: "unchanged" });
    expect(s.updates).toEqual([]);
  });

  it("a newer page version becomes a new document version, and the link records both versions", async () => {
    const s = refreshSetup();
    s.c.edit("42", "<h1>GTM</h1><p>New plan.</p>", "GTM one-pager v2");
    const p = await previewRefresh(s.deps());
    expect(p).toMatchObject({ ok: true, action: "update", localEdits: false, page: { version: 4, title: "GTM one-pager v2" }, excerpt: "# GTM\n\nNew plan." });
    const done = await confirmRefresh(s.deps(), { confirm: p.ok ? p.confirm : "" });
    expect(done).toMatchObject({ ok: true, action: "update", version: 2 });
    expect(s.updates).toEqual([{ id: "doc-1", patch: { title: "GTM one-pager v2", body: "# GTM\n\nNew plan." } }]);
    expect(s.bindingUpdates).toEqual([{ id: "bind-1", patch: { publishedVersion: 2, remoteVersion: 4, contentHash: hash("# GTM\n\nNew plan."), pageTitle: "GTM one-pager v2" } }]);
  });

  it("keeps a title the person changed here when the page title did not change", async () => {
    const s = refreshSetup();
    s.c.edit("42", "<p>New plan.</p>");
    const deps = s.deps();
    deps.doc = { ...deps.doc, title: "My own title" };
    const p = await previewRefresh(deps);
    await confirmRefresh(deps, { confirm: p.ok ? p.confirm : "" });
    expect(s.updates[0]!.patch).toMatchObject({ title: "My own title" });
  });

  it("local edits are refused unless the person chooses to replace them, and the preview says they are kept as a previous version", async () => {
    const s = refreshSetup({ docBody: "# GTM\n\nEdited here." , docVersion: 2 });
    s.c.edit("42", "<p>Changed in Confluence.</p>");
    const p = await previewRefresh(s.deps());
    expect(p).toMatchObject({ ok: true, action: "update", localEdits: true, notes: [expect.stringContaining("kept as version 2")] });
    expect(await confirmRefresh(s.deps(), { confirm: p.ok ? p.confirm : "" })).toMatchObject({ ok: false, kind: "edited_here" });
    expect(s.updates).toEqual([]);
    expect(await confirmRefresh(s.deps(), { confirm: p.ok ? p.confirm : "", overwrite: true })).toMatchObject({ ok: true, action: "update" });
    expect(s.updates).toHaveLength(1);
  });

  it("warns when the document is approved (changing its text sends it back to review)", async () => {
    const s = refreshSetup({ status: "approved" });
    s.c.edit("42", "<p>Changed.</p>");
    expect(await previewRefresh(s.deps())).toMatchObject({ notes: [expect.stringContaining("approved")] });
  });

  it("a page saved between the preview and the confirmation needs a new preview", async () => {
    const s = refreshSetup();
    s.c.edit("42", "<p>First change.</p>");
    const p = await previewRefresh(s.deps());
    s.c.edit("42", "<p>Second change.</p>");
    expect(await confirmRefresh(s.deps(), { confirm: p.ok ? p.confirm : "" })).toMatchObject({ ok: false, kind: "changed" });
    expect(s.updates).toEqual([]);
  });

  it("a deleted page ends the link and leaves the document as it is", async () => {
    const s = refreshSetup();
    s.c.pages.delete("42");
    const p = await previewRefresh(s.deps());
    expect(p).toMatchObject({ ok: true, action: "gone" });
    expect(await confirmRefresh(s.deps(), { confirm: p.ok ? p.confirm : "" })).toMatchObject({ ok: true, action: "gone" });
    expect(s.updates).toEqual([]);
    expect(s.bindingUpdates).toEqual([{ id: "bind-1", patch: { unlinkedAt: "2026-11-26T13:00:00Z" } }]);
  });

  it("a Confluence refusal on read is shown as it is, not as a deleted page", async () => {
    const s = refreshSetup();
    const deps = { ...s.deps(), call: (async () => ({ status: 403, json: null })) as ConfluenceRequest };
    expect(await previewRefresh(deps)).toMatchObject({ ok: false, kind: "forbidden" });
  });
});

describe("two-way links (issue #714 slice 2)", () => {
  it("the notice Product Velocity put at the top of a page it wrote is not read back as text", async () => {
    const s = refreshSetup({ page: { version: 3, storage: pageBody("Plan with **bold** text.") } });
    s.c.edit("42", pageBody("Plan with **bold** text. And more."));
    const p = await previewRefresh(s.deps());
    expect(p).toMatchObject({ ok: true, action: "update", excerpt: "Plan with **bold** text. And more." });
    expect(p.ok && p.lost).toEqual([]);
  });
  it("a two-way link decides 'edited here' by the caller's answer (versions), not by the stored hash", async () => {
    const s = refreshSetup({ docBody: "# GTM\n\nEdited here after the last sync." });
    s.c.edit("42", "<h1>GTM</h1><p>New plan.</p>");
    const d = { ...s.deps(), localEdits: false };
    expect(await previewRefresh(d)).toMatchObject({ ok: true, action: "update", localEdits: false });
    const none = { ...s.deps(), localEdits: true };
    const p = await previewRefresh(none);
    expect(p).toMatchObject({ ok: true, localEdits: true });
    expect(await confirmRefresh(none, { confirm: p.ok ? p.confirm : "" })).toMatchObject({ ok: false, kind: "edited_here" });
  });
  it("an import can be two-way, and is read-only by default", async () => {
    const s = importSetup();
    const input = { pageUrl: URL42, mode: "sync" as const, direction: "both" as const };
    const p = await previewImport(s.deps(), input);
    await confirmImport(s.deps(), { ...input, confirm: p.ok ? p.confirm : "" });
    expect(s.bindings[0]!.b.syncDirection).toBe("both");
    const s2 = importSetup();
    const input2 = { pageUrl: URL42, mode: "sync" as const };
    const p2 = await previewImport(s2.deps(), input2);
    await confirmImport(s2.deps(), { ...input2, confirm: p2.ok ? p2.confirm : "" });
    expect(s2.bindings[0]!.b.syncDirection).toBe("from_confluence");
  });
});
