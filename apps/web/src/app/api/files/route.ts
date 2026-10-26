import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { fileKindOf, MAX_FILE_BYTES, validateUpload } from "@pv/domain";
import { toFile, type FileRow } from "@/lib/files/serve";
import { supabaseFileStore } from "@/lib/files/store";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

const COLS = "id, name, kind, mime_type, size_bytes, share_token";

/** Files of one initiative. Reads go through the signed-in person's own client, so only members of the workspace see them. */
export async function GET(request: Request) {
  const item = new URL(request.url).searchParams.get("item") ?? "";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data } = await supabase.from("item_files").select(COLS).eq("item_id", item).order("created_at");
  const appUrl = await siteUrl();
  return NextResponse.json({ files: ((data ?? []) as FileRow[]).map((r) => toFile(r, appUrl)) });
}

/** Adds one file. The type is read from the bytes, the row is written as the person (so the role check and the audit log apply), then the bytes are stored. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const itemId = String(form?.get("item") ?? "");
  const file = form?.get("file");
  if (!form || !(file instanceof File) || !itemId) return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "That file is larger than 10 MB." }, { status: 413 });

  const { data: item } = await supabase.from("items").select("id, tenant_id").eq("id", itemId).is("deleted_at", null).maybeSingle();
  if (!item) return NextResponse.json({ error: "This initiative no longer exists or you cannot see it." }, { status: 404 });
  const { count } = await supabase.from("item_files").select("id", { count: "exact", head: true }).eq("item_id", itemId);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateUpload({ name: file.name, bytes, size: file.size, declaredType: file.type, existingCount: count ?? 0 });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 422 });

  const id = randomUUID();
  const path = `${item.tenant_id}/${itemId}/${id}`;
  const { data: row, error } = await supabase
    .from("item_files")
    .insert({ id, tenant_id: item.tenant_id, item_id: itemId, kind: fileKindOf(check.mime), name: check.name, storage_path: path, mime_type: check.mime, size_bytes: file.size })
    .select(COLS)
    .single();
  if (error || !row) return NextResponse.json({ error: "You do not have permission to attach files here." }, { status: 403 });

  try {
    await supabaseFileStore().put(path, bytes, check.mime);
  } catch {
    await supabase.from("item_files").delete().eq("id", id);
    return NextResponse.json({ error: "The file could not be stored. Nothing was attached; try again." }, { status: 502 });
  }
  return NextResponse.json({ file: toFile(row as FileRow, await siteUrl()) }, { status: 201 });
}
