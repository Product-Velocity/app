import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ConfluenceRequest } from "./client";
import { confirmPublish, previewPublish, type LivePublication, type NewPublication, type PublicationPatch, type PublishDeps, type PublishInput } from "./publish";

const SITE = "https://acme.atlassian.net";
type FakePage = { id: string; title: string; version: number; space: string; body: string };

/** A small in-memory Confluence: spaces and pages, with the version rule (a write must carry the next number) and unique titles per space. */
function confluence(seed: FakePage[] = []) {
  const pages = new Map(seed.map((p) => [p.id, { ...p }]));
  const log: string[] = [];
  let nextId = 5000;
  const wire = (p: FakePage) => ({ id: p.id, title: p.title, version: { number: p.version }, space: { key: p.space }, _links: { base: `${SITE}/wiki`, webui: `/spaces/${p.space}/pages/${p.id}/x` } });
  const call: ConfluenceRequest = async (method, path, body) => {
    log.push(`${method} ${path}`);
    const b = (body ?? {}) as { title: string; space: { key: string }; version: { number: number }; body: { storage: { value: string } } };
    const one = /^\/content\/(\d+)/.exec(path);
    if (method === "GET" && one) { const p = pages.get(one[1]!); return p ? { status: 200, json: wire(p) } : { status: 404, json: { message: "No content found" } }; }
    if (method === "POST" && path === "/content") {
      if ([...pages.values()].some((p) => p.space === b.space.key && p.title === b.title)) return { status: 400, json: { message: "A page with this title already exists: A page already exists in the space with the same title" } };
      const p: FakePage = { id: String(nextId++), title: b.title, version: 1, space: b.space.key, body: b.body.storage.value };
      pages.set(p.id, p);
      return { status: 200, json: wire(p) };
    }
    if (method === "PUT" && one) {
      const p = pages.get(one[1]!);
      if (!p) return { status: 404, json: null };
      if (b.version.number !== p.version + 1) return { status: 409, json: { message: "Version must be incremented" } };
      Object.assign(p, { title: b.title, version: b.version.number, body: b.body.storage.value });
      return { status: 200, json: wire(p) };
    }
    return { status: 500, json: null };
  };
  return { call, pages, log, editInConfluence: (id: string, body: string) => { const p = pages.get(id)!; p.version += 1; p.body = body; } };
}

function setup(opts: { seed?: FakePage[]; live?: LivePublication | null; doc?: Partial<PublishDeps["doc"]>; terms?: PublishDeps["terms"] } = {}) {
  const c = confluence(opts.seed);
  const store = { inserted: [] as NewPublication[], updated: [] as { id: string; patch: PublicationPatch }[], failInsert: false };
  let live = opts.live ?? null;
  const deps = (): PublishDeps => ({
    call: c.call, siteUrl: SITE,
    doc: { id: "doc-1", itemCode: "R-12", title: "PRD: Tickets", body: "# Tickets\n\nText.", version: 1, aiDraft: false, ...opts.doc },
    live, terms: opts.terms ?? [], appLink: "https://app.example.test/portfolio/R-12",
    hash: (s) => createHash("sha256").update(s).digest("hex"), now: () => "2026-11-26T12:00:00Z",
    save: {
      insert: async (p) => { if (store.failInsert) return { ok: false, error: "db down" }; store.inserted.push(p); live = { id: "pub-1", pageId: p.pageId, pageUrl: p.pageUrl, spaceKey: p.spaceKey, syncMode: p.syncMode, publishedVersion: p.publishedVersion, remoteVersion: p.remoteVersion, contentHash: p.contentHash }; return { ok: true }; },
      update: async (id, patch) => { store.updated.push({ id, patch }); return { ok: true }; },
    },
  });
  const publish = async (input: PublishInput, d = deps()) => {
    const p = await previewPublish(d, input);
    if (!p.ok) return { preview: p, done: null };
    return { preview: p, done: await confirmPublish(d, { ...input, confirm: p.confirm }) };
  };
  return { c, store, deps, publish, setLive: (l: LivePublication | null) => { live = l; }, getLive: () => live };
}
const IN: PublishInput = { spaceKey: "PRD", mode: "sync" };

