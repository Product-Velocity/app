import { NextResponse } from "next/server";
import { getSpaceByKey, listChildPages, listRootPages } from "@/lib/confluence/client";
import { loadDocForPublish } from "@/lib/confluence/doc-access";
import { json, statusFor } from "@/lib/confluence/http";
import { confluenceRequest, confluenceSiteFor } from "@/lib/confluence/server";

// The page tree of a Confluence space, for choosing where a document goes (issue #693): the top-level pages of a space (`?space=KEY`), or the sub pages directly
// under a page (`?parent=ID`). Reads only, with the workspace's Confluence connection, and only for a person who may publish this document (a Creator or Admin).
// Only titles and ids leave this route; no page text is read.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const c = await loadDocForPublish(id);
  if (!c.ok) return c.error;
  if (!c.canPublish) return json({ error: "Only a Creator or Admin can browse Confluence pages here.", kind: "forbidden" }, 403);
  const site = await confluenceSiteFor(c.doc.tenant_id);
  if (!site) return json({ error: "Confluence is not connected for this workspace. An admin can connect it in Settings, Integrations, Confluence.", kind: "not_connected" }, 409);
  const q = new URL(request.url).searchParams;
  const parent = q.get("parent");
  const space = q.get("space");
  const call = confluenceRequest(site.connectionId, site.siteId);
  if (parent) {
    if (!/^\d{1,20}$/.test(parent)) return json({ error: "That is not a Confluence page.", kind: "invalid" }, 422);
    const r = await listChildPages(call, parent);
    return r.ok ? json({ pages: r.pages }) : json({ error: r.message, kind: r.kind }, statusFor(r.kind));
  }
  if (!space || !/^[~A-Za-z0-9_-]{1,255}$/.test(space)) return json({ error: "Choose a space first.", kind: "invalid" }, 422);
  const sp = await getSpaceByKey(call, space);
  if (!sp.ok) return json({ error: sp.message, kind: sp.kind }, statusFor(sp.kind));
  const r = await listRootPages(call, sp.space.id);
  return r.ok ? json({ pages: r.pages }) : json({ error: r.message, kind: r.kind }, statusFor(r.kind));
}
