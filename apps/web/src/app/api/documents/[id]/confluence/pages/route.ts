import { NextResponse } from "next/server";
import { browsePages } from "@/lib/confluence/browse";
import { loadDocForPublish } from "@/lib/confluence/doc-access";
import { json } from "@/lib/confluence/http";
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
  return browsePages(confluenceRequest(site.connectionId, site.siteId), new URL(request.url).searchParams);
}
