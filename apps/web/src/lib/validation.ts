import { parseRole, type Role } from "./roles";

/** Lower-cased, trimmed address, or null if it is not plausibly an email. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

export function parseTenantName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name.length >= 1 && name.length <= 120 ? name : null;
}

export type InviteInput = { email: string; role: Role; isApprover: boolean };

export function parseInviteForm(form: FormData): InviteInput | { error: string } {
  const email = normalizeEmail(form.get("email"));
  if (!email) return { error: "Enter a valid email address." };
  const role = parseRole(form.get("role"));
  if (!role) return { error: "Choose a role." };
  return { email, role, isApprover: form.get("is_approver") === "on" };
}
