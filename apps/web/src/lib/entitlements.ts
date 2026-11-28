import type { requireWorkspace } from "@/lib/session";

type Supabase = Awaited<ReturnType<typeof requireWorkspace>>["supabase"];

/** The features a plan can include. Plans do not exist yet (Phase 9), so the database answers yes for every workspace; branding becomes a paid-plan feature then. */
export type Feature = "branding";

/** Whether the workspace's plan includes a feature. Asked in one place (the database function `tenant_has_feature`), so gating later is one change. */
export async function hasFeature(supabase: Supabase, tenantId: string, feature: Feature): Promise<boolean> {
  const { data } = await supabase.rpc("tenant_has_feature", { p_tenant: tenantId, p_feature: feature });
  return data !== false;
}
