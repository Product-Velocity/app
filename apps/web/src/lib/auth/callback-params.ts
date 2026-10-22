import { safeNext } from "./safe-next";

/** Link types the app accepts. `recovery` is for the password reset flow (issue #13). */
const OTP_TYPES = ["email", "signup", "recovery"] as const;
export type OtpType = (typeof OTP_TYPES)[number];

export type CallbackParams =
  | { kind: "otp"; tokenHash: string; type: OtpType; next: string }
  | { kind: "code"; code: string; next: string }
  | { kind: "none" };

/**
 * Email links carry a one-time token hash (works in any browser or device).
 * OAuth returns use the PKCE code, which only works in the browser that
 * started the sign-in.
 */
export function parseCallbackParams(params: URLSearchParams): CallbackParams {
  const next = safeNext(params.get("next"));
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash && type && (OTP_TYPES as readonly string[]).includes(type)) {
    return { kind: "otp", tokenHash, type: type as OtpType, next };
  }
  const code = params.get("code");
  if (code) return { kind: "code", code, next };
  return { kind: "none" };
}
