import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { supabaseEnv } from "./env";

/**
 * Supabase client acting as the signed-in user (RLS applies). Used from server
 * components, server actions and route handlers. Writes are labelled "UI" in
 * the audit log through the x-pv-via header (see write_source() in the DB).
 */
export async function createClient() {
  // read cookies first: it marks the route as dynamic, so `next build` never
  // prerenders a page (and never needs the env vars) at build time
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseEnv();
  const screen = (await headers()).get("x-pv-screen"); // set by the proxy: the audit log shows which screen a change came from
  return createServerClient(url, anonKey, {
    global: { headers: { "x-pv-via": "UI", ...(screen ? { "x-pv-screen": screen } : {}) } },
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
