import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicDocument } from "@/components/public-document";
import { isShareToken } from "@/lib/files/serve";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared document", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * The login-free address of one shared document (issue #325). Anyone holding the link can read that one document and nothing else: the token is looked
 * up as an exact match, a wrong, revoked or unaccepted-draft token answers the same 404, and nothing names a workspace, initiative or person.
 * Only a document that is shared and not an unaccepted AI draft has a token at all (the database makes and removes it).
 */
export default async function SharedDocument({ params }: { params: Promise<{ token: string; name: string }> }) {
  const { token } = await params;
  if (!isShareToken(token)) notFound();
  // an unreachable database answers the same plain 404, never an error page
  const row = await (async () => {
    try {
      return (await createAdminClient({ via: "system" }).from("item_documents").select("title, kind, status, version, body, updated_at").eq("share_token", token).eq("shared", true).eq("ai_draft", false).maybeSingle()).data;
    } catch { return null; }
  })();
  if (!row) notFound();
  return <PublicDocument title={row.title as string} kind={row.kind as string} status={row.status as string} version={row.version as number} body={row.body as string} updatedAt={row.updated_at as string} />;
}
