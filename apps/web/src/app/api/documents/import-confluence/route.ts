import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { DOC_KINDS } from "@pv/domain";
import { json, saveError, statusFor } from "@/lib/confluence/http";
import { confirmImport, previewImport, type ImportDeps, type ImportInput } from "@/lib/confluence/importer";
import { confluenceRequest, confluenceSiteFor } from "@/lib/confluence/server";
import { createClient } from "@/lib/supabase/server";

// Reading a Confluence page into a new document (issue #693 slice A2). The person's own client does every read and write, so the role check, row-level
// security and the audit log apply. Only a signed-in Creator or Admin (not a service account, not platform staff) can import: Product Velocity reads the page
// with the workspace's Atlassian sign-in, which may see more than the person does, so the dialog says so. The page is the source; nothing is written to it.
// The document is created "Do not share" (it is not sent to a tracker unless a person chooses), and what the page says is data, never instructions.

const UUID = /^[0-9a-f-]{36}$/i;
type Body = { action?: string; item?: string; pageUrl?: string; kind?: string; title?: string; mode?: string; direction?: string; confirm?: string };

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return json({ error: "Sign in first." }, 401);
  const b = (await request.json().catch(() => null)) as Body | null;
  if (!b || !["preview", "import", "dismiss"].includes(String(b.action))) return json({ error: "Say what to do: preview, import or dismiss." }, 400);
  if (!b.item || !UUID.test(b.item)) return json({ error: "Choose an initiative." }, 400);
  if (typeof b.pageUrl !== "string" || b.pageUrl.trim() === "") return json({ error: "Paste the address of the Confluence page." }, 422);
  // "dismiss" removes the open request (Claude's or a person's) to import this page; it reads nothing and creates nothing
  if (b.action === "dismiss") {
    const { error } = await supabase.from("item_confluence_read_requests").delete().eq("item_id", b.item).eq("kind", "import").eq("page_url", b.pageUrl.trim());
    return error ? json({ error: "The request could not be removed." }, 403) : json({ ok: true });
  }
  if (b.mode !== "once" && b.mode !== "sync") return json({ error: "Choose once or keep in sync." }, 400);
  if (b.kind !== undefined && !(DOC_KINDS as readonly string[]).includes(b.kind)) return json({ error: "Choose what kind of document this is." }, 422);

  const { data: item } = await supabase.from("items").select("id, tenant_id").eq("id", b.item).is("deleted_at", null).maybeSingle();
  if (!item) return json({ error: "This initiative no longer exists or you cannot see it." }, 404);
  const tenantId = (item as { tenant_id: string }).tenant_id;
  const { data: me } = await supabase.from("tenant_members").select("role, is_service_account").eq("tenant_id", tenantId).eq("user_id", auth.user.id).maybeSingle();
  if (!(me && (me.role === "creator" || me.role === "admin") && !me.is_service_account)) return json({ error: "Only a Creator or Admin can copy a Confluence page into a document.", kind: "forbidden" }, 403);

  const site = await confluenceSiteFor(tenantId);
  if (!site) return json({ error: "Confluence is not connected for this workspace. An admin can connect it in Settings, Integrations, Confluence.", kind: "not_connected" }, 409);
  const { count } = await supabase.from("item_documents").select("id", { count: "exact", head: true }).eq("item_id", b.item);

  const deps: ImportDeps = {
    call: confluenceRequest(site.connectionId, site.siteId), siteUrl: site.siteUrl, documentCount: count ?? 0,
    hash: (s) => createHash("sha256").update(s).digest("hex"), now: () => new Date().toISOString(),
    store: {
      createDocument: async (d) => {
        // created "Do not share" in the same write, so a tracker never sees it before a person decides
        const { data, error } = await supabase.from("item_documents").insert({ tenant_id: tenantId, item_id: b.item, kind: d.kind, title: d.title, body: d.body, shared: false }).select("id, version").single();
        const row = data as { id: string; version: number } | null;
        return error || !row ? { ok: false, error: saveError(error) } : { ok: true, id: row.id, version: row.version };
      },
      insertBinding: async (documentId, p) => {
        const { error } = await supabase.from("item_document_pages").insert({
          tenant_id: tenantId, item_id: b.item, document_id: documentId, connection_id: site.connectionId, site_id: site.siteId, site_url: site.siteUrl,
          space_key: p.spaceKey, parent_page_id: null, page_id: p.pageId, page_url: p.pageUrl, page_title: p.pageTitle, source: "external", sync_mode: p.syncMode, sync_direction: p.syncDirection,
          published_version: p.publishedVersion, remote_version: p.remoteVersion, content_hash: p.contentHash, unlinked_at: p.unlinkedAt,
        });
        return error ? { ok: false, error: saveError(error) } : { ok: true };
      },
    },
  };
  const input: ImportInput = { pageUrl: b.pageUrl, mode: b.mode, ...(b.kind ? { kind: b.kind } : {}), ...(b.title ? { title: String(b.title) } : {}), ...(b.direction === "both" || b.direction === "from_confluence" ? { direction: b.direction } : {}), ...(b.confirm ? { confirm: String(b.confirm) } : {}) };

  if (b.action === "preview") {
    const p = await previewImport(deps, input);
    return p.ok ? json({ preview: p }) : json({ error: p.message, kind: p.kind }, statusFor(p.kind));
  }
  const done = await confirmImport(deps, input);
  if (!done.ok) return json({ error: done.message, kind: done.kind }, statusFor(done.kind));
  // the confirmed import answers the request, if there was one
  await supabase.from("item_confluence_read_requests").delete().eq("item_id", b.item).eq("kind", "import").eq("page_url", b.pageUrl.trim());
  return json({ done });
}
