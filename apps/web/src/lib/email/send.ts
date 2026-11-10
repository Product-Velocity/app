import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, type SendResult } from "./resend";
import type { EmailKey } from "./registry/registry";

/**
 * The one way the app sends a product email (issue #370). The key must be in the template registry (a type error otherwise, and a test
 * scans every call), and every send is written to the send log: template, outcome, Resend's message id, and the workspace when there is
 * one. The log never holds an address, a name, a token, a link or a body. A log failure never blocks the email.
 */
export async function sendLogged(key: EmailKey, msg: { to: string; subject: string; text: string; html: string }, opts?: { tenantId?: string | null; isTest?: boolean; actorId?: string | null }): Promise<SendResult> {
  const res = await sendEmail(msg);
  try {
    const admin = createAdminClient({ via: "system" });
    await admin.from("email_send_log").insert({
      template_key: key,
      tenant_id: opts?.tenantId ?? null,
      is_test: opts?.isTest ?? false,
      actor_id: opts?.actorId ?? null,
      status: res.ok ? "sent" : "failed",
      provider_id: res.ok ? res.id : null,
      error: res.ok ? null : res.error.slice(0, 200),
    });
  } catch {
    console.error(JSON.stringify({ emailLog: "write-failed", template: key }));
  }
  return res;
}
