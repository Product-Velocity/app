import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { docKindLabel, SYNC_DIRECTIONS, type CommercialTerm, type SyncDirection } from "@pv/domain";
import { documentSyncState } from "@/lib/confluence/state";
import { listSpaces, type ConfluenceRequest } from "@/lib/confluence/client";
import { confirmPublish, previewPublish, type LivePublication, type PublicationPatch, type PublishDeps, type PublishInput } from "@/lib/confluence/publish";
import { loadDocForPublish as load } from "@/lib/confluence/doc-access";
import { confirmRefresh, previewRefresh, type ExternalBinding, type RefreshDeps } from "@/lib/confluence/importer";
import { json, saveError, statusFor } from "@/lib/confluence/http";
import { confluenceRequest, confluenceSiteFor, type ConfluenceSite } from "@/lib/confluence/server";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

// Publishing one document to Confluence (issue #693 slice B). The person's own client does every read and write, so the role check, row-level security
// and the audit log apply. Only a signed-in person with the Creator or Admin role (not a service account, not platform staff, not an assistant) can
// publish: Claude can prepare a publication, a person confirms it (CLAUDE.md rule 3; the database refuses an assistant as well, PV035).
// The text of the document is read here, sent to the customer's own Confluence after a preview, and never put in a response beyond the person's own
// browser, in a log or in a tracker payload.

type Ctx = { params: Promise<{ id: string }> };
type Db = Awaited<ReturnType<typeof createClient>>;

const PUB_COLS = "id, source, sync_direction, page_id, page_url, page_title, space_key, site_id, sync_mode, published_version, remote_version, content_hash, published_at, unlinked_at, parent_page_id";
type PubRow = { id: string; source: "pv" | "external"; sync_direction: SyncDirection; page_id: string; page_url: string; page_title: string; space_key: string; site_id: string; sync_mode: "once" | "sync"; published_version: number; remote_version: number | null; content_hash: string | null; published_at: string; unlinked_at: string | null; parent_page_id: string | null };
const toLive = (r: PubRow): LivePublication => ({ id: r.id, pageId: r.page_id, pageUrl: r.page_url, spaceKey: r.space_key, syncMode: r.sync_mode, syncDirection: r.sync_direction, publishedVersion: r.published_version, remoteVersion: r.remote_version, contentHash: r.content_hash });
const REQ_COLS = "space_key, parent_url, page_title, sync_mode, note, ai_model, created_via";
type ReqRow = { space_key: string | null; parent_url: string | null; page_title: string | null; sync_mode: "once" | "sync"; note: string | null; ai_model: string | null; created_via: string };
const toRequest = (r: ReqRow) => ({ mode: r.sync_mode, spaceKey: r.space_key, parentUrl: r.parent_url, title: r.page_title, note: r.note, requestedBy: r.created_via === "MCP" ? "Claude" : "a person", aiModel: r.ai_model });
const toView = (r: PubRow, docVersion: number) => ({ id: r.id, source: r.source, direction: r.sync_direction, pageUrl: r.page_url, pageTitle: r.page_title, spaceKey: r.space_key, syncMode: r.sync_mode, publishedVersion: r.published_version, publishedAt: r.published_at, linked: r.unlinked_at === null, outOfDate: r.sync_direction !== "from_confluence" && r.unlinked_at === null && r.published_version < docVersion });


async function lastPublication(supabase: Db, docId: string): Promise<PubRow | null> {
  const { data } = await supabase.from("item_document_pages").select(PUB_COLS).eq("document_id", docId).order("created_at", { ascending: false }).limit(1);
  return ((data ?? [])[0] as PubRow | undefined) ?? null;
}

/** What the item holds that is commercial: the key-result metric and the value, so the preview can warn when the document repeats them. */
async function commercialTerms(supabase: Db, itemId: string): Promise<CommercialTerm[]> {
  const { data } = await supabase.from("items").select("kr_metric, value_12m").eq("id", itemId).maybeSingle();
  const row = data as { kr_metric: string | null; value_12m: number | string | null } | null;
  const terms: CommercialTerm[] = [];
  if (row?.kr_metric) terms.push({ kind: "key_result", label: "The key result of this initiative", text: row.kr_metric });
  const v = Number(row?.value_12m);
  if (Number.isFinite(v) && v >= 1000) {
    const whole = Math.round(v);
    for (const text of new Set([String(whole), whole.toLocaleString("en-US"), whole.toLocaleString("de-DE")])) terms.push({ kind: "value", label: "The business value of this initiative", text });
  }
  return terms;
}

