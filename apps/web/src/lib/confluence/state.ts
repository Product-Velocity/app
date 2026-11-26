import { syncState, type SyncDirection, type SyncState } from "@pv/domain";
import { getPage, type ConfluenceRequest } from "./client";

// What a linked document needs (issue #714 slice 2): reads the page's current version (only when the direction can act on it) and asks the pure rule. Detection
// happens when somebody looks (the document menu, the Sync dialog), never in the background, and it only reads a version number: no page text.

export type LinkForState = { direction: SyncDirection; pageId: string; publishedVersion: number; remoteVersion: number | null };

export async function documentSyncState(call: ConfluenceRequest, siteUrl: string | null, link: LinkForState, docVersion: number): Promise<{ state: SyncState; pageVersion: number | "missing" | null }> {
  let pageVersion: number | "missing" | null = null;
  // a write-only link never reads the page back, so it costs no call
  if (link.direction !== "to_confluence") {
    const got = await getPage(call, link.pageId, siteUrl);
    if (got.ok) pageVersion = got.page.version;
    else if (got.kind === "gone") pageVersion = "missing";
  }
  return { state: syncState({ direction: link.direction, docVersion, publishedVersion: link.publishedVersion, pageVersion, remoteVersion: link.remoteVersion }), pageVersion };
}
