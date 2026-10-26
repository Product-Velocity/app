import { fileResponse, isShareToken } from "@/lib/files/serve";
import { supabaseFileStore } from "@/lib/files/store";
import { createAdminClient } from "@/lib/supabase/admin";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

/**
 * The login-free address of one shared file. Anyone holding the link can open that one file and nothing else: the
 * token is looked up as an exact match, the answer for a wrong or revoked token is the same plain 404, and no
 * workspace, initiative or person is named in the response.
 */
export async function GET(_: Request, ctx: { params: Promise<{ token: string; name: string }> }) {
  const { token } = await ctx.params;
  if (!isShareToken(token)) return notFound();
  const { data: row } = await createAdminClient({ via: "system" }).from("item_files").select("name, mime_type, storage_path").eq("share_token", token).maybeSingle();
  if (!row?.mime_type) return notFound();
  const bytes = await supabaseFileStore().get(row.storage_path);
  if (!bytes) return notFound();
  return fileResponse(bytes, row.mime_type, row.name);
}
