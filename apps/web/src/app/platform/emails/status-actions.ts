"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/session";
import { forgetEmailStatus } from "@/lib/email/status";
import { EMAIL_TEMPLATES } from "@/lib/email/registry/registry";

/**
 * Switches one product email between Active and Paused (issue #634). Platform admins only (the database checks it too and writes the change to
 * the platform audit log). A sign-in, confirmation, reset or code email, or an alignment mailing, cannot be paused: pausing it would lock
 * people out or silently break a mailing a workspace admin confirmed.
 */
export async function setEmailStatus(form: FormData): Promise<void> {
  const key = String(form.get("key") ?? "");
  const status = form.get("status") === "paused" ? "paused" : "active";
  const t = EMAIL_TEMPLATES.find((x) => x.key === key);
  const { supabase } = await requirePlatformAdmin("/platform/emails");
  if (!t || t.alwaysOn) return;
  const { error } = await supabase.rpc("platform_email_set_status", { p_key: key, p_status: status });
  if (!error) forgetEmailStatus(key);
  revalidatePath("/platform/emails");
}
