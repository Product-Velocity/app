import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { Wizard } from "../wizard";
import { AboutForm } from "./form";

export const metadata = { title: "About you · Product Velocity" };

export default async function AboutPage() {
  const { user, active } = await requireWorkspace("/onboarding/about");
  if (active.isDemoAccount || active.platform) redirect("/portfolio");
  const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  return (
    <Wizard step="about" title={`${active.tenantName} is ready`} intro="Two quick questions help us tune your first steps. You can skip them and change them later in your account.">
      <AboutForm defaultName={name} />
    </Wizard>
  );
}
