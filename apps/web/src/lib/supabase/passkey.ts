import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/**
 * A browser client with passkey support switched on (Supabase marks passkeys experimental, so the client must opt in).
 * Used only by the "Sign in with a passkey" button and the passkey list in Security. Passkeys also have to be enabled in the
 * Supabase project (docs/14-GO-LIVE-CHECKLIST.md); until then the calls answer `passkey_disabled` and the screens say so.
 */
export function createPasskeyClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey, { auth: { experimental: { passkey: true } } });
}

/** Whether this browser can run a passkey ceremony at all. */
export const passkeysSupported = () => typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";

/** Plain words for the errors a person can run into. */
export function passkeyErrorText(e: { code?: string; message?: string; name?: string } | null | undefined): string {
  switch (e?.code) {
    case "passkey_disabled": return "Passkeys are not switched on for this workspace yet. Ask an admin.";
    case "too_many_passkeys": return "You have reached the maximum number of passkeys. Remove one first.";
    case "webauthn_credential_exists": return "This device or key is already registered.";
    case "webauthn_credential_not_found": return "That passkey is not registered here. Sign in another way, then add it again in Security.";
    case "webauthn_challenge_expired": return "That took too long. Try again.";
    case "email_not_confirmed": return "Confirm your email address first.";
    case "user_banned": return "This account cannot sign in.";
  }
  if (e?.name === "NotAllowedError" || e?.code === "ERROR_CEREMONY_ABORTED") return "The passkey prompt was cancelled.";
  return "The passkey could not be used. Try again, or sign in another way.";
}