const patchToColumns = (p: PublicationPatch): Record<string, unknown> => ({
  ...(p.syncMode !== undefined ? { sync_mode: p.syncMode } : {}), ...(p.syncDirection !== undefined ? { sync_direction: p.syncDirection } : {}), ...(p.pageTitle !== undefined ? { page_title: p.pageTitle } : {}), ...(p.pageUrl !== undefined ? { page_url: p.pageUrl } : {}),
  ...(p.publishedVersion !== undefined ? { published_version: p.publishedVersion } : {}), ...(p.remoteVersion !== undefined ? { remote_version: p.remoteVersion } : {}),
  ...(p.contentHash !== undefined ? { content_hash: p.contentHash } : {}), ...(p.publishedAt !== undefined ? { published_at: p.publishedAt } : {}), ...(p.unlinkedAt !== undefined ? { unlinked_at: p.unlinkedAt } : {}),
});

/** Where the document stands: the site that can be published to (if any), the last publication and who may publish. `?spaces=1` also lists the spaces. */
export async function GET(request: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const c = await load(id);
  if (!c.ok) return c.error;
  const site = await confluenceSiteFor(c.doc.tenant_id);
  const last = await lastPublication(c.supabase, id);
  const { data: req } = await c.supabase.from("item_document_publish_requests").select(REQ_COLS).eq("document_id", id).maybeSingle();
  // the page title offered by default: what kind of document, which roadmap item, which initiative ("Go-to-market - R-12 - Publisher ticketing")
  const { data: it } = await c.supabase.from("items").select("item_code, initiative_name").eq("id", c.doc.item_id).maybeSingle();
  const itRow = it as { item_code?: string; initiative_name?: string } | null;
  const suggestedTitle = [docKindLabel(c.doc.kind), itRow?.item_code, itRow?.initiative_name].filter(Boolean).join(" - ").slice(0, 255) || c.doc.title;
  const base = { suggestedTitle, request: req ? toRequest(req as ReqRow) : null, canPublish: c.canPublish, available: Boolean(site), missingScopes: site?.missingScopes ?? [], site: site ? { name: site.siteName, url: site.siteUrl } : null, last: last ? toView(last, c.doc.version) : null };
  if (!site || new URL(request.url).searchParams.get("spaces") !== "1") return json(base);
  if (!c.canPublish) return json({ ...base, spaces: [] });
  const r = await listSpaces(confluenceRequest(site.connectionId, site.siteId));
  // the dialog still opens when the list cannot be read (the person is told why); it is not an error of this request
  return r.ok ? json({ ...base, spaces: r.spaces }) : json({ ...base, spaces: [], error: r.message, kind: r.kind });
}

type Body = { action?: string; direction?: string; spaceKey?: string; parentUrl?: string; parentPageId?: string; existingPageId?: string; title?: string; mode?: string; confirm?: string; overwrite?: boolean };

