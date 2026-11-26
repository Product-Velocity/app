import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { markdownToStorage, pageBody } from "@pv/domain";
import type { ConfluenceRequest } from "./client";
import { confirmMerge, previewMerge, type MergeDeps } from "./merge";

const SITE = "https://acme.atlassian.net";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const BASE = "# Plan\n\nIntro paragraph.\n\n## Scope\n\nBuild the thing.\n\n## Risks\n\nNone known.\n";

/** A one-page Confluence (v2): the page in storage format, read with its text and written with a version one higher. */
function confluence(storage: string, version: number) {
  const page = { id: "42", title: "Plan", version, storage, puts: 0, failPut: false };
  const call: ConfluenceRequest = async (method, path, body) => {
    const b = (body ?? {}) as { title: string; version: { number: number }; body: { value: string } };
    if (method === "GET" && /^\/api\/v2\/pages\/42/.test(path)) return { status: 200, json: { id: "42", status: "current", title: page.title, spaceId: "9", version: { number: page.version }, body: { storage: { value: page.storage } }, _links: { webui: "/spaces/GTM/pages/42/Plan" } } };
    if (method === "PUT" && path === "/api/v2/pages/42") {
      if (page.failPut) return { status: 500, json: null };
      if (b.version.number !== page.version + 1) return { status: 409, json: { errors: [{ status: 409, title: "Version must be incremented" }] } };
      page.puts += 1; page.version = b.version.number; page.storage = b.body.value; page.title = b.title;
      return { status: 200, json: { id: "42", title: page.title, spaceId: "9", version: { number: page.version }, _links: { webui: "/spaces/GTM/pages/42/Plan" } } };
    }
    return { status: 500, json: null };
  };
  return { call, page };
}

function setup(o: { ours: string; theirs: string; docVersion?: number; baseBody?: string | null; pageVersion?: number }) {
  const c = confluence(markdownToStorage(o.theirs), o.pageVersion ?? 6);
  const saved: { id: string; body: string }[] = [];
  const bindings: unknown[] = [];
  const state = { failDoc: false };
  const deps = (): MergeDeps => ({
    call: c.call, siteUrl: SITE, hash, now: () => "2026-11-26T19:00:00Z",
    doc: { id: "doc-1", itemCode: "R-1", title: "Plan", body: o.ours, version: o.docVersion ?? 4, status: "draft" },
    binding: { id: "bind-1", pageId: "42", pageUrl: `${SITE}/wiki/spaces/GTM/pages/42/Plan`, pageTitle: "Plan", publishedVersion: 2, remoteVersion: 5 },
    baseBody: o.baseBody === undefined ? BASE : o.baseBody,
    terms: [], appLink: "https://app.example.test/portfolio/R-1",
    store: {
      updateDocument: async (id, patch) => { if (state.failDoc) return { ok: false, error: "somebody saved the document in the meantime" }; saved.push({ id, body: patch.body }); return { ok: true, version: (o.docVersion ?? 4) + 1 }; },
      updateBinding: async (id, patch) => { bindings.push({ id, patch }); return { ok: true }; },
    },
  });
  return { c, deps, saved, bindings, state };
}
const ours = BASE.replace("Build the thing.", "Build the thing in two steps.");
const theirsOther = BASE.replace("None known.", "Vendor delay possible.");

describe("preview of a merge", () => {
  it("merges changes in different blocks without a choice, shows what came from where, and writes nothing", async () => {
    const s = setup({ ours, theirs: theirsOther });
    const p = await previewMerge(s.deps());
    expect(p).toMatchObject({ ok: true, conflicts: 0, page: { version: 6 }, documentVersion: 4 });
    expect(p.ok && p.chunks.map((c) => c.kind)).toEqual(["same", "ours", "same", "theirs"]);
    expect(p.ok && p.confirm).toMatch(/^[0-9a-f]{64}$/);
    expect(s.saved).toEqual([]);
    expect(s.c.page.puts).toBe(0);
  });
  it("blocks both sides changed are conflicts to settle", async () => {
    const s = setup({ ours, theirs: BASE.replace("Build the thing.", "Build the thing with Acme.") });
    expect(await previewMerge(s.deps())).toMatchObject({ ok: true, conflicts: 1 });
  });
  it("only one side changed: nothing to merge; the text both started from is gone: it says so; a page that cannot be read shows Confluence's reason", async () => {
    expect(await previewMerge(setup({ ours: BASE, theirs: theirsOther, docVersion: 2 }).deps())).toMatchObject({ ok: false, kind: "nothing_to_merge" });
    expect(await previewMerge(setup({ ours, theirs: BASE, pageVersion: 5 }).deps())).toMatchObject({ ok: false, kind: "nothing_to_merge" });
    expect(await previewMerge(setup({ ours, theirs: theirsOther, baseBody: null }).deps())).toMatchObject({ ok: false, kind: "no_base" });
  });
});

