import { redirect } from "next/navigation";
import { loadMemberships, requireUser } from "@/lib/session";
import { myAccessStates, syncDomainAccess } from "@/lib/access-requests";
import { domainOfEmail, isFreeMailDomain } from "@pv/domain";
import { countryOptions, currencyOptions, timeZoneOptions } from "@/lib/workspace-profile";
import { CreateTenantForm } from "./form";
import { Wizard } from "./wizard";

export const metadata = { title: "Create your workspace · Product Velocity" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: wantsNew } = await searchParams;
  const { supabase, user } = await requireUser("/onboarding");
  if (wantsNew !== "1" && (await loadMemberships(supabase, user.id)).length > 0) redirect("/portfolio"); // ?new=1 is the switcher's "+ New account"
  // someone at an authorized domain waits for their admin instead of starting a second workspace (they can still choose to)
  if (wantsNew !== "1") {
    const asked = user.email ? await syncDomainAccess(supabase, user.email) : [];
    if (asked.some((a) => a.joined)) redirect("/portfolio"); // joined as a Viewer through the authorized domain (issue #673)
    if (asked.length > 0 || (await myAccessStates(supabase)).length > 0) redirect("/access-requested");
  }
  const domain = user.email ? domainOfEmail(user.email) : null;
  const suggested = domain && !isFreeMailDomain(domain) ? domain : "";
  return (
    <Wizard
      step="workspace"
      title={wantsNew === "1" ? "Create a new account" : "Create your workspace"}
      intro="You will be its first admin. Next we ask two quick things about you, then you land on your roadmap. If someone already invited you, open the invitation link they sent instead."
    >
      <CreateTenantForm suggestedDomain={suggested} countries={countryOptions()} currencies={currencyOptions()} timeZones={timeZoneOptions()} />
    </Wizard>
  );
}
