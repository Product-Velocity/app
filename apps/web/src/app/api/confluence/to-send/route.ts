import { NextResponse } from "next/server";
import { json } from "@/lib/confluence/http";
import { confluenceSiteFor } from "@/lib/confluence/server";
import { createClient } from "@/lib/supabase/server";

// "To send" for Confluence (issue #693): the documents of the given initiatives that are kept in sync with a Confluence page and have a newer version than the page
// holds. The Sync dialog lists them next to what goes to the tracker. This route only LISTS (ids, titles, versions and the page address); nothing is written to
// Confluence here, and no document text is read. Each page is updated by the person, one by one, through the same preview and confirmation as in the document's menu.
// Only a Creator or Admin who is not a service account sees them (they are the only ones who can publish), and only when Confluence is connected.

const UUID = /^[0-9a-f-]{36}$/i;
const MAX = 200;

type PubRow = { id: string; document_id: string; item_id: string; page_url: string; page_title: string; space_key: string; published_version: number };
type DocRow = { id: string; title: string; version: number };
type ItemRow = { id: string; tenant_id: string; item_code: string; initiative_name: string };

export async function GET(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return json({ error: "Sign in first." }, 401);
  const ids = [...new Set((new URL(request.url).searchParams.get("items") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX || !ids.every((i) => UUID.test(i))) return json({ error: `Give 1 to ${MAX} initiative ids.` }, 400);

  const { data: items } = await supabase.from("items").select("id, tenant_id, item_code, initiative_name").in("id", ids).is("deleted_at", null);
  const itemRows = (items ?? []) as ItemRow[];
  const tenants = [...new Set(itemRows.map((i) => i.tenant_id))];
  const none = json({ available: false, documents: [] });
  if (tenants.length !== 1) return none;
  const tenantId = tenants[0]!;
  const { data: me } = await supabase.from("tenant_members").select("role, is_service_account").eq("tenant_id", tenantId).eq("user_id", auth.user.id).maybeSingle();
  if (!(me && (me.role === "creator" || me.role === "admin") && !me.is_service_account)) return none;
  if (!(await confluenceSiteFor(tenantId))) return none;

  const { data: pubs } = await supabase.from("item_document_pages").select("id, document_id, item_id, page_url, page_title, space_key, published_version")
    .eq("tenant_id", tenantId).in("item_id", itemRows.map((i) => i.id)).eq("source", "pv").eq("sync_mode", "sync").is("unlinked_at", null);
  const pubRows = (pubs ?? []) as PubRow[];
  if (pubRows.length === 0) return json({ available: true, documents: [] });
  const { data: docs } = await supabase.from("item_documents").select("id, title, version").in("id", pubRows.map((p) => p.document_id));
  const docById = new Map(((docs ?? []) as DocRow[]).map((d) => [d.id, d]));
  const itemById = new Map(itemRows.map((i) => [i.id, i]));
  const documents = pubRows.flatMap((p) => {
    const d = docById.get(p.document_id);
    const it = itemById.get(p.item_id);
    if (!d || !it || p.published_version >= d.version) return [];
    return [{ id: d.id, itemId: it.id, code: it.item_code, itemName: it.initiative_name, title: d.title, version: d.version, publishedVersion: p.published_version, pageTitle: p.page_title, pageUrl: p.page_url, spaceKey: p.space_key }];
  }).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }) || a.title.localeCompare(b.title));
  return json({ available: true, documents });
}
