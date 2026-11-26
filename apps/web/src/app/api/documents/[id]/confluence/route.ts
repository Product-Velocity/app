import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { docKindLabel, type CommercialTerm } from "@pv/domain";
import { listSpaces, type ConfluenceRequest } from "@/lib/confluence/client";
import { confirmPublish, previewPublish, type LivePublication, type PublicationPatch, type PublishDeps, type PublishInput } from "@/lib/confluence/publish";
import { loadDocForPublish as load } from "@/lib/confluence/doc-access";
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

const PUB_COLS = "id, page_id, page_url, page_title, space_key, site_id, sync_mode, published_version, remote_version, content_hash, published_at, unlinked_at, parent_page_id";
type PubRow = { id: string; page_id: string; page_url: string; page_title: string; space_key: string; site_id: string; sync_mode: "once" | "sync"; published_version: number; remote_version: number | null; content_hash: string | null; published_at: string; unlinked_at: string | null; parent_page_id: string | null };
const toLive = (r: PubRow): LivePublication => ({ id: r.id, pageId: r.page_id, pageUrl: r.page_url, spaceKey: r.space_key, syncMode: r.sync_mode, publishedVersion: r.published_version, remoteVersion: r.remote_version, contentHash: r.content_hash });
const REQ_COLS = "space_key, parent_url, page_title, sync_mode, note, ai_model, created_via";
type ReqRow = { space_key: string | null; parent_url: string | null; page_title: string | null; sync_mode: "once" | "sync"; note: string | null; ai_model: string | null; created_via: string };
const toRequest = (r: ReqRow) => ({ mode: r.sync_mode, spaceKey: r.space_key, parentUrl: r.parent_url, title: r.page_title, note: r.note, requestedBy: r.created_via === "MCP" ? "Claude" : "a person", aiModel: r.ai_model });
const toView = (r: PubRow, docVersion: number) => ({ id: r.id, pageUrl: r.page_url, pageTitle: r.page_title, spaceKey: r.space_key, syncMode: r.sync_mode, publishedVersion: r.published_version, publishedAt: r.published_at, linked: r.unlinked_at === null, outOfDate: r.unlinked_at === null && r.published_version < docVersion });


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
  ...(p.syncMode !== undefined ? { sync_mode: p.syncMode } : {}), ...(p.pageTitle !== undefined ? { page_title: p.pageTitle } : {}), ...(p.pageUrl !== undefined ? { page_url: p.pageUrl } : {}),
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

type Body = { action?: string; spaceKey?: string; parentUrl?: string; parentPageId?: string; existingPageId?: string; title?: string; mode?: string; confirm?: string; overwrite?: boolean };

/** `preview` shows what a publish would do and writes nothing; `publish` does it, only with the token of that preview; `unlink` ends the link and leaves the page. */
export async function POST(request: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const c = await load(id);
  if (!c.ok) return c.error;
  if (!c.canPublish) return json({ error: "Only a Creator or Admin can publish a document to Confluence.", kind: "forbidden" }, 403);
  const b = (await request.json().catch(() => null)) as Body | null;
  if (!b || !["preview", "publish", "unlink", "dismiss"].includes(String(b.action))) return json({ error: "Say what to do: preview, publish, unlink or dismiss." }, 400);

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
  if (b.mode !== "once" && b.mode !== "sync") return json({ error: "Choose once or keep in sync." }, 400);

  const { data: item } = await c.supabase.from("items").select("item_code").eq("id", c.doc.item_id).maybeSingle();
  const code = String((item as { item_code?: string } | null)?.item_code ?? "");
  const app = await siteUrl();
  const last = await lastPublication(c.supabase, id);
  const call: ConfluenceRequest = confluenceRequest(site.connectionId, site.siteId);
  const deps: PublishDeps = {
    call, siteUrl: site.siteUrl,
    doc: { id: c.doc.id, itemCode: code, title: c.doc.title, body: c.doc.body, version: c.doc.version, aiDraft: c.doc.ai_draft },
    live: last && !last.unlinked_at ? toLive(last) : null,
    terms: await commercialTerms(c.supabase, c.doc.item_id),
    appLink: /^https:\/\//.test(app) && code ? `${app}/portfolio/${encodeURIComponent(code)}` : null,
    hash: (s) => createHash("sha256").update(s).digest("hex"),
    now: () => new Date().toISOString(),
    save: {
      insert: async (p) => {
        const { error } = await c.supabase.from("item_document_pages").insert({
          tenant_id: c.doc.tenant_id, item_id: c.doc.item_id, document_id: c.doc.id, connection_id: site.connectionId, site_id: site.siteId, site_url: site.siteUrl,
          space_key: p.spaceKey, parent_page_id: p.parentPageId, page_id: p.pageId, page_url: p.pageUrl, page_title: p.pageTitle, source: "pv", sync_mode: p.syncMode,
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
  const input: PublishInput = { mode: b.mode, ...(b.spaceKey ? { spaceKey: String(b.spaceKey) } : {}), ...(b.parentUrl ? { parentUrl: String(b.parentUrl) } : {}), ...(b.parentPageId ? { parentPageId: String(b.parentPageId) } : {}), ...(b.existingPageId ? { existingPageId: String(b.existingPageId) } : {}), ...(b.title ? { title: String(b.title) } : {}), ...(b.confirm ? { confirm: String(b.confirm) } : {}), ...(b.overwrite === true ? { overwrite: true } : {}) };

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
