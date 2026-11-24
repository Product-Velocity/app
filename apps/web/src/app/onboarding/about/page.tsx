import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { hasFinishedOnboarding, splitName } from "@/lib/onboarding";
import { Wizard } from "../wizard";
import { AboutForm } from "./form";

export const metadata = { title: "About you · Product Velocity" };

export default async function AboutPage() {
  const { user, active } = await requireWorkspace("/onboarding/about");
  if (active.isDemoAccount || active.platform || hasFinishedOnboarding(user.user_metadata, active.tenantId)) redirect("/portfolio");
  const { first: defaultFirst, last: defaultLast } = splitName(user.user_metadata);
  return (
    <Wizard step="about" title={`${active.tenantName} is ready`} intro="Two quick questions help us tune your first steps. You can skip them and change them later in your account.">
      <AboutForm defaultFirst={defaultFirst} defaultLast={defaultLast} />
    </Wizard>
  );
}
