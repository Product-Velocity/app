import { NextResponse } from "next/server";
import { fileResponse } from "@/lib/files/serve";
import { supabaseFileStore } from "@/lib/files/store";
import { createClient } from "@/lib/supabase/server";

/** Opens a file for a signed-in member (row read through their own client, so RLS decides). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: row } = await supabase.from("item_files").select("name, mime_type, storage_path").eq("id", id).maybeSingle();
  if (!row?.mime_type) return NextResponse.json({ error: "File not found." }, { status: 404 });
  const bytes = await supabaseFileStore().get(row.storage_path);
  if (!bytes) return NextResponse.json({ error: "File not found." }, { status: 404 });
  return fileResponse(bytes, row.mime_type, row.name, { download: new URL(request.url).searchParams.has("download") });
}
