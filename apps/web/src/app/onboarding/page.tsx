import { redirect } from "next/navigation";
import { loadMemberships, requireUser } from "@/lib/session";
import { myAccessStates, syncDomainAccess } from "@/lib/access-requests";
import { domainOfEmail, isFreeMailDomain } from "@pv/domain";
import { countryOptions, currencyOptions, timeZoneOptions } from "@/lib/workspace-profile";
import { CreateTenantForm } from "./form";

export const metadata = { title: "Create your workspace · Product Velocity" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: wantsNew } = await searchParams;
  const { supabase, user } = await requireUser("/onboarding");
  if ((await loadMemberships(supabase, user.id)).length > 0) redirect("/portfolio");
  // someone at an authorized domain waits for their admin instead of starting a second workspace (they can still choose to)
  if (wantsNew !== "1") {
    const asked = user.email ? await syncDomainAccess(supabase, user.email) : [];
    if (asked.length > 0 || (await myAccessStates(supabase)).length > 0) redirect("/access-requested");
  }
  const domain = user.email ? domainOfEmail(user.email) : null;
  const suggested = domain && !isFreeMailDomain(domain) ? domain : "";
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>Create your workspace</h1>
        <p className="muted">
          You will be its first admin. You can invite your team next. If someone already invited
          you, open the invitation link they sent instead.
        </p>
        <CreateTenantForm suggestedDomain={suggested} countries={countryOptions()} currencies={currencyOptions()} timeZones={timeZoneOptions()} />
      </div>
    </main>
  );
}
