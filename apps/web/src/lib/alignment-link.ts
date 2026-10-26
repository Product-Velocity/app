import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { hashInviteToken } from "@/lib/auth/invite-token";
import { createAdminClient } from "@/lib/supabase/admin";

export type LinkParticipant = {
  id: string; tenant_id: string; session_id: string; group_id: string; token_hash: string | null; browser_hash: string | null;
  consent_at: string | null; unsubscribed_at: string | null; removed_at: string | null; invited_at: string | null;
};
export type LinkSession = {
  id: string; name: string; status: string; method: string; closes_at: string | null; retention_months: number; show_results: boolean;
  coins_total: number; coins_max_per_item: number; groups: { id: string; name: string }[];
};
export type LinkState =
  | { kind: "unknown" }
  | { kind: "replaced"; participantId: string }
  | { kind: "ok"; participant: LinkParticipant; session: LinkSession; hash: string };

const COLUMNS = "id, tenant_id, session_id, group_id, token_hash, browser_hash, consent_at, unsubscribed_at, removed_at, invited_at";
export const browserCookie = (participantId: string) => `pv_a_${participantId.slice(0, 8)}`;
export const hashSecret = (secret: string) => createHash("sha256").update(secret, "utf8").digest("hex");
export const newBrowserSecret = () => randomBytes(32).toString("base64url");

/**
 * Finds the person behind a link. Reads only with the service role and only by the hash of a 256-bit token, so a guess finds nothing.
 * A link that was replaced by a newer one still finds its person ("replaced") so they can ask for a new one.
 */
export async function resolveLink(token: string): Promise<LinkState> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { kind: "unknown" };
  const admin = createAdminClient({ via: "system" });
  const hash = hashInviteToken(token);
  const { data: current } = await admin.from("alignment_participants").select(COLUMNS).eq("token_hash", hash).maybeSingle();
  let p = current as LinkParticipant | null;
  if (!p) {
    const { data: old } = await admin.from("alignment_participants").select("id").eq("prev_token_hash", hash).maybeSingle();
    return old ? { kind: "replaced", participantId: (old as { id: string }).id } : { kind: "unknown" };
  }
  if (p.removed_at) return { kind: "unknown" };
  const { data: s } = await admin.from("alignment_sessions").select("id, name, status, method, closes_at, retention_months, show_results, coins_total, coins_max_per_item, groups").eq("id", p.session_id).maybeSingle();
  if (!s) return { kind: "unknown" };
  p = { ...p };
  return { kind: "ok", participant: p, session: s as LinkSession, hash };
}

/** Is this the browser the link was first opened in? */
export async function sameBrowser(p: Pick<LinkParticipant, "id" | "browser_hash">): Promise<boolean> {
  if (!p.browser_hash) return false;
  const secret = (await cookies()).get(browserCookie(p.id))?.value;
  return !!secret && hashSecret(secret) === p.browser_hash;
}
