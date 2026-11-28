import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendLogged } from "@/lib/email/send";
import { loadEmailOverride } from "@/lib/email/override";
import { siteUrl } from "@/lib/site-url";
import { emailBrandFrom } from "@/lib/brand/voter-brand";
import { loadVoterBrand } from "@/lib/brand/voter-brand-server";
import type { SendDeps } from "@/lib/alignment-send";

/** The real dependencies of sendMailing: the service-role database, Resend and this deployment's address. */
export async function serverSendDeps(): Promise<SendDeps> {
  const admin = createAdminClient({ via: "UI" });
  return {
    rpc: (fn, args) => admin.rpc(fn, args) as never,
    mailing: async (id) => {
      const { data: m } = await admin.from("alignment_mailings").select("id, kind, subject, body, status, session_id").eq("id", id).maybeSingle();
      if (!m) return null;
      const { data: s } = await admin.from("alignment_sessions").select("name, closes_at, tenant_id").eq("id", m.session_id).maybeSingle();
      const site = await siteUrl();
      const brand = s?.tenant_id ? emailBrandFrom(await loadVoterBrand(admin, s.tenant_id as string, m.session_id as string), site) : null;
      return { id: m.id, kind: m.kind, subject: m.subject, body: m.body, status: m.status, sessionName: s?.name ?? "", closesAt: s?.closes_at ?? null, brand };
    },
    send: (key, m) => sendLogged(key, m),
    override: loadEmailOverride,
    site: await siteUrl(),
  };
}
