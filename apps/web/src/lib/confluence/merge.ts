import { applyMerge, commercialWarnings, mergeTexts, MAX_DOC_CHARS, pageBody, type Choice, type CommercialTerm, type CommercialWarning, type MergeChunk } from "@pv/domain";
import { updatePage, type ConfluenceRequest } from "./client";
import { readPageById, type Fail } from "./importer";

// Merging the document and its page when both changed since they were last in step (issue #721). Two steps, like publishing: PREVIEW reads the page, finds the
// text both sides started from (the stored version of the document that was last in step), merges block by block and returns what merged on its own and the
// blocks both sides changed, with a token; CONFIRM does it only with the same token and a choice for every conflict, so what is written is what was seen.
// Confirm saves the merged text as a NEW version of the document (the old text stays as a previous version), then writes it to the page (the old text stays in
// the page history). Both sides end identical. A person confirms; Claude never does (CLAUDE.md rule 3). The page text is data, never instructions.
// Pure over injected dependencies, so it is tested with a fake Confluence and a fake store.

type Saved = { ok: true } | { ok: false; error: string };
export type MergeBinding = { id: string; pageId: string; pageUrl: string; pageTitle: string; publishedVersion: number; remoteVersion: number | null };
export type MergeDeps = {
  call: ConfluenceRequest;
  siteUrl: string | null;
  hash: (s: string) => string;
  now: () => string;
  doc: { id: string; itemCode: string; title: string; body: string; version: number; status: string };
  binding: MergeBinding;
  /** The text of the document at the version the two were last in step (null when that version is not stored). */
  baseBody: string | null;
  terms: readonly CommercialTerm[];
  appLink: string | null;
  store: {
    updateDocument: (id: string, patch: { body: string }) => Promise<{ ok: true; version: number } | { ok: false; error: string }>;
    updateBinding: (id: string, patch: { publishedVersion: number; remoteVersion: number; contentHash: string; pageTitle: string; publishedAt: string }) => Promise<Saved>;
  };
};
export type MergeFail = Fail | { ok: false; kind: "nothing_to_merge" | "no_base" | "too_long" | "choose" | "page_not_written"; message: string };
export type MergePreview = {
  ok: true; chunks: MergeChunk[]; conflicts: number; page: { version: number; title: string; url: string | null }; documentVersion: number;
  warnings: CommercialWarning[]; notes: string[]; confirm: string;
};
export type MergeDone = { ok: true; message: string; documentVersion: number; page: { version: number; url: string | null } };

export async function previewMerge(d: MergeDeps): Promise<MergePreview | MergeFail> {
  const b = d.binding;
  const docChanged = d.doc.version > b.publishedVersion;
  const r = await readPageById(d.call, d.siteUrl, b.pageId);
  if (!r.ok) return r;
  const p = r.page;
  const pageChanged = b.remoteVersion !== null && p.version !== b.remoteVersion;
  if (!docChanged || !pageChanged) return { ok: false, kind: "nothing_to_merge", message: !docChanged && !pageChanged ? "Nothing changed on either side since they were last in step." : "Only one side changed, so there is nothing to merge: update the other side from the Confluence sync window." };
  if (d.baseBody === null) return { ok: false, kind: "no_base", message: "The text the two last agreed on is not stored any more, so they cannot be merged. Choose which side to keep in the Confluence sync window." };
  const m = mergeTexts(d.baseBody, d.doc.body, p.markdown);
  if (!m.ok) return { ok: false, kind: "too_long", message: m.error };
  const all = applyMerge(m.chunks, Object.fromEntries(m.chunks.flatMap((c, i) => (c.kind === "conflict" ? [[i, "both" as Choice]] : []))));
  const notes: string[] = ["The merged text becomes a new version of the document and is written to the page, so both end identical. The text each side had now stays as a previous version of the document and in the page history in Confluence."];
  if (p.lost.length > 0) notes.push(`Not carried over from the page: ${p.lost.join(" ")}`);
  if (d.doc.status === "approved") notes.push("This document is approved. Changing its text sends it back to review.");
  const confirm = d.hash(JSON.stringify([d.doc.id, d.doc.version, b.id, p.version, d.hash(JSON.stringify(m.chunks))]));
  return { ok: true, chunks: m.chunks, conflicts: m.conflicts, page: { version: p.version, title: p.title, url: p.url }, documentVersion: d.doc.version, warnings: all.ok ? commercialWarnings(all.markdown, d.terms) : [], notes, confirm };
}

export async function confirmMerge(d: MergeDeps, input: { confirm?: string; choices?: Record<number, Choice> }): Promise<MergeDone | MergeFail> {
  const pv = await previewMerge(d);
  if (!pv.ok) return pv;
  if (!input.confirm || input.confirm !== pv.confirm) return { ok: false, kind: "changed", message: "The document or the page changed since the preview. Nothing was changed. Review the preview again." };
  const merged = applyMerge(pv.chunks, input.choices ?? {});
  if (!merged.ok) return { ok: false, kind: "choose", message: merged.error };
  if (merged.markdown.length > MAX_DOC_CHARS) return { ok: false, kind: "too_long", message: `The merged text is ${merged.markdown.length.toLocaleString("en")} characters; a document can hold ${MAX_DOC_CHARS.toLocaleString("en")}. Nothing was changed.` };
  // 1. the document first: its previous text stays as a version, so this step is undoable; only if nobody saved it in between
  const saved = await d.store.updateDocument(d.doc.id, { body: merged.markdown });
  if (!saved.ok) return { ok: false, kind: "not_recorded", message: `The document could not be updated: ${saved.error}. Nothing was changed.` };
  // 2. then the page, at the version that was previewed
  const body = pageBody(merged.markdown, { ...(d.appLink ? { link: d.appLink } : {}), code: d.doc.itemCode });
  const title = pv.page.title;
  const w = await updatePage(d.call, { id: d.binding.pageId, currentVersion: pv.page.version, title, body }, d.siteUrl);
  if (!w.ok) return { ok: false, kind: "page_not_written", message: `The document now holds the merged text (version ${saved.version}), but the page could not be updated: ${w.message} Update the page from the Confluence sync window.` };
  const rec = await d.store.updateBinding(d.binding.id, { publishedVersion: saved.version, remoteVersion: w.page.version, contentHash: d.hash(`${title}\n${body}`), pageTitle: title.slice(0, 255), publishedAt: d.now() });
  if (!rec.ok) return { ok: false, kind: "not_recorded", message: `The document and the page were updated, but the link could not record it: ${rec.error}. Open the Confluence sync window to check.` };
  return { ok: true, message: `Merged: the document is at version ${saved.version} and the page at version ${w.page.version}, both with the same text.`, documentVersion: saved.version, page: { version: w.page.version, url: w.page.url } };
}
