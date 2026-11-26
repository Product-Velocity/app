import { getSpaceByKey, listChildPages, listRootPages, type ConfluenceRequest } from "./client";
import { json, statusFor } from "./http";

/**
 * The page tree of a Confluence space, for choosing a page (issue #693): the top-level pages of a space (`?space=KEY`) or the sub pages directly under a page
 * (`?parent=ID`). Shared by the publish dialog's route and the import dialog's route, which each check who may ask first. Only titles and ids are returned.
 */
export async function browsePages(call: ConfluenceRequest, q: URLSearchParams) {
  const parent = q.get("parent");
  const space = q.get("space");
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
