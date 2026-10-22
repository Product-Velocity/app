import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";
import { MfaForm } from "./form";

export const metadata = { title: "Two-factor sign-in · Product Velocity" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.nextLevel !== "aal2" || aal.currentLevel === "aal2") redirect(next);

  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>Two-factor sign-in</h1>
        <p className="muted">Open your authenticator app and enter the current 6-digit code.</p>
        <MfaForm next={next} />
        <form action="/auth/sign-out" method="post">
          <button className="link-button" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
