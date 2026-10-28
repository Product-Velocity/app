import { NextResponse } from "next/server";
import { removeItemFile } from "@/lib/files/actions";
import { supabaseFileStore } from "@/lib/files/store";
import { createClient } from "@/lib/supabase/server";

/** Removes a file: the row first (so the role check applies and the share link stops working at once), then the bytes. */
export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const r = await removeItemFile(supabase, supabaseFileStore(), id);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
