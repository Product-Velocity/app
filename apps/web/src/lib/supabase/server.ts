import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

/**
 * Supabase client acting as the signed-in user (RLS applies). Used from server
 * components, server actions and route handlers. Writes are labelled "UI" in
 * the audit log through the x-pv-via header (see write_source() in the DB).
 */
export async function createClient() {
  const { url, anonKey } = supabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    global: { headers: { "x-pv-via": "UI" } },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // called from a server component: the proxy refreshes the session instead
        }
      },
    },
  });
}
