import { resolveLink } from "@/lib/alignment-link";
import { LinkButton } from "../join-form";
import { VoterShell } from "../voter-shell";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadVoterBrand, loadVoterBrandForParticipant } from "@/lib/brand/voter-brand-server";
import type { VoterBrandView } from "@/lib/brand/voter-brand";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const brand = await brandOf((await params).token);
  return { title: brand ? `Stop reminders · ${brand.name}` : "Stop reminders · Product Velocity", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
}

/** The company brand of the session behind the link, if it uses one (issue #750). */
async function brandOf(token: string): Promise<VoterBrandView | null> {
  const link = await resolveLink(token);
  const admin = createAdminClient({ via: "system" });
  return link.kind === "ok" ? loadVoterBrand(admin, link.participant.tenant_id, link.session.id) : link.kind === "replaced" ? loadVoterBrandForParticipant(admin, link.participantId) : null;
}
export const dynamic = "force-dynamic";

/** Reminders can be stopped from the email. The button is on this page (not the link itself) so a mail scanner opening the link changes nothing. */
export default async function StopRemindersPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveLink(token);
  const v = await brandOf(token);
  return (
    <VoterShell title="Stop reminders" brand={v ? { name: v.name, logoSrc: v.logoPath, vars: v.vars } : null}>
        {link.kind === "unknown" ? (
          <p className="muted">This link is not valid. Ask the person who invited you.</p>
        ) : (
          <>
            <p>You will not get more reminders for this session. You can still vote with your personal link until the session closes.</p>
            <LinkButton token={token} action="stop" label="Stop reminders" />
          </>
        )}
    </VoterShell>
  );
}
