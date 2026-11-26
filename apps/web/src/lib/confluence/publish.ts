import { commercialWarnings, pageBody, pageIdFromUrl, planPublish, type SyncDirection, type CommercialTerm, type CommercialWarning, type PublishAction, type RemotePage } from "@pv/domain";
import { createPage, getPage, getSpaceById, getSpaceByKey, updatePage, type ConfluenceFail, type ConfluenceRequest } from "./client";

// Publishing one document to Confluence (issue #693 slice B). Two steps, like Sync: PREVIEW shows exactly what would happen (create or update, the target,
// the warning about commercial text, any conflict) and returns a token; CONFIRM does it only when the person sends back that same token, so what is
// written is what was seen. Claude can prepare a publication but only a person confirms (CLAUDE.md rule 3; the database refuses an assistant, PV035).
// Pure over injected dependencies, so it is tested with a fake Confluence and a fake store.

export type PubDoc = { id: string; itemCode: string; title: string; body: string; version: number; aiDraft: boolean };
export type LivePublication = { id: string; pageId: string; pageUrl: string; spaceKey: string; syncMode: "once" | "sync"; syncDirection?: SyncDirection; publishedVersion: number; remoteVersion: number | null; contentHash: string | null };
export type NewPublication = {
  spaceKey: string; parentPageId: string | null; pageId: string; pageUrl: string; pageTitle: string; syncMode: "once" | "sync"; syncDirection: SyncDirection;
  publishedVersion: number; remoteVersion: number; contentHash: string; unlinkedAt: string | null;
};
export type PublicationPatch = { syncMode?: "once" | "sync"; syncDirection?: SyncDirection; pageTitle?: string; pageUrl?: string; publishedVersion?: number; remoteVersion?: number; contentHash?: string; publishedAt?: string; unlinkedAt?: string | null };
type Saved = { ok: true } | { ok: false; error: string };

export type PublishDeps = {
  call: ConfluenceRequest;
  siteUrl: string | null;
  doc: PubDoc;
  /** The live publication of the document, if it has one. */
  live: LivePublication | null;
  terms: readonly CommercialTerm[];
  /** A https address of the document in Product Velocity, for the link in the banner. */
  appLink: string | null;
  hash: (s: string) => string;
  now: () => string;
  save: { insert: (p: NewPublication) => Promise<Saved>; update: (id: string, patch: PublicationPatch) => Promise<Saved> };
};
export type PublishInput = {
  spaceKey?: string;
  /** The page a new page goes under, chosen in the page tree (its id) or given as an address. */
  parentPageId?: string;
  parentUrl?: string;
  /** Publish onto a page that already exists (its id): the document replaces the whole content of that page. Only when the document has no page of its own yet. */
  existingPageId?: string;
  title?: string; mode: "once" | "sync";
  /** With mode "sync": write only (to_confluence, the default) or both ways (issue #714). A page that is read from Confluence is never written here. */
  direction?: "to_confluence" | "both";
  confirm?: string; overwrite?: boolean;
};

export type Fail = { ok: false; kind: ConfluenceFail["kind"] | "invalid" | "changed" | "not_recorded"; message: string };
export type Preview = {
  ok: true; action: PublishAction; why: string; mode: "once" | "sync"; title: string; spaceKey: string; spaceId: string | null; /** An existing page that Product Velocity did not create will be replaced. */ adopt: boolean;
  parent: { id: string; title: string } | null; page: { id: string; url: string | null; version: number } | null;
  warnings: CommercialWarning[]; notes: string[]; confirm: string;
};
export type Done = { ok: true; action: PublishAction; page: { id: string; url: string | null; version: number } | null; message: string };

const TITLE_MAX = 255;
const invalid = (message: string): Fail => ({ ok: false, kind: "invalid", message });

