import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseCallbackParams } from "@/lib/auth/callback-params";
import { rememberTenant } from "@/lib/session";
import { acceptInviteToken, inviteTokenFromNext } from "@/lib/invite-accept";

/**
 * Return point for sign-in links.
 * - Email links carry a one-time token hash. A GET never uses it up: mail scanners open every link in a message, and a
 *   token they used would fail for the person (issue #689). The GET hands the link to the "Continue" page, and the token is
 *   verified (verifyOtp, works in any browser) only when the person presses the button, which POSTs here.
 * - OAuth returns use the PKCE code exchange on GET, as before.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const parsed = parseCallbackParams(url.searchParams);
  if (parsed.kind === "otp") {
    const to = new URL("/auth/confirm", request.url);
    to.searchParams.set("token_hash", parsed.tokenHash);
    to.searchParams.set("type", parsed.type);
    to.searchParams.set("next", parsed.next);
    return NextResponse.redirect(to);
  }
  if (parsed.kind === "code") {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (!error) return NextResponse.redirect(new URL(parsed.next, request.url));
  }
  return NextResponse.redirect(new URL("/sign-in?error=callback", request.url));
}

/** The "Continue" button: verify the one-time token, sign the person in, and for an invitation accept it in the same step. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params = new URLSearchParams();
  for (const k of ["token_hash", "type", "next"]) {
    const v = form.get(k);
    if (typeof v === "string") params.set(k, v);
  }
  const parsed = parseCallbackParams(params);
  // 303: the browser follows a POST with a GET
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  if (parsed.kind !== "otp") return go("/sign-in?error=callback");

  const inviteToken = inviteTokenFromNext(parsed.next);
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: parsed.tokenHash, type: parsed.type });
  if (error) {
    // used up or expired: an invitation goes back to its own page with the sign-in form; the invitation itself is still valid
    return go(inviteToken ? `/invite/${inviteToken}?link=used` : "/sign-in?error=callback");
  }
  if (!inviteToken) return go(parsed.next);

  // two-factor still comes first: the invitation page sends the person to the code step and then back to accept
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") return go(parsed.next);

  const accepted = await acceptInviteToken(supabase, inviteToken);
  if (!accepted.ok) return go(parsed.next); // the invitation page shows why (wrong address, already a member, expired)
  await rememberTenant(accepted.tenantId);
  return go("/onboarding/welcome");
}
