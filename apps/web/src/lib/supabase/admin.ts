import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client: bypasses RLS. Server-only (jobs, webhooks, migrations
 * support). Never import from a client component, and always scope queries by
 * tenant_id yourself. This is the ONLY file allowed to read the key
 * (see service-role.test.ts).
 */
export function createAdminClient(opts: { via?: "GitHub webhook" | "UI" | "system" } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // labels the write in the audit log (see write_source() in the database)
    global: { headers: { "x-pv-via": opts.via ?? "system" } },
  });
}
