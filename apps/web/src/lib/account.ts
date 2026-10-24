/** Pure rules of the account page (issue #44), kept apart from the forms so they can be tested. */

export const LANGUAGES = [{ value: "en", label: "English" }] as const;
export const DATE_FORMATS = [
  { value: "locale", label: "Follow my browser's locale" },
  { value: "d MMM yyyy", label: "23 Oct 2026" },
  { value: "dd/mm/yyyy", label: "23/10/2026" },
  { value: "mm/dd/yyyy", label: "10/23/2026" },
  { value: "yyyy-mm-dd", label: "2026-10-23" },
] as const;

export type Profile = { fullName: string; language: string; timeZone: string; dateFormat: string };
export const DEFAULT_PROFILE: Profile = { fullName: "", language: "en", timeZone: "UTC", dateFormat: "locale" };

/** What is stored for a person (Supabase user metadata) read back with defaults for anything missing or invalid. */
export function profileFromMetadata(meta: Record<string, unknown> | null | undefined): Profile {
  const m = meta ?? {};
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : "");
  return {
    fullName: str("full_name").slice(0, 120),
    language: LANGUAGES.some((l) => l.value === str("language")) ? str("language") : DEFAULT_PROFILE.language,
    timeZone: isTimeZone(str("time_zone")) ? str("time_zone") : DEFAULT_PROFILE.timeZone,
    dateFormat: DATE_FORMATS.some((d) => d.value === str("date_format")) ? str("date_format") : DEFAULT_PROFILE.dateFormat,
  };
}

export function isTimeZone(tz: string): boolean {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

export function timeZones(): string[] {
  const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return list.includes("UTC") ? list : ["UTC", ...list];
}

export type ProfileResult = { ok: true; profile: Profile } | { ok: false; error: string };
export function validateProfile(input: { fullName: unknown; language: unknown; timeZone: unknown; dateFormat: unknown }): ProfileResult {
  const fullName = String(input.fullName ?? "").replace(/\s+/g, " ").trim();
  if (fullName.length > 120) return { ok: false, error: "The name can have up to 120 characters." };
  const language = String(input.language ?? "");
  if (!LANGUAGES.some((l) => l.value === language)) return { ok: false, error: "Choose a language from the list." };
  const timeZone = String(input.timeZone ?? "");
  if (!isTimeZone(timeZone)) return { ok: false, error: "Choose a time zone from the list." };
  const dateFormat = String(input.dateFormat ?? "");
  if (!DATE_FORMATS.some((d) => d.value === dateFormat)) return { ok: false, error: "Choose a date format from the list." };
  return { ok: true, profile: { fullName, language, timeZone, dateFormat } };
}

export type Identity = { provider: string };
/** Sign-in methods the person can use: email and password, Google, GitHub. A method can be removed only while another one remains. */
export const canUnlink = (identities: readonly Identity[], provider: string) => identities.length > 1 && identities.some((i) => i.provider === provider);
export const PROVIDER_LABEL: Record<string, string> = { email: "Email and password", google: "Google", github: "GitHub" };
export const LINKABLE = ["google", "github"] as const;

/** Changing an email, a password or deleting an account needs a recent sign-in when there is no password to ask for. */
export const RECENT_SIGN_IN_MINUTES = 15;
export function signedInRecently(lastSignInAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastSignInAt) return false;
  const t = Date.parse(lastSignInAt);
  return !Number.isNaN(t) && now - t <= RECENT_SIGN_IN_MINUTES * 60_000 && now >= t - 60_000;
}

export type LeaveResult = { ok: true } | { ok: false; error: string };
export function leaveMessage(code: string | undefined): string {
  if (code === "PV003") return "You are the only admin of this workspace. Make someone else an admin first, then you can leave.";
  return "We could not remove you from this workspace. Please try again.";
}
