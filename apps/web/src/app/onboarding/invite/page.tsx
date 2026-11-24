import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { emailConfigured } from "@/lib/email/resend";
import { InviteForm } from "@/app/(workspace)/settings/members/forms";
import { Wizard } from "../wizard";
import { finishSetup } from "./actions";

export const metadata = { title: "Invite your team · Product Velocity" };

export default async function InviteStepPage() {
  const { active } = await requireWorkspace("/onboarding/invite");
  if (active.isDemoAccount || active.platform || active.role !== "admin") redirect("/portfolio");
  return (
    <Wizard step="invite" title="Invite your team" intro="Roadmaps work best with the people who build and decide on them. You review each invitation before anything is sent, and you can invite more people any time from Members.">
      <InviteForm workspaceName={active.tenantName} emailEnabled={emailConfigured()} />
      <form action={finishSetup} className="wizard-actions">
        <button className="btn btn-primary" type="submit">Continue</button>
        <button className="btn" type="submit">Skip for now</button>
      </form>
    </Wizard>
  );
}