export async function previewPublish(d: PublishDeps, input: PublishInput): Promise<Preview | Fail> {
  const live = d.live;
  let remote: RemotePage = null;
  let remoteInfo: { id: string; url: string | null; version: number; title: string } | null = null;
  if (live) {
    const got = await getPage(d.call, live.pageId, d.siteUrl);
    if (got.ok) { remote = { id: got.page.id, version: got.page.version, title: got.page.title }; remoteInfo = { id: got.page.id, url: got.page.url ?? live.pageUrl, version: got.page.version, title: got.page.title }; }
    else if (got.kind === "gone") remote = "missing";
    else return got;
  }

  // Publishing onto a page that already exists (the document has no page of its own yet): the page is read, its space looked up, and the document replaces its content
  if (!live && input.existingPageId) {
    if (!/^\d{1,20}$/.test(input.existingPageId)) return invalid("That is not a Confluence page.");
    const got = await getPage(d.call, input.existingPageId, d.siteUrl);
    if (!got.ok) return got;
    if (!got.page.spaceId) return { ok: false, kind: "rejected", message: "Confluence did not say which space the page is in. Nothing was written." };
    const sp = await getSpaceById(d.call, got.page.spaceId);
    if (!sp.ok) return sp;
    const t = (input.title?.trim() || got.page.title || d.doc.title).slice(0, TITLE_MAX);
    const b = pageBody(d.doc.body, { ...(d.appLink ? { link: d.appLink } : {}), code: d.doc.itemCode });
    const notes: string[] = [`This replaces the whole content of the page “${got.page.title}” (version ${got.page.version}), which Product Velocity did not create. Its previous version stays in the page history in Confluence, and anything on it that is not in this document (macros, comments' anchors, attachments' placement) will be gone from the current version.`];
    if (d.doc.aiDraft) notes.push("This document is an AI draft that nobody has accepted yet.");
    const url = got.page.url;
    return {
      ok: true, action: "update", why: `The page “${got.page.title}” (version ${got.page.version}) in space ${sp.space.key} will be replaced with this document.`, mode: input.mode, title: t,
      spaceKey: sp.space.key, spaceId: got.page.spaceId, adopt: true, parent: null, page: { id: got.page.id, url, version: got.page.version },
      warnings: commercialWarnings(d.doc.body, d.terms), notes,
      confirm: d.hash(JSON.stringify([d.doc.id, d.doc.version, "adopt", got.page.id, got.page.version, t, d.hash(`${t}\n${b}`), input.mode])),
    };
  }

  // the title: the person's, else the page's own for an update (a rename made in Confluence is kept), else the document's
  const title = (input.title?.trim() || (remoteInfo?.title ?? "") || d.doc.title).slice(0, TITLE_MAX);
  if (!title) return invalid("Give the page a title.");

  const body = pageBody(d.doc.body, { ...(d.appLink ? { link: d.appLink } : {}), code: d.doc.itemCode });
  const bodyHash = d.hash(`${title}\n${body}`);
  const plan = planPublish({ published: live ? { pageId: live.pageId, publishedVersion: live.publishedVersion, remoteVersion: live.remoteVersion, contentHash: live.contentHash } : null, docVersion: d.doc.version, bodyHash, remote });

  // where a new page goes: the space the person chose, and a parent page they gave as an address (checked, not trusted)
  const creating = plan.action === "create" || plan.action === "gone";
  const spaceKey = creating ? (input.spaceKey?.trim() || live?.spaceKey || "") : (live?.spaceKey ?? "");
  let parent: { id: string; title: string } | null = null;
  let spaceId: string | null = null;
  if (creating) {
    if (!/^[~A-Za-z0-9_-]{1,255}$/.test(spaceKey)) return invalid("Choose the space the page goes in.");
    // Confluence's v2 API creates a page in a space by its id; the key the person chose is looked up (and so checked) here
    const sp = await getSpaceByKey(d.call, spaceKey);
    if (!sp.ok) return sp;
    spaceId = sp.space.id;
    const raw = input.parentUrl?.trim();
    if (input.parentPageId) {
      if (!/^\d{1,20}$/.test(input.parentPageId)) return invalid("That is not a Confluence page.");
      const p = await getPage(d.call, input.parentPageId, d.siteUrl);
      if (!p.ok) return p;
      if (p.page.spaceId && p.page.spaceId !== spaceId) return invalid(`The parent page is in another space than ${spaceKey}. Choose a page in that space, or another space.`);
      parent = { id: p.page.id, title: p.page.title };
    } else if (raw) {
      const id = pageIdFromUrl(raw);
      if (!id) return invalid("That is not the address of a Confluence page. Open the parent page and copy its address (it contains /pages/12345/).");
      if (d.siteUrl) {
        let same = false;
        try { same = new URL(raw).host === new URL(d.siteUrl).host; } catch { same = false; }
        if (!same) return invalid("The parent page is on another Confluence site than the one connected.");
      }
      const p = await getPage(d.call, id, d.siteUrl);
      if (!p.ok) return p;
      if (p.page.spaceId && p.page.spaceId !== spaceId) return invalid(`The parent page is in another space than ${spaceKey}. Choose the space the parent page is in, or another parent.`);
      parent = { id: p.page.id, title: p.page.title };
    }
  }

  const notes: string[] = [];
  if (d.doc.aiDraft) notes.push("This document is an AI draft that nobody has accepted yet. The page will say so only if the text does.");
  if (plan.action === "update" || plan.action === "conflict") notes.push("The page is replaced with the document as it is now. Edits made on the page in Confluence since the last publish would be lost.");
  const warnings = commercialWarnings(d.doc.body, d.terms);
  const confirm = d.hash(JSON.stringify([d.doc.id, d.doc.version, plan.action, spaceKey, parent?.id ?? null, title, bodyHash, live?.pageId ?? null, remoteInfo?.version ?? null, input.mode]));
  return {
    ok: true, action: plan.action, why: plan.why, mode: input.mode, title, spaceKey, spaceId, adopt: false, parent,
    page: remoteInfo ? { id: remoteInfo.id, url: remoteInfo.url, version: remoteInfo.version } : null,
    warnings, notes, confirm,
  };
}

