import { DOC_KINDS, MAX_DOCS_PER_ITEM, MAX_DOC_CHARS, MAX_DOC_TITLE, pageIdFromUrl, storageToMarkdown, type DocKind } from "@pv/domain";
import { getPageWithText, getSpaceById, type ConfluenceFail, type ConfluenceRequest } from "./client";

// Reading a Confluence page into Product Velocity (issue #693 slice A2). A written document whose text comes from a page: the page is the source and
// Product Velocity never writes back to it. Two steps, like publishing: PREVIEW shows the converted text and what could not be carried over and returns a
// token; CONFIRM does it only when the same token comes back, so what is stored is what was seen. "Once" copies the text and lets go of the page; "keep in
// sync" lets a person check the page for a newer version and update the document from it (the old text stays as a previous version). Pure over injected
// dependencies, so it is tested with a fake Confluence and a fake store. The text of a page is data, never instructions (CLAUDE.md rule 4).

export type Fail = { ok: false; kind: ConfluenceFail["kind"] | "invalid" | "changed" | "too_long" | "not_recorded" | "edited_here"; message: string };
type Saved = { ok: true } | { ok: false; error: string };

export type ReadPage = { pageId: string; title: string; version: number; url: string | null; spaceId: string | null; markdown: string; lost: string[]; characters: number };

/** One page as Markdown. `pageUrl` must be an address on the connected site; a short link or another site is refused. */
export async function readPageByUrl(call: ConfluenceRequest, siteUrl: string | null, pageUrl: string): Promise<{ ok: true; page: ReadPage } | Fail> {
  const id = pageIdFromUrl(pageUrl);
  if (!id) return { ok: false, kind: "invalid", message: "That is not the address of a Confluence page. Open the page and copy its address (it contains /pages/12345/)." };
  if (siteUrl) {
    let same = false;
    try { same = new URL(pageUrl.trim()).host === new URL(siteUrl).host; } catch { same = false; }
    if (!same) return { ok: false, kind: "invalid", message: "That page is on another Confluence site than the one connected to this workspace." };
  }
  return readPageById(call, siteUrl, id);
}

export async function readPageById(call: ConfluenceRequest, siteUrl: string | null, pageId: string): Promise<{ ok: true; page: ReadPage } | Fail> {
  const got = await getPageWithText(call, pageId, siteUrl);
  if (!got.ok) return got;
  const c = storageToMarkdown(got.page.storage);
  return { ok: true, page: { pageId: got.page.id, title: got.page.title, version: got.page.version, url: got.page.url, spaceId: got.page.spaceId, markdown: c.markdown, lost: c.lost, characters: c.markdown.length } };
}

const EXCERPT = 2000;

// ---------------------------------------------------------------------------------------------------------------------------------
// Import: a new document from a page
// ---------------------------------------------------------------------------------------------------------------------------------
export type NewExternalBinding = {
  spaceKey: string; pageId: string; pageUrl: string; pageTitle: string; syncMode: "once" | "sync";
  publishedVersion: number; remoteVersion: number; contentHash: string; unlinkedAt: string | null;
};
export type ImportDeps = {
  call: ConfluenceRequest;
  siteUrl: string | null;
  /** How many documents the initiative already has (the limit is per initiative). */
  documentCount: number;
  hash: (s: string) => string;
  now: () => string;
  store: {
    createDocument: (d: { kind: DocKind; title: string; body: string }) => Promise<{ ok: true; id: string; version: number } | { ok: false; error: string }>;
    insertBinding: (documentId: string, b: NewExternalBinding) => Promise<Saved>;
  };
};
export type ImportInput = { pageUrl: string; kind?: string; title?: string; mode: "once" | "sync"; confirm?: string };
export type ImportPreview = {
  ok: true; title: string; kind: DocKind; mode: "once" | "sync"; page: { id: string; url: string | null; version: number; spaceKey: string };
  excerpt: string; truncated: boolean; characters: number; lost: string[]; notes: string[]; confirm: string;
};
export type ImportDone = { ok: true; documentId: string; message: string; page: { url: string | null; version: number } };

