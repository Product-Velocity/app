import { NextResponse } from "next/server";
import { browsePages } from "@/lib/confluence/browse";
import { listSpaces } from "@/lib/confluence/client";
import { json } from "@/lib/confluence/http";
import { confluenceRequest, confluenceSiteFor } from "@/lib/confluence/server";
import { createClient } from "@/lib/supabase/server";

// Browsing Confluence to choose a page to read into a document (issue #693 slice A2): `?item=ID&spaces=1` lists the spaces, `&space=KEY` the top-level pages of a
// space, `&parent=ID` the sub pages of a page. Reads only, and only for a Creator or Admin who can see the initiative (the same rule as the import itself).
// Only titles, ids and the site address leave this route; no page text is read.

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return json({ error: "Sign in first." }, 401);
  const q = new URL(request.url).searchParams;
  const itemId = q.get("item") ?? "";
  if (!UUID.test(itemId)) return json({ error: "Choose an initiative." }, 400);
  const { data: item } = await supabase.from("items").select("tenant_id").eq("id", itemId).is("deleted_at", null).maybeSingle();
  if (!item) return json({ error: "This initiative no longer exists or you cannot see it." }, 404);
  const tenantId = (item as { tenant_id: string }).tenant_id;
  const { data: me } = await supabase.from("tenant_members").select("role, is_service_account").eq("tenant_id", tenantId).eq("user_id", auth.user.id).maybeSingle();
  if (!(me && (me.role === "creator" || me.role === "admin") && !me.is_service_account)) return json({ error: "Only a Creator or Admin can browse Confluence pages here.", kind: "forbidden" }, 403);
  const site = await confluenceSiteFor(tenantId);
  if (!site) return json({ error: "Confluence is not connected for this workspace. An admin can connect it in Settings, Integrations, Confluence.", kind: "not_connected" }, 409);
  const call = confluenceRequest(site.connectionId, site.siteId);
  if (q.get("spaces") === "1") {
    const r = await listSpaces(call);
    return r.ok ? json({ spaces: r.spaces, siteUrl: site.siteUrl }) : json({ error: r.message, kind: r.kind }, 502);
  }
  return browsePages(call, q);
}
