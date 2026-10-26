import { NextResponse } from "next/server";
import { newShareToken, shareUrl } from "@/lib/files/serve";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

/**
 * Turns the login-free link of one file on (a new unguessable address) or off (the old address stops working at once).
 * Turning it on again always makes a new address, so a leaked old link stays dead.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { on?: unknown } | null;
  if (typeof body?.on !== "boolean") return NextResponse.json({ error: "Say whether the link should be on or off." }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const token = body.on ? newShareToken() : null;
  const { data, error } = await supabase.from("item_files").update({ share_token: token, share_updated_at: new Date().toISOString() }).eq("id", id).select("name").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "You do not have permission to change this link." }, { status: 403 });
  return NextResponse.json({ shareUrl: token ? shareUrl(await siteUrl(), token, data.name) : null });
}
