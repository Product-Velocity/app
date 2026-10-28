import { NextResponse } from "next/server";
import { MAX_FILE_BYTES } from "@pv/domain";
import { addItemFile, FILE_COLS } from "@/lib/files/actions";
import { toFile, type FileRow } from "@/lib/files/serve";
import { supabaseFileStore } from "@/lib/files/store";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

/** Files of one initiative. Reads go through the signed-in person's own client, so only members of the workspace see them. */
export async function GET(request: Request) {
  const item = new URL(request.url).searchParams.get("item") ?? "";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data } = await supabase.from("item_files").select(FILE_COLS).eq("item_id", item).order("created_at");
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

  const r = await addItemFile(supabase, supabaseFileStore(), { itemId, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), declaredType: file.type });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ file: toFile(r.row, await siteUrl()) }, { status: 201 });
}
