import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { defaultEmailStatus, templateByKey, type EmailKey, type EmailStatus } from "./registry/registry";

/**
 * Active or Paused for one product email, switched in the platform Emails console (issue #634). Replaces the FOUNDER_EMAILS setting.
 * An email that is "always on" (sign-in, confirmation, reset and code emails, and alignment mailings a workspace admin confirmed) is never
 * paused, whatever the table says. With no row, or if the read fails, the template's own default applies: the personal notes Paused, the rest
 * Active, so a broken store never stops a sign-in link and never starts a note that has not been switched on.
 */
const TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: EmailStatus }>();

export async function emailStatus(key: EmailKey): Promise<EmailStatus> {
  const t = templateByKey(key);
  if (t.alwaysOn) return "active";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value = defaultEmailStatus(t);
  try {
    const { data, error } = await createAdminClient({ via: "system" }).rpc("email_template_status", { p_key: key });
    if (!error && (data === "active" || data === "paused")) value = data;
  } catch { /* the default stands */ }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** A switch made in the console shows at once on this server instance; other instances pick it up within the cache time. */
export const forgetEmailStatus = (key: string) => { cache.delete(key); };