describe("preview", () => {
  it("a new document: creates a page in the chosen space, shows the target, writes nothing and gives a token", async () => {
    const s = setup();
    const p = await previewPublish(s.deps(), IN);
    expect(p).toMatchObject({ ok: true, action: "create", title: "PRD: Tickets", spaceKey: "PRD", parent: null, page: null, warnings: [] });
    expect(p.ok && p.confirm).toMatch(/^[0-9a-f]{64}$/);
    expect(s.c.pages.size).toBe(0);
    expect(s.store.inserted).toEqual([]);
  });

  it("needs a space; a parent must be a Confluence page address on the connected site and in the same space", async () => {
    const s = setup({ seed: [{ id: "77", title: "Specs", version: 2, space: "PRD", body: "" }, { id: "88", title: "Other", version: 1, space: "ELSE", body: "" }] });
    expect(await previewPublish(s.deps(), { mode: "once" })).toMatchObject({ ok: false, kind: "invalid", message: expect.stringContaining("Choose the space") });
    expect(await previewPublish(s.deps(), { ...IN, parentUrl: "https://acme.atlassian.net/wiki/x/short" })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await previewPublish(s.deps(), { ...IN, parentUrl: "https://other.atlassian.net/wiki/spaces/PRD/pages/77/Specs" })).toMatchObject({ ok: false, kind: "invalid", message: expect.stringContaining("another Confluence site") });
    expect(await previewPublish(s.deps(), { ...IN, parentUrl: "https://acme.atlassian.net/wiki/spaces/ELSE/pages/88/Other" })).toMatchObject({ ok: false, kind: "invalid", message: expect.stringContaining("space ELSE") });
    expect(await previewPublish(s.deps(), { ...IN, parentUrl: "https://acme.atlassian.net/wiki/spaces/PRD/pages/404/Missing" })).toMatchObject({ ok: false, kind: "gone" });
    expect(await previewPublish(s.deps(), { ...IN, parentUrl: "https://acme.atlassian.net/wiki/spaces/PRD/pages/77/Specs" })).toMatchObject({ ok: true, parent: { id: "77", title: "Specs" } });
  });

  it("warns about commercial text and about an AI draft, and never blocks", async () => {
    const s = setup({ doc: { body: "Worth about €1.2m. Goal: Reduce churn.", aiDraft: true }, terms: [{ kind: "key_result", label: "Key result", text: "Reduce churn" }] });
    const p = await previewPublish(s.deps(), IN);
    expect(p).toMatchObject({ ok: true, warnings: expect.arrayContaining([{ kind: "key_result", what: "Key result" }, { kind: "money", what: "€1.2m" }]), notes: [expect.stringContaining("AI draft")] });
  });

  it("the token changes when the document, the title or the target changes", async () => {
    const s = setup();
    const a = await previewPublish(s.deps(), IN);
    const b = await previewPublish(s.deps(), { ...IN, title: "Another title" });
    const c = await previewPublish(setup({ doc: { version: 2 } }).deps(), IN);
    const d = await previewPublish(setup({ doc: { body: "changed" } }).deps(), IN);
    const tokens = [a, b, c, d].map((x) => (x.ok ? x.confirm : ""));
    expect(new Set(tokens).size).toBe(4);
  });
});

