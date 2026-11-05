import { NextResponse } from "next/server";
import { removeItemFile, renameItemFile } from "@/lib/files/actions";
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

/** Renames a file: `{ name }`. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  if (typeof body?.name !== "string") return NextResponse.json({ error: "Give the file a name." }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const r = await renameItemFile(supabase, id, body.name);
  return r.ok ? NextResponse.json({ name: r.name }) : NextResponse.json({ error: r.error }, { status: r.status });
}
