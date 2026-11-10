import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOverride, type OverrideRow } from "./override-core";
import type { EmailKey, TemplateText } from "./registry/registry";

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: Partial<TemplateText> | null }>();

/** Kill switch: EMAIL_TEMPLATE_OVERRIDES=off makes every email use its code default (nothing is read). */
const storeOff = () => process.env.EMAIL_TEMPLATE_OVERRIDES === "off";

async function fetchRow(key: EmailKey): Promise<OverrideRow | null> {
  const admin = createAdminClient({ via: "system" });
  const { data, error } = await admin.rpc("email_template_override", { p_key: key });
  if (error) throw new Error("read failed");
  const row = (Array.isArray(data) ? data[0] : data) as OverrideRow | null | undefined;
  return row ?? null;
}

/** The published wording to send for this email (cached for 30 seconds), or null for the code default. Never throws, never blocks an email. */
export async function loadEmailOverride(key: EmailKey): Promise<Partial<TemplateText> | null> {
  if (storeOff()) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await resolveOverride(key, fetchRow);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** A published change should show at once on this server instance; other instances pick it up within the cache time. */
export const forgetEmailOverride = (key: EmailKey) => { cache.delete(key); };
