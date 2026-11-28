import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseFileStore } from "@/lib/files/store";

/** What the public logo address needs: the brand row by its random token, and the file. Injected so the rule can be tested without a database. */
export type PublicLogoDeps = {
  brandByToken: (token: string) => Promise<{ status: string; logo_path: string | null; logo_sha: string | null } | null>;
  read: (path: string) => Promise<Uint8Array | null>;
};

/**
 * The public logo of a workspace (issue #750). Voters have no account, so the logo of a CONFIRMED brand is served without sign-in at an address that holds a random
 * token (not the workspace id). A draft brand, a missing logo, a wrong token or a missing file all answer the same "not found", so nothing about a workspace leaks.
 */
export async function loadPublicLogo(token: string, deps: PublicLogoDeps = defaultDeps()): Promise<{ bytes: Uint8Array; sha: string } | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const row = await deps.brandByToken(token);
  if (!row || row.status !== "confirmed" || !row.logo_path || !row.logo_sha) return null;
  const bytes = await deps.read(row.logo_path);
  return bytes ? { bytes, sha: row.logo_sha } : null;
}

function defaultDeps(): PublicLogoDeps {
  return {
    brandByToken: async (token) => {
      const { data } = await createAdminClient({ via: "system" }).from("workspace_brand").select("status, logo_path, logo_sha").eq("public_token", token).maybeSingle();
      return (data as { status: string; logo_path: string | null; logo_sha: string | null } | null) ?? null;
    },
    read: (path) => supabaseFileStore().get(path).catch(() => null),
  };
}