describe("confirm a merge", () => {
  it("saves the merged text as a new document version, then writes the same text to the page, and records both versions", async () => {
    const s = setup({ ours, theirs: theirsOther });
    const p = await previewMerge(s.deps());
    const done = await confirmMerge(s.deps(), { confirm: p.ok ? p.confirm : "" });
    expect(done).toMatchObject({ ok: true, documentVersion: 5, page: { version: 7 } });
    const merged = "# Plan\n\nIntro paragraph.\n\n## Scope\n\nBuild the thing in two steps.\n\n## Risks\n\nVendor delay possible.\n";
    expect(s.saved).toEqual([{ id: "doc-1", body: merged }]);
    expect(s.c.page.storage).toBe(pageBody(merged, { link: "https://app.example.test/portfolio/R-1", code: "R-1" }));
    expect(s.bindings).toEqual([{ id: "bind-1", patch: expect.objectContaining({ publishedVersion: 5, remoteVersion: 7, pageTitle: "Plan", publishedAt: "2026-11-26T19:00:00Z" }) }]);
  });
  it("needs a choice for every conflict, and uses it", async () => {
    const s = setup({ ours, theirs: BASE.replace("Build the thing.", "Build the thing with Acme.") });
    const p = await previewMerge(s.deps());
    const token = p.ok ? p.confirm : "";
    const idx = p.ok ? p.chunks.findIndex((c) => c.kind === "conflict") : -1;
    expect(await confirmMerge(s.deps(), { confirm: token })).toMatchObject({ ok: false, kind: "choose" });
    expect(s.saved).toEqual([]);
    const done = await confirmMerge(s.deps(), { confirm: token, choices: { [idx]: "theirs" } });
    expect(done).toMatchObject({ ok: true });
    expect(s.saved[0]!.body).toContain("Build the thing with Acme.");
    expect(s.saved[0]!.body).not.toContain("two steps");
  });
  it("a confirmation without the token, or after the page changed again, changes nothing", async () => {
    const s = setup({ ours, theirs: theirsOther });
    const p = await previewMerge(s.deps());
    expect(await confirmMerge(s.deps(), { confirm: "nope" })).toMatchObject({ ok: false, kind: "changed" });
    s.c.page.version += 1; s.c.page.storage = markdownToStorage(BASE.replace("Intro paragraph.", "Edited meanwhile."));
    expect(await confirmMerge(s.deps(), { confirm: p.ok ? p.confirm : "" })).toMatchObject({ ok: false, kind: "changed" });
    expect(s.saved).toEqual([]);
    expect(s.c.page.puts).toBe(0);
  });
  it("if somebody saved the document in between, nothing is written to the page", async () => {
    const s = setup({ ours, theirs: theirsOther });
    const p = await previewMerge(s.deps());
    s.state.failDoc = true;
    expect(await confirmMerge(s.deps(), { confirm: p.ok ? p.confirm : "" })).toMatchObject({ ok: false, kind: "not_recorded" });
    expect(s.c.page.puts).toBe(0);
  });
  it("if the page cannot be written after the document was saved, the person is told exactly what stands (the document is ahead, so it shows as to send)", async () => {
    const s = setup({ ours, theirs: theirsOther });
    const p = await previewMerge(s.deps());
    s.c.page.failPut = true;
    const done = await confirmMerge(s.deps(), { confirm: p.ok ? p.confirm : "" });
    expect(done).toMatchObject({ ok: false, kind: "page_not_written", message: expect.stringContaining("The document now holds the merged text (version 5)") });
    expect(s.saved).toHaveLength(1);
    expect(s.bindings).toEqual([]);
  });
});
