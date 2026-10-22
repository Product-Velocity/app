import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/**
 * Supabase client for the browser, acting as the signed-in user (RLS applies).
 * Used where edits must be instant and parallel, such as the roadmap grid.
 * Writes are labelled "UI" in the audit log through the x-pv-via header.
 */
export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey, { global: { headers: { "x-pv-via": "UI" } } });
}
