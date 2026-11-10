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

type Json = Record<string, unknown>;

/**
 * Registration options steered towards the device's own passkey provider (Apple Passwords / iCloud Keychain on Apple devices, Google Password
 * Manager or Windows Hello elsewhere). Supabase passes whatever its server returns to the browser; if that asks for a security key or an "other
 * device", Apple's sheet shows only apps such as Microsoft Authenticator. So: no "cross-platform only" restriction, hints that prefer this
 * device (then a phone), and a discoverable credential, which sign-in needs because it never asks for an email first. Stricter settings the
 * server asked for (user verification, attestation) are kept as they are.
 */
export function preferPlatformCreation(pk: Json): Json {
  const sel = { ...((pk.authenticatorSelection as Json | undefined) ?? {}) };
  if (sel.authenticatorAttachment === "cross-platform") delete sel.authenticatorAttachment;
  sel.residentKey = "required";
  sel.requireResidentKey = true;
  return { ...pk, authenticatorSelection: sel, hints: ["client-device", "hybrid"] };
}

/** The sign-in request: only the hints change (a "security-key" hint hides the built-in provider). */
export function preferPlatformRequest(pk: Json): Json {
  const hints = Array.isArray(pk.hints) ? (pk.hints as string[]) : [];
  return hints.includes("security-key") || hints.length === 0 ? { ...pk, hints: ["client-device", "hybrid"] } : pk;
}

/** What the last passkey call asked the browser for (no challenge, no user name or email), for the "Technical details" box. */
let last: Json | null = null;
const summary = (kind: "create" | "get", server: Json, used: Json): Json => {
  const sel = (key: Json) => (key.authenticatorSelection as Json | undefined) ?? {};
  const rp = (server.rp as Json | undefined)?.id ?? server.rpId ?? null;
  return {
    call: kind,
    relyingParty: rp,
    pageHost: typeof window === "undefined" ? null : window.location.hostname,
    serverAsked: { hints: server.hints ?? null, authenticatorAttachment: sel(server).authenticatorAttachment ?? null, residentKey: sel(server).residentKey ?? null, userVerification: sel(server).userVerification ?? server.userVerification ?? null, attestation: server.attestation ?? null, excluded: Array.isArray(server.excludeCredentials) ? server.excludeCredentials.length : 0, allowed: Array.isArray(server.allowCredentials) ? server.allowCredentials.length : 0 },
    weSent: { hints: used.hints ?? null, authenticatorAttachment: sel(used).authenticatorAttachment ?? null, residentKey: sel(used).residentKey ?? null },
  };
};
export const recordPasskeyError = (e: { code?: string; name?: string; message?: string } | null | undefined) => { if (e) last = { ...(last ?? {}), error: { code: e.code ?? null, name: e.name ?? null } }; };
/** Text to paste into a support message; empty before any attempt. */
export const passkeyDiagnostics = (): string => (last ? JSON.stringify({ ...last, browser: typeof navigator === "undefined" ? null : navigator.userAgent }, null, 2) : "");

/** Runs `fn` with the browser's passkey calls adjusted by the two functions above, and always puts them back. */
export async function withPlatformPasskeys<T>(fn: () => Promise<T>): Promise<T> {
  const creds = navigator.credentials as CredentialsContainer & { create: CredentialsContainer["create"]; get: CredentialsContainer["get"] };
  const create = creds.create.bind(creds);
  const get = creds.get.bind(creds);
  last = null;
  creds.create = (o?: CredentialCreationOptions) => {
    if (!o?.publicKey) return create(o);
    const used = preferPlatformCreation(o.publicKey as unknown as Json);
    last = summary("create", o.publicKey as unknown as Json, used);
    return create({ ...o, publicKey: used as unknown as PublicKeyCredentialCreationOptions });
  };
  creds.get = (o?: CredentialRequestOptions) => {
    if (!o?.publicKey) return get(o);
    const used = preferPlatformRequest(o.publicKey as unknown as Json);
    last = summary("get", o.publicKey as unknown as Json, used);
    return get({ ...o, publicKey: used as unknown as PublicKeyCredentialRequestOptions });
  };
  try { return await fn(); } finally { delete (creds as unknown as Json).create; delete (creds as unknown as Json).get; }
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
