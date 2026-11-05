import { NextResponse } from "next/server";
import { fetchLinkTitle } from "@/lib/link-title";
import { createClient } from "@/lib/supabase/server";

/** The name of a web page, for a pasted link. Signed-in people only; the server-side fetch is limited to the public internet (lib/link-title.ts). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.slice(0, 2000) : "";
  return NextResponse.json({ title: url ? await fetchLinkTitle(url) : null });
}
