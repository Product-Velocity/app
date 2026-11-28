import { formatDate, PROFILE_STALE_DAYS, summarizeProfile, type ProfileSections } from "@pv/domain";
import { requireWorkspace } from "@/lib/session";
import { ProfileForm } from "./form";
import { BrandCard, type BrandRow } from "./brand-card";
import { hasFeature } from "@/lib/entitlements";
import { supabaseFileStore } from "@/lib/files/store";

export const metadata = { title: "Company profile · Product Velocity" };

type Row = { status: string; version: number; ai_draft: boolean; researched_at: string | null; confirmed_at: string | null; sections: ProfileSections };

/** What Claude knows about the company (issue #269): the profile it drafts from public sources and an admin confirms. */
export default async function CompanyProfilePage() {
  const { supabase, active } = await requireWorkspace("/settings/company-profile");
  const [t, p] = await Promise.all([
    supabase.from("tenants").select("company_url").eq("id", active.tenantId).maybeSingle(),
    supabase.from("company_profiles").select("status, version, ai_draft, researched_at, confirmed_at, sections").eq("tenant_id", active.tenantId).maybeSingle(),
  ]);
  const url = (t.data as { company_url: string | null } | null)?.company_url ?? null;
  const row = (p.data as Row | null) ?? null;
  const sum = summarizeProfile(row);
  const day = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10), new Date()) : null);
  const isAdmin = active.role === "admin";
  // the brand (issue #750): the row, the logo as a data address for the preview (it is private until the brand is confirmed), and whether the plan has branding
  const { data: b } = await supabase.from("workspace_brand").select("display_name, primary_color, accent_color, heading_font, body_font, source, source_note, status, ai_draft, version, confirmed_at, use_on_voting, use_in_app, logo_path").eq("tenant_id", active.tenantId).maybeSingle();
  const brandRaw = (b as (Omit<BrandRow, "has_logo"> & { logo_path: string | null }) | null) ?? null;
  let logoDataUrl: string | null = null;
  if (brandRaw?.logo_path) { const bytes = await supabaseFileStore().get(brandRaw.logo_path).catch(() => null); if (bytes) logoDataUrl = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`; }
  const brand: BrandRow | null = brandRaw ? { ...brandRaw, has_logo: !!brandRaw.logo_path } : null;
  const brandAllowed = await hasFeature(supabase, active.tenantId, "branding");
  return (
    <div className="page-narrow">
      <h1>Company profile</h1>
      <p className="muted">What Claude knows about your company: what you do, who you serve and the words you use. Discovery and PRD documents use it so they sound like you.{!isAdmin && " Only admins can change it."}</p>
      <div className="card">
        <p role="status">
          {sum.state === "none" && <strong>Not set up yet.</strong>}
          {sum.state === "draft" && <strong>{sum.ai_draft ? "AI draft, not confirmed." : "Draft, not confirmed."}</strong>}
          {sum.state === "confirmed" && <strong>Confirmed{day(row?.confirmed_at ?? null) ? ` on ${day(row?.confirmed_at ?? null)}` : ""}.</strong>}
          {row?.researched_at && <> Researched {day(row.researched_at)}.</>}
          {sum.stale && <> It is more than {PROFILE_STALE_DAYS} days old: ask Claude to refresh it.</>}
        </p>
        <p className="hint">
          {url ? <>Company website: <a href={url} rel="noopener noreferrer" target="_blank">{url}</a>. </> : <>No company website set (add it under Workspace settings). </>}
          To build or refresh the profile, ask Claude to run <em>research company</em> (the <code>pv-company</code> prompt in the Product Velocity connector; it was called <code>research_company</code>). It reads public sources, shows you what it found, and saves a draft here. Nothing here is sent to GitHub.
        </p>
        <ProfileForm sections={(row?.sections ?? {}) as Record<string, string>} version={row?.version ?? null} canEdit={isAdmin} status={sum.state} />
      </div>
      {brandAllowed ? <BrandCard brand={brand} companyUrl={url} logoDataUrl={logoDataUrl} canEdit={isAdmin && !active.platform} /> : (
        <section className="card stack" id="brand"><h2>Brand</h2><p className="muted">Company branding is not part of this workspace&apos;s plan.</p></section>
      )}
    </div>
  );
}