export async function previewImport(d: ImportDeps, input: ImportInput): Promise<ImportPreview | Fail> {
  const kind = (input.kind ?? "other") as DocKind;
  if (!(DOC_KINDS as readonly string[]).includes(kind)) return { ok: false, kind: "invalid", message: "Choose what kind of document this is." };
  if (d.documentCount >= MAX_DOCS_PER_ITEM) return { ok: false, kind: "invalid", message: `An initiative can hold at most ${MAX_DOCS_PER_ITEM} documents.` };
  const r = await readPageByUrl(d.call, d.siteUrl, input.pageUrl);
  if (!r.ok) return r;
  const p = r.page;
  if (p.characters === 0) return { ok: false, kind: "invalid", message: "The page has no text to copy." };
  if (p.characters > MAX_DOC_CHARS) return { ok: false, kind: "too_long", message: `The page is ${p.characters.toLocaleString("en")} characters as text; a document can hold ${MAX_DOC_CHARS.toLocaleString("en")}. Nothing was copied.` };
  if (!p.spaceId) return { ok: false, kind: "rejected", message: "Confluence did not say which space the page is in. Nothing was copied." };
  const sp = await getSpaceById(d.call, p.spaceId);
  if (!sp.ok) return sp;
  const title = (input.title?.trim() || p.title || "Confluence page").slice(0, MAX_DOC_TITLE);
  const notes = [
    "Product Velocity reads this page with your workspace's Atlassian sign-in, so it can read pages you may not see in Confluence. Check that the text may be kept here.",
    ...(input.mode === "once" ? ["Once: the text is copied now and the link to the page ends."] : ["Keep in sync: the page stays the source; you check it for changes and update the document from it. Product Velocity never writes to the page."]),
  ];
  const confirm = d.hash(JSON.stringify([p.pageId, p.version, kind, title, input.mode, d.hash(p.markdown)]));
  return { ok: true, title, kind, mode: input.mode, page: { id: p.pageId, url: p.url, version: p.version, spaceKey: sp.space.key }, excerpt: p.markdown.slice(0, EXCERPT), truncated: p.markdown.length > EXCERPT, characters: p.characters, lost: p.lost, notes, confirm };
}