/** `preview` shows what a publish would do and writes nothing; `publish` does it, only with the token of that preview; `unlink` ends the link and leaves the page. */
export async function POST(request: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const c = await load(id);
  if (!c.ok) return c.error;
  if (!c.canPublish) return json({ error: "Only a Creator or Admin can publish a document to Confluence.", kind: "forbidden" }, 403);
  const b = (await request.json().catch(() => null)) as Body | null;
  if (!b || !["preview", "publish", "unlink", "dismiss", "refresh-preview", "refresh", "sync-state", "set-direction"].includes(String(b.action))) return json({ error: "Say what to do: preview, publish, unlink, dismiss, sync-state, set-direction, refresh-preview or refresh." }, 400);

  // "dismiss" removes the open request to publish (made by a person or by Claude); it touches no page
  if (b.action === "dismiss") {
    const { error } = await c.supabase.from("item_document_publish_requests").delete().eq("document_id", id);
    return error ? json({ error: `The request could not be removed: ${saveError(error)}.` }, 403) : json({ ok: true });
  }

  if (b.action === "unlink") {
    const last = await lastPublication(c.supabase, id);
    if (!last || last.unlinked_at) return json({ error: "This document is not linked to a page." }, 404);
    const { error } = await c.supabase.from("item_document_pages").update({ unlinked_at: new Date().toISOString() }).eq("id", last.id);
    return error ? json({ error: `The link could not be ended: ${saveError(error)}.` }, 403) : json({ ok: true });
  }

  const site: ConfluenceSite | null = await confluenceSiteFor(c.doc.tenant_id);
  if (!site) return json({ error: "Confluence is not connected for this workspace. An admin can connect it in Settings, Integrations, Confluence.", kind: "not_connected" }, 409);
  const hash = (x: string) => createHash("sha256").update(x).digest("hex");
  const call: ConfluenceRequest = confluenceRequest(site.connectionId, site.siteId);

  // Which way the link keeps the document up to date (issue #714 slice 2). Changing it is a setting of a person; nothing is read or written on the page.
  if (b.action === "set-direction") {
    const cur = await lastPublication(c.supabase, id);
    if (!cur || cur.unlinked_at) return json({ error: "This document is not linked to a page.", kind: "invalid" }, 404);
    if (!(SYNC_DIRECTIONS as readonly string[]).includes(String(b.direction))) return json({ error: "Choose a direction: from Confluence, to Confluence or both ways.", kind: "invalid" }, 400);
    const { error } = await c.supabase.from("item_document_pages").update({ sync_direction: b.direction, ...(cur.sync_mode === "once" ? { sync_mode: "sync" } : {}) }).eq("id", cur.id);
    if (error) return json({ error: `The direction could not be changed: ${saveError(error)}.` }, 403);
    const now = await lastPublication(c.supabase, id);
    return json({ ok: true, last: now ? toView(now, c.doc.version) : null });
  }
  // What the link needs now: nothing, to send, to receive, or a conflict (both sides changed). Reads only the page's version number.
  if (b.action === "sync-state") {
    const cur = await lastPublication(c.supabase, id);
    if (!cur || cur.unlinked_at) return json({ error: "This document is not linked to a page.", kind: "invalid" }, 404);
    const r = await documentSyncState(confluenceRequest(site.connectionId, site.siteId), site.siteUrl, { direction: cur.sync_direction, pageId: cur.page_id, publishedVersion: cur.published_version, remoteVersion: cur.remote_version }, c.doc.version);
    return json({ direction: cur.sync_direction, state: r.state, pageVersion: r.pageVersion, documentVersion: c.doc.version, publishedVersion: cur.published_version });
  }

  // A document kept from a page, or kept both ways (issue #693 slice A2, #714): these two actions read the page again; a newer version of it becomes a new version of
  // the document, after a preview a person confirms (the text stays as a previous version). A link that only writes to the page never reads it back.
  if (b.action === "refresh-preview" || b.action === "refresh") {
    const ext = await lastPublication(c.supabase, id);
    if (!ext || ext.sync_direction === "to_confluence" || ext.unlinked_at) return json({ error: "This document is not kept from a Confluence page.", kind: "invalid" }, 404);
    const binding: ExternalBinding = { id: ext.id, pageId: ext.page_id, pageUrl: ext.page_url, pageTitle: ext.page_title, syncMode: ext.sync_mode, publishedVersion: ext.published_version, remoteVersion: ext.remote_version, contentHash: ext.content_hash };
    const rdeps: RefreshDeps = {
      call, siteUrl: site.siteUrl, hash, now: () => new Date().toISOString(),
      // two-way: the document was edited here when it is a newer version than the one the two last agreed on (a page we wrote has a different hash from the text)
      ...(ext.sync_direction === "both" ? { localEdits: c.doc.version > ext.published_version } : {}),
      doc: { id: c.doc.id, title: c.doc.title, body: c.doc.body, version: c.doc.version, status: c.doc.status }, binding,
      store: {
        updateDocument: async (docId, patch) => {
          // only if nobody saved the document in between (the version is the one the preview was made from)
          const { data, error } = await c.supabase.from("item_documents").update({ title: patch.title, body: patch.body }).eq("id", docId).eq("version", c.doc.version).select("version");
          if (error) return { ok: false, error: saveError(error) };
          const v = (data as { version: number }[] | null)?.[0]?.version;
          return v ? { ok: true, version: v } : { ok: false, error: "somebody saved the document in the meantime" };
        },
        updateBinding: async (rowId, patch) => {
          const { error } = await c.supabase.from("item_document_pages").update(patchToColumns({ ...patch, ...(patch.unlinkedAt !== undefined ? { unlinkedAt: patch.unlinkedAt } : {}), ...(patch.publishedVersion !== undefined ? { publishedAt: new Date().toISOString() } : {}) })).eq("id", rowId);
          return error ? { ok: false, error: saveError(error) } : { ok: true };
        },
      },
    };
    if (b.action === "refresh-preview") {
      const p = await previewRefresh(rdeps);
      return p.ok ? json({ refresh: p }) : json({ error: p.message, kind: p.kind }, statusFor(p.kind));
    }
    const done = await confirmRefresh(rdeps, { ...(b.confirm ? { confirm: String(b.confirm) } : {}), ...(b.overwrite === true ? { overwrite: true } : {}) });
    return done.ok ? json({ done }) : json({ error: done.message, kind: done.kind }, statusFor(done.kind));
  }

  if (b.mode !== "once" && b.mode !== "sync") return json({ error: "Choose once or keep in sync." }, 400);

  const { data: item } = await c.supabase.from("items").select("item_code").eq("id", c.doc.item_id).maybeSingle();
  const code = String((item as { item_code?: string } | null)?.item_code ?? "");
  const app = await siteUrl();
  const last = await lastPublication(c.supabase, id);
  if (last?.sync_direction === "from_confluence" && !last.unlinked_at) return json({ error: "This document is kept from a Confluence page. Product Velocity does not write to a page it reads from. Change the direction to both ways first.", kind: "invalid" }, 409);
  const deps: PublishDeps = {
    call, siteUrl: site.siteUrl,
    doc: { id: c.doc.id, itemCode: code, title: c.doc.title, body: c.doc.body, version: c.doc.version, aiDraft: c.doc.ai_draft },
    live: last && !last.unlinked_at ? toLive(last) : null,
    terms: await commercialTerms(c.supabase, c.doc.item_id),
    appLink: /^https:\/\//.test(app) && code ? `${app}/portfolio/${encodeURIComponent(code)}` : null,
    hash,
    now: () => new Date().toISOString(),
    save: {
      insert: async (p) => {
        const { error } = await c.supabase.from("item_document_pages").insert({
          tenant_id: c.doc.tenant_id, item_id: c.doc.item_id, document_id: c.doc.id, connection_id: site.connectionId, site_id: site.siteId, site_url: site.siteUrl,
          space_key: p.spaceKey, parent_page_id: p.parentPageId, page_id: p.pageId, page_url: p.pageUrl, page_title: p.pageTitle, source: "pv", sync_mode: p.syncMode, sync_direction: p.syncDirection,
          published_version: p.publishedVersion, remote_version: p.remoteVersion, content_hash: p.contentHash, unlinked_at: p.unlinkedAt,
        });
        return error ? { ok: false, error: saveError(error) } : { ok: true };
      },
      update: async (rowId, patch) => {
        const { error } = await c.supabase.from("item_document_pages").update(patchToColumns(patch)).eq("id", rowId);
        return error ? { ok: false, error: saveError(error) } : { ok: true };
      },
    },
  };
  const input: PublishInput = { mode: b.mode, ...(b.spaceKey ? { spaceKey: String(b.spaceKey) } : {}), ...(b.parentUrl ? { parentUrl: String(b.parentUrl) } : {}), ...(b.parentPageId ? { parentPageId: String(b.parentPageId) } : {}), ...(b.existingPageId ? { existingPageId: String(b.existingPageId) } : {}), ...(b.title ? { title: String(b.title) } : {}), ...(b.direction === "both" || b.direction === "to_confluence" ? { direction: b.direction } : {}), ...(b.confirm ? { confirm: String(b.confirm) } : {}), ...(b.overwrite === true ? { overwrite: true } : {}) };

  if (b.action === "preview") {
    const p = await previewPublish(deps, input);
    return p.ok ? json({ preview: p }) : json({ error: p.message, kind: p.kind }, statusFor(p.kind));
  }
  const done = await confirmPublish(deps, input);
  if (!done.ok) return json({ error: done.message, kind: done.kind }, statusFor(done.kind));
  // the request (if any) is answered by a confirmed publish, so it no longer waits
  await c.supabase.from("item_document_publish_requests").delete().eq("document_id", id);
  const now = await lastPublication(c.supabase, id);
  return json({ done, last: now ? toView(now, c.doc.version) : null });
}
