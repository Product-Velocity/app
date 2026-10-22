import { redirect } from "next/navigation";
import { loadMemberships, requireUser } from "@/lib/session";
import { CreateTenantForm } from "./form";

export const metadata = { title: "Create your workspace · Product Velocity" };

export default async function OnboardingPage() {
  const { supabase, user } = await requireUser("/onboarding");
  if ((await loadMemberships(supabase, user.id)).length > 0) redirect("/portfolio");
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>Create your workspace</h1>
        <p className="muted">
          You will be its first admin. You can invite your team next. If someone already invited
          you, open the invitation link they sent instead.
        </p>
        <CreateTenantForm />
      </div>
    </main>
  );
}