describe("create", () => {
  it("creates the page with the banner and the converted text, records it, and keeps it linked for 'keep in sync'", async () => {
    const s = setup();
    const { done } = await s.publish(IN);
    expect(done).toMatchObject({ ok: true, action: "create", page: { id: "5000", version: 1, url: "https://acme.atlassian.net/wiki/spaces/PRD/pages/5000/x" } });
    const page = s.c.pages.get("5000")!;
    expect(page.body).toContain("Managed in Product Velocity");
    expect(page.body).toContain("Open R-12 in Product Velocity");
    expect(page.body).toContain("<h1>Tickets</h1><p>Text.</p>");
    expect(s.store.inserted).toEqual([expect.objectContaining({ spaceKey: "PRD", pageId: "5000", syncMode: "sync", publishedVersion: 1, remoteVersion: 1, unlinkedAt: null, contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
  });

  it("'once' records the page and unlinks it at the same time", async () => {
    const s = setup();
    await s.publish({ ...IN, mode: "once" });
    expect(s.store.inserted[0]).toMatchObject({ syncMode: "once", unlinkedAt: "2026-11-26T12:00:00Z" });
  });

  it("a confirmation with the wrong token writes nothing", async () => {
    const s = setup();
    const r = await confirmPublish(s.deps(), { ...IN, confirm: "0".repeat(64) });
    expect(r).toMatchObject({ ok: false, kind: "changed" });
    expect(s.c.pages.size).toBe(0);
    expect(await confirmPublish(s.deps(), IN)).toMatchObject({ ok: false, kind: "changed" });
  });

  it("a token from a preview does not carry over to a changed document", async () => {
    const s = setup();
    const p = await previewPublish(s.deps(), IN);
    const r = await confirmPublish(setup({ doc: { body: "edited meanwhile" } }).deps(), { ...IN, confirm: p.ok ? p.confirm : "" });
    expect(r).toMatchObject({ ok: false, kind: "changed" });
  });

  it("a title that is already taken says so, and nothing is recorded", async () => {
    const s = setup({ seed: [{ id: "1", title: "PRD: Tickets", version: 1, space: "PRD", body: "" }] });
    const { done } = await s.publish(IN);
    expect(done).toMatchObject({ ok: false, kind: "title_taken" });
    expect(s.store.inserted).toEqual([]);
  });

  it("if the page was created but could not be recorded, the person is told where the page is", async () => {
    const s = setup();
    s.store.failInsert = true;
    const { done } = await s.publish(IN);
    expect(done).toMatchObject({ ok: false, kind: "not_recorded", message: expect.stringContaining("https://acme.atlassian.net/wiki/spaces/PRD/pages/5000/x") });
    expect(s.c.pages.size).toBe(1);
  });
});

describe("update", () => {
  const live = (over: Partial<LivePublication> = {}): LivePublication => ({ id: "pub-1", pageId: "10", pageUrl: "https://acme.atlassian.net/wiki/spaces/PRD/pages/10/x", spaceKey: "PRD", syncMode: "sync", publishedVersion: 1, remoteVersion: 1, contentHash: "old", ...over });
  const page = { id: "10", title: "PRD: Tickets", version: 1, space: "PRD", body: "old" };

  it("a newer document version updates the same page to the next page version", async () => {
    const s = setup({ seed: [page], live: live(), doc: { version: 2 } });
    const { preview, done } = await s.publish(IN);
    expect(preview).toMatchObject({ action: "update", page: { id: "10", version: 1 } });
    expect(done).toMatchObject({ ok: true, action: "update", page: { version: 2 } });
    expect(s.c.pages.get("10")!.body).toContain("Text.");
    expect(s.store.updated[0]).toMatchObject({ id: "pub-1", patch: { publishedVersion: 2, remoteVersion: 2, syncMode: "sync", unlinkedAt: null } });
  });

  it("keeps the title the page has now, unless the person gives another", async () => {
    const s = setup({ seed: [{ ...page, title: "Renamed in Confluence" }], live: live(), doc: { version: 2 } });
    const p = await previewPublish(s.deps(), IN);
    expect(p).toMatchObject({ ok: true, title: "Renamed in Confluence" });
    const q = await previewPublish(s.deps(), { ...IN, title: "New name" });
    expect(q).toMatchObject({ ok: true, title: "New name" });
  });

  it("nothing to send when the page already holds this version; a changed mode is still recorded", async () => {
    const s0 = setup();
    const first = await s0.publish(IN);
    expect(first.done).toMatchObject({ ok: true, action: "create" });
    const pub = s0.getLive()!;
    const again = await s0.publish({ ...IN, mode: "once" });
    expect(again.preview).toMatchObject({ action: "none" });
    expect(again.done).toMatchObject({ ok: true, action: "none" });
    expect(s0.store.updated).toEqual([{ id: pub.id, patch: { syncMode: "once", unlinkedAt: "2026-11-26T12:00:00Z" } }]);
    expect(pub.pageId).toBe("5000");
  });

  it("a page saved in Confluence since our write is a conflict: refused unless the person chooses Keep Product Velocity", async () => {
    const s = setup({ seed: [page], live: live(), doc: { version: 2 } });
    s.c.editInConfluence("10", "somebody else wrote this");
    const p = await previewPublish(s.deps(), IN);
    expect(p).toMatchObject({ ok: true, action: "conflict", why: expect.stringContaining("version 2") });
    const refused = await confirmPublish(s.deps(), { ...IN, confirm: p.ok ? p.confirm : "" });
    expect(refused).toMatchObject({ ok: false, kind: "conflict" });
    expect(s.c.pages.get("10")!.body).toBe("somebody else wrote this");
    const kept = await confirmPublish(s.deps(), { ...IN, confirm: p.ok ? p.confirm : "", overwrite: true });
    expect(kept).toMatchObject({ ok: true, action: "conflict", page: { version: 3 } });
    expect(s.c.pages.get("10")!.body).toContain("Text.");
  });

  it("a page saved between the preview and the confirmation is refused by Confluence's own version rule or by the token, never overwritten", async () => {
    const s = setup({ seed: [page], live: live(), doc: { version: 2 } });
    const p = await previewPublish(s.deps(), IN);
    s.c.editInConfluence("10", "late edit");
    const r = await confirmPublish(s.deps(), { ...IN, confirm: p.ok ? p.confirm : "" });
    expect(r.ok).toBe(false);
    expect(s.c.pages.get("10")!.body).toBe("late edit");
  });

  it("a page deleted in Confluence is 'gone': a new page is made and the old record stays as history", async () => {
    const s = setup({ seed: [], live: live(), doc: { version: 2 } });
    const { preview, done } = await s.publish(IN);
    expect(preview).toMatchObject({ action: "gone" });
    expect(done).toMatchObject({ ok: true, action: "gone", page: { id: "5000" } });
    expect(s.store.updated[0]).toMatchObject({ id: "pub-1", patch: { unlinkedAt: "2026-11-26T12:00:00Z" } });
    expect(s.store.inserted).toHaveLength(1);
  });

  it("a Confluence refusal on read is shown as it is (not as gone)", async () => {
    const s = setup({ live: live() });
    const d = { ...s.deps(), call: (async () => ({ status: 403, json: { message: "nope" } })) as ConfluenceRequest };
    expect(await previewPublish(d, IN)).toMatchObject({ ok: false, kind: "forbidden" });
  });
});
