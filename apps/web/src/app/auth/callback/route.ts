import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseCallbackParams } from "@/lib/auth/callback-params";

/**
 * Return point for sign-in links. Email links use a one-time token hash
 * (verifyOtp, works in any browser); OAuth uses the PKCE code exchange.
 */
export async function GET(request: NextRequest) {
  const parsed = parseCallbackParams(new URL(request.url).searchParams);
  if (parsed.kind !== "none") {
    const supabase = await createClient();
    const { error } =
      parsed.kind === "otp"
        ? await supabase.auth.verifyOtp({ token_hash: parsed.tokenHash, type: parsed.type })
        : await supabase.auth.exchangeCodeForSession(parsed.code);
    if (!error) return NextResponse.redirect(new URL(parsed.next, request.url));
  }
  return NextResponse.redirect(new URL("/sign-in?error=callback", request.url));
}
