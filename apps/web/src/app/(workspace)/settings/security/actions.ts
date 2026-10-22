"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";

export type EnrollStart = { factorId: string; qr: string; secret: string } | { error: string };
export type Result = { ok: true } | { ok: false; error: string };

const PATH = "/settings/security";

export async function startEnrollment(): Promise<EnrollStart> {
  const { supabase } = await requireUser(PATH);
  // drop abandoned, never-verified attempts so they do not pile up
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
  if (error || !data) return { error: "Could not start setup. Please try again." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmEnrollment(factorId: string, code: string): Promise<Result> {
  const { supabase } = await requireUser(PATH);
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, error: "Enter the 6-digit code." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: clean });
  if (error) return { ok: false, error: "That code is not correct. Try the newest code." };
  revalidatePath(PATH);
  return { ok: true };
}

export async function removeFactor(form: FormData): Promise<void> {
  const { supabase } = await requireUser(PATH);
  const factorId = form.get("factorId");
  if (typeof factorId !== "string") return;
  await supabase.auth.mfa.unenroll({ factorId });
  revalidatePath(PATH);
}
