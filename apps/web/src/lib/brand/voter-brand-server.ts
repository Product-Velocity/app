import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { voterBrandFor, type VoterBrandView } from "./voter-brand";

type Admin = ReturnType<typeof createAdminClient>;

/** The brand a voting session shows, read with the service role (voters have no account). See voter-brand.ts for the rule. */
export async function loadVoterBrand(admin: Admin, tenantId: string, sessionId: string): Promise<VoterBrandView | null> {
  const [{ data: s }, { data: b }, { data: t }] = await Promise.all([
    admin.from("alignment_sessions").select("use_brand").eq("id", sessionId).maybeSingle(),
    admin.from("workspace_brand").select("status, use_on_voting, display_name, primary_color, accent_color, logo_path, public_token").eq("tenant_id", tenantId).maybeSingle(),
    admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);
  return voterBrandFor((b as Parameters<typeof voterBrandFor>[0]) ?? null, (t as { name: string } | null)?.name ?? "", (s as { use_brand: boolean } | null)?.use_brand ?? true);
}

/** The same, from a participant (a replaced link only knows the person). */
export async function loadVoterBrandForParticipant(admin: Admin, participantId: string): Promise<VoterBrandView | null> {
  const { data: p } = await admin.from("alignment_participants").select("tenant_id, session_id").eq("id", participantId).maybeSingle();
  const row = p as { tenant_id: string; session_id: string } | null;
  return row ? loadVoterBrand(admin, row.tenant_id, row.session_id) : null;
}
