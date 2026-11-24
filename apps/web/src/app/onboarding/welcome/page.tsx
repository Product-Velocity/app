import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";
import { ROLE_HELP, ROLE_LABEL } from "@/lib/roles";
import { firstThings, hasFinishedOnboarding, splitName } from "@/lib/onboarding";
import { Wizard } from "../wizard";
import { AboutForm } from "../about/form";

export const metadata = { title: "Welcome · Product Velocity" };

/** The one screen after accepting an invitation: where you are, what you can do, how to start, and optional name and role. */
export default async function WelcomePage() {
  const { user, active } = await requireWorkspace("/onboarding/welcome");
  if (active.isDemoAccount || active.platform || hasFinishedOnboarding(user.user_metadata, active.tenantId)) redirect("/portfolio");
  const { first: defaultFirst, last: defaultLast } = splitName(user.user_metadata);
  const role = `${ROLE_LABEL[active.role]}${active.isApprover ? " and Approver" : ""}`;
  const things = firstThings(active.role === "creator" || active.role === "admin");
  return (
    <Wizard step="invited-welcome" title={`Welcome to ${active.tenantName}`} intro={`You joined as ${role} (${ROLE_HELP[active.role].toLowerCase()}). Product Velocity is one roadmap for humans and their AI, from company OKR to tracked outcome.`}>
      <section aria-labelledby="first-things">
        <h2 id="first-things" className="wizard-sub">Your first minute</h2>
        <ul className="first-things">
          {things.map((t) => (
            <li key={t.title}><strong>{t.title}</strong><span className="muted"> {t.text}</span></li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="about-you">
        <h2 id="about-you" className="wizard-sub">So your team knows who you are</h2>
        <AboutForm defaultFirst={defaultFirst} defaultLast={defaultLast} flow="invited" />
      </section>
    </Wizard>
  );
}
