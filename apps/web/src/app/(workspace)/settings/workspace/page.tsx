import { requireWorkspace } from "@/lib/session";
import { countryOptions, currencyOptions, timeZoneOptions } from "@/lib/workspace-profile";
import { WorkspaceForm } from "./form";

export const metadata = { title: "Workspace settings · Product Velocity" };

export default async function WorkspaceSettingsPage() {
  const { supabase, active } = await requireWorkspace("/settings/workspace");
  const { data } = await supabase.from("tenants").select("name, country, currency, time_zone, allowed_email_domains").eq("id", active.tenantId).single();
  const t = data as { name: string; country: string | null; currency: string | null; time_zone: string | null; allowed_email_domains: string[] } | null;
  return (
    <div className="page-narrow">
      <h1>Workspace settings</h1>
      <p className="muted">The organization profile and who can ask to join it.{active.role !== "admin" && " Only admins can change these."}</p>
      <div className="card">
        <WorkspaceForm
          canEdit={active.role === "admin"}
          countries={countryOptions()}
          currencies={currencyOptions()}
          timeZones={timeZoneOptions()}
          values={{ name: t?.name ?? active.tenantName, country: t?.country ?? "", currency: t?.currency ?? "", timeZone: t?.time_zone ?? "", domains: (t?.allowed_email_domains ?? []).join(", ") }}
        />
      </div>
    </div>
  );
}
