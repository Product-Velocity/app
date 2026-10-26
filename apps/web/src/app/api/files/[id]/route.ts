import { NextResponse } from "next/server";
import { supabaseFileStore } from "@/lib/files/store";
import { createClient } from "@/lib/supabase/server";

/** Removes a file: the row first (so the role check applies and the share link stops working at once), then the bytes. */
export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: row } = await supabase.from("item_files").select("storage_path").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "File not found." }, { status: 404 });
  const { data: gone, error } = await supabase.from("item_files").delete().eq("id", id).select("id");
  if (error || !gone?.length) return NextResponse.json({ error: "You do not have permission to remove this file." }, { status: 403 });
  await supabaseFileStore().remove(row.storage_path).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