export async function confirmImport(d: ImportDeps, input: ImportInput): Promise<ImportDone | Fail> {
  const pv = await previewImport(d, input);
  if (!pv.ok) return pv;
  if (!input.confirm || input.confirm !== pv.confirm) return { ok: false, kind: "changed", message: "The page changed since the preview. Nothing was copied. Review the preview again." };
  const read = await readPageByUrl(d.call, d.siteUrl, input.pageUrl);
  if (!read.ok) return read;
  const page = read.page;
  const made = await d.store.createDocument({ kind: pv.kind, title: pv.title, body: page.markdown });
  if (!made.ok) return { ok: false, kind: "not_recorded", message: `The document could not be created: ${made.error}.` };
  const url = page.url ?? pv.page.url;
  if (!url) return { ok: false, kind: "not_recorded", message: "The text was copied into a new document, but Confluence gave no address for the page, so the link was not recorded." };
  const saved = await d.store.insertBinding(made.id, {
    spaceKey: pv.page.spaceKey, pageId: page.pageId, pageUrl: url, pageTitle: page.title.slice(0, 255), syncMode: input.mode,
    publishedVersion: made.version, remoteVersion: page.version, contentHash: d.hash(page.markdown), unlinkedAt: input.mode === "once" ? d.now() : null,
  });
  if (!saved.ok) return { ok: false, kind: "not_recorded", message: `The text was copied into a new document, but the link to the page could not be recorded: ${saved.error}.` };
  return { ok: true, documentId: made.id, message: input.mode === "once" ? "The text was copied into a new document." : "The text was copied into a new document, which is kept from the page.", page: { url, version: page.version } };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Refresh: a newer version of the page becomes a new version of the document
// ---------------------------------------------------------------------------------------------------------------------------------
export type ExternalBinding = { id: string; pageId: string; pageUrl: string; pageTitle: string; syncMode: "once" | "sync"; publishedVersion: number; remoteVersion: number | null; contentHash: string | null };
export type RefreshDeps = {
  call: ConfluenceRequest;
  siteUrl: string | null;
  hash: (s: string) => string;
  now: () => string;
  doc: { id: string; title: string; body: string; version: number; status: string };
  binding: ExternalBinding;
  store: {
    updateDocument: (id: string, patch: { title: string; body: string }) => Promise<{ ok: true; version: number } | { ok: false; error: string }>;
    updateBinding: (id: string, patch: { publishedVersion?: number; remoteVersion?: number; contentHash?: string; pageTitle?: string; unlinkedAt?: string | null }) => Promise<Saved>;
  };
};
export type RefreshInput = { confirm?: string; overwrite?: boolean };
export type RefreshAction = "unchanged" | "update" | "gone";
export type RefreshPreview = {
  ok: true; action: RefreshAction; why: string; localEdits: boolean; page: { version: number; title: string; url: string | null } | null;
  excerpt: string; truncated: boolean; characters: number; lost: string[]; notes: string[]; confirm: string;
};
export type RefreshDone = { ok: true; action: RefreshAction; message: string; version: number | null };

export async function previewRefresh(d: RefreshDeps): Promise<RefreshPreview | Fail> {
  const r = await readPageById(d.call, d.siteUrl, d.binding.pageId);
  const localEdits = d.hash(d.doc.body) !== d.binding.contentHash;
  if (!r.ok) {
    if (r.kind === "gone") return { ok: true, action: "gone", why: "The page was deleted in Confluence, or the sign-in can no longer see it. The document keeps its text.", localEdits, page: null, excerpt: "", truncated: false, characters: 0, lost: [], notes: [], confirm: d.hash(JSON.stringify([d.doc.id, d.binding.id, "gone"])) };
    return r;
  }
  const p = r.page;
  if (p.characters > MAX_DOC_CHARS) return { ok: false, kind: "too_long", message: `The page is now ${p.characters.toLocaleString("en")} characters as text; a document can hold ${MAX_DOC_CHARS.toLocaleString("en")}. Nothing was changed.` };
  const same = d.binding.remoteVersion !== null && p.version === d.binding.remoteVersion;
  const notes: string[] = [];
  if (localEdits && !same) notes.push(`The document was edited here since it was last updated from the page. Updating replaces that text; it is kept as version ${d.doc.version} of the document.`);
  if (d.doc.status === "approved" && !same) notes.push("This document is approved. Changing its text sends it back to review.");
  const confirm = d.hash(JSON.stringify([d.doc.id, d.doc.version, d.binding.id, p.version, d.hash(p.markdown), localEdits]));
  return {
    ok: true, action: same ? "unchanged" : "update",
    why: same ? "The page has not changed since the document was last updated from it." : `The page is at version ${p.version}; the document was last updated from version ${d.binding.remoteVersion ?? "?"}.`,
    localEdits, page: { version: p.version, title: p.title, url: p.url }, excerpt: same ? "" : p.markdown.slice(0, EXCERPT), truncated: !same && p.markdown.length > EXCERPT, characters: p.characters, lost: same ? [] : p.lost, notes, confirm,
  };
}

export async function confirmRefresh(d: RefreshDeps, input: RefreshInput): Promise<RefreshDone | Fail> {
  const pv = await previewRefresh(d);
  if (!pv.ok) return pv;
  if (!input.confirm || input.confirm !== pv.confirm) return { ok: false, kind: "changed", message: "The page or the document changed since the preview. Nothing was changed. Review the preview again." };
  if (pv.action === "unchanged") return { ok: true, action: "unchanged", message: "Nothing to update: the page has not changed.", version: d.doc.version };
  if (pv.action === "gone") {
    const s = await d.store.updateBinding(d.binding.id, { unlinkedAt: d.now() });
    return s.ok ? { ok: true, action: "gone", message: "The link to the deleted page was ended. The document keeps its text.", version: d.doc.version } : { ok: false, kind: "not_recorded", message: s.error };
  }
  if (pv.localEdits && !input.overwrite) return { ok: false, kind: "edited_here", message: "The document was edited here since it was last updated from the page. Choose Replace with the Confluence version to update it (your text is kept as a previous version), or cancel. Nothing was changed." };
  const read = await readPageById(d.call, d.siteUrl, d.binding.pageId);
  if (!read.ok) return read;
  const page = read.page;
  const title = (page.title !== d.binding.pageTitle ? page.title : d.doc.title).slice(0, MAX_DOC_TITLE) || d.doc.title;
  const updated = await d.store.updateDocument(d.doc.id, { title, body: page.markdown });
  if (!updated.ok) return { ok: false, kind: "not_recorded", message: `The document could not be updated: ${updated.error}.` };
  const saved = await d.store.updateBinding(d.binding.id, { publishedVersion: updated.version, remoteVersion: page.version, contentHash: d.hash(page.markdown), pageTitle: page.title.slice(0, 255) });
  if (!saved.ok) return { ok: false, kind: "not_recorded", message: `The document was updated, but the link could not record it: ${saved.error}.` };
  return { ok: true, action: "update", message: `The document was updated from page version ${page.version}.`, version: updated.version };
}
