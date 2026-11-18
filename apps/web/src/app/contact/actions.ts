"use server";
import { headers } from "next/headers";
import { emailConfigured } from "@/lib/email/resend";
import { sendLogged } from "@/lib/email/send";
import { loadEmailOverride } from "@/lib/email/override";
import { buildContactEmail } from "@/lib/email/access";
import { SUPPORT_CONTACT } from "@/lib/public-contact";
import { makeLimiter } from "@/app/(marketing)/early-access";
import { checkContact, readContact, type ContactErrors } from "./contact";

export type ContactState = { status: "idle" } | { status: "invalid"; errors: ContactErrors } | { status: "sent" } | { status: "failed"; message: string };

const allow = makeLimiter();

/** The contact form: one email to the contact address, nothing stored, nothing logged but the send outcome (never the address or the text). */
export async function requestContact(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const v = readContact(formData);
  // a person never fills the hidden field: pretend it worked so a bot learns nothing
  if (v.website) return { status: "sent" };
  const errors = checkContact(v);
  if (Object.keys(errors).length) return { status: "invalid", errors };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  if (!allow(`ip:${ip}`) || !allow(`email:${v.email}`)) return { status: "failed", message: "Too many messages from here. Please try again later." };
  if (!emailConfigured()) return { status: "failed", message: "We could not take your message right now. Please try again later." };
  const mail = buildContactEmail({ name: v.name, email: v.email, subject: v.subject, message: v.message, override: await loadEmailOverride("site.contact") });
  const res = await sendLogged("site.contact", { to: SUPPORT_CONTACT.email, replyTo: v.email, ...mail });
  return res.ok ? { status: "sent" } : { status: "failed", message: "We could not send your message. Please try again in a minute." };
}
