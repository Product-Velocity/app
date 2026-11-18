"use server";
import { headers } from "next/headers";
import { emailConfigured } from "@/lib/email/resend";
import { sendLogged } from "@/lib/email/send";
import { loadEmailOverride } from "@/lib/email/override";
import { buildEarlyAccessEmail } from "@/lib/email/access";
import { SUPPORT_CONTACT } from "@/lib/public-contact";
import { checkEarlyAccess, makeLimiter, readEarlyAccess, type EarlyAccessErrors } from "./early-access";

export type EarlyAccessState = { status: "idle" } | { status: "invalid"; errors: EarlyAccessErrors } | { status: "sent" } | { status: "failed"; message: string };

const allow = makeLimiter();

/** The early-access form: one email to the contact address, nothing stored, nothing logged but the send outcome (never the address or the text). */
export async function requestEarlyAccess(_prev: EarlyAccessState, formData: FormData): Promise<EarlyAccessState> {
  const v = readEarlyAccess(formData);
  // a person never fills the hidden field: pretend it worked so a bot learns nothing
  if (v.website) return { status: "sent" };
  const errors = checkEarlyAccess(v);
  if (Object.keys(errors).length) return { status: "invalid", errors };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  if (!allow(`ip:${ip}`) || !allow(`email:${v.email}`)) return { status: "failed", message: "Too many requests from here. Please try again later." };
  if (!emailConfigured()) return { status: "failed", message: "We could not take your request right now. Please try again later." };
  const mail = buildEarlyAccessEmail({ name: v.name, email: v.email, company: v.company, role: v.role, teams: v.teams, override: await loadEmailOverride("site.early-access") });
  const res = await sendLogged("site.early-access", { to: SUPPORT_CONTACT.email, ...mail });
  return res.ok ? { status: "sent" } : { status: "failed", message: "We could not send your request. Please try again in a minute." };
}
