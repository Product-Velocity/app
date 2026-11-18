import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  // "local" ends only this browser. The default is global, which also revokes the Claude connector's OAuth session (issue #510).
  await supabase.auth.signOut({ scope: "local" });
  const form = await request.formData().catch(() => null);
  const next = safeNext(form?.get("next") as string | null, "/sign-in");
  return NextResponse.redirect(new URL(next, request.url), 303);
}