export async function confirmPublish(d: PublishDeps, input: PublishInput): Promise<Done | Fail> {
  const p = await previewPublish(d, input);
  if (!p.ok) return p;
  if (!input.confirm || input.confirm !== p.confirm) return { ok: false, kind: "changed", message: "The document or the page changed since the preview. Nothing was written. Review the preview again." };
  const once = input.mode === "once";
  const live = d.live;
  const direction: SyncDirection = input.direction ?? live?.syncDirection ?? "to_confluence";
  const stamp = d.now();
  const body = pageBody(d.doc.body, { ...(d.appLink ? { link: d.appLink } : {}), code: d.doc.itemCode });
  const contentHash = d.hash(`${p.title}\n${body}`);

  if (p.action === "none") {
    if (live && live.syncMode !== input.mode) {
      const s = await d.save.update(live.id, { syncMode: input.mode, syncDirection: direction, ...(once ? { unlinkedAt: stamp } : {}) });
      if (!s.ok) return { ok: false, kind: "not_recorded", message: s.error };
    }
    return { ok: true, action: "none", page: p.page, message: "The page already holds this version of the document." };
  }
  if (p.action === "conflict" && !input.overwrite) return { ok: false, kind: "conflict", message: "The page was changed in Confluence. Choose Keep Product Velocity to replace it, or cancel. Nothing was written." };

  if (p.adopt && !live && p.page) {
    const r = await updatePage(d.call, { id: p.page.id, currentVersion: p.page.version, title: p.title, body }, d.siteUrl);
    if (!r.ok) return r;
    const url = r.page.url ?? p.page.url;
    if (!url) return { ok: false, kind: "not_recorded", message: `The page was replaced (id ${r.page.id}) but Confluence gave no address for it, so Product Velocity could not record it.` };
    const s = await d.save.insert({ spaceKey: p.spaceKey, parentPageId: null, pageId: r.page.id, pageUrl: url, pageTitle: p.title, syncMode: input.mode, syncDirection: direction, publishedVersion: d.doc.version, remoteVersion: r.page.version, contentHash, unlinkedAt: once ? stamp : null });
    if (!s.ok) return { ok: false, kind: "not_recorded", message: `The page was replaced (${url}) but Product Velocity could not record it: ${s.error}` };
    return { ok: true, action: "update", page: { id: r.page.id, url, version: r.page.version }, message: "The existing page was replaced with the document." };
  }

  if ((p.action === "update" || p.action === "conflict") && live && p.page) {
    const r = await updatePage(d.call, { id: live.pageId, currentVersion: p.page.version, title: p.title, body }, d.siteUrl);
    if (!r.ok) return r;
    const s = await d.save.update(live.id, { syncMode: input.mode, syncDirection: direction, pageTitle: p.title, pageUrl: r.page.url ?? live.pageUrl, publishedVersion: d.doc.version, remoteVersion: r.page.version, contentHash, publishedAt: stamp, unlinkedAt: once ? stamp : null });
    if (!s.ok) return { ok: false, kind: "not_recorded", message: `The page was updated (${r.page.url ?? live.pageUrl}) but Product Velocity could not record it: ${s.error}` };
    return { ok: true, action: p.action, page: { id: r.page.id, url: r.page.url, version: r.page.version }, message: "The page was updated." };
  }

  // create (a new page), or gone (the old page was deleted in Confluence: the old record stays as history and a new page is made)
  const r = await createPage(d.call, { spaceId: p.spaceId ?? "", parentId: p.parent?.id ?? null, title: p.title, body }, d.siteUrl);
  if (!r.ok) return r;
  if (p.action === "gone" && live) await d.save.update(live.id, { unlinkedAt: stamp });
  const url = r.page.url;
  if (!url) return { ok: false, kind: "not_recorded", message: `The page was created (id ${r.page.id}) but Confluence gave no address for it, so Product Velocity could not record it. Find it in the space ${p.spaceKey}.` };
  const s = await d.save.insert({ spaceKey: p.spaceKey, parentPageId: p.parent?.id ?? null, pageId: r.page.id, pageUrl: url, pageTitle: p.title, syncMode: input.mode, syncDirection: direction, publishedVersion: d.doc.version, remoteVersion: r.page.version, contentHash, unlinkedAt: once ? stamp : null });
  if (!s.ok) return { ok: false, kind: "not_recorded", message: `The page was created (${url}) but Product Velocity could not record it: ${s.error}` };
  return { ok: true, action: p.action, page: { id: r.page.id, url, version: r.page.version }, message: "The page was created." };
}
