import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { hasFinishedOnboarding, splitName } from "@/lib/onboarding";
import { Wizard } from "../wizard";
import { AboutForm } from "./form";

export const metadata = { title: "About you · Product Velocity" };

export default async function AboutPage() {
  const { supabase, user, active } = await requireWorkspace("/onboarding/about");
  if (active.isDemoAccount || active.platform || hasFinishedOnboarding(user.user_metadata, active.tenantId)) redirect("/portfolio");
  let { first: defaultFirst, last: defaultLast } = splitName(user.user_metadata);
  // someone who was named before they joined (a colleague typed their first and last name): use those until they write their own
  if (!defaultFirst) {
    const { data } = await supabase.rpc("person_names", { p_tenant: active.tenantId });
    const me = ((data ?? []) as { is_me: boolean; first_name: string | null; last_name: string | null }[]).find((r) => r.is_me);
    if (me?.first_name) { defaultFirst = me.first_name; defaultLast = me.last_name ?? ""; }
  }
  return (
    <Wizard step="about" title={`${active.tenantName} is ready`} intro="Two quick questions help us tune your first steps. You can skip them and change them later in your account.">
      <AboutForm defaultFirst={defaultFirst} defaultLast={defaultLast} />
    </Wizard>
  );
}
