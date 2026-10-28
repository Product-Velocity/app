import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fileKindOf, MAX_FILE_BYTES, validateUpload } from "@pv/domain";
import { newShareToken, type FileRow } from "./serve";
import type { FileStore } from "./store";

/**
 * The one place files are added, shared and removed. The item panel routes (`/api/files`) and the MCP file tools both call these,
 * each with the signed-in person's own client: the role check, row-level security and the audit log apply to every write, and the
 * service role is never used here (only the injected `store` holds bytes).
 */
export const FILE_COLS = "id, name, kind, mime_type, size_bytes, share_token";

export type Failure = { ok: false; status: 400 | 403 | 404 | 413 | 422 | 502; error: string };
const fail = (status: Failure["status"], error: string): Failure => ({ ok: false, status, error });

export async function addItemFile(
  supabase: SupabaseClient,
  store: FileStore,
  i: { itemId: string; name: string; bytes: Uint8Array; declaredType?: string },
): Promise<{ ok: true; row: FileRow; tenantId: string } | Failure> {
  if (i.bytes.length > MAX_FILE_BYTES) return fail(413, "That file is larger than 10 MB.");
  const { data: item } = await supabase.from("items").select("id, tenant_id").eq("id", i.itemId).is("deleted_at", null).maybeSingle();
  if (!item) return fail(404, "This initiative no longer exists or you cannot see it.");
  const { count } = await supabase.from("item_files").select("id", { count: "exact", head: true }).eq("item_id", i.itemId);

  const check = validateUpload({ name: i.name, bytes: i.bytes, size: i.bytes.length, declaredType: i.declaredType, existingCount: count ?? 0 });
  if (!check.ok) return fail(422, check.error);

  const id = randomUUID();
  const path = `${item.tenant_id}/${i.itemId}/${id}`;
  const { data: row, error } = await supabase
    .from("item_files")
    .insert({ id, tenant_id: item.tenant_id, item_id: i.itemId, kind: fileKindOf(check.mime), name: check.name, storage_path: path, mime_type: check.mime, size_bytes: i.bytes.length })
    .select(FILE_COLS)
    .single();
  if (error || !row) return fail(403, "You do not have permission to attach files here.");

  try {
    await store.put(path, i.bytes, check.mime);
  } catch {
    await supabase.from("item_files").delete().eq("id", id);
    return fail(502, "The file could not be stored. Nothing was attached; try again.");
  }
  return { ok: true, row: row as FileRow, tenantId: item.tenant_id as string };
}

/** On makes a new unguessable token (an old, leaked address stays dead); off removes it, so the address answers 404 at once. */
export async function setFileSharing(supabase: SupabaseClient, id: string, on: boolean): Promise<{ ok: true; token: string | null; name: string } | Failure> {
  const token = on ? newShareToken() : null;
  const { data, error } = await supabase.from("item_files").update({ share_token: token, share_updated_at: new Date().toISOString() }).eq("id", id).select("name").maybeSingle();
  if (error || !data) return fail(403, "You do not have permission to change this link.");
  return { ok: true, token, name: data.name as string };
}

/** The row goes first (the role check applies and the share link stops working at once), then the bytes. */
export async function removeItemFile(supabase: SupabaseClient, store: FileStore, id: string): Promise<{ ok: true } | Failure> {
  const { data: row } = await supabase.from("item_files").select("storage_path").eq("id", id).maybeSingle();
  if (!row) return fail(404, "File not found.");
  const { data: gone, error } = await supabase.from("item_files").delete().eq("id", id).select("id");
  if (error || !gone?.length) return fail(403, "You do not have permission to remove this file.");
  await store.remove(row.storage_path).catch(() => undefined);
  return { ok: true };
}
