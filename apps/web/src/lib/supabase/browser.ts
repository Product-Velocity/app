import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";
import { screenOf } from "@/lib/account-path";

/**
 * Supabase client for the browser, acting as the signed-in user (RLS applies).
 * Used where edits must be instant and parallel, such as the roadmap grid.
 * Writes are labelled "UI" in the audit log through the x-pv-via header.
 */
export function createClient(via: "UI" | "import" = "UI") {
  const { url, anonKey } = supabaseEnv();
  // the screen is read when the request is made, so a client kept across tab changes still labels its writes correctly
  const withScreen: typeof fetch = (input, init) => {
    const screen = typeof window !== "undefined" ? screenOf(window.location.pathname) : null;
    if (!screen) return fetch(input, init);
    const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    h.set("x-pv-screen", screen);
    return fetch(input, { ...init, headers: h });
  };
  return createBrowserClient(url, anonKey, { global: { headers: { "x-pv-via": via }, fetch: withScreen } });
}
